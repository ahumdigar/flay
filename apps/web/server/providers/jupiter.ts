import bs58 from 'bs58';
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { QUOTE_TTL_MS } from '../../shared/constants.js';
import type { GasPayment, QuoteFee } from '../../shared/types.js';
import type { ProviderQuoteResult } from '../domain.js';
import { config, providerHeaders } from '../config.js';
import { AppError } from '../errors.js';
import { fetchJson } from '../fetch-json.js';
import { withRpcFallback } from '../rpc.js';
import { simulationError } from '../transaction-validation.js';
import type { PrepareRequest, ProviderPrepared, QuoteAdapter, QuoteRequest } from './types.js';

interface JupiterRoute {
  percent?: number;
  swapInfo?: {
    ammKey?: string;
    label?: string;
    feeAmount?: string;
    feeMint?: string;
  };
}

interface JupiterOrder {
  inputMint?: string;
  outputMint?: string;
  inAmount?: string;
  outAmount?: string;
  otherAmountThreshold?: string;
  slippageBps?: number;
  priceImpactPct?: string;
  priceImpact?: number;
  routePlan?: JupiterRoute[];
  feeMint?: string;
  feeBps?: number;
  platformFee?: { amount?: string; feeBps?: number; feeMint?: string };
  gasless?: boolean;
  signatureFeePayer?: string;
  prioritizationFeePayer?: string;
  rentFeePayer?: string;
  signatureFeeLamports?: number | string;
  prioritizationFeeLamports?: number | string;
  rentFeeLamports?: number | string;
  requestId?: string;
  transaction?: string | null;
  router?: string;
  error?: string | null;
  errorMessage?: string | null;
  errorCode?: string | number | null;
  taker?: string | null;
}

interface JupiterApiInstruction {
  programId?: string;
  accounts?: Array<{ pubkey?: string; isSigner?: boolean; isWritable?: boolean }>;
  data?: string;
}

interface JupiterBuild {
  inputMint?: string;
  outputMint?: string;
  inAmount?: string;
  outAmount?: string;
  otherAmountThreshold?: string;
  slippageBps?: number;
  priceImpactPct?: string;
  routePlan?: JupiterRoute[];
  computeBudgetInstructions?: JupiterApiInstruction[];
  setupInstructions?: JupiterApiInstruction[];
  swapInstruction?: JupiterApiInstruction;
  cleanupInstruction?: JupiterApiInstruction | null;
  otherInstructions?: JupiterApiInstruction[];
  tipInstruction?: JupiterApiInstruction | null;
  addressesByLookupTableAddress?: Record<string, string[]> | null;
  blockhashWithMetadata?: { blockhash?: number[] | string; lastValidBlockHeight?: number };
}

interface JupiterRouterSnapshot {
  kind: 'router-build';
  payload: JupiterBuild;
  transactionBase64: string;
}

// Jupiter's official RFQ settlement program. Keep this route-scoped instead of
// broadening the global program allowlist for every Jupiter transaction.
export const JUPITERZ_ORDER_ENGINE_PROGRAM = '61DFfeTKM7trxYcPQCM78bJ794ddZprZpAwAnLiwTpYH';

export function jupiterRoutePrograms(router: string | undefined): string[] {
  return router?.toLowerCase() === 'jupiterz' ? [JUPITERZ_ORDER_ENGINE_PROGRAM] : [];
}

function orderUrl(request: QuoteRequest, taker?: string): URL {
  const url = new URL('/swap/v2/order', config.jupiterBaseUrl);
  url.searchParams.set('inputMint', request.inputMint);
  url.searchParams.set('outputMint', request.outputMint);
  url.searchParams.set('amount', request.amount);
  url.searchParams.set('slippageBps', String(request.slippageBps));
  if (taker) url.searchParams.set('taker', taker);
  return url;
}

const DEFAULT_ROUTER_MAX_ACCOUNTS = 32;
const COMPACT_ROUTER_MAX_ACCOUNTS = 20;

