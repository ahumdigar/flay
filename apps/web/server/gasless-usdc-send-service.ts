import { createHash, randomUUID } from 'node:crypto';
import {
  TOKEN_PROGRAM_ID,
  createTransferCheckedInstruction,
  decodeTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  unpackAccount,
} from '@solana/spl-token';
import {
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  type AccountInfo,
  type BlockhashWithExpiryBlockHeight,
  type SimulatedTransactionResponse,
  type SignatureStatus,
  type VersionedTransactionResponse,
} from '@solana/web3.js';
import { atomicToDecimal } from '../shared/amounts.js';
import { USDC_MINT } from '../shared/constants.js';
import type { GaslessUsdcSendPrepared, GaslessUsdcSendStatus } from '../shared/types.js';
import { AppError } from './errors.js';
import { withRpcFallback } from './rpc.js';
import type { TokenService } from './tokens.js';

const USDC_DECIMALS = 6;
const PREPARED_TTL_MS = 90_000;

export interface GaslessUsdcSendRpc {
  accountInfo(address: PublicKey): Promise<AccountInfo<Buffer> | null>;
  latestBlockhash(): Promise<BlockhashWithExpiryBlockHeight>;
  simulate(transaction: VersionedTransaction): Promise<SimulatedTransactionResponse>;
  transaction(signature: string): Promise<VersionedTransactionResponse | null>;
  signatureStatus(signature: string): Promise<SignatureStatus | null>;
}

const liveRpc: GaslessUsdcSendRpc = {
  accountInfo: (address) => withRpcFallback((rpc) => rpc.getAccountInfo(address, 'confirmed')),
  latestBlockhash: () => withRpcFallback((rpc) => rpc.getLatestBlockhash('confirmed')),
  simulate: async (transaction) => {
    const result = await withRpcFallback((rpc) => rpc.simulateTransaction(transaction, {
      commitment: 'confirmed',
      sigVerify: false,
    }));
    return result.value;
  },
  transaction: (signature) => withRpcFallback((rpc) => rpc.getTransaction(signature, {
    commitment: 'confirmed',
    maxSupportedTransactionVersion: 0,
  })),
  signatureStatus: async (signature) => {
    const result = await withRpcFallback((rpc) => rpc.getSignatureStatuses([signature], { searchTransactionHistory: true }));
    return result.value[0];
  },
};

export function validateGaslessUsdcSendTransaction(
  transaction: VersionedTransaction,
  expected: { wallet: string; recipient: string; amountAtomic: string },
): void {
  if (transaction.message.addressTableLookups.length !== 0) {
    throw new AppError(409, 'SEND_LOOKUP_TABLE_FORBIDDEN', 'The USDC send transaction contains an unexpected lookup table.');
  }
  if (transaction.message.header.numRequiredSignatures !== 1) {
    throw new AppError(409, 'SEND_SIGNER_MISMATCH', 'The USDC send transaction contains an unexpected signer policy.');
  }
  const wallet = new PublicKey(expected.wallet);
  const recipient = new PublicKey(expected.recipient);
  const mint = new PublicKey(USDC_MINT);
  const sourceAta = getAssociatedTokenAddressSync(mint, wallet);
  const recipientAta = getAssociatedTokenAddressSync(mint, recipient);
  if (!transaction.message.staticAccountKeys[0]?.equals(wallet)) {
    throw new AppError(409, 'SEND_PAYER_MISMATCH', 'The prepared transaction is not bound to the authenticated wallet.');
  }

  let instructions;
  try {
    instructions = TransactionMessage.decompile(transaction.message).instructions;
  } catch {
    throw new AppError(409, 'SEND_TRANSACTION_INVALID', 'The prepared USDC transaction could not be decoded.');
  }
  if (instructions.length !== 1 || !instructions[0]?.programId.equals(TOKEN_PROGRAM_ID)) {
    throw new AppError(409, 'SEND_INSTRUCTION_FORBIDDEN', 'The gasless send may contain only one SPL Token instruction.');
  }
  try {
    const decoded = decodeTransferCheckedInstruction(instructions[0], TOKEN_PROGRAM_ID);
    if (
      !decoded.keys.source.pubkey.equals(sourceAta)
      || !decoded.keys.mint.pubkey.equals(mint)
      || !decoded.keys.destination.pubkey.equals(recipientAta)
      || !decoded.keys.owner.pubkey.equals(wallet)
      || decoded.keys.multiSigners.length !== 0
      || decoded.data.amount !== BigInt(expected.amountAtomic)
      || decoded.data.decimals !== USDC_DECIMALS
    ) {
      throw new Error('review mismatch');
    }
  } catch {
    throw new AppError(409, 'SEND_REVIEW_MISMATCH', 'The prepared USDC transfer differs from the reviewed recipient or amount.');
  }
}

