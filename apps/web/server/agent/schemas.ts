import { PublicKey } from '@solana/web3.js';
import { z } from 'zod';
import { MAX_SLIPPAGE_BPS, MIN_SLIPPAGE_BPS } from '../../shared/constants.js';

export const agentPublicKeySchema = z.string().min(32).max(44).refine((value) => {
  try { return new PublicKey(value).toBase58() === value; } catch { return false; }
}, 'Invalid Solana address.');

export const agentAtomicAmountSchema = z.string().regex(/^[1-9]\d*$/).refine(
  (value) => !/^[1-9]\d*$/.test(value) || BigInt(value) <= 18_446_744_073_709_551_615n,
  'Amount exceeds the Solana u64 limit.',
);

export const agentStockSymbolSchema = z.string().trim().toUpperCase().min(2).max(24).regex(/^[A-Z0-9.]+$/);
export const agentFuturesMarketSchema = z.enum(['SOL-PERP', 'BTC-PERP', 'ETH-PERP']);
export const agentStockAmountSchema = z.string().trim().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/).refine((value) => Number(value) > 0);

export const agentPolicySchema = z.object({
  wallet: agentPublicKeySchema,
  name: z.string().trim().min(2).max(60),
  approvalMode: z.enum(['always-ask', 'automatic']).default('always-ask'),
  products: z.array(z.enum(['convert', 'stocks', 'futures'])).min(1).max(3).transform((items) => [...new Set(items)]),
  maxTransactionUsd: z.number().finite().min(1).max(1_000_000),
  maxDailyUsd: z.number().finite().min(1).max(10_000_000),
  maxSlippageBps: z.number().int().min(MIN_SLIPPAGE_BPS).max(MAX_SLIPPAGE_BPS),
  maxFuturesLeverage: z.number().int().min(1).max(10),
  maxOpenFuturesPositions: z.number().int().min(1).max(20),
  allowedTokenMints: z.array(agentPublicKeySchema).max(100).transform((items) => [...new Set(items)]),
  allowedStockSymbols: z.array(agentStockSymbolSchema).max(100).transform((items) => [...new Set(items)]),
  allowedFuturesMarkets: z.array(agentFuturesMarketSchema).max(3).transform((items) => [...new Set(items)]),
  expiresInHours: z.number().int().min(1).max(24 * 30),
}).strict().superRefine((value, context) => {
  if (value.maxDailyUsd < value.maxTransactionUsd) {
    context.addIssue({ code: 'custom', path: ['maxDailyUsd'], message: 'Daily limit must be at least the per-request limit.' });
  }
  if (value.products.includes('convert') && value.allowedTokenMints.length < 2) {
    context.addIssue({ code: 'custom', path: ['allowedTokenMints'], message: 'Convert access requires at least two allowed token mints.' });
  }
  if (value.products.includes('stocks') && value.allowedStockSymbols.length < 1) {
    context.addIssue({ code: 'custom', path: ['allowedStockSymbols'], message: 'Stocks access requires at least one allowed symbol.' });
  }
  if (value.products.includes('futures') && value.allowedFuturesMarkets.length < 1) {
    context.addIssue({ code: 'custom', path: ['allowedFuturesMarkets'], message: 'Futures access requires at least one allowed market.' });
  }
});

const convertIntent = z.object({
  kind: z.literal('convert'),
  inputMint: agentPublicKeySchema,
  outputMint: agentPublicKeySchema,
  amountAtomic: agentAtomicAmountSchema,
  slippageBps: z.number().int().min(MIN_SLIPPAGE_BPS).max(MAX_SLIPPAGE_BPS),
}).strict().refine((value) => value.inputMint !== value.outputMint, { path: ['outputMint'], message: 'Choose different tokens.' });

const stockIntent = z.object({
  kind: z.literal('stock'),
  symbol: agentStockSymbolSchema,
  side: z.enum(['buy', 'sell']),
  amount: agentStockAmountSchema,
  slippageBps: z.number().int().min(MIN_SLIPPAGE_BPS).max(MAX_SLIPPAGE_BPS),
}).strict();

const futuresOpenIntent = z.object({
  kind: z.literal('futures-open'),
  market: agentFuturesMarketSchema,
  side: z.enum(['long', 'short']),
  orderType: z.enum(['market', 'limit']),
  collateralAtomic: agentAtomicAmountSchema.refine((value) => BigInt(value) >= 1_000_000n, 'Minimum collateral is 1 USDC.'),
  leverageBps: z.number().int().min(10_000).max(100_000),
  limitPriceMicroUsd: agentAtomicAmountSchema.optional(),
  slippageBps: z.number().int().min(1).max(500),
  routeChoice: z.enum(['auto', 'phoenix', 'gmtrade']),
}).strict().superRefine((value, context) => {
  if (value.orderType === 'limit' && !value.limitPriceMicroUsd) context.addIssue({ code: 'custom', path: ['limitPriceMicroUsd'], message: 'Limit price is required.' });
  if (value.orderType === 'market' && value.limitPriceMicroUsd) context.addIssue({ code: 'custom', path: ['limitPriceMicroUsd'], message: 'Market orders cannot include a limit price.' });
});

const futuresManageIntent = z.object({
  kind: z.literal('futures-manage'),
  action: z.enum(['close', 'cancel']),
  venue: z.enum(['phoenix', 'gmtrade']),
  market: agentFuturesMarketSchema,
  nativeId: z.string().min(1).max(128),
}).strict();

export const agentIntentSubmissionSchema = z.object({
  idempotencyKey: z.string().uuid(),
  intent: z.discriminatedUnion('kind', [convertIntent, stockIntent, futuresOpenIntent, futuresManageIntent]),
}).strict();

export const agentRequestActionSchema = z.object({ wallet: agentPublicKeySchema }).strict();

export const agentExecuteSchema = z.object({
  wallet: agentPublicKeySchema,
  signedTransaction: z.string().min(100).max(20_000).regex(/^[A-Za-z0-9+/]+={0,2}$/),
  idempotencyKey: z.string().uuid(),
}).strict();

export const agentSponsoredCompleteSchema = z.object({
  wallet: agentPublicKeySchema,
  signature: z.string().min(80).max(90).regex(/^[1-9A-HJ-NP-Za-km-z]+$/),
}).strict();

export const agentWorkspaceSchema = z.object({ wallet: agentPublicKeySchema }).strict();
