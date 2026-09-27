import { createHash, createPublicKey, timingSafeEqual, verify } from 'node:crypto';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  unpackAccount,
} from '@solana/spl-token';
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  VersionedTransaction,
  type AccountInfo,
} from '@solana/web3.js';
import { atomicToDecimal } from '../shared/amounts.js';
import type { PreparedKind, QuoteProvider, TokenInfo } from '../shared/types.js';
import { config, providerHeaders } from './config.js';
import { AppError } from './errors.js';
import { fetchJson } from './fetch-json.js';
import { withRpcFallback } from './rpc.js';

const MEMO_PROGRAMS = [
  'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
  'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo',
];
const JUPITER_SWAP_PROGRAM = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
export const JUPITER_TRIGGER_V1_PROGRAM = 'jupoNjAxXgZ4rjzxzPMP4oxduvQsQtZzyknqvzYNrNu';
export const JUPITER_TRIGGER_V1_PROGRAMS = [
  JUPITER_TRIGGER_V1_PROGRAM,
  'j1o2qRpjcyUwEvwtcfhEQefh773ZgjxcVRry7LDqg5X',
];

const COMMON_PROGRAMS = new Set([
  SystemProgram.programId.toBase58(),
  ComputeBudgetProgram.programId.toBase58(),
  TOKEN_PROGRAM_ID.toBase58(),
  TOKEN_2022_PROGRAM_ID.toBase58(),
  ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
  ...MEMO_PROGRAMS,
]);

export interface TransactionExpectations {
  kind: PreparedKind;
  provider: QuoteProvider | 'jupiter-trigger';
  wallet: string;
  inputToken?: TokenInfo;
  outputToken?: TokenInfo;
  inputAmount?: string;
  minimumOutput?: string;
  expectedPrograms: string[];
  expectedPoolIds: string[];
  feePayer?: string;
  allowedExternalSigners?: string[];
  rejectUnknownSigners?: boolean;
  order?: string;
}

export interface ValidatedTransaction {
  messageBytes: Uint8Array;
  messageHash: string;
  monitoredAddresses: string[];
  inputAccount?: string;
  outputAccount?: string;
}

export interface SponsoredMarketReceiptTokenBalance {
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string };
}

export interface SponsoredMarketReceipt {
  signature: string;
  transactionSignatures: string[];
  accountKeys: string[];
  feeLamports: number;
  error: unknown;
  preBalances: number[];
  postBalances: number[];
  preTokenBalances: SponsoredMarketReceiptTokenBalance[];
  postTokenBalances: SponsoredMarketReceiptTokenBalance[];
}

let jupiterProgramsCache: { expiresAt: number; ids: Set<string> } | null = null;

async function jupiterPrograms(): Promise<Set<string>> {
  if (jupiterProgramsCache && jupiterProgramsCache.expiresAt > Date.now()) return jupiterProgramsCache.ids;
  const ids = new Set<string>([JUPITER_SWAP_PROGRAM]);
  const results = await Promise.allSettled(['/swap/v1/program-id-to-label', '/swap/v2/program-id-to-label'].map((path) =>
    fetchJson<Record<string, string>>(new URL(path, config.jupiterBaseUrl), {
      provider: 'Jupiter program registry',
      headers: providerHeaders(),
      timeoutMs: config.requestTimeoutMs,
    }),
  ));
  for (const result of results) {
    if (result.status === 'fulfilled') Object.keys(result.value).forEach((id) => ids.add(id));
  }
  jupiterProgramsCache = { expiresAt: Date.now() + 60 * 60_000, ids };
  return ids;
}

function tokenProgram(token: TokenInfo): PublicKey {
  return token.tokenProgram === 'token-2022' ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
}

function expectedAta(token: TokenInfo | undefined, wallet: PublicKey): string | undefined {
  if (!token || token.tokenProgram === 'native') return undefined;
  return getAssociatedTokenAddressSync(new PublicKey(token.mint), wallet, false, tokenProgram(token)).toBase58();
}

export function transactionBindsExpectedToken(
  keyStrings: ReadonlySet<string>,
  token: TokenInfo | undefined,
  wallet: PublicKey,
): boolean {
  if (!token) return true;
  if (keyStrings.has(token.mint)) return true;
  const canonicalAccount = expectedAta(token, wallet);
  return canonicalAccount !== undefined && keyStrings.has(canonicalAccount);
}