export class GaslessUsdcSendService {
  private readonly prepared = new Map<string, { expiresAt: number; wallet: string }>();

  constructor(
    private readonly tokens: TokenService,
    private readonly rpc: GaslessUsdcSendRpc = liveRpc,
  ) {}

  async prepare(input: { wallet: string; recipient: string; amountAtomic: string }): Promise<GaslessUsdcSendPrepared> {
    this.sweep();
    const wallet = new PublicKey(input.wallet);
    const recipient = new PublicKey(input.recipient);
    if (wallet.equals(recipient)) {
      throw new AppError(400, 'SEND_SELF_RECIPIENT', 'Enter a recipient other than your own wallet.');
    }
    if (!PublicKey.isOnCurve(recipient.toBytes())) {
      throw new AppError(400, 'SEND_RECIPIENT_OFF_CURVE', 'Enter a user-controlled Solana wallet address. Program addresses are not supported in this send flow.');
    }
    const amount = BigInt(input.amountAtomic);
    if (amount < 1n || amount > 18_446_744_073_709_551_615n) {
      throw new AppError(400, 'SEND_AMOUNT_INVALID', 'Enter a positive USDC amount within the Solana token limit.');
    }

    const balances = await this.tokens.balances(input.wallet);
    const usdc = balances.balances.find((item) => item.token.mint === USDC_MINT);
    if (!usdc || BigInt(usdc.amountAtomic) < amount) {
      throw new AppError(409, 'SEND_USDC_BALANCE_LOW', 'Your wallet does not contain enough confirmed USDC.');
    }

    const mint = new PublicKey(USDC_MINT);
    const sourceAta = getAssociatedTokenAddressSync(mint, wallet);
    const recipientAta = getAssociatedTokenAddressSync(mint, recipient);
    const [sourceInfo, recipientInfo, blockhash] = await Promise.all([
      this.rpc.accountInfo(sourceAta),
      this.rpc.accountInfo(recipientAta),
      this.rpc.latestBlockhash(),
    ]);
    this.assertUsdcAccount(sourceAta, sourceInfo, wallet, 'sender');
    this.assertUsdcAccount(recipientAta, recipientInfo, recipient, 'recipient');

    const instruction = createTransferCheckedInstruction(
      sourceAta,
      mint,
      recipientAta,
      wallet,
      amount,
      USDC_DECIMALS,
      [],
      TOKEN_PROGRAM_ID,
    );
    const message = new TransactionMessage({
      payerKey: wallet,
      recentBlockhash: blockhash.blockhash,
      instructions: [instruction],
    }).compileToV0Message();
    const transaction = new VersionedTransaction(message);
    validateGaslessUsdcSendTransaction(transaction, input);

    const simulation = await this.rpc.simulate(transaction);
    if (simulation.err) {
      throw new AppError(409, 'SEND_SIMULATION_FAILED', 'Solana rejected this USDC send during simulation.', true, {
        error: JSON.stringify(simulation.err).slice(0, 300),
      });
    }

    const transactionBytes = transaction.serialize();
    const preparedId = randomUUID();
    const expiresAt = Date.now() + PREPARED_TTL_MS;
    this.prepared.set(preparedId, { expiresAt, wallet: input.wallet });
    return {
      preparedId,
      wallet: input.wallet,
      recipient: input.recipient,
      recipientAta: recipientAta.toBase58(),
      mint: USDC_MINT,
      symbol: 'USDC',
      decimals: USDC_DECIMALS,
      amountAtomic: input.amountAtomic,
      amountUi: atomicToDecimal(input.amountAtomic, USDC_DECIMALS),
      transaction: Buffer.from(transactionBytes).toString('base64'),
      messageHash: createHash('sha256').update(message.serialize()).digest('hex'),
      expiresAt,
      gasPayment: {
        mode: 'provider-sponsored',
        provider: 'Privy',
        detail: 'Privy supplies a managed Solana fee payer. Your wallet sends only the reviewed USDC amount.',
      },
      review: {
        flayFeePercent: '0',
        recipientAccountExists: true,
        warnings: [
          'The recipient already has a mainnet USDC account; this transaction creates or closes no token account.',
          'If Privy sponsorship is unavailable, Flay stops instead of charging your wallet SOL.',
        ],
      },
    };
  }