function buildUrl(request: QuoteRequest, maxAccounts = DEFAULT_ROUTER_MAX_ACCOUNTS): URL {
  if (!request.executionWallet) {
    throw new AppError(500, 'JUPITER_ROUTER_WALLET_REQUIRED', 'A wallet is required to build this Jupiter Router transaction.');
  }
  const url = new URL('/swap/v2/build', config.jupiterBaseUrl);
  url.searchParams.set('inputMint', request.inputMint);
  url.searchParams.set('outputMint', request.outputMint);
  url.searchParams.set('amount', request.amount);
  url.searchParams.set('slippageBps', String(request.slippageBps));
  url.searchParams.set('taker', request.executionWallet);
  // Bound the primary route, then allow the quote path to request one stricter
  // 20-account build only when exact simulation identifies a SOL rent shortfall.
  url.searchParams.set('maxAccounts', String(maxAccounts));
  return url;
}

export function compactRouterFallbackMaxAccounts(error: unknown): number | null {
  return error instanceof AppError && error.code === 'INSUFFICIENT_SOL'
    ? COMPACT_ROUTER_MAX_ACCOUNTS
    : null;
}

function validateQuote(payload: JupiterOrder | JupiterBuild, request: QuoteRequest): asserts payload is (JupiterOrder | JupiterBuild) & {
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
} {
  if (
    payload.inputMint !== request.inputMint
    || payload.outputMint !== request.outputMint
    || payload.inAmount !== request.amount
    || !/^\d+$/.test(payload.outAmount ?? '')
    || !/^\d+$/.test(payload.otherAmountThreshold ?? '')
  ) {
    throw new AppError(502, 'JUPITER_QUOTE_INVALID', 'Jupiter returned a quote that did not match the request.', true);
  }
}

function validateOrder(payload: JupiterOrder, request: QuoteRequest): asserts payload is JupiterOrder & {
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  requestId: string;
} {
  validateQuote(payload, request);
  if (typeof payload.requestId !== 'string' || !payload.requestId) {
    throw new AppError(502, 'JUPITER_QUOTE_INVALID', 'Jupiter returned an order without an execution reference.', true);
  }
}

function normalizeQuote(
  payload: JupiterOrder | JupiterBuild,
  request: QuoteRequest,
  fetchedAt: number,
  providerLabel = 'Jupiter Swap V2',
): ProviderQuoteResult['quote'] {
  validateQuote(payload, request);
  const order = payload as JupiterOrder;
  const feeBps = order.feeBps ?? order.platformFee?.feeBps;
  const fees: QuoteFee[] = [];
  if (typeof feeBps === 'number') {
    fees.push({
      label: 'Jupiter total swap fee',
      amountAtomic: null,
      mint: order.platformFee?.feeMint ?? order.feeMint ?? request.inputMint,
      detail: `${feeBps / 100}% disclosed by Jupiter${order.gasless === true ? '; includes any gas sponsorship recovery' : ''}`,
  });
  }
  const liquidityFees = (payload.routePlan ?? [])
    .filter((route) => /^\d+$/.test(route.swapInfo?.feeAmount ?? ''))
    .map((route) => ({
      label: `${route.swapInfo?.label ?? 'Liquidity venue'} fee`,
      amountAtomic: route.swapInfo?.feeAmount ?? null,
      mint: route.swapInfo?.feeMint ?? null,
      detail: `${route.percent ?? 100}% of route`,
  }));
  fees.push(...liquidityFees);

  const labels = [...new Set((payload.routePlan ?? []).map((route) => route.swapInfo?.label).filter(Boolean))];
  const priceImpact = typeof order.priceImpact === 'number'
    ? order.priceImpact
    : Number.isFinite(Number(payload.priceImpactPct)) ? Number(payload.priceImpactPct) * 100 : null;

  return {
    provider: 'jupiter',
    providerLabel,
    routeLabel: labels.length ? labels.join(' → ') : order.router ? `Jupiter · ${order.router}` : 'Jupiter Metis Router',
    inputMint: request.inputMint,
    outputMint: request.outputMint,
    inAmount: request.amount,
    outAmount: payload.outAmount,
    minimumOut: payload.otherAmountThreshold,
    slippageBps: Number.isInteger(payload.slippageBps) ? payload.slippageBps! : request.slippageBps,
    priceImpactPct: priceImpact,
    fees,
    networkFeeLamports: null,
    fetchedAt,
    expiresAt: fetchedAt + QUOTE_TTL_MS,
    poolIds: (payload.routePlan ?? []).map((route) => route.swapInfo?.ammKey).filter((value): value is string => Boolean(value)),
    warnings: [
      providerLabel.includes('Router')
        ? 'Jupiter Metis selected the underlying venue shown in the route label.'
        : 'Jupiter is a meta-aggregator; its underlying venue is shown in the route label.',
      ...(order.gasless === true ? ['Jupiter reports this prepared order as gasless; its quoted output already reflects provider fees.'] : []),
      ...(providerLabel.includes('Router') ? ['Jupiter Metis built this wallet-bound route; your wallet pays its Solana gas and account rent.'] : []),
    ],
  };
  }

