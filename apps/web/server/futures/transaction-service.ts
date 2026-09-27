import { createHash, createPublicKey, timingSafeEqual, verify } from 'node:crypto';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import {
  AddressLookupTableAccount,
  ComputeBudgetInstruction,
  ComputeBudgetProgram,
  PublicKey,
  SystemInstruction,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
  type TransactionInstruction,
} from '@solana/web3.js';
import bs58 from 'bs58';
import type {
  FuturesExecution,
  FuturesPrepareRequest,
  FuturesPreparedStep,
  FuturesRouteQuote,
  FuturesVenuePortfolio,
} from '../../shared/futures.js';
import { USDC_MINT } from '../../shared/constants.js';
import { AppError } from '../errors.js';
import { withRpcFallback } from '../rpc.js';
import type { FuturesService } from './futures-service.js';
import { FuturesPreparedStore } from './prepared-store.js';
import { PhoenixTransactionBuilder } from './phoenix-transactions.js';
import { reconcileFuturesAction } from './reconciliation.js';
import { observeVenueBuild } from './build-reliability.js';
import { gmTradeProtocolPriceToMicro, validateGmTradeInstructionAccounts, validateGmTradeOrderSemantics, type GmTradeOrderSemantics } from './gmtrade-transaction-validation.js';
import { validatePhoenixInstructionAccounts, validatePhoenixSemantics } from './phoenix-transaction-validation.js';

const FUTURES_PREPARED_TTL_MS = 90_000;
interface OperationMetrics {
  attempts: number;
  successes: number;
  failures: number;
  lastLatencyMs: number | null;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
}
const operationMetrics = (): OperationMetrics => ({ attempts: 0, successes: 0, failures: 0, lastLatencyMs: null, lastSuccessAt: null, lastFailureAt: null });
const simulationMetrics = { attempts: 0, failures: 0, lastSuccessAt: null as number | null, lastFailureAt: null as number | null };
const transactionMetrics = {
  builds: { phoenix: operationMetrics(), gmtrade: operationMetrics() },
  submissions: { phoenix: operationMetrics(), gmtrade: operationMetrics() },
  reconciliation: { attempts: 0, completed: 0, failed: 0, lastLagMs: null as number | null, lastCompletedAt: null as number | null },
};

async function observeOperation<T>(metrics: OperationMetrics, operation: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  metrics.attempts += 1;
  try {
    const result = await operation();
    metrics.successes += 1;
    metrics.lastSuccessAt = Date.now();
    return result;
  } catch (error) {
    metrics.failures += 1;
    metrics.lastFailureAt = Date.now();
    throw error;
  } finally {
    metrics.lastLatencyMs = Date.now() - startedAt;
  }
}
const CIRCUIT_FAILURE_CODES = new Set([
  'FUTURES_TRANSACTION_INVALID', 'FUTURES_TRANSACTION_TOO_LARGE', 'FUTURES_BLOCKHASH_INVALID',
  'FUTURES_INSTRUCTION_LIMIT', 'FUTURES_LOOKUP_TABLE_NOT_ALLOWED', 'FUTURES_PROGRAM_INDEX_INVALID',
  'FUTURES_PROGRAM_NOT_ALLOWED', 'FUTURES_UNEXPECTED_RECIPIENT', 'FUTURES_UNEXPECTED_SIGNER',
  'FUTURES_PAYER_MISMATCH', 'FUTURES_SIGNER_MISMATCH', 'FUTURES_ROUTE_MISMATCH',
  'FUTURES_COMPUTE_LIMIT_EXCEEDED', 'FUTURES_PRIORITY_FEE_EXCEEDED', 'FUTURES_SIMULATION_FAILED',
]);

export class FuturesEntryCircuitBreaker {
  private consecutiveFailures = 0;
  private openUntil = 0;
  private lastFailureAt: number | null = null;
  private lastReason: string | null = null;

  constructor(private readonly threshold = 3, private readonly cooldownMs = 60_000) {}

  assertAvailable(now = Date.now()): void {
    if (this.openUntil > now) {
      throw new AppError(503, 'FUTURES_ENTRY_CIRCUIT_OPEN', 'New futures entries are temporarily paused after repeated invalid provider transactions or simulations.', true, { retryAfterMs: this.openUntil - now });
    }
    if (this.openUntil !== 0) {
      this.openUntil = 0;
      this.consecutiveFailures = 0;
    }
  }

  recordFailure(error: unknown, now = Date.now()): void {
    if (!(error instanceof AppError) || !CIRCUIT_FAILURE_CODES.has(error.code)) return;
    this.consecutiveFailures += 1;
    this.lastFailureAt = now;
    this.lastReason = error.code;
    if (this.consecutiveFailures >= this.threshold) this.openUntil = now + this.cooldownMs;
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.openUntil = 0;
  }