async function loadLookupTables(transaction: VersionedTransaction): Promise<AddressLookupTableAccount[]> {
  const lookups = await withRpcFallback((rpc) => Promise.all(transaction.message.addressTableLookups.map(async (lookup) => {
    const response = await rpc.getAddressLookupTable(lookup.accountKey);
    if (!response.value) throw new AppError(409, 'LOOKUP_TABLE_UNAVAILABLE', 'A transaction address table is unavailable. Request a fresh transaction.', true);
    return response.value;
  })));
  return lookups;
}

function hasNonzeroSignature(signature: Uint8Array): boolean {
  return signature.some((byte) => byte !== 0);
}

export function validateTransactionSigners(
  transaction: VersionedTransaction,
  expectations: Pick<TransactionExpectations, 'wallet' | 'feePayer' | 'allowedExternalSigners' | 'rejectUnknownSigners'>,
): void {
  const wallet = new PublicKey(expectations.wallet);
  const expectedPayer = new PublicKey(expectations.feePayer ?? expectations.wallet);
  const requiredSignatures = transaction.message.header.numRequiredSignatures;
  const signerKeys = transaction.message.staticAccountKeys.slice(0, requiredSignatures);
  const payer = signerKeys[0];
  if (!payer?.equals(expectedPayer)) {
    throw new AppError(409, 'PAYER_MISMATCH', 'The transaction fee payer does not match the payer shown in review.');
  }

  const allowedExternalSigners = new Set(expectations.allowedExternalSigners ?? []);
  let walletSignerFound = false;
  signerKeys.forEach((signer, index) => {
    const address = signer.toBase58();
    if (signer.equals(wallet)) {
      walletSignerFound = true;
      return;
    }
    if (allowedExternalSigners.has(address)) return;
    if (expectations.rejectUnknownSigners || !hasNonzeroSignature(transaction.signatures[index])) {
      throw new AppError(409, 'UNEXPECTED_SIGNER', 'The transaction asks for an additional signer that was not declared in the reviewed order.');
    }
  });
  if (!walletSignerFound) {
    throw new AppError(409, 'SIGNER_MISMATCH', 'Your reviewed wallet is not a required transaction signer.');
  }
}

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export function assertWalletSignature(transaction: VersionedTransaction, walletAddress: string): void {
  const wallet = new PublicKey(walletAddress);
  const requiredSignatures = transaction.message.header.numRequiredSignatures;
  const signerIndex = transaction.message.staticAccountKeys
    .slice(0, requiredSignatures)
    .findIndex((key) => key.equals(wallet));
  if (signerIndex < 0) {
    throw new AppError(409, 'SIGNER_MISMATCH', 'Your reviewed wallet is not a required transaction signer.');
  }
  const signature = transaction.signatures[signerIndex];
  if (!signature || !hasNonzeroSignature(signature)) {
    throw new AppError(409, 'WALLET_SIGNATURE_MISSING', 'The embedded wallet did not sign the reviewed transaction.');
  }
  const publicKey = createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(wallet.toBytes())]),
    format: 'der',
    type: 'spki',
  });
  if (!verify(null, Buffer.from(transaction.message.serialize()), publicKey, Buffer.from(signature))) {
    throw new AppError(409, 'WALLET_SIGNATURE_INVALID', 'The embedded wallet signature does not authorize the reviewed transaction.');
  }
}