  async status(input: { wallet: string; recipient: string; amountAtomic: string; signature: string }): Promise<GaslessUsdcSendStatus> {
    const explorerUrl = `https://explorer.solana.com/tx/${encodeURIComponent(input.signature)}?cluster=mainnet-beta`;
    const transaction = await this.rpc.transaction(input.signature);
    if (!transaction) {
      const status = await this.rpc.signatureStatus(input.signature);
      return {
        signature: input.signature,
        status: status?.err ? 'failed' : 'pending',
        explorerUrl,
        feePayer: null,
        networkFeeLamports: null,
        senderNetworkFeeLamports: null,
        error: status?.err ? JSON.stringify(status.err).slice(0, 300) : null,
      };
    }
    if (transaction.meta?.err) {
      return {
        signature: input.signature,
        status: 'failed',
        explorerUrl,
        feePayer: transaction.transaction.message.staticAccountKeys[0]?.toBase58() ?? null,
        networkFeeLamports: String(transaction.meta.fee),
        senderNetworkFeeLamports: null,
        error: JSON.stringify(transaction.meta.err).slice(0, 300),
      };
    }
    if (!transaction.meta) throw new AppError(409, 'SEND_RECEIPT_INCOMPLETE', 'Solana returned the transaction without execution metadata.', true);

    const message = transaction.transaction.message;
    if ('addressTableLookups' in message && message.addressTableLookups.length !== 0) {
      throw new AppError(409, 'SEND_RECEIPT_MISMATCH', 'The confirmed send contains an unexpected lookup table.');
    }
    const keys = message.staticAccountKeys;
    const wallet = new PublicKey(input.wallet);
    const recipient = new PublicKey(input.recipient);
    const feePayer = keys[0];
    const walletIndex = keys.findIndex((key) => key.equals(wallet));
    if (!feePayer || feePayer.equals(wallet) || walletIndex < 0 || walletIndex >= message.header.numRequiredSignatures) {
      throw new AppError(409, 'SEND_SPONSORSHIP_NOT_PROVEN', 'The confirmed transaction does not prove an external Privy fee payer.');
    }
    if (message.compiledInstructions.length !== 1) {
      throw new AppError(409, 'SEND_RECEIPT_MISMATCH', 'The confirmed send contains unexpected instructions.');
    }
    const compiled = message.compiledInstructions[0];
    const programId = keys[compiled.programIdIndex];
    const accountKeys = compiled.accountKeyIndexes.map((index) => keys[index]);
    if (!programId?.equals(TOKEN_PROGRAM_ID) || accountKeys.some((key) => !key)) {
      throw new AppError(409, 'SEND_RECEIPT_MISMATCH', 'The confirmed send invokes an unexpected program or account.');
    }
    const instruction = {
      programId,
      keys: accountKeys.map((pubkey, index) => ({
        pubkey: pubkey!,
        isSigner: index === 3,
        isWritable: index === 0 || index === 2,
      })),
      data: Buffer.from(compiled.data),
    };
    try {
      const decoded = decodeTransferCheckedInstruction(instruction, TOKEN_PROGRAM_ID);
      const mint = new PublicKey(USDC_MINT);
      if (
        !decoded.keys.source.pubkey.equals(getAssociatedTokenAddressSync(mint, wallet))
        || !decoded.keys.mint.pubkey.equals(mint)
        || !decoded.keys.destination.pubkey.equals(getAssociatedTokenAddressSync(mint, recipient))
        || !decoded.keys.owner.pubkey.equals(wallet)
        || decoded.keys.multiSigners.length !== 0
        || decoded.data.amount !== BigInt(input.amountAtomic)
        || decoded.data.decimals !== USDC_DECIMALS
      ) throw new Error('receipt mismatch');
    } catch {
      throw new AppError(409, 'SEND_RECEIPT_MISMATCH', 'The confirmed transfer differs from the reviewed USDC recipient or amount.');
    }
    const unexpectedInner = transaction.meta.innerInstructions?.some((group) => group.instructions.length > 0) ?? false;
    if (unexpectedInner) throw new AppError(409, 'SEND_RECEIPT_MISMATCH', 'The confirmed send contains unexpected inner instructions.');

    const mint = new PublicKey(USDC_MINT);
    const sourceAta = getAssociatedTokenAddressSync(mint, wallet);
    const recipientAta = getAssociatedTokenAddressSync(mint, recipient);
    const sourceIndex = keys.findIndex((key) => key.equals(sourceAta));
    const recipientIndex = keys.findIndex((key) => key.equals(recipientAta));
    const tokenAmount = (rows: NonNullable<typeof transaction.meta>['preTokenBalances'], accountIndex: number) => (
      rows?.find((row) => row.accountIndex === accountIndex && row.mint === USDC_MINT)?.uiTokenAmount.amount
    );
    const sourceBefore = BigInt(tokenAmount(transaction.meta.preTokenBalances, sourceIndex) ?? '0');
    const sourceAfter = BigInt(tokenAmount(transaction.meta.postTokenBalances, sourceIndex) ?? '0');
    const recipientBefore = BigInt(tokenAmount(transaction.meta.preTokenBalances, recipientIndex) ?? '0');
    const recipientAfter = BigInt(tokenAmount(transaction.meta.postTokenBalances, recipientIndex) ?? '0');
    const amount = BigInt(input.amountAtomic);
    if (sourceBefore - sourceAfter !== amount || recipientAfter - recipientBefore !== amount) {
      throw new AppError(409, 'SEND_BALANCE_DELTA_MISMATCH', 'Solana balance changes do not match the reviewed USDC send.');
    }
    const senderLamportDelta = BigInt(transaction.meta.postBalances[walletIndex] ?? 0) - BigInt(transaction.meta.preBalances[walletIndex] ?? 0);
    if (senderLamportDelta !== 0n) {
      throw new AppError(409, 'SEND_SENDER_LAMPORT_DELTA', 'The sponsored send unexpectedly changed the sender SOL balance.');
    }
    return {
      signature: input.signature,
      status: 'confirmed',
      explorerUrl,
      feePayer: feePayer.toBase58(),
      networkFeeLamports: String(transaction.meta.fee),
      senderNetworkFeeLamports: '0',
      error: null,
    };
  }