  snapshot(now = Date.now()) {
    return { consecutiveFailures: this.consecutiveFailures, open: this.openUntil > now, openUntil: this.openUntil || null, lastFailureAt: this.lastFailureAt, lastReason: this.lastReason };
  }
}

const entryCircuits = { phoenix: new FuturesEntryCircuitBreaker(), gmtrade: new FuturesEntryCircuitBreaker() };
const GMTRADE_PROGRAM = 'Gmso1uvJnLbawvw7yezdfCDcPydwW2s2iqG3w6MDucLo';
const MAX_COMPUTE_UNIT_LIMIT = 1_400_000;
const MAX_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS = 1_000_000n;
const COMMON_PROGRAMS = [
  SystemProgram.programId.toBase58(),
  'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
  'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo',
  ComputeBudgetProgram.programId.toBase58(),
  TOKEN_PROGRAM_ID.toBase58(),
  TOKEN_2022_PROGRAM_ID.toBase58(),
  ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
];

interface ValidatedFuturesTransaction {
  message: Uint8Array;
  messageHash: string;
  programs: string[];
  lookupTables: string[];
  instructions: TransactionInstruction[];
  writableAddresses: string[];
}


function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function explorer(signature: string): string {
  return `https://explorer.solana.com/tx/${encodeURIComponent(signature)}?cluster=mainnet-beta`;
}

function deserializeTransaction(base64: string): VersionedTransaction {
  try {
    const bytes = Buffer.from(base64, 'base64');
    if (bytes.length > 1232) throw new Error('oversize');
    return VersionedTransaction.deserialize(bytes);
  } catch {
    throw new AppError(400, 'FUTURES_TRANSACTION_INVALID', 'The futures transaction is not a valid Solana v0 transaction.');
  }
}

async function lookupTables(transaction: VersionedTransaction): Promise<AddressLookupTableAccount[]> {
  if (transaction.message.addressTableLookups.length === 0) return [];
  return withRpcFallback((rpc) => Promise.all(transaction.message.addressTableLookups.map(async (lookup) => {
    const result = await rpc.getAddressLookupTable(lookup.accountKey);
    if (!result.value) throw new AppError(409, 'LOOKUP_TABLE_UNAVAILABLE', 'A futures lookup table is unavailable. Prepare a fresh transaction.', true);
    return result.value;
  })));
}