export async function validateTransactionStructure(
  transaction: VersionedTransaction,
  expectations: TransactionExpectations,
): Promise<ValidatedTransaction> {
  const serialized = transaction.serialize();
  if (serialized.length > 1232) {
    throw new AppError(502, 'TRANSACTION_TOO_LARGE', 'The provider transaction exceeds Solana’s packet limit.');
  }

  const wallet = new PublicKey(expectations.wallet);
  validateTransactionSigners(transaction, expectations);
  const tables = await loadLookupTables(transaction);
  const accountKeys = transaction.message.getAccountKeys({ addressLookupTableAccounts: tables });
  const keys = Array.from({ length: accountKeys.length }, (_, index) => accountKeys.get(index)!);
  const keyStrings = new Set(keys.map((key) => key.toBase58()));
  const inputAccount = expectedAta(expectations.inputToken, wallet);
  const outputAccount = expectedAta(expectations.outputToken, wallet);
  if (!transactionBindsExpectedToken(keyStrings, expectations.inputToken, wallet)) {
    throw new AppError(409, 'INPUT_MINT_MISMATCH', 'The reviewed input mint is absent from the provider transaction.');
  }
  if (
    expectations.kind !== 'limit-cancel'
    && !transactionBindsExpectedToken(keyStrings, expectations.outputToken, wallet)
  ) {
    throw new AppError(409, 'OUTPUT_MINT_MISMATCH', 'The reviewed output mint is absent from the provider transaction.');
  }
  for (const pool of expectations.expectedPoolIds) {
    if (!keyStrings.has(pool)) throw new AppError(409, 'ROUTE_MISMATCH', 'The transaction does not contain the pool or venue account shown in review.');
  }
  if (expectations.order && !keyStrings.has(expectations.order)) {
    throw new AppError(409, 'ORDER_MISMATCH', 'The cancellation transaction does not contain the selected order account.');
  }

  if (inputAccount && !keyStrings.has(inputAccount)) {
    throw new AppError(409, 'INPUT_ACCOUNT_MISMATCH', 'The transaction does not debit the expected wallet token account.');
  }
  if (outputAccount && expectations.kind === 'market-swap' && !keyStrings.has(outputAccount)) {
    throw new AppError(409, 'RECIPIENT_MISMATCH', 'The transaction does not credit the expected wallet token account.');
  }

  const allowed = new Set([...COMMON_PROGRAMS, ...expectations.expectedPrograms]);
  if (expectations.provider === 'jupiter') {
    const registry = await jupiterPrograms();
    registry.forEach((id) => allowed.add(id));
    expectations.expectedPoolIds.forEach((id) => allowed.add(id));
  }
  if (expectations.provider === 'jupiter-trigger') JUPITER_TRIGGER_V1_PROGRAMS.forEach((id) => allowed.add(id));

  const invokedPrograms = transaction.message.compiledInstructions.map((instruction) => {
    const program = accountKeys.get(instruction.programIdIndex);
    if (!program) throw new AppError(409, 'PROGRAM_INDEX_INVALID', 'The provider transaction contains an invalid program index.');
    return program.toBase58();
  });
  const unknownPrograms = [...new Set(invokedPrograms.filter((program) => !allowed.has(program)))];
  if (unknownPrograms.length) {
    throw new AppError(409, 'PROGRAM_NOT_ALLOWED', 'The provider transaction invokes a program outside the reviewed route.', false, { programs: unknownPrograms });
  }

  const writable = keys.filter((_key, index) => transaction.message.isAccountWritable(index));
  const infos = await withRpcFallback((rpc) => rpc.getMultipleAccountsInfo(writable, 'confirmed'));
  const expectedMints = new Set([expectations.inputToken?.mint, expectations.outputToken?.mint].filter(Boolean));
  for (let index = 0; index < infos.length; index += 1) {
    const info = infos[index];
    if (!info || (!info.owner.equals(TOKEN_PROGRAM_ID) && !info.owner.equals(TOKEN_2022_PROGRAM_ID))) continue;
    try {
      const account = unpackAccount(writable[index], info, info.owner);
      if (account.owner.equals(wallet) && !expectedMints.has(account.mint.toBase58())) {
        throw new AppError(409, 'UNREVIEWED_TOKEN_ACCOUNT', 'The transaction can modify another token in your wallet, so Flay rejected it.');
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      // Mint and multisig accounts are owned by token programs but are not token accounts.
    }
  }

  const messageBytes = transaction.message.serialize();
  return {
    messageBytes,
    messageHash: createHash('sha256').update(messageBytes).digest('hex'),
    monitoredAddresses: [...new Set([expectations.wallet, inputAccount, outputAccount].filter((value): value is string => Boolean(value)))],
    inputAccount,
    outputAccount,
  };
}

function sponsorshipIneligible(message: string): AppError {
  return new AppError(409, 'PRIVY_SPONSORSHIP_INELIGIBLE', message);
}

export async function assertPrivySponsoredMarketTransactionSafe(
  transaction: VersionedTransaction,
  expectations: TransactionExpectations,
  loadTokenAccounts: (addresses: PublicKey[]) => Promise<Array<AccountInfo<Buffer> | null>> = (addresses) =>
    withRpcFallback((rpc) => rpc.getMultipleAccountsInfo(addresses, 'confirmed')),
): Promise<void> {
  if (
    expectations.kind !== 'market-swap'
    || (expectations.provider !== 'raydium' && expectations.provider !== 'orca')
    || !expectations.inputToken
    || !expectations.outputToken
    || expectations.inputToken.tokenProgram === 'native'
    || expectations.outputToken.tokenProgram === 'native'
  ) {
    throw sponsorshipIneligible('Privy sponsorship currently requires a Raydium or Orca SPL-to-SPL market swap.');
  }

  const wallet = new PublicKey(expectations.wallet);
  const signerKeys = transaction.message.staticAccountKeys.slice(0, transaction.message.header.numRequiredSignatures);
  if (signerKeys.length !== 1 || !signerKeys[0]?.equals(wallet)) {
    throw sponsorshipIneligible('This venue transaction needs a signer beyond your wallet, so Privy sponsorship is unavailable.');
  }

  const tables = await loadLookupTables(transaction);
  const keys = transaction.message.getAccountKeys({ addressLookupTableAccounts: tables });
  for (const instruction of transaction.message.compiledInstructions) {
    const program = keys.get(instruction.programIdIndex)?.toBase58();
    if (program === SystemProgram.programId.toBase58() || program === ASSOCIATED_TOKEN_PROGRAM_ID.toBase58()) {
      throw sponsorshipIneligible('This transaction creates an account or moves rent, so it remains user-paid.');
    }
    if (
      (program === TOKEN_PROGRAM_ID.toBase58() || program === TOKEN_2022_PROGRAM_ID.toBase58())
      && (instruction.data[0] === 9 || instruction.data[0] === 17)
    ) {
      throw sponsorshipIneligible('This transaction closes or synchronizes a rent-bearing token account, so it remains user-paid.');
    }
  }

  const inputProgram = tokenProgram(expectations.inputToken);
  const outputProgram = tokenProgram(expectations.outputToken);
  const inputAta = getAssociatedTokenAddressSync(new PublicKey(expectations.inputToken.mint), wallet, false, inputProgram);
  const outputAta = getAssociatedTokenAddressSync(new PublicKey(expectations.outputToken.mint), wallet, false, outputProgram);
  const [inputInfo, outputInfo] = await loadTokenAccounts([inputAta, outputAta]);
  const accounts = [
    { address: inputAta, info: inputInfo, mint: new PublicKey(expectations.inputToken.mint), program: inputProgram },
    { address: outputAta, info: outputInfo, mint: new PublicKey(expectations.outputToken.mint), program: outputProgram },
  ];
  for (const account of accounts) {
    if (!account.info) throw sponsorshipIneligible('Both reviewed token accounts must already exist for Privy sponsorship.');
    try {
      const decoded = unpackAccount(account.address, account.info, account.program);
      if (!decoded.owner.equals(wallet) || !decoded.mint.equals(account.mint)) throw new Error('wrong token account');
    } catch {
      throw sponsorshipIneligible('A reviewed token account is not the wallet account Flay expected.');
    }
  }
}

function receiptTokenAmount(
  balances: SponsoredMarketReceiptTokenBalance[],
  wallet: string,
  mint: string,
): bigint {
  return balances
    .filter((balance) => balance.owner === wallet && balance.mint === mint)
    .reduce((total, balance) => total + BigInt(balance.uiTokenAmount.amount), 0n);
}

export function assertPrivySponsoredMarketReceipt(
  receipt: SponsoredMarketReceipt,
  expectations: TransactionExpectations,
): void {
  if (!expectations.inputToken || !expectations.outputToken || !expectations.inputAmount || !expectations.minimumOutput) {
    throw new AppError(500, 'VALIDATION_POLICY_MISSING', 'Sponsored market receipt validation policy is incomplete.');
  }
  if (receipt.error) {
    throw new AppError(409, 'TRANSACTION_FAILED', 'The sponsored conversion failed on Solana.', false, {
      reason: JSON.stringify(receipt.error).slice(0, 300),
    });
  }
  if (receipt.transactionSignatures[0] !== receipt.signature) {
    throw new AppError(409, 'SPONSORED_SIGNATURE_MISMATCH', 'The returned signature does not identify the reviewed sponsored transaction.');
  }
  const feePayer = receipt.accountKeys[0];
  if (!feePayer || feePayer === expectations.wallet || receipt.feeLamports <= 0) {
    throw new AppError(409, 'SPONSOR_FEE_PAYER_MISMATCH', 'Privy sponsorship was not proven by the confirmed transaction fee payer.');
  }
  const walletIndex = receipt.accountKeys.indexOf(expectations.wallet);
  if (walletIndex < 0) {
    throw new AppError(409, 'SIGNER_MISMATCH', 'The confirmed transaction does not involve the reviewed wallet.');
  }
  if (receipt.preBalances[walletIndex] !== receipt.postBalances[walletIndex]) {
    throw new AppError(409, 'SPONSORED_SOL_DEBIT', 'The reviewed wallet paid or received SOL in a transaction marked as gas-sponsored.');
  }

  const inputBefore = receiptTokenAmount(receipt.preTokenBalances, expectations.wallet, expectations.inputToken.mint);
  const inputAfter = receiptTokenAmount(receipt.postTokenBalances, expectations.wallet, expectations.inputToken.mint);
  if (inputBefore - inputAfter !== BigInt(expectations.inputAmount)) {
    throw new AppError(409, 'INPUT_AMOUNT_MISMATCH', 'The confirmed sponsored conversion did not debit the exact reviewed input amount.');
  }
  const outputBefore = receiptTokenAmount(receipt.preTokenBalances, expectations.wallet, expectations.outputToken.mint);
  const outputAfter = receiptTokenAmount(receipt.postTokenBalances, expectations.wallet, expectations.outputToken.mint);
  if (outputAfter - outputBefore < BigInt(expectations.minimumOutput)) {
    throw new AppError(409, 'MINIMUM_OUTPUT_MISMATCH', 'The confirmed sponsored conversion delivered less than the reviewed minimum output.');
  }
}

function decodeTokenAmount(account: { data: Buffer | [string, string] } | null | undefined): bigint {
  if (!account) return 0n;
  const data = Buffer.isBuffer(account.data) ? account.data : Buffer.from(account.data[0], 'base64');
  if (data.length < 72) return 0n;
  return data.readBigUInt64LE(64);
}

export function simulationError(error: unknown, logs?: string[] | null): AppError {
  const encoded = JSON.stringify(error);
  const logText = logs?.join('\n') ?? '';
  const rentShortfall = logText.match(/Transfer: insufficient lamports (\d+), need (\d+)/i);
  if (rentShortfall) {
    const available = BigInt(rentShortfall[1]);
    const required = BigInt(rentShortfall[2]);
    const missing = required > available ? required - available : 0n;
    return new AppError(
      409,
      'INSUFFICIENT_SOL',
      `This route needs ${atomicToDecimal(missing.toString(), 9)} SOL more for account rent. Choose a direct route that creates fewer accounts or add that amount of SOL.`,
    );
  }
  if (/BlockhashNotFound|blockhash/i.test(encoded)) {
    return new AppError(410, 'BLOCKHASH_EXPIRED', 'The transaction blockhash expired. Review a fresh quote and sign again.', true);
  }
  if (/insufficient|0x1\b|custom program error: 0x1\b/i.test(`${encoded}\n${logText}`)) {
    return new AppError(409, 'INSUFFICIENT_BALANCE', 'The wallet does not have enough tokens or SOL for this transaction and its network fee.');
  }
  if (/slippage|0x1771|6001/i.test(`${encoded}\n${logText}`)) {
    return new AppError(409, 'SLIPPAGE_EXCEEDED', 'The route moved below your minimum output. Request a fresh quote.', true);
  }
  return new AppError(409, 'SIMULATION_FAILED', 'Solana simulation rejected this transaction before submission.', true, { reason: encoded.slice(0, 500) });
}

export async function simulateAndVerifyDeltas(
  transaction: VersionedTransaction,
  expectations: TransactionExpectations,
  validated: ValidatedTransaction,
  sigVerify: boolean,
): Promise<{ walletLamportDelta: bigint }> {
  const addresses = validated.monitoredAddresses;
  const pre = await withRpcFallback((rpc) => rpc.getMultipleAccountsInfo(addresses.map((address) => new PublicKey(address)), 'confirmed'));
  const simulation = await withRpcFallback((rpc) => rpc.simulateTransaction(transaction, {
    sigVerify,
    commitment: 'confirmed',
    accounts: { encoding: 'base64', addresses },
  }));
  if (simulation.value.err) throw simulationError(simulation.value.err, simulation.value.logs);
  const post = simulation.value.accounts;
  if (!post || post.length !== addresses.length) {
    throw new AppError(503, 'SIMULATION_ACCOUNTS_MISSING', 'The RPC did not return simulated wallet balances. Try the fallback RPC.', true);
  }

  const walletIndex = addresses.indexOf(expectations.wallet);
  const walletBefore = BigInt(pre[walletIndex]?.lamports ?? 0);
  const walletAfter = BigInt(post[walletIndex]?.lamports ?? 0);
  const walletDelta = walletAfter - walletBefore;
  const estimatedNetworkFee = 10_000_000n;

  if (expectations.kind === 'market-swap' || expectations.kind === 'limit-create') {
    if (!expectations.inputToken || !expectations.inputAmount) {
      throw new AppError(500, 'VALIDATION_POLICY_MISSING', 'Input validation policy is missing.');
    }
    const inputAmount = BigInt(expectations.inputAmount);
    if (expectations.inputToken.tokenProgram === 'native') {
      const spent = -walletDelta;
      if (spent < inputAmount || spent > inputAmount + estimatedNetworkFee) {
        throw new AppError(409, 'INPUT_AMOUNT_MISMATCH', 'Simulation does not debit the reviewed SOL amount within the network-fee bound.');
      }
    } else if (validated.inputAccount) {
      const index = addresses.indexOf(validated.inputAccount);
      const spent = decodeTokenAmount(pre[index] ? { data: pre[index]!.data } : null)
        - decodeTokenAmount(post[index] ? { data: post[index]!.data as [string, string] } : null);
      if (spent !== inputAmount) {
        throw new AppError(409, 'INPUT_AMOUNT_MISMATCH', 'Simulation does not debit exactly the reviewed token amount.');
      }
    }
  }

  if (expectations.kind === 'limit-cancel' && expectations.inputToken && expectations.inputAmount) {
    const minimumRecovery = BigInt(expectations.inputAmount);
    if (expectations.inputToken.tokenProgram === 'native') {
      if (walletDelta + estimatedNetworkFee < minimumRecovery) {
        throw new AppError(409, 'RECOVERY_AMOUNT_MISMATCH', 'Cancellation simulation does not return the expected SOL principal.');
      }
    } else if (validated.inputAccount) {
      const index = addresses.indexOf(validated.inputAccount);
      const recovered = decodeTokenAmount(post[index] ? { data: post[index]!.data as [string, string] } : null)
        - decodeTokenAmount(pre[index] ? { data: pre[index]!.data } : null);
      if (recovered < minimumRecovery) {
        throw new AppError(409, 'RECOVERY_AMOUNT_MISMATCH', 'Cancellation simulation does not return the expected token principal.');
      }
    }
  }

  if (expectations.kind === 'market-swap') {
    if (!expectations.outputToken || !expectations.minimumOutput) {
      throw new AppError(500, 'VALIDATION_POLICY_MISSING', 'Output validation policy is missing.');
    }
    const minimum = BigInt(expectations.minimumOutput);
    if (expectations.outputToken.tokenProgram === 'native') {
      const receivedBeforeFee = walletDelta + (expectations.inputToken?.tokenProgram === 'native' ? BigInt(expectations.inputAmount ?? '0') : 0n);
      if (receivedBeforeFee + estimatedNetworkFee < minimum) {
        throw new AppError(409, 'MINIMUM_OUTPUT_MISMATCH', 'Simulation does not deliver the reviewed minimum SOL output.');
      }
    } else if (validated.outputAccount) {
      const index = addresses.indexOf(validated.outputAccount);
      const received = decodeTokenAmount(post[index] ? { data: post[index]!.data as [string, string] } : null)
        - decodeTokenAmount(pre[index] ? { data: pre[index]!.data } : null);
      if (received < minimum) {
        throw new AppError(409, 'MINIMUM_OUTPUT_MISMATCH', 'Simulation does not deliver the reviewed minimum token output.');
      }
    }
  }

  return { walletLamportDelta: walletDelta };
}

export function deserializeSignedTransaction(base64: string): VersionedTransaction {
  try {
    const bytes = Buffer.from(base64, 'base64');
    if (bytes.length > 1232) throw new Error('transaction is too large');
    return VersionedTransaction.deserialize(bytes);
  } catch {
    throw new AppError(400, 'SIGNED_TRANSACTION_INVALID', 'The signed transaction is not a valid Solana v0 transaction.');
  }
}

export function assertMessageUnchanged(transaction: VersionedTransaction, expectedMessage: Uint8Array): void {
  const received = transaction.message.serialize();
  if (received.length !== expectedMessage.length || !timingSafeEqual(Buffer.from(received), Buffer.from(expectedMessage))) {
    throw new AppError(409, 'TRANSACTION_CHANGED', 'The signed transaction no longer matches the exact transaction reviewed in Flay.');
  }
}
