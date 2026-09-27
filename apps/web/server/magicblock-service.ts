import {
  createHash,
  createPublicKey,
  randomUUID,
  timingSafeEqual,
  verify as verifySignature,
} from 'node:crypto';
import {
  Keypair,
  PublicKey,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import bs58 from 'bs58';
import { verifyTeeIntegrity } from '@magicblock-labs/ephemeral-rollups-sdk';
import { z } from 'zod';
import { MAGICBLOCK_TOKEN_MINT, USDC_MINT } from '../shared/constants.js';
import type {
  MagicBlockAction,
  MagicBlockBalance,
  MagicBlockExecution,
  MagicBlockPreparedTransaction,
  MagicBlockStatus,
} from '../shared/types.js';
import { config } from './config.js';
import { AppError } from './errors.js';
import { fetchJson } from './fetch-json.js';
import { TokenService } from './tokens.js';

const MAGICBLOCK_TOKEN_PROGRAM = new PublicKey('SPLxh1LVZzEkX99H6rqYizhytLWPZVV296zyYDPagv2');
const MAGICBLOCK_DELEGATION_PROGRAM = 'DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh';
const MAGICBLOCK_PERMISSION_PROGRAM = 'ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1';
const MAGICBLOCK_RUNTIME_PROGRAM = 'Magic11111111111111111111111111111111111111';
const SYSTEM_PROGRAM = '11111111111111111111111111111111';
const COMPUTE_BUDGET_PROGRAM = 'ComputeBudget111111111111111111111111111111';
const SESSION_TTL_MS = 10 * 60_000;
const CHALLENGE_TTL_MS = 2 * 60_000;
const PREPARED_TTL_MS = 75_000;
const TEE_ATTESTATION_TTL_MS = 5 * 60_000;

function isMockChallenge(challenge: string): boolean {
  return /^\s*MOCK\s*:/i.test(challenge);
}

function isMockToken(token: string): boolean {
  return /(^|[-_:])mock($|[-_:])/i.test(token);
}

const builderSchema = z.object({
  kind: z.enum(['deposit', 'transfer', 'withdraw']),
  version: z.enum(['legacy', 'v0']),
  transactionBase64: z.string().min(100).max(4_000).regex(/^[A-Za-z0-9+/]+={0,2}$/),
  sendTo: z.enum(['base', 'ephemeral']),
  recentBlockhash: z.string().min(32).max(44),
  lastValidBlockHeight: z.number().int().positive(),
  instructionCount: z.number().int().nonnegative(),
  requiredSigners: z.array(z.string().min(32).max(44)).min(1).max(4),
  validator: z.string().min(32).max(44).optional(),
  fees: z.object({
    lamports: z.string().regex(/^\d+$/),
    tokens: z.string().regex(/^\d+$/),
  }).optional(),
});

const balanceSchema = z.object({
  address: z.string(),
  mint: z.string(),
  ata: z.string(),
  location: z.enum(['base', 'ephemeral']),
  balance: z.string().regex(/^\d+$/),
});

const sendSchema = z.object({
  signature: z.string().min(80).max(90),
  sendTo: z.enum(['base', 'ephemeral']),
  confirmed: z.boolean(),
  confirmationRpcEndpoint: z.string().url(),
  confirmationRequiresAuthToken: z.boolean(),
});

interface ChallengeRecord {
  challenge: string;
  expiresAt: number;
}

interface SessionRecord {
  token: string;
  authorizedAt: number;
  expiresAt: number;
  receiptFingerprint: string;
}

interface PreparedRecord {
  public: MagicBlockPreparedTransaction;
  messageBytes: Uint8Array;
  recentBlockhash: string;
  lastValidBlockHeight: number;
  executed?: MagicBlockExecution;
}

interface StatusCache {
  expiresAt: number;
  value: MagicBlockStatus;
}

function magicUrl(path: string): URL {
  return new URL(path, config.magicBlockBaseUrl);
}

function magicTeeUrl(path: string): URL {
  return new URL(path, config.magicBlockTeeBaseUrl);
}

function magicHeaders(token?: string): HeadersInit {
  const headers: Record<string, string> = {
    accept: 'application/json',
    'user-agent': 'Flay-Convert/0.1',
  };
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

function encodePublicKeyForJwk(publicKey: string): string {
  return Buffer.from(new PublicKey(publicKey).toBytes()).toString('base64url');
}

function verifyWalletChallenge(wallet: string, challenge: string, encodedSignature: string): boolean {
  try {
    const signature = bs58.decode(encodedSignature);
    if (signature.length !== 64) return false;
    const publicKey = createPublicKey({
      key: {
        kty: 'OKP',
        crv: 'Ed25519',
        x: encodePublicKeyForJwk(wallet),
      },
      format: 'jwk',
    });
    return verifySignature(null, Buffer.from(challenge, 'utf8'), publicKey, signature);
  } catch {
    return false;
  }
}

function transactionFromBase64(value: string): VersionedTransaction {
  try {
    const bytes = Buffer.from(value, 'base64');
    if (bytes.length > 1_232) throw new Error('packet too large');
    return VersionedTransaction.deserialize(bytes);
  } catch {
    throw new AppError(502, 'MAGICBLOCK_TRANSACTION_INVALID', 'MagicBlock returned an invalid Solana transaction.', true);
  }
}

function messageParts(transaction: VersionedTransaction) {
  const message = transaction.message;
  if ('addressTableLookups' in message && message.addressTableLookups.length > 0) {
    throw new AppError(502, 'MAGICBLOCK_LOOKUP_UNSUPPORTED', 'MagicBlock returned a transaction with unresolved lookup tables.', true);
  }
  return {
    keys: message.staticAccountKeys,
    instructions: message.compiledInstructions,
    messageBytes: message.serialize(),
    recentBlockhash: message.recentBlockhash,
  };
}

function readU64Le(data: Uint8Array, offset: number): bigint | null {
  if (data.length < offset + 8) return null;
  return Buffer.from(data).readBigUInt64LE(offset);
}

function expectedKind(action: MagicBlockAction): 'deposit' | 'transfer' | 'withdraw' {
  if (action === 'deposit') return 'deposit';
  if (action === 'withdraw') return 'withdraw';
  return 'transfer';
}

function validateBuilderTransaction(
  transaction: VersionedTransaction,
  builder: z.infer<typeof builderSchema>,
  input: {
    action: MagicBlockAction;
    wallet: string;
    recipient?: string;
    amountAtomic: string;
  },
): { messageBytes: Uint8Array; messageHash: string } {
  const { keys, instructions, messageBytes, recentBlockhash } = messageParts(transaction);
  if (recentBlockhash !== builder.recentBlockhash) {
    throw new AppError(409, 'MAGICBLOCK_BLOCKHASH_MISMATCH', 'MagicBlock returned a transaction with a different blockhash than its review data.');
  }

  const keyStrings = keys.map((key) => key.toBase58());
  const payer = keyStrings[0];
  if (payer !== input.wallet) {
    throw new AppError(409, 'MAGICBLOCK_PAYER_MISMATCH', 'The MagicBlock transaction does not use your wallet as fee payer.');
  }
  if (builder.requiredSigners.length !== 1 || builder.requiredSigners[0] !== input.wallet) {
    throw new AppError(409, 'MAGICBLOCK_SIGNER_MISMATCH', 'The MagicBlock transaction requested an unexpected signer.');
  }
  if (transaction.message.header.numRequiredSignatures !== 1 || keyStrings[0] !== input.wallet) {
    throw new AppError(409, 'MAGICBLOCK_SIGNER_MISMATCH', 'The MagicBlock transaction has an unexpected signer policy.');
  }
  if (builder.kind !== expectedKind(input.action)) {
    throw new AppError(409, 'MAGICBLOCK_ACTION_MISMATCH', 'MagicBlock built a different action than the one reviewed.');
  }

  const expectedDestination = input.action === 'deposit' || input.action === 'withdraw' ? 'base' : 'ephemeral';
  if (builder.sendTo !== expectedDestination) {
    throw new AppError(409, 'MAGICBLOCK_NETWORK_MISMATCH', 'MagicBlock selected an unexpected submission network.');
  }

  const allowedPrograms = new Set([
    SYSTEM_PROGRAM,
    TOKEN_PROGRAM_ID.toBase58(),
    ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
    MAGICBLOCK_TOKEN_PROGRAM.toBase58(),
    MAGICBLOCK_DELEGATION_PROGRAM,
    MAGICBLOCK_PERMISSION_PROGRAM,
    MAGICBLOCK_RUNTIME_PROGRAM,
    COMPUTE_BUDGET_PROGRAM,
  ]);
  const invoked = instructions.map((instruction) => {
    const program = keys[instruction.programIdIndex];
    if (!program) throw new AppError(409, 'MAGICBLOCK_PROGRAM_INDEX_INVALID', 'MagicBlock returned an invalid program index.');
    return program.toBase58();
  });
  const unknownPrograms = [...new Set(invoked.filter((program) => !allowedPrograms.has(program)))];
  if (unknownPrograms.length) {
    throw new AppError(409, 'MAGICBLOCK_PROGRAM_NOT_ALLOWED', 'The MagicBlock transaction invokes an unreviewed program.', false, { programs: unknownPrograms });
  }

  const mint = new PublicKey(MAGICBLOCK_TOKEN_MINT);
  const wallet = new PublicKey(input.wallet);
  const walletAta = getAssociatedTokenAddressSync(mint, wallet).toBase58();
  const amount = BigInt(input.amountAtomic);

  if (input.action === 'deposit' || input.action === 'withdraw') {
    if (!keyStrings.includes(USDC_MINT) || !keyStrings.includes(walletAta) || !invoked.includes(MAGICBLOCK_TOKEN_PROGRAM.toBase58())) {
      throw new AppError(409, 'MAGICBLOCK_ACCOUNT_MISMATCH', 'The MagicBlock transaction does not contain the reviewed USDC account path.');
    }
    const discriminator = input.action === 'deposit' ? 24 : 26;
    const amountFound = instructions.some((instruction, index) => (
      invoked[index] === MAGICBLOCK_TOKEN_PROGRAM.toBase58()
      && instruction.data[0] === discriminator
      && readU64Le(instruction.data, 5) === amount
    ));
    if (!amountFound) {
      throw new AppError(409, 'MAGICBLOCK_AMOUNT_MISMATCH', 'The MagicBlock transaction does not contain the reviewed amount.');
    }
  } else {
    if (!input.recipient) throw new AppError(500, 'MAGICBLOCK_POLICY_MISSING', 'The transfer recipient policy is missing.');
    const recipientAta = getAssociatedTokenAddressSync(mint, new PublicKey(input.recipient)).toBase58();
    if (!keyStrings.includes(walletAta) || !keyStrings.includes(recipientAta)) {
      throw new AppError(409, 'MAGICBLOCK_RECIPIENT_MISMATCH', 'The MagicBlock transaction does not use the reviewed sender and recipient token accounts.');
    }
    const transferFound = instructions.some((instruction, index) => (
      invoked[index] === TOKEN_PROGRAM_ID.toBase58()
      && instruction.data[0] === 3
      && readU64Le(instruction.data, 1) === amount
    ));
    if (!transferFound) {
      throw new AppError(409, 'MAGICBLOCK_AMOUNT_MISMATCH', 'The MagicBlock transfer does not contain the reviewed amount.');
    }
    const magicInvoked = invoked.includes(MAGICBLOCK_TOKEN_PROGRAM.toBase58());
    if ((input.action === 'private-transfer') !== magicInvoked) {
      throw new AppError(409, 'MAGICBLOCK_VISIBILITY_MISMATCH', 'The MagicBlock transfer visibility does not match the reviewed mode.');
    }
  }

  if (instructions.length !== builder.instructionCount) {
    throw new AppError(409, 'MAGICBLOCK_INSTRUCTION_COUNT_MISMATCH', 'MagicBlock transaction instructions differ from its review data.');
  }

  return {
    messageBytes,
    messageHash: createHash('sha256').update(messageBytes).digest('hex'),
  };
}

function assertSignedMessage(
  signed: VersionedTransaction,
  record: PreparedRecord,
  wallet: string,
): void {
  const { messageBytes } = messageParts(signed);
  if (
    messageBytes.length !== record.messageBytes.length
    || !timingSafeEqual(Buffer.from(messageBytes), Buffer.from(record.messageBytes))
  ) {
    throw new AppError(409, 'MAGICBLOCK_TRANSACTION_CHANGED', 'The signed MagicBlock transaction no longer matches the exact review.');
  }
  const signature = signed.signatures[0];
  if (!signature || !signature.some((byte) => byte !== 0)) {
    throw new AppError(400, 'MAGICBLOCK_SIGNATURE_MISSING', 'The MagicBlock transaction was not signed.');
  }
  try {
    const publicKey = createPublicKey({
      key: { kty: 'OKP', crv: 'Ed25519', x: encodePublicKeyForJwk(wallet) },
      format: 'jwk',
    });
    if (!verifySignature(null, Buffer.from(messageBytes), publicKey, signature)) {
      throw new Error('signature mismatch');
    }
  } catch {
    throw new AppError(409, 'MAGICBLOCK_SIGNATURE_INVALID', 'The transaction signature does not match your embedded wallet.');
  }
}

function explorer(signature: string, sendTo: 'base' | 'ephemeral'): string | null {
  return sendTo === 'base'
    ? `https://explorer.solana.com/tx/${signature}?cluster=mainnet-beta`
    : null;
}

export class MagicBlockService {
  constructor(
    private readonly tokens: TokenService,
    private readonly verifyTee: (url: string) => Promise<void> = verifyTeeIntegrity,
  ) {}

  private readonly challenges = new Map<string, ChallengeRecord>();
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly prepared = new Map<string, PreparedRecord>();
  private statusCache: StatusCache | null = null;
  private teeAttestedUntil = 0;
  private teeVerification: Promise<void> | null = null;

  async status(): Promise<MagicBlockStatus> {
    if (this.statusCache && this.statusCache.expiresAt > Date.now()) return this.statusCache.value;
    try {
      const probeWallet = Keypair.generate().publicKey.toBase58();
      const [health, mintStatus, authorization] = await Promise.all([
        fetchJson<{ status?: string }>(magicUrl('/health'), {
          provider: 'MagicBlock',
          headers: magicHeaders(),
          timeoutMs: config.magicBlockTimeoutMs,
          maxBytes: 32_000,
        }),
        fetchJson<{ initialized?: boolean }>(magicUrl(`/v1/spl/is-mint-initialized?mint=${MAGICBLOCK_TOKEN_MINT}&cluster=mainnet`), {
          provider: 'MagicBlock',
          headers: magicHeaders(),
          timeoutMs: config.magicBlockTimeoutMs,
          maxBytes: 32_000,
        }),
        fetchJson<{ challenge?: string }>(magicTeeUrl(`/auth/challenge?pubkey=${probeWallet}`), {
          provider: 'MagicBlock',
          headers: magicHeaders(),
          timeoutMs: config.magicBlockTimeoutMs,
          maxBytes: 32_000,
        }),
        this.assertTeeIntegrity(),
      ]);
      const challenge = authorization.challenge ?? '';
      const mockAuthorization = isMockChallenge(challenge);
      const authorizationVerified = challenge.length >= 20 && !mockAuthorization;
      const apiHealthy = health.status === 'ok';
      const value: MagicBlockStatus = {
        available: apiHealthy && authorizationVerified,
        cluster: 'mainnet',
        token: { mint: MAGICBLOCK_TOKEN_MINT, symbol: 'USDC', decimals: 6 },
        mintInitialized: mintStatus.initialized === true,
        privateTransfers: apiHealthy && authorizationVerified && mintStatus.initialized === true,
        teeAttested: true,
        authorizationMode: mockAuthorization ? 'mock' : authorizationVerified ? 'verified' : 'unavailable',
        detail: mockAuthorization
          ? 'MagicBlock mainnet is returning mock authorization. Private PER access is paused until the provider enables verified wallet authentication.'
          : authorizationVerified
            ? 'MagicBlock mainnet TEE attestation and wallet authorization are verified.'
            : 'MagicBlock did not return a usable private-authorization challenge.',
        checkedAt: Date.now(),
        provider: 'MagicBlock Ephemeral SPL Token',
      };
      this.statusCache = { value, expiresAt: Date.now() + 10_000 };
      return value;
    } catch {
      return {
        available: false,
        cluster: 'mainnet',
        token: { mint: MAGICBLOCK_TOKEN_MINT, symbol: 'USDC', decimals: 6 },
        mintInitialized: false,
        privateTransfers: false,
        teeAttested: false,
        authorizationMode: 'unavailable',
        detail: 'MagicBlock mainnet TEE attestation or private authorization could not be verified. Try again after the provider recovers.',
        checkedAt: Date.now(),
        provider: 'MagicBlock Ephemeral SPL Token',
      };
    }
  }

  async challenge(wallet: string): Promise<{ challenge: string; expiresAt: number }> {
    this.sweep();
    await this.assertTeeIntegrity();
    const response = await fetchJson<{ challenge?: string }>(
      magicTeeUrl(`/auth/challenge?pubkey=${wallet}`),
      {
        provider: 'MagicBlock',
        headers: magicHeaders(),
        timeoutMs: config.magicBlockTimeoutMs,
        maxBytes: 32_000,
      },
    );
    if (!response.challenge || response.challenge.length < 20 || response.challenge.length > 1_000) {
      throw new AppError(502, 'MAGICBLOCK_CHALLENGE_INVALID', 'MagicBlock returned an invalid wallet challenge.', true);
    }
    if (isMockChallenge(response.challenge)) {
      throw new AppError(
        503,
        'MAGICBLOCK_AUTH_MOCK',
        'MagicBlock mainnet is currently returning mock authorization. Flay will not request a wallet signature until verified private access is live.',
        true,
      );
    }
    const record = { challenge: response.challenge, expiresAt: Date.now() + CHALLENGE_TTL_MS };
    this.challenges.set(wallet, record);
    return record;
  }

  async login(wallet: string, challenge: string, signature: string): Promise<{ unlocked: true; expiresAt: number }> {
    this.sweep();
    const record = this.challenges.get(wallet);
    this.challenges.delete(wallet);
    if (!record || record.expiresAt <= Date.now() || record.challenge !== challenge) {
      throw new AppError(410, 'MAGICBLOCK_CHALLENGE_EXPIRED', 'The MagicBlock challenge expired. Request a fresh one.', true);
    }
    if (!verifyWalletChallenge(wallet, challenge, signature)) {
      throw new AppError(401, 'MAGICBLOCK_SIGNATURE_INVALID', 'The MagicBlock challenge signature does not match your wallet.');
    }
    const response = await fetchJson<{ token?: string }>(magicTeeUrl('/auth/login'), {
      provider: 'MagicBlock',
      method: 'POST',
      headers: { ...magicHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ pubkey: wallet, challenge, signature }),
      timeoutMs: config.magicBlockTimeoutMs,
      maxBytes: 32_000,
    });
    if (!response.token || response.token.length < 8 || response.token.length > 8_000) {
      throw new AppError(502, 'MAGICBLOCK_TOKEN_INVALID', 'MagicBlock returned an invalid authorization session.', true);
    }
    if (isMockToken(response.token)) {
      throw new AppError(503, 'MAGICBLOCK_AUTH_MOCK', 'MagicBlock returned a mock authorization token. Flay refused to unlock private access.', true);
    }
    const authorizedAt = Date.now();
    const expiresAt = authorizedAt + SESSION_TTL_MS;
    const receiptFingerprint = createHash('sha256')
      .update(`${wallet}:${challenge}:${signature}:${response.token}`)
      .digest('hex')
      .slice(0, 24);
    this.sessions.set(wallet, { token: response.token, authorizedAt, expiresAt, receiptFingerprint });
    return { unlocked: true, expiresAt };
  }

  async balance(wallet: string): Promise<MagicBlockBalance> {
    const session = this.session(wallet);
    const response = balanceSchema.parse(await fetchJson(
      magicUrl(`/v1/spl/private-balance?address=${wallet}&mint=${MAGICBLOCK_TOKEN_MINT}&cluster=mainnet`),
      {
        provider: 'MagicBlock',
        headers: magicHeaders(session.token),
        timeoutMs: config.magicBlockTimeoutMs,
        maxBytes: 32_000,
      },
    ));
    if (response.address !== wallet || response.mint !== MAGICBLOCK_TOKEN_MINT || response.location !== 'ephemeral') {
      throw new AppError(409, 'MAGICBLOCK_BALANCE_MISMATCH', 'MagicBlock returned a balance for a different account.');
    }
    return {
      wallet,
      mint: response.mint,
      symbol: 'USDC',
      decimals: 6,
      amountAtomic: response.balance,
      uiAmount: (Number(response.balance) / 1_000_000).toFixed(6).replace(/\.?0+$/, ''),
      location: 'ephemeral',
      protected: true,
      unlockedUntil: session.expiresAt,
      fetchedAt: Date.now(),
      authorization: {
        source: 'MagicBlock mainnet TEE',
        walletSignature: 'verified',
        teeAttestation: 'verified',
        providerToken: 'accepted',
        receiptFingerprint: session.receiptFingerprint,
        authorizedAt: session.authorizedAt,
        expiresAt: session.expiresAt,
      },
    };
  }

  async prepare(input: {
    action: MagicBlockAction;
    wallet: string;
    recipient?: string;
    amountAtomic: string;
  }): Promise<MagicBlockPreparedTransaction> {
    this.sweep();
    const status = await this.status();
    if (!status.available) throw new AppError(503, 'MAGICBLOCK_UNAVAILABLE', status.detail, true);
    if (!status.mintInitialized) throw new AppError(409, 'MAGICBLOCK_MINT_UNAVAILABLE', 'MagicBlock has not initialized mainnet USDC for ephemeral transfers.');

    const amount = Number(input.amountAtomic);
    if (!Number.isSafeInteger(amount) || amount < 1) {
      throw new AppError(400, 'MAGICBLOCK_AMOUNT_UNSUPPORTED', 'Enter a positive USDC amount within the provider integer limit.');
    }

    const session = this.session(input.wallet);
    if (input.action === 'deposit') {
      const baseBalances = await this.tokens.balances(input.wallet);
      const baseUsdc = baseBalances.balances.find((item) => item.token.mint === MAGICBLOCK_TOKEN_MINT);
      if (!baseUsdc || BigInt(baseUsdc.amountAtomic) < BigInt(input.amountAtomic)) {
        throw new AppError(409, 'MAGICBLOCK_BASE_BALANCE_LOW', 'Your Solana wallet does not have enough confirmed USDC for this deposit.');
      }
    } else {
      const ephemeral = await this.balance(input.wallet);
      if (BigInt(ephemeral.amountAtomic) < BigInt(input.amountAtomic)) {
        throw new AppError(409, 'MAGICBLOCK_EPHEMERAL_BALANCE_LOW', 'Your MagicBlock balance does not have enough USDC for this action.');
      }
    }

    let path: string;
    let body: Record<string, unknown>;
    if (input.action === 'deposit') {
      path = '/v1/spl/deposit';
      body = {
        owner: input.wallet,
        mint: MAGICBLOCK_TOKEN_MINT,
        amount,
        cluster: 'mainnet',
        initIfMissing: true,
        initVaultIfMissing: true,
        initAtasIfMissing: true,
        idempotent: true,
      };
    } else if (input.action === 'withdraw') {
      path = '/v1/spl/withdraw';
      body = {
        owner: input.wallet,
        mint: MAGICBLOCK_TOKEN_MINT,
        amount,
        cluster: 'mainnet',
        initIfMissing: true,
        initAtasIfMissing: true,
        idempotent: true,
      };
    } else {
      if (!input.recipient) throw new AppError(400, 'MAGICBLOCK_RECIPIENT_REQUIRED', 'Enter a Solana recipient address.');
      path = '/v1/spl/transfer';
      body = {
        from: input.wallet,
        to: input.recipient,
        mint: MAGICBLOCK_TOKEN_MINT,
        amount,
        cluster: 'mainnet',
        visibility: 'private',
        fromBalance: 'ephemeral',
        toBalance: 'ephemeral',
        exactOut: false,
        initIfMissing: true,
        initAtasIfMissing: true,
        initVaultIfMissing: false,
        minDelayMs: '0',
        maxDelayMs: '1000',
        split: 1,
      };
    }

    const builder = builderSchema.parse(await fetchJson(magicUrl(path), {
      provider: 'MagicBlock',
      method: 'POST',
      headers: { ...magicHeaders(session.token), 'content-type': 'application/json' },
      body: JSON.stringify(body),
      timeoutMs: config.magicBlockTimeoutMs,
      maxBytes: 64_000,
    }));
    const transaction = transactionFromBase64(builder.transactionBase64);
    const validated = validateBuilderTransaction(transaction, builder, input);
    const preparedId = randomUUID();
    const expiresAt = Date.now() + PREPARED_TTL_MS;
    const publicRecord: MagicBlockPreparedTransaction = {
      preparedId,
      action: input.action,
      provider: 'MagicBlock Ephemeral SPL Token',
      wallet: input.wallet,
      recipient: input.recipient ?? null,
      mint: MAGICBLOCK_TOKEN_MINT,
      symbol: 'USDC',
      decimals: 6,
      amountAtomic: input.amountAtomic,
      transaction: builder.transactionBase64,
      messageHash: validated.messageHash,
      sendTo: builder.sendTo,
      expiresAt,
      review: {
        mode: input.action === 'private-transfer'
          ? 'PER · permissioned'
          : input.action === 'deposit'
            ? 'Solana → MagicBlock'
            : 'MagicBlock → Solana',
        source: input.action === 'deposit' ? 'Solana wallet' : 'MagicBlock ephemeral balance',
        destination: input.action === 'withdraw'
          ? 'Solana wallet'
          : input.action === 'deposit'
            ? 'MagicBlock ephemeral balance'
            : input.recipient!,
        providerFees: builder.fees ?? { lamports: '0', tokens: '0' },
        warnings: input.action === 'private-transfer'
          ? [
              'Permissioned state and the internal transfer execute through MagicBlock PER using Intel TDX.',
              'Deposits, withdrawals, and information later settled publicly on Solana remain observable.',
            ]
          : input.action === 'deposit'
            ? [
                  'This Solana transaction moves USDC into a separate MagicBlock ephemeral balance.',
                  'The deposit and its base-layer wallet balance are publicly observable.',
                ]
            : [
                'This transaction returns USDC to the Solana wallet.',
                'The withdrawal and resulting base-layer balance are publicly observable.',
              ],
      },
    };
    this.prepared.set(preparedId, {
      public: publicRecord,
      messageBytes: validated.messageBytes,
      recentBlockhash: builder.recentBlockhash,
      lastValidBlockHeight: builder.lastValidBlockHeight,
    });
    return publicRecord;
  }

  async execute(preparedId: string, wallet: string, signedBase64: string): Promise<MagicBlockExecution> {
    this.sweep();
    const record = this.prepared.get(preparedId);
    if (!record || record.public.expiresAt <= Date.now()) {
      throw new AppError(410, 'MAGICBLOCK_PREPARED_EXPIRED', 'This MagicBlock transaction expired. Review a fresh one.', true);
    }
    if (record.public.wallet !== wallet) {
      throw new AppError(403, 'MAGICBLOCK_WALLET_MISMATCH', 'This MagicBlock review belongs to another wallet.');
    }
    if (record.executed) return record.executed;

    const signed = transactionFromBase64(signedBase64);
    assertSignedMessage(signed, record, wallet);
    const session = this.session(wallet);
    const sendTo = record.public.sendTo;
    const response = sendSchema.parse(await fetchJson(magicUrl('/v1/transaction/send'), {
      provider: 'MagicBlock',
      method: 'POST',
      headers: { ...magicHeaders(session.token), 'content-type': 'application/json' },
      body: JSON.stringify({
        transactionBase64: signedBase64,
        sendTo,
        cluster: record.public.action === 'private-transfer' ? 'mainnet-private' : 'mainnet',
        confirm: true,
        recentBlockhash: record.recentBlockhash,
        lastValidBlockHeight: record.lastValidBlockHeight,
        skipPreflight: false,
        maxRetries: 2,
      }),
      timeoutMs: 45_000,
      maxBytes: 64_000,
    }));
    if (response.sendTo !== sendTo) {
      throw new AppError(409, 'MAGICBLOCK_SUBMISSION_MISMATCH', 'MagicBlock submitted the transaction to an unexpected network.');
    }
    const result: MagicBlockExecution = {
      signature: response.signature,
      confirmed: response.confirmed,
      sendTo: response.sendTo,
      networkLabel: response.sendTo === 'base' ? 'Solana mainnet' : 'MagicBlock ephemeral rollup',
      explorerUrl: explorer(response.signature, response.sendTo),
      provider: 'MagicBlock Ephemeral SPL Token',
    };
    record.executed = result;
    return result;
  }

  private session(wallet: string): SessionRecord {
    this.sweep();
    const session = this.sessions.get(wallet);
    if (!session || session.expiresAt <= Date.now()) {
      this.sessions.delete(wallet);
      throw new AppError(401, 'MAGICBLOCK_UNLOCK_REQUIRED', 'Unlock the MagicBlock account with a wallet signature first.', true);
    }
    return session;
  }

  private async assertTeeIntegrity(): Promise<void> {
    if (this.teeAttestedUntil > Date.now()) return;
    if (!this.teeVerification) {
      this.teeVerification = this.verifyTee(config.magicBlockTeeBaseUrl)
        .then(() => {
          this.teeAttestedUntil = Date.now() + TEE_ATTESTATION_TTL_MS;
        })
        .finally(() => {
          this.teeVerification = null;
        });
    }
    await this.teeVerification;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [wallet, record] of this.challenges) if (record.expiresAt <= now) this.challenges.delete(wallet);
    for (const [wallet, record] of this.sessions) if (record.expiresAt <= now) this.sessions.delete(wallet);
    for (const [id, record] of this.prepared) if (record.public.expiresAt + 10 * 60_000 <= now) this.prepared.delete(id);
  }
}