export async function validateFuturesTransaction(
  transaction: VersionedTransaction,
  walletAddress: string,
  venuePrograms: string[],
  requiredAddresses: string[],
  allowedLookupTables: string[] = [],
  allowedAdditionalSigners: string[] = [],
): Promise<ValidatedFuturesTransaction> {
  if (transaction.serialize().length > 1232) throw new AppError(502, 'FUTURES_TRANSACTION_TOO_LARGE', 'The venue transaction exceeds Solana’s packet limit.');
  const wallet = new PublicKey(walletAddress);
  if (transaction.message.recentBlockhash === '11111111111111111111111111111111') throw new AppError(409, 'FUTURES_BLOCKHASH_INVALID', 'The venue transaction has no valid recent blockhash.');
  if (transaction.message.compiledInstructions.length > 40) throw new AppError(409, 'FUTURES_INSTRUCTION_LIMIT', 'The venue transaction contains too many instructions.');
  const requestedLookupTables = transaction.message.addressTableLookups.map((lookup) => lookup.accountKey.toBase58());
  const unexpectedLookupTables = requestedLookupTables.filter((address) => !allowedLookupTables.includes(address));
  if (unexpectedLookupTables.length > 0) {
    throw new AppError(409, 'FUTURES_LOOKUP_TABLE_NOT_ALLOWED', 'The transaction uses an address lookup table outside the reviewed venue action.', false, { lookupTables: unexpectedLookupTables });
  }
  const tables = await lookupTables(transaction);
  const accountKeys = transaction.message.getAccountKeys({ addressLookupTableAccounts: tables });
  const keys = Array.from({ length: accountKeys.length }, (_, index) => accountKeys.get(index)!);
  if (!keys[0]?.equals(wallet)) throw new AppError(409, 'FUTURES_PAYER_MISMATCH', 'The transaction fee payer differs from the reviewed Privy wallet.');

  let walletSigner = false;
  const reviewedAdditionalSigners = new Set(allowedAdditionalSigners);
  for (let index = 0; index < transaction.message.header.numRequiredSignatures; index += 1) {
    const signer = keys[index];
    if (signer.equals(wallet)) {
      walletSigner = true;
      continue;
    }
    if (!reviewedAdditionalSigners.has(signer.toBase58())) {
      throw new AppError(409, 'FUTURES_UNEXPECTED_SIGNER', 'The venue transaction requests an additional signer outside the reviewed action.');
    }
  }
  if (!walletSigner) throw new AppError(409, 'FUTURES_SIGNER_MISMATCH', 'The reviewed wallet is not a required signer.');

  const keyStrings = new Set(keys.map((key) => key.toBase58()));
  for (const required of requiredAddresses) {
    if (!keyStrings.has(required)) throw new AppError(409, 'FUTURES_ROUTE_MISMATCH', 'The transaction does not contain the reviewed venue or market account.');
  }
  const allowed = new Set([...COMMON_PROGRAMS, ...venuePrograms]);
  const programs = transaction.message.compiledInstructions.map((instruction) => {
    const program = accountKeys.get(instruction.programIdIndex);
    if (!program) throw new AppError(409, 'FUTURES_PROGRAM_INDEX_INVALID', 'The transaction contains an invalid program index.');
    return program.toBase58();
  });
  const unknown = [...new Set(programs.filter((program) => !allowed.has(program)))];
  if (unknown.length) throw new AppError(409, 'FUTURES_PROGRAM_NOT_ALLOWED', 'The venue transaction invokes a program outside the reviewed route.', false, { programs: unknown });

  const instructions = TransactionMessage.decompile(transaction.message, { addressLookupTableAccounts: tables }).instructions;
  for (const instruction of instructions) {
    if (instruction.programId.equals(ComputeBudgetProgram.programId)) {
      const kind = ComputeBudgetInstruction.decodeInstructionType(instruction);
      if (kind === 'SetComputeUnitLimit' && ComputeBudgetInstruction.decodeSetComputeUnitLimit(instruction).units > MAX_COMPUTE_UNIT_LIMIT) {
        throw new AppError(409, 'FUTURES_COMPUTE_LIMIT_EXCEEDED', 'The venue transaction requests more compute than Flay allows.');
      }
      if (kind === 'SetComputeUnitPrice' && ComputeBudgetInstruction.decodeSetComputeUnitPrice(instruction).microLamports > MAX_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS) {
        throw new AppError(409, 'FUTURES_PRIORITY_FEE_EXCEEDED', 'The venue transaction priority fee exceeds Flay’s safety ceiling.');
      }
      continue;
    }
    if (!instruction.programId.equals(SystemProgram.programId)) continue;
    const kind = SystemInstruction.decodeInstructionType(instruction);
    if (kind === 'Transfer' || kind === 'TransferWithSeed') {
      throw new AppError(409, 'FUTURES_UNEXPECTED_RECIPIENT', 'A venue transaction cannot contain a top-level SOL transfer.');
    }
  }

  const message = transaction.message.serialize();
  return {
    message,
    messageHash: createHash('sha256').update(message).digest('hex'),
    programs: [...new Set(programs)],
    lookupTables: transaction.message.addressTableLookups.map((lookup) => lookup.accountKey.toBase58()),
    instructions,
    writableAddresses: keys.filter((_key, index) => transaction.message.isAccountWritable(index)).map((key) => key.toBase58()),
  };
}

const MAX_SIMULATION_RETURN_ACCOUNTS = 20;

export function accountRentLamportsFromSimulation(
  newAccountCount: number,
  accounts: Array<{ lamports: number } | null> | null | undefined,
): string | null {
  if (newAccountCount === 0) return '0';
  if (newAccountCount > MAX_SIMULATION_RETURN_ACCOUNTS || !accounts || accounts.length !== newAccountCount) return null;
  return accounts.reduce((total, account) => total + BigInt(account?.lamports ?? 0), 0n).toString();
}

async function simulate(transaction: VersionedTransaction, sigVerify: boolean, writableAddresses: string[] = []): Promise<{ accountRentLamports: string | null }> {
  simulationMetrics.attempts += 1;
  const addresses = [...new Set(writableAddresses)];
  const { simulation, newAccountCount } = await withRpcFallback(async (rpc) => {
    const before: Array<object | null> = [];
    for (let offset = 0; offset < addresses.length; offset += 100) {
      before.push(...await rpc.getMultipleAccountsInfo(
        addresses.slice(offset, offset + 100).map((address) => new PublicKey(address)),
        'confirmed',
      ));
    }
    const newAddresses = addresses.filter((_address, index) => before[index] === null);
    const reportAccounts = newAddresses.length <= MAX_SIMULATION_RETURN_ACCOUNTS ? newAddresses : [];
    const simulation = await rpc.simulateTransaction(transaction, {
      sigVerify,
      commitment: 'confirmed',
      ...(reportAccounts.length ? { accounts: { encoding: 'base64' as const, addresses: reportAccounts } } : {}),
    });
    return { simulation, newAccountCount: newAddresses.length };
  });
  if (!simulation.value.err) {
    simulationMetrics.lastSuccessAt = Date.now();
    return {
      accountRentLamports: accountRentLamportsFromSimulation(newAccountCount, simulation.value.accounts),
    };
  }
  simulationMetrics.failures += 1;
  simulationMetrics.lastFailureAt = Date.now();
  throw classifyFuturesSimulationError(simulation.value.err, simulation.value.logs);
}

