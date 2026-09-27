import { PublicKey } from '@solana/web3.js';
import { z } from 'zod';
import { MAX_SLIPPAGE_BPS, MIN_SLIPPAGE_BPS } from '../shared/constants.js';

const publicKey = z.string().min(32).max(44).refine((value) => {
  try {
    return new PublicKey(value).toBase58() === value;
  } catch {
    return false;
  }
}, 'Invalid Solana address.');

const userPublicKey = publicKey.refine((value) => {
  try {
    return PublicKey.isOnCurve(new PublicKey(value).toBytes());
  } catch {
    return false;
  }
}, 'Program addresses are not supported here.');

const atomicAmount = z.string().regex(/^[1-9]\d*$/, 'Amount must be a positive atomic-unit integer.').refine(
  (value) => !/^[1-9]\d*$/.test(value) || BigInt(value) <= 18_446_744_073_709_551_615n,
  'Amount exceeds the Solana u64 limit.',
);

export const tokenSearchSchema = z.object({
  query: z.string().trim().min(1).max(100),
});

export const quoteSchema = z.object({
  inputMint: publicKey,
  outputMint: publicKey,
  amount: atomicAmount,
  slippageBps: z.coerce.number().int().min(MIN_SLIPPAGE_BPS).max(MAX_SLIPPAGE_BPS),
}).refine((value) => value.inputMint !== value.outputMint, {
  message: 'Choose two different tokens.',
  path: ['outputMint'],
});

export const prepareSchema = z.object({
  quoteId: z.string().uuid(),
  wallet: publicKey,
});

export const gaslessUsdcSendPrepareSchema = z.object({
  wallet: publicKey,
  recipient: userPublicKey,
  amountAtomic: atomicAmount,
}).refine((value) => value.wallet !== value.recipient, {
  message: 'Enter a recipient other than your own wallet.',
  path: ['recipient'],
});

export const gaslessUsdcSendStatusSchema = z.object({
  wallet: publicKey,
  recipient: userPublicKey,
  amountAtomic: atomicAmount,
  signature: z.string().min(80).max(90).regex(/^[1-9A-HJ-NP-Za-km-z]+$/, 'Invalid Solana transaction signature.'),
}).refine((value) => value.wallet !== value.recipient, {
  message: 'The recipient must differ from the sender.',
  path: ['recipient'],
});

export const executeSchema = z.object({
  preparedId: z.string().uuid(),
  signedTransaction: z.string().min(100).max(4000).regex(/^[A-Za-z0-9+/]+={0,2}$/, 'Invalid base64 transaction.'),
});

export const sponsoredMarketCompleteSchema = z.object({
  preparedId: z.string().uuid(),
  signature: z.string().min(80).max(90).regex(/^[1-9A-HJ-NP-Za-km-z]+$/, 'Invalid Solana transaction signature.'),
});

export const walletSchema = z.object({ wallet: publicKey });

export const stockSymbolSchema = z.string().trim().min(2).max(24).regex(/^[A-Za-z0-9.]+$/, 'Invalid xStocks symbol.');

export const stockQuoteSchema = z.object({
  wallet: publicKey,
  symbol: stockSymbolSchema,
  side: z.enum(['buy', 'sell']),
  amount: z.string().trim().min(1).max(40).regex(/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/, 'Enter a positive decimal amount without commas.'),
  slippageBps: z.number().int().min(MIN_SLIPPAGE_BPS).max(MAX_SLIPPAGE_BPS),
});

export const stockPricesSchema = z.object({
  symbols: z.string().min(2).max(300).transform((value) => value.split(',').map((symbol) => symbol.trim()).filter(Boolean)).pipe(z.array(stockSymbolSchema).min(1).max(12)),
});

export const alchemyPayCheckoutSchema = z.object({
  wallet: publicKey,
  fiat: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
  fiatAmount: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,2})$/, 'Use a fiat amount with exactly two decimal places.'),
});

export const alchemyPayOrdersSchema = z.object({ wallet: publicKey });

export const alchemyPayOrderSchema = z.object({
  wallet: publicKey,
  merchantOrderNo: z.string().min(12).max(48).regex(/^[A-Za-z0-9_-]+$/),
});