const MAX_ROUTER_INSTRUCTIONS = 24;
const MAX_ROUTER_ACCOUNTS = 128;
const MAX_ROUTER_LOOKUP_TABLES = 16;
const MAX_COMPUTE_UNITS = 1_400_000;

function boundedInstructions(value: unknown, field: string): JupiterApiInstruction[] {
  if (!Array.isArray(value) || value.length > MAX_ROUTER_INSTRUCTIONS) {
    throw new AppError(502, 'JUPITER_BUILD_INVALID', `Jupiter returned invalid ${field}.`, true);
  }
  return value as JupiterApiInstruction[];
}

function routerInstruction(value: JupiterApiInstruction, field: string): TransactionInstruction {
  if (!value || typeof value.programId !== 'string' || !Array.isArray(value.accounts) || value.accounts.length > MAX_ROUTER_ACCOUNTS) {
    throw new AppError(502, 'JUPITER_BUILD_INVALID', `Jupiter returned an invalid ${field} instruction.`, true);
  }
  if (typeof value.data !== 'string' || value.data.length > 4_096 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value.data)) {
    throw new AppError(502, 'JUPITER_BUILD_INVALID', `Jupiter returned invalid ${field} instruction data.`, true);
  }
  try {
    const data = Buffer.from(value.data, 'base64');
    if (data.length > 2_048) throw new Error('instruction data is too large');
    return new TransactionInstruction({
      programId: new PublicKey(value.programId),
      keys: value.accounts.map((account) => {
        if (
          typeof account.pubkey !== 'string'
          || typeof account.isSigner !== 'boolean'
          || typeof account.isWritable !== 'boolean'
        ) throw new Error('invalid instruction account');
        return { pubkey: new PublicKey(account.pubkey), isSigner: account.isSigner, isWritable: account.isWritable };
      }),
      data,
    });
  } catch {
    throw new AppError(502, 'JUPITER_BUILD_INVALID', `Jupiter returned an invalid ${field} instruction.`, true);
  }
}

function routerLookupTables(value: JupiterBuild['addressesByLookupTableAddress']): AddressLookupTableAccount[] {
  if (value === null || value === undefined) return [];
  const entries = Object.entries(value);
  if (entries.length > MAX_ROUTER_LOOKUP_TABLES) {
    throw new AppError(502, 'JUPITER_BUILD_INVALID', 'Jupiter returned too many address lookup tables.', true);
  }
  try {
    return entries.map(([key, addresses]) => {
      if (!Array.isArray(addresses) || addresses.length > 256) throw new Error('invalid lookup table');
      return new AddressLookupTableAccount({
        key: new PublicKey(key),
        state: {
          deactivationSlot: BigInt('18446744073709551615'),
          lastExtendedSlot: 0,
          lastExtendedSlotStartIndex: 0,
          authority: undefined,
          addresses: addresses.map((address) => new PublicKey(address)),
        },
      });
    });
  } catch {
    throw new AppError(502, 'JUPITER_BUILD_INVALID', 'Jupiter returned an invalid address lookup table.', true);
  }
}

function routerBlockhash(value: JupiterBuild['blockhashWithMetadata']): string {
  const blockhash = value?.blockhash;
  try {
    if (typeof blockhash === 'string') return new PublicKey(blockhash).toBase58();
    if (Array.isArray(blockhash) && blockhash.length === 32 && blockhash.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
      return bs58.encode(Uint8Array.from(blockhash));
    }
  } catch {
    // Handled below as a bounded provider error.
  }
  throw new AppError(502, 'JUPITER_BUILD_INVALID', 'Jupiter returned an invalid transaction blockhash.', true);
}