  private assertUsdcAccount(
    address: PublicKey,
    info: AccountInfo<Buffer> | null,
    expectedOwner: PublicKey,
    role: 'sender' | 'recipient',
  ): void {
    if (!info) {
      const message = role === 'recipient'
        ? 'This recipient does not yet have a mainnet USDC account. Ask them to receive USDC once, then retry.'
        : 'Your wallet does not have a mainnet USDC account.';
      throw new AppError(409, role === 'recipient' ? 'SEND_RECIPIENT_USDC_ACCOUNT_REQUIRED' : 'SEND_SOURCE_USDC_ACCOUNT_REQUIRED', message);
    }
    if (!info.owner.equals(TOKEN_PROGRAM_ID)) {
      throw new AppError(409, 'SEND_TOKEN_ACCOUNT_INVALID', `The ${role} USDC account is owned by an unexpected program.`);
    }
    try {
      const account = unpackAccount(address, info, TOKEN_PROGRAM_ID);
      if (!account.mint.equals(new PublicKey(USDC_MINT)) || !account.owner.equals(expectedOwner)) throw new Error('account mismatch');
    } catch {
      throw new AppError(409, 'SEND_TOKEN_ACCOUNT_INVALID', `The ${role} USDC account does not match the reviewed wallet and mint.`);
    }
  }

  private sweep(): void {
    const now = Date.now();
    for (const [id, record] of this.prepared) if (record.expiresAt <= now) this.prepared.delete(id);
    while (this.prepared.size > 2_000) {
      const oldest = this.prepared.keys().next().value as string | undefined;
      if (!oldest) break;
      this.prepared.delete(oldest);
    }
  }
}