function lamportsToSol(lamports: bigint): string {
  const whole = lamports / 1_000_000_000n;
  const fraction = (lamports % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function classifyFuturesSimulationError(error: unknown, logs: readonly string[] | null = null): AppError {
  const reason = JSON.stringify(error);
  const logText = logs?.join('\n') ?? '';
  if (/BlockhashNotFound|blockhash/i.test(reason)) return new AppError(410, 'FUTURES_BLOCKHASH_EXPIRED', 'The transaction blockhash expired. Review a fresh action.', true);
  const rentShortfall = logText.match(/Transfer: insufficient lamports (\d+), need (\d+)/i);
  if (rentShortfall) {
    const available = BigInt(rentShortfall[1]);
    const needed = BigInt(rentShortfall[2]);
    const shortfall = needed > available ? needed - available : 0n;
    return new AppError(
      409,
      'FUTURES_INSUFFICIENT_BALANCE',
      `This action needs ${lamportsToSol(needed)} SOL for account rent, but only ${lamportsToSol(available)} SOL remains after network fees. Add at least ${lamportsToSol(shortfall)} SOL plus a small fee buffer, then retry.`,
    );
  }
  if (/insufficient|0x1\b/i.test(`${reason}\n${logText}`)) return new AppError(409, 'FUTURES_INSUFFICIENT_BALANCE', 'The wallet or venue collateral cannot cover this action and its network fee.');
  return new AppError(409, 'FUTURES_SIMULATION_FAILED', 'Solana simulation rejected this futures action before submission.', true, { reason: reason.slice(0, 600) });
}

export function futuresTransactionDiagnostics() {
  return { simulation: { ...simulationMetrics }, transactions: structuredClone(transactionMetrics), entryCircuits: { phoenix: entryCircuits.phoenix.snapshot(), gmtrade: entryCircuits.gmtrade.snapshot() } };
}

export function assertMessageUnchanged(transaction: VersionedTransaction, expected: Uint8Array) {
  const actual = transaction.message.serialize();
  if (actual.length !== expected.length || !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) {
    throw new AppError(409, 'FUTURES_TRANSACTION_CHANGED', 'The signed transaction differs from the exact action reviewed in Flay.');
  }
}

export function verifyWalletSignature(message: Uint8Array, wallet: string, signature: Uint8Array): boolean {
  try {
    const key = createPublicKey({
      key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(new PublicKey(wallet).toBytes())]),
      format: 'der',
      type: 'spki',
    });
    return verify(null, Buffer.from(message), key, Buffer.from(signature));
  } catch {
    return false;
  }
}

function actionRequiresMarket(action: FuturesPrepareRequest['action']): boolean {
  return ['open', 'cancel', 'close', 'reduce', 'take-profit', 'stop-loss', 'cancel-conditional'].includes(action);
}

function reviewFor(request: FuturesPrepareRequest, quote: FuturesRouteQuote | undefined, networkFeeLamports: string | null, accountRentLamports: string | null, builtWarnings: string[]) {
  return {
    market: quote?.market ?? request.market ?? null,
    nativeMarketAddress: quote?.nativeMarketAddress ?? null,
    side: quote?.side ?? null,
    orderType: quote?.orderType ?? null,
    collateralAtomic: quote?.collateralAtomic ?? request.amountAtomic ?? null,
    sizeAtomic: quote?.baseSizeAtomic ?? request.sizeAtomic ?? null,
    priceMicroUsd: quote?.acceptablePriceMicroUsd ?? null,
    triggerPriceMicroUsd: request.triggerPriceMicroUsd ?? null,
    executionPriceMicroUsd: request.executionPriceMicroUsd ?? null,
    executionFeeLamports: quote?.executionFeeLamports ?? null,
    networkFeeLamports,
    accountRentLamports,
    lookupTables: [] as string[],
    programs: [] as string[],
    warnings: [
      ...builtWarnings,
      'Flay simulated this exact unsigned message and will reject any signed-message change.',
      'Perpetual futures can liquidate collateral and all venue activity is public on Solana.',
    ],
  };
}