function routerTransaction(
  wallet: PublicKey,
  recentBlockhash: string,
  instructions: TransactionInstruction[],
  lookupTables: AddressLookupTableAccount[],
): VersionedTransaction {
  const message = new TransactionMessage({ payerKey: wallet, recentBlockhash, instructions })
    .compileToV0Message(lookupTables);
  return new VersionedTransaction(message);
}

async function assembleRouterTransaction(payload: JupiterBuild, request: QuoteRequest): Promise<VersionedTransaction> {
  validateQuote(payload, request);
  if (!request.executionWallet) {
    throw new AppError(500, 'JUPITER_ROUTER_WALLET_REQUIRED', 'A wallet is required to assemble this Jupiter Router transaction.');
  }
  if (!Number.isInteger(payload.slippageBps) || payload.slippageBps! < 0 || payload.slippageBps! > 5_000) {
    throw new AppError(502, 'JUPITER_BUILD_INVALID', 'Jupiter returned invalid slippage for this route.', true);
  }
  if (!payload.swapInstruction || payload.tipInstruction) {
    throw new AppError(502, 'JUPITER_BUILD_INVALID', 'Jupiter returned an incomplete or unexpected Router instruction set.', true);
  }

  const compute = boundedInstructions(payload.computeBudgetInstructions, 'compute budget');
  const setup = boundedInstructions(payload.setupInstructions, 'setup');
  const other = boundedInstructions(payload.otherInstructions, 'additional');
  const computeInstructions = compute.map((instruction, index) => {
    const built = routerInstruction(instruction, `compute budget ${index + 1}`);
    if (!built.programId.equals(ComputeBudgetProgram.programId) || built.data[0] === 2) {
      throw new AppError(502, 'JUPITER_BUILD_INVALID', 'Jupiter returned an unexpected compute-budget instruction.', true);
    }
    return built;
  });
  const routeInstructions = [
    ...setup.map((instruction, index) => routerInstruction(instruction, `setup ${index + 1}`)),
    routerInstruction(payload.swapInstruction, 'swap'),
    ...(payload.cleanupInstruction ? [routerInstruction(payload.cleanupInstruction, 'cleanup')] : []),
    ...other.map((instruction, index) => routerInstruction(instruction, `additional ${index + 1}`)),
  ];
  const wallet = new PublicKey(request.executionWallet);
  const blockhash = routerBlockhash(payload.blockhashWithMetadata);
  const lookupTables = routerLookupTables(payload.addressesByLookupTableAddress);
  const simulationTransaction = routerTransaction(wallet, blockhash, [
    ComputeBudgetProgram.setComputeUnitLimit({ units: MAX_COMPUTE_UNITS }),
    ...computeInstructions,
    ...routeInstructions,
  ], lookupTables);
  const simulation = await withRpcFallback((rpc) => rpc.simulateTransaction(simulationTransaction, {
    commitment: 'confirmed',
    replaceRecentBlockhash: true,
    sigVerify: false,
  }));
  if (simulation.value.err) throw simulationError(simulation.value.err, simulation.value.logs);
  const estimatedUnits = simulation.value.unitsConsumed
    ? Math.min(MAX_COMPUTE_UNITS, Math.max(100_000, Math.ceil(simulation.value.unitsConsumed * 1.2)))
    : MAX_COMPUTE_UNITS;
  const transaction = routerTransaction(wallet, blockhash, [
    ComputeBudgetProgram.setComputeUnitLimit({ units: estimatedUnits }),
    ...computeInstructions,
    ...routeInstructions,
  ], lookupTables);
  if (transaction.serialize().length > 1_232) {
    throw new AppError(502, 'TRANSACTION_TOO_LARGE', 'The Jupiter Router transaction exceeds Solana’s packet limit.', true);
  }
  return transaction;
}

async function buildRouterQuote(request: QuoteRequest, maxAccounts: number): Promise<{
  payload: JupiterBuild;
  transactionBase64: string;
}> {
  const payload = await fetchJson<JupiterBuild>(buildUrl(request, maxAccounts), {
    provider: 'Jupiter Router',
    headers: providerHeaders(),
    timeoutMs: config.requestTimeoutMs + 3_000,
  });
  const transaction = await assembleRouterTransaction(payload, request);
  return { payload, transactionBase64: Buffer.from(transaction.serialize()).toString('base64') };
}