export const activitySchema = z.object({
  wallet: publicKey,
  signature: z.string().min(80).max(90).regex(/^[1-9A-HJ-NP-Za-km-z]+$/, 'Invalid transaction signature.'),
});

export const triggerCreateSchema = z.object({
  wallet: publicKey,
  inputMint: publicKey,
  outputMint: publicKey,
  makingAmount: atomicAmount,
  takingAmount: atomicAmount,
  slippageBps: z.number().int().min(0).max(MAX_SLIPPAGE_BPS).default(0),
  expiredAt: z.number().int().positive().optional(),
}).refine((value) => value.inputMint !== value.outputMint, {
  message: 'Choose two different tokens.',
  path: ['outputMint'],
}).refine((value) => value.expiredAt === undefined || value.expiredAt > Math.floor(Date.now() / 1000) + 60, {
  message: 'Expiry must be at least one minute in the future.',
  path: ['expiredAt'],
}).refine((value) => value.expiredAt === undefined || value.expiredAt < Math.floor(Date.now() / 1000) + 31_536_000, {
  message: 'Expiry cannot be more than one year away.',
  path: ['expiredAt'],
});

export const triggerOrdersSchema = z.object({
  wallet: publicKey,
  orderStatus: z.enum(['active', 'history']),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});

export const triggerCancelSchema = z.object({
  wallet: publicKey,
  order: publicKey,
});

export const magicBlockWalletSchema = z.object({ wallet: publicKey });

export const magicBlockLoginSchema = z.object({
  wallet: publicKey,
  challenge: z.string().min(20).max(1000),
  signature: z.string().min(80).max(90).regex(/^[1-9A-HJ-NP-Za-km-z]+$/, 'Invalid Solana signature.'),
});

export const magicBlockPrepareSchema = z.object({
  action: z.enum(['deposit', 'private-transfer', 'withdraw']),
  wallet: publicKey,
  recipient: publicKey.optional(),
  amountAtomic: atomicAmount.refine(
    (value) => BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER),
    'Amount exceeds the MagicBlock API integer limit.',
  ),
}).superRefine((value, context) => {
  const isTransfer = value.action === 'private-transfer';
  if (isTransfer && !value.recipient) {
    context.addIssue({ code: 'custom', path: ['recipient'], message: 'Recipient is required for a transfer.' });
  }
  if (!isTransfer && value.recipient) {
    context.addIssue({ code: 'custom', path: ['recipient'], message: 'Recipient is only accepted for transfers.' });
  }
});

export const magicBlockExecuteSchema = z.object({
  preparedId: z.string().uuid(),
  wallet: publicKey,
  signedTransaction: z.string().min(100).max(4000).regex(/^[A-Za-z0-9+/]+={0,2}$/, 'Invalid base64 transaction.'),
});

export const futuresCandlesSchema = z.object({
  symbol: z.enum(['SOL-PERP', 'BTC-PERP', 'ETH-PERP']),
  interval: z.enum(['1m', '5m', '15m', '1h', '4h', '1d']),
});

export const futuresQuoteSchema = z.object({
  wallet: publicKey,
  market: z.enum(['SOL-PERP', 'BTC-PERP', 'ETH-PERP']),
  side: z.enum(['long', 'short']),
  orderType: z.enum(['market', 'limit']),
  collateralAtomic: atomicAmount.refine((value) => BigInt(value) >= 1_000_000n, 'Minimum collateral is 1 USDC.'),
  leverageBps: z.number().int().min(10_000).max(100_000),
  limitPriceMicroUsd: atomicAmount.optional(),
  slippageBps: z.number().int().min(1).max(500),
  routeChoice: z.enum(['auto', 'phoenix', 'gmtrade']),
}).superRefine((value, context) => {
  if (value.orderType === 'limit' && !value.limitPriceMicroUsd) {
    context.addIssue({ code: 'custom', path: ['limitPriceMicroUsd'], message: 'A limit price is required for a limit order.' });
  }
  if (value.orderType === 'market' && value.limitPriceMicroUsd) {
    context.addIssue({ code: 'custom', path: ['limitPriceMicroUsd'], message: 'A market order cannot include a limit price.' });
  }
});