export class FuturesTransactionService {
  private readonly store = new FuturesPreparedStore();
  private readonly phoenix = new PhoenixTransactionBuilder();

  constructor(private readonly futures: FuturesService) {}

  challengePhoenix(wallet: string) {
    return this.phoenix.challenge(wallet);
  }

  loginPhoenix(wallet: string, proof?: { challengeId: string; signedTransaction: string }) {
    return this.phoenix.login(wallet, proof);
  }

  preparedWallet(preparedId: string): string {
    return this.store.get(preparedId).request.wallet;
  }


  async prepare(request: FuturesPrepareRequest): Promise<FuturesPreparedStep> {
    if (request.action === 'open') entryCircuits[request.venue].assertAvailable();
    const requestFingerprint = fingerprint(request);
    const prior = this.store.getByIdempotency(request.wallet, request.idempotencyKey, requestFingerprint);
    if (prior) return prior.public;

    const { quote, normalizedRequest, beforeVenuePortfolio } = await this.validateAction(request);
    let transaction: VersionedTransaction;
    let allowedPrograms: string[];
    let marketAddress: string | null;
    let allowedLookupTables: string[];
    let allowedAdditionalSigners: string[];
    let warnings: string[];
    let gmSemantics: GmTradeOrderSemantics | null = null;
    let phoenixExpected: import('./phoenix-transactions.js').PhoenixExpectedSemantics | null = null;
    let accountRentLamports: string | null = null;

    if (request.venue === 'phoenix') {
      const access = await this.futures.access(request.wallet);
      if (!access.publicData) throw new AppError(503, 'PHOENIX_ACCESS_UNAVAILABLE', access.message, true);
      if (request.action === 'activate' || request.action === 'register') {
        if (access.activated) throw new AppError(409, 'PHOENIX_ALREADY_ONBOARDED', 'This wallet is already onboarded to Phoenix. Refresh futures and continue.');
      } else if (!access.executionEligible) {
        throw new AppError(403, 'PHOENIX_ONBOARDING_REQUIRED', access.message);
      }
      const latest = await withRpcFallback((rpc) => rpc.getLatestBlockhash('confirmed'));
      const built = await observeOperation(transactionMetrics.builds.phoenix, () => observeVenueBuild('phoenix', () => this.phoenix.build(normalizedRequest, quote, latest)));
      if (built.transaction) {
        transaction = deserializeTransaction(built.transaction);
        if (transaction.message.recentBlockhash !== latest.blockhash) {
          throw new AppError(409, 'FUTURES_BLOCKHASH_INVALID', 'Phoenix returned an onboarding transaction with a different blockhash.');
        }
      } else {
        const message = new TransactionMessage({
          payerKey: new PublicKey(request.wallet),
          recentBlockhash: latest.blockhash,
          instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }), ...built.instructions],
        }).compileToV0Message();
        transaction = new VersionedTransaction(message);
      }
      allowedPrograms = built.allowedPrograms;
      allowedLookupTables = [];
      allowedAdditionalSigners = built.allowedAdditionalSigners;
      phoenixExpected = built.expected;
      marketAddress = built.marketAddress;
      warnings = built.warnings;
    } else {
      const built = await observeOperation(transactionMetrics.builds.gmtrade, () => observeVenueBuild('gmtrade', () => this.futures.gmtrade.prepareAction({ request: normalizedRequest, quote })));
      transaction = deserializeTransaction(built.transaction);
      allowedPrograms = [GMTRADE_PROGRAM];
      allowedLookupTables = built.lookupTables ?? [];
      allowedAdditionalSigners = [];
      marketAddress = built.marketAddress ?? quote?.nativeMarketAddress ?? null;
      warnings = built.warnings ?? [];
      if (built.programs.some((program) => program !== GMTRADE_PROGRAM && !COMMON_PROGRAMS.includes(program))) {
        throw new AppError(409, 'GMTRADE_PROGRAM_NOT_ALLOWED', 'The GMTrade sidecar returned an unexpected program.');
      }
    }

    const requiredAddresses = [request.wallet, ...(actionRequiresMarket(request.action) && marketAddress ? [marketAddress] : [])];
    if (request.venue === 'gmtrade' && request.nativeId && ['cancel', 'close', 'reduce', 'take-profit', 'stop-loss', 'cancel-conditional'].includes(request.action)) {
      requiredAddresses.push(request.nativeId);
    }
    if (request.venue === 'gmtrade' || request.action === 'deposit' || request.action === 'withdraw') requiredAddresses.push(USDC_MINT);
    const requiresWalletUsdcAccount = request.venue === 'gmtrade'
      ? ['open', 'close', 'reduce', 'take-profit', 'stop-loss'].includes(request.action)
      : request.action === 'deposit' || request.action === 'withdraw';
    if (requiresWalletUsdcAccount) {
      requiredAddresses.push(getAssociatedTokenAddressSync(new PublicKey(USDC_MINT), new PublicKey(request.wallet)).toBase58());
    }
    let validated: ValidatedFuturesTransaction;
    try {
      validated = await validateFuturesTransaction(transaction, request.wallet, allowedPrograms, requiredAddresses, allowedLookupTables, allowedAdditionalSigners);
      if (request.venue === 'gmtrade') {
        gmSemantics = validateGmTradeOrderSemantics(normalizedRequest, quote, beforeVenuePortfolio, validated.instructions);
        validateGmTradeInstructionAccounts(normalizedRequest, quote, marketAddress, validated.instructions, gmSemantics);
      }
      if (request.venue === 'phoenix' && phoenixExpected) {
        validatePhoenixSemantics(phoenixExpected, validated.instructions);
        validatePhoenixInstructionAccounts(phoenixExpected, normalizedRequest.wallet, marketAddress, validated.instructions);
      }
      const simulation = await simulate(transaction, false, validated.writableAddresses);
      accountRentLamports = simulation.accountRentLamports;
      if (request.action === 'open') entryCircuits[request.venue].recordSuccess();
    } catch (error) {
      if (request.action === 'open') entryCircuits[request.venue].recordFailure(error);
      throw error;
    }
    const fee = await withRpcFallback((rpc) => rpc.getFeeForMessage(transaction.message, 'confirmed'));
    const networkFeeLamports = fee.value === null ? null : String(fee.value);
    const review = reviewFor(normalizedRequest, quote, networkFeeLamports, accountRentLamports, warnings);
    if (gmSemantics) {
      review.executionFeeLamports = gmSemantics.executionFeeLamports.toString();
      const baseDecimals = quote?.baseDecimals ?? beforeVenuePortfolio?.positions.find((position) => position.nativeId === normalizedRequest.nativeId)?.baseDecimals;
      if (baseDecimals !== undefined && gmSemantics.acceptablePriceProtocol !== null) {
        review.priceMicroUsd = gmTradeProtocolPriceToMicro(gmSemantics.acceptablePriceProtocol, baseDecimals);
      }
    }
    review.lookupTables = validated.lookupTables;
    review.programs = validated.programs;
    review.nativeMarketAddress = marketAddress;
    const expiresAt = Date.now() + FUTURES_PREPARED_TTL_MS;
    const record = this.store.put({
      request: normalizedRequest,
      requestFingerprint,
      unsignedMessage: validated.message,
      allowedPrograms,
      allowedLookupTables,
      allowedAdditionalSigners,
      requiredAddresses,
      quote: quote ?? null,
      beforeVenuePortfolio: beforeVenuePortfolio ?? null,
      public: {
        action: request.action,
        venue: request.venue,
        wallet: request.wallet,
        transaction: Buffer.from(transaction.serialize()).toString('base64'),
        messageHash: validated.messageHash,
        expiresAt,
        review,
      },
    });
    return record.public;
  }

  async execute(preparedId: string, wallet: string, signedTransaction: string, idempotencyKey: string): Promise<FuturesExecution> {
    const record = this.store.get(preparedId);
    if (record.request.wallet !== wallet) throw new AppError(403, 'WALLET_MISMATCH', 'This prepared action belongs to another wallet.');
    const previous = this.store.executionForKey(wallet, idempotencyKey);
    if (previous) {
      if (previous.preparedId !== preparedId) throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'This submission key was already used for a different transaction.');
      return previous;
    }
    if (record.executedSignature && record.executionId) return this.store.getExecution(record.executionId, wallet);

    const transaction = deserializeTransaction(signedTransaction);
    assertMessageUnchanged(transaction, record.unsignedMessage);
    await validateFuturesTransaction(transaction, wallet, record.allowedPrograms, record.requiredAddresses, record.allowedLookupTables, record.allowedAdditionalSigners);
    const walletSignature = transaction.signatures[0];
    if (!walletSignature?.some((byte) => byte !== 0)) throw new AppError(400, 'FUTURES_SIGNATURE_MISSING', 'The Privy wallet did not sign the reviewed transaction.');
    if (!verifyWalletSignature(record.unsignedMessage, wallet, walletSignature)) throw new AppError(400, 'FUTURES_SIGNATURE_INVALID', 'The reviewed wallet signature is invalid.');
    const localSignature = bs58.encode(walletSignature);
    if (record.request.venue === 'phoenix' && (record.request.action === 'activate' || record.request.action === 'register')) {
      if (record.allowedAdditionalSigners.length !== 1) {
        throw new AppError(409, 'PHOENIX_ONBOARDING_SIGNER_INVALID', 'The reviewed Phoenix onboarding signer is unavailable. Prepare a fresh onboarding.', true);
      }
      const result = await observeOperation(transactionMetrics.submissions.phoenix, () => this.phoenix.onboardSigned(wallet, signedTransaction, record.allowedAdditionalSigners[0]));
      if (result.signature !== localSignature) {
        throw new AppError(502, 'FUTURES_SIGNATURE_MISMATCH', 'Phoenix returned a different transaction signature.');
      }
      this.futures.invalidateWalletState(wallet, 'phoenix');
      return this.store.putExecution(preparedId, idempotencyKey, {
        preparedId,
        venue: record.request.venue,
        action: record.request.action,
        signature: result.signature,
        status: 'submitted',
        explorerUrl: explorer(result.signature),
        submittedAt: Date.now(),
        reconciledAt: null,
        detail: 'Phoenix accepted the signed public onboarding; Solana confirmation is pending.',
      });
    }
    await simulate(transaction, true);
    const signature = await observeOperation(transactionMetrics.submissions[record.request.venue], () => withRpcFallback((rpc) => rpc.sendRawTransaction(transaction.serialize(), { skipPreflight: false, maxRetries: 3 })));
    if (signature !== localSignature) throw new AppError(502, 'FUTURES_SIGNATURE_MISMATCH', 'The RPC returned a different transaction signature.');
    this.futures.invalidateWalletState(wallet, record.request.venue);
    return this.store.putExecution(preparedId, idempotencyKey, {
      preparedId,
      venue: record.request.venue,
      action: record.request.action,
      signature,
      status: 'submitted',
      explorerUrl: explorer(signature),
      submittedAt: Date.now(),
      reconciledAt: null,
      detail: 'Submitted to Solana; venue state is reconciling.',
    });
  }

  async execution(executionId: string, wallet: string): Promise<FuturesExecution> {
    const execution = this.store.getExecution(executionId, wallet);
    if (execution.status !== 'submitted') return execution;
    transactionMetrics.reconciliation.attempts += 1;
    const response = await withRpcFallback((rpc) => rpc.getSignatureStatuses([execution.signature], { searchTransactionHistory: true }));
    const status = response.value[0];
    if (!status) return execution;
    const record = this.store.get(execution.preparedId);
    let next: FuturesExecution;
    if (status.err) {
      next = { ...execution, status: 'failed', reconciledAt: Date.now(), detail: `Solana confirmed a venue failure: ${JSON.stringify(status.err).slice(0, 300)}` };
    } else if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') {
      if (record.request.action === 'activate' || record.request.action === 'register') {
        const access = await this.futures.access(wallet);
        const indexed = access.activated && access.traderRegistered;
        if (!indexed) {
          next = { ...execution, detail: 'Confirmed on Solana; waiting for Phoenix to index public onboarding.' };
        } else {
          next = { ...execution, status: 'filled', reconciledAt: Date.now(), detail: 'Phoenix confirms public onboarding.' };
        }
      } else {
        const portfolio = await this.futures.portfolio(wallet);
        const venue = portfolio.venues[record.request.venue];
        const reconciled = reconcileFuturesAction(record.request, record.quote, record.beforeVenuePortfolio, venue);
        next = reconciled
          ? { ...execution, ...reconciled, reconciledAt: Date.now() }
          : { ...execution, detail: `Confirmed on Solana; waiting for ${record.request.venue} to report the resulting venue state.` };
      }
    } else return execution;
    if (next.status !== 'submitted') {
      transactionMetrics.reconciliation.completed += 1;
      if (next.status === 'failed') transactionMetrics.reconciliation.failed += 1;
      transactionMetrics.reconciliation.lastLagMs = Date.now() - execution.submittedAt;
      transactionMetrics.reconciliation.lastCompletedAt = Date.now();
    }
    this.store.updateExecution(next);
    return next;
  }

  private async validateAction(request: FuturesPrepareRequest): Promise<{ quote?: FuturesRouteQuote; normalizedRequest: FuturesPrepareRequest; beforeVenuePortfolio?: FuturesVenuePortfolio }> {
    if (request.action === 'activate' || request.action === 'register') return { normalizedRequest: request };
    if (request.action === 'open') {
      if (!request.quoteId) throw new AppError(400, 'FUTURES_QUOTE_REQUIRED', 'Select and review a live venue quote.');
      const stored = this.futures.quotes.get(request.quoteId, request.wallet);
      if (stored.quote.venue !== request.venue) throw new AppError(409, 'FUTURES_VENUE_CHANGED', 'The selected venue differs from the reviewed route.');
      if (request.market !== stored.intent.market || stored.quote.market !== stored.intent.market) {
        throw new AppError(409, 'FUTURES_MARKET_CHANGED', 'The requested market differs from the wallet-bound quote.');
      }
      if (!stored.quote.executionEligible) throw new AppError(409, 'FUTURES_ROUTE_INELIGIBLE', stored.quote.exclusionReason ?? 'This route cannot execute.');
      const [freshRoutes, portfolio] = await Promise.all([
        this.futures.routeQuotes(stored.intent),
        this.futures.portfolio(request.wallet),
      ]);
      const fresh = freshRoutes.quotes.find((candidate) => candidate.venue === request.venue);
      if (!fresh?.executionEligible) {
        throw new AppError(
          409,
          'FUTURES_ROUTE_INELIGIBLE',
          fresh?.exclusionReason ?? 'The selected venue no longer exposes an executable route.',
          true,
        );
      }
      const acceptable = BigInt(stored.quote.acceptablePriceMicroUsd ?? '0');
      const entry = BigInt(fresh.entryPriceMicroUsd ?? '0');
      if (stored.intent.orderType === 'market' && ((stored.intent.side === 'long' && entry > acceptable) || (stored.intent.side === 'short' && entry < acceptable))) {
        throw new AppError(409, 'FUTURES_PRICE_MOVED', 'The selected venue moved beyond the reviewed slippage bound. Refresh routes.', true);
      }
      return { quote: fresh, normalizedRequest: { ...request, market: fresh.market }, beforeVenuePortfolio: portfolio.venues[request.venue] };
    }

    const portfolio = await this.futures.portfolio(request.wallet);
    const venue = portfolio.venues[request.venue];
    if (request.action === 'deposit') {
      if (portfolio.walletUsdcAtomic === null || portfolio.walletBalancesStale) {
        throw new AppError(503, 'FUTURES_WALLET_BALANCE_UNAVAILABLE', 'A current wallet USDC balance is required before preparing a deposit.', true);
      }
      if (BigInt(request.amountAtomic ?? '0') > BigInt(portfolio.walletUsdcAtomic)) throw new AppError(409, 'FUTURES_WALLET_BALANCE_LOW', 'The wallet does not contain enough USDC for this deposit.');
    } else if (request.action === 'withdraw') {
      if (!venue.available) throw new AppError(503, 'FUTURES_STATE_UNAVAILABLE', 'The venue must report current margin before Flay can prepare a safe withdrawal.', true);
      if (BigInt(request.amountAtomic ?? '0') > BigInt(venue.withdrawableAtomic)) throw new AppError(409, 'FUTURES_WITHDRAWAL_UNSAFE', 'This amount is not currently withdrawable under venue margin and cooldown rules.');
    } else if (request.action === 'cancel') {
      const order = venue.orders.find((item) => item.nativeId === request.nativeId);
      if (!order) throw new AppError(404, 'FUTURES_ORDER_NOT_FOUND', 'The original venue no longer reports this order.');
      return { normalizedRequest: { ...request, market: order.market }, beforeVenuePortfolio: venue };
    } else if (['close', 'reduce', 'take-profit', 'stop-loss'].includes(request.action)) {
      const position = venue.positions.find((item) => item.nativeId === request.nativeId);
      if (!position) throw new AppError(404, 'FUTURES_POSITION_NOT_FOUND', 'The original venue no longer reports this position.');
      const requestedSize = request.action === 'close' ? position.sizeAtomic : request.sizeAtomic ?? position.sizeAtomic;
      if (BigInt(requestedSize) > BigInt(position.sizeAtomic)) throw new AppError(409, 'FUTURES_REDUCE_TOO_LARGE', 'The requested size exceeds the live venue position.');
      return { normalizedRequest: { ...request, market: position.market, sizeAtomic: requestedSize }, beforeVenuePortfolio: venue };
    } else if (request.action === 'cancel-conditional') {
      const livePosition = venue.positions.find((position) => position.conditionals.some((conditional) => conditional.nativeId === request.nativeId));
      const orphaned = venue.orphanedConditionals.find((conditional) => conditional.nativeId === request.nativeId);
      const conditionalMarket = livePosition?.market ?? orphaned?.market;
      if (!conditionalMarket) throw new AppError(404, 'FUTURES_CONDITIONAL_NOT_FOUND', 'The original venue no longer reports this conditional order.');
      return { normalizedRequest: { ...request, market: conditionalMarket }, beforeVenuePortfolio: venue };
    }
    return { normalizedRequest: request, beforeVenuePortfolio: venue };
  }
}