function isRouterSnapshot(value: unknown): value is JupiterRouterSnapshot {
  return Boolean(value && typeof value === 'object' && (value as { kind?: unknown }).kind === 'router-build');
}

function validPublicKey(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new AppError(502, 'JUPITER_GASLESS_INVALID', `Jupiter returned an invalid ${field}.`, true);
  }
  try {
    return new PublicKey(value).toBase58();
  } catch {
    throw new AppError(502, 'JUPITER_GASLESS_INVALID', `Jupiter returned an invalid ${field}.`, true);
  }
}

function lamports(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  const serialized = typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? String(value)
    : typeof value === 'string' && /^\d+$/.test(value)
      ? value
      : null;
  if (serialized === null) {
    throw new AppError(502, 'JUPITER_GASLESS_INVALID', `Jupiter returned an invalid ${field}.`, true);
  }
  return BigInt(serialized).toString();
}

export function parseJupiterGasPayment(payload: JupiterOrder, taker: string): GasPayment {
  const normalizedTaker = validPublicKey(taker, 'taker');
  const signatureFeePayer = validPublicKey(payload.signatureFeePayer, 'signature fee payer');
  validPublicKey(payload.prioritizationFeePayer, 'prioritization fee payer');
  validPublicKey(payload.rentFeePayer, 'rent fee payer');
  const signatureFeeLamports = lamports(payload.signatureFeeLamports, 'signature fee');
  const prioritizationFeeLamports = lamports(payload.prioritizationFeeLamports, 'prioritization fee');
  const rentFeeLamports = lamports(payload.rentFeeLamports, 'rent fee');

  if (payload.gasless !== undefined && typeof payload.gasless !== 'boolean') {
    throw new AppError(502, 'JUPITER_GASLESS_INVALID', 'Jupiter returned an invalid gasless flag.', true);
  }
  if (payload.gasless === true) {
    if (!signatureFeePayer || signatureFeePayer === normalizedTaker) {
      throw new AppError(502, 'JUPITER_GASLESS_INVALID', 'Jupiter marked the order gasless without a distinct valid fee payer.', true);
    }
    return {
      mode: 'provider-sponsored',
      provider: 'Jupiter',
      feePayer: signatureFeePayer,
      signatureFeeLamports,
      prioritizationFeeLamports,
      rentFeeLamports,
      detail: 'Jupiter pays this order’s network gas. The quoted output already reflects any sponsorship recovery charged by Jupiter.',
    };
  }
  if (signatureFeePayer && signatureFeePayer !== normalizedTaker) {
    throw new AppError(502, 'JUPITER_GASLESS_INVALID', 'Jupiter returned a non-user fee payer without explicitly marking the order gasless.', true);
  }
  return {
    mode: 'user-paid',
    provider: null,
    feePayer: normalizedTaker!,
    signatureFeeLamports,
    prioritizationFeeLamports,
    rentFeeLamports,
    detail: 'Your wallet pays this order’s Solana network gas.',
  };
}


export class JupiterAdapter implements QuoteAdapter {
  async quote(request: QuoteRequest): Promise<ProviderQuoteResult> {
    const fetchedAt = Date.now();
    if (request.jupiterMode === 'router') {
      let built;
      let compactFallback = false;
      try {
        built = await buildRouterQuote(request, DEFAULT_ROUTER_MAX_ACCOUNTS);
      } catch (error) {
        const compactMaxAccounts = compactRouterFallbackMaxAccounts(error);
        if (compactMaxAccounts === null) throw error;
        compactFallback = true;
        built = await buildRouterQuote(request, compactMaxAccounts);
      }
      const { payload, transactionBase64 } = built;
      const raw: JupiterRouterSnapshot = { kind: 'router-build', payload, transactionBase64 };
      const quote = normalizeQuote(payload, request, fetchedAt, 'Jupiter Swap V2 Router');
      if (compactFallback) {
        quote.warnings.push('Jupiter selected a compact route because its higher-output route required more account rent than this wallet could fund.');
      }
      return {
        raw,
        context: {
          executionWallet: request.executionWallet,
          jupiterMode: 'router',
        },
        quote,
      };
    }
    const payload = await fetchJson<JupiterOrder>(orderUrl(request), {
      provider: 'Jupiter',
      headers: providerHeaders(),
      timeoutMs: config.requestTimeoutMs,
    });
    validateOrder(payload, request);

    return { raw: payload, context: { requestId: payload.requestId }, quote: normalizeQuote(payload, request, fetchedAt) };
  }