export const futuresPrepareSchema = z.object({
  wallet: publicKey,
  action: z.enum(['activate', 'register', 'deposit', 'open', 'cancel', 'close', 'reduce', 'take-profit', 'stop-loss', 'cancel-conditional', 'withdraw']),
  venue: z.enum(['phoenix', 'gmtrade']),
  quoteId: z.string().uuid().optional(),
  market: z.enum(['SOL-PERP', 'BTC-PERP', 'ETH-PERP']).optional(),
  nativeId: z.string().min(1).max(128).optional(),
  sizeAtomic: atomicAmount.optional(),
  amountAtomic: atomicAmount.optional(),
  triggerPriceMicroUsd: atomicAmount.optional(),
  executionPriceMicroUsd: atomicAmount.optional(),
  idempotencyKey: z.string().uuid(),
}).superRefine((value, context) => {
  const fields = ['quoteId', 'market', 'nativeId', 'sizeAtomic', 'amountAtomic', 'triggerPriceMicroUsd', 'executionPriceMicroUsd'] as const;
  const allowed: Record<typeof value.action, Set<(typeof fields)[number]>> = {
    activate: new Set(),
    register: new Set(),
    deposit: new Set(['amountAtomic']),
    withdraw: new Set(['amountAtomic']),
    open: new Set(['quoteId', 'market']),
    cancel: new Set(['nativeId', 'market']),
    close: new Set(['nativeId', 'market']),
    reduce: new Set(['nativeId', 'market', 'sizeAtomic']),
    'take-profit': new Set(['nativeId', 'market', 'sizeAtomic', 'triggerPriceMicroUsd', 'executionPriceMicroUsd']),
    'stop-loss': new Set(['nativeId', 'market', 'sizeAtomic', 'triggerPriceMicroUsd', 'executionPriceMicroUsd']),
    'cancel-conditional': new Set(['nativeId', 'market']),
  };
  const required: Record<typeof value.action, Set<(typeof fields)[number]>> = {
    activate: new Set(),
    register: new Set(),
    deposit: new Set(['amountAtomic']),
    withdraw: new Set(['amountAtomic']),
    open: new Set(['quoteId', 'market']),
    cancel: new Set(['nativeId', 'market']),
    close: new Set(['nativeId', 'market']),
    reduce: new Set(['nativeId', 'market', 'sizeAtomic']),
    'take-profit': new Set(['nativeId', 'market', 'sizeAtomic', 'triggerPriceMicroUsd', 'executionPriceMicroUsd']),
    'stop-loss': new Set(['nativeId', 'market', 'sizeAtomic', 'triggerPriceMicroUsd', 'executionPriceMicroUsd']),
    'cancel-conditional': new Set(['nativeId', 'market']),
  };
  if (value.venue === 'gmtrade' && ['activate', 'register', 'deposit', 'withdraw'].includes(value.action)) {
    context.addIssue({ code: 'custom', path: ['venue'], message: 'GMTrade uses direct per-position USDC collateral for this action.' });
  }
  for (const field of fields) {
    if (required[value.action].has(field) && value[field] === undefined) {
      context.addIssue({ code: 'custom', path: [field], message: field + ' is required for ' + value.action + '.' });
    }
    if (!allowed[value.action].has(field) && value[field] !== undefined) {
      context.addIssue({ code: 'custom', path: [field], message: field + ' is not accepted for ' + value.action + '.' });
    }
  }
});

export const futuresExecuteSchema = z.object({
  preparedId: z.string().uuid(),
  wallet: publicKey,
  signedTransaction: z.string().min(100).max(20_000).regex(/^[A-Za-z0-9+/]+={0,2}$/, 'Invalid base64 transaction.'),
  idempotencyKey: z.string().uuid(),
}).strict();


export const futuresPhoenixChallengeSchema = z.object({
  wallet: publicKey,
}).strict();

export const futuresPhoenixLoginSchema = z.object({
  wallet: publicKey,
  challengeId: z.string().uuid().optional(),
  signedTransaction: z.string().min(100).max(4_000).regex(/^[A-Za-z0-9+/]+={0,2}$/, 'Invalid base64 transaction.').optional(),
}).strict().superRefine((value, context) => {
  if (Boolean(value.challengeId) !== Boolean(value.signedTransaction)) {
    context.addIssue({ code: 'custom', message: 'challengeId and signedTransaction must be provided together.' });
  }
});

export const futuresExecutionQuerySchema = z.object({ wallet: publicKey });