  async prepare(request: PrepareRequest, freshQuote: ProviderQuoteResult): Promise<ProviderPrepared> {
    if (isRouterSnapshot(freshQuote.raw)) {
      if (freshQuote.context.executionWallet !== request.wallet || freshQuote.context.jupiterMode !== 'router') {
        throw new AppError(403, 'QUOTE_WALLET_MISMATCH', 'This executable stock route belongs to another wallet. Request a fresh route.');
      }
      const transaction = deserialize(freshQuote.raw.transactionBase64, 'Jupiter Router');
      const finalQuote = normalizeQuote(freshQuote.raw.payload, request, Date.now(), 'Jupiter Swap V2 Router');
      const networkFee = await withRpcFallback(async (rpc) => {
        const result = await rpc.getFeeForMessage(transaction.message, 'confirmed');
        return result.value === null ? null : String(result.value);
      });
      return {
        transaction,
        transactionBase64: freshQuote.raw.transactionBase64,
        expectedPrograms: [],
        expectedPoolIds: finalQuote.poolIds,
        networkFeeLamports: networkFee,
        gasPayment: {
          mode: 'user-paid',
          provider: null,
          feePayer: request.wallet,
          signatureFeeLamports: networkFee,
          prioritizationFeeLamports: null,
          rentFeeLamports: null,
          detail: 'Your wallet pays this Jupiter Router transaction’s Solana gas and any required token-account rent.',
        },
        submissionMode: 'rpc',
        finalQuote,
      };
    }

    const payload = await fetchJson<JupiterOrder>(orderUrl(request, request.wallet), {
      provider: 'Jupiter',
      headers: providerHeaders(),
      timeoutMs: config.requestTimeoutMs + 3_000,
    });
    validateOrder(payload, request);
    if (payload.error || payload.errorMessage || !payload.transaction) {
      const message = payload.errorMessage || payload.error || 'Jupiter could not build this transaction.';
      if (Number(payload.errorCode) === 3 && payload.router !== 'jupiterz') {
        throw new AppError(409, 'JUPITER_GASLESS_MINIMUM', 'This swap is below Jupiter’s current gasless minimum. Increase the amount or fund a small amount of SOL for a user-paid route.', true);
      }
      const insufficient = /insufficient/i.test(message);
      throw new AppError(
        insufficient ? 409 : 502,
        insufficient ? 'INSUFFICIENT_BALANCE' : 'JUPITER_BUILD_FAILED',
        `Jupiter: ${message}`,
        !insufficient,
      );
    }
    const finalQuote = normalizeQuote(payload, request, Date.now());
    const transaction = deserialize(payload.transaction, 'Jupiter');
    const gasPayment = parseJupiterGasPayment(payload, request.wallet);
    const networkFee = await withRpcFallback(async (rpc) => {
      const result = await rpc.getFeeForMessage(transaction.message, 'confirmed');
      return result.value === null ? null : String(result.value);
    });
    return {
      transaction,
      transactionBase64: payload.transaction,
      requestId: payload.requestId,
      submissionMode: 'provider-execute',
      expectedPrograms: jupiterRoutePrograms(payload.router),
      expectedPoolIds: finalQuote.poolIds,
      networkFeeLamports: networkFee,
      gasPayment,
      allowedExternalSigners: gasPayment.mode === 'provider-sponsored' && gasPayment.feePayer ? [gasPayment.feePayer] : [],
      rejectUnknownSigners: gasPayment.mode === 'provider-sponsored',
      finalQuote,
    };
  }
}

function deserialize(base64: string, provider: string): VersionedTransaction {
  try {
    const bytes = Buffer.from(base64, 'base64');
    if (bytes.length > 1600) throw new Error('transaction exceeds the Solana packet limit');
    return VersionedTransaction.deserialize(bytes);
  } catch (error) {
    throw new AppError(502, 'PROVIDER_TRANSACTION_INVALID', `${provider} returned an invalid transaction: ${error instanceof Error ? error.message : 'unknown error'}.`);
  }
}
