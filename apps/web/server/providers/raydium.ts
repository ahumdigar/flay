import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { PublicKey, VersionedTransaction } from '@solana/web3.js';
import { QUOTE_TTL_MS, SOL_MINT } from '../../shared/constants.js';
import type { QuoteFee } from '../../shared/types.js';
import type { ProviderQuoteResult } from '../domain.js';
import { config } from '../config.js';
import { AppError } from '../errors.js';
import { fetchJson } from '../fetch-json.js';
import { withRpcFallback } from '../rpc.js';
import type { PrepareRequest, ProviderPrepared, QuoteAdapter, QuoteRequest } from './types.js';

interface RaydiumRoute {
  poolId?: string;
  feeMint?: string;
  feeRate?: number;
  feeAmount?: string;
}

interface RaydiumCompute {
  id?: string;
  success?: boolean;
  msg?: string;
  data?: {
    swapType?: string;
    inputMint?: string;
    inputAmount?: string;
    outputMint?: string;
    outputAmount?: string;
    otherAmountThreshold?: string;
    slippageBps?: number;
    priceImpactPct?: number;
    routePlan?: RaydiumRoute[];
  };
}

interface RaydiumTransactions {
  success?: boolean;
  msg?: string;
  data?: Array<{ transaction?: string }>;
}

function computeUrl(request: QuoteRequest): URL {
  const url = new URL('/compute/swap-base-in', config.raydiumSwapUrl);
  url.searchParams.set('inputMint', request.inputMint);
  url.searchParams.set('outputMint', request.outputMint);
  url.searchParams.set('amount', request.amount);
  url.searchParams.set('slippageBps', String(request.slippageBps));
  url.searchParams.set('txVersion', 'V0');
  return url;
}

function validateCompute(payload: RaydiumCompute, request: QuoteRequest): asserts payload is RaydiumCompute & {
  success: true;
  data: {
    inputMint: string;
    inputAmount: string;
    outputMint: string;
    outputAmount: string;
    otherAmountThreshold: string;
    slippageBps: number;
    routePlan: RaydiumRoute[];
  };
} {
  if (!payload.success) {
    const noRoute = /route.not.found/i.test(payload.msg ?? '');
    throw new AppError(noRoute ? 404 : 502, noRoute ? 'NO_DIRECT_ROUTE' : 'RAYDIUM_QUOTE_FAILED', noRoute ? 'Raydium has no direct liquidity route for this pair.' : `Raydium: ${payload.msg ?? 'quote failed'}`, !noRoute);
  }
  const data = payload.data;
  if (
    !data
    || data.inputMint !== request.inputMint
    || data.outputMint !== request.outputMint
    || data.inputAmount !== request.amount
    || !/^\d+$/.test(data.outputAmount ?? '')
    || !/^\d+$/.test(data.otherAmountThreshold ?? '')
  ) {
    throw new AppError(502, 'RAYDIUM_QUOTE_INVALID', 'Raydium returned a quote that did not match the request.', true);
  }
  data.routePlan ??= [];
}

export class RaydiumAdapter implements QuoteAdapter {
  async quote(request: QuoteRequest): Promise<ProviderQuoteResult> {
    const fetchedAt = Date.now();
    const payload = await fetchJson<RaydiumCompute>(computeUrl(request), {
      provider: 'Raydium',
      timeoutMs: config.requestTimeoutMs,
      headers: { accept: 'application/json', 'user-agent': 'Flay-Convert/0.1' },
    });
    validateCompute(payload, request);
    const fees: QuoteFee[] = payload.data.routePlan.map((route) => ({
      label: 'Raydium liquidity fee',
      amountAtomic: /^\d+$/.test(route.feeAmount ?? '') ? route.feeAmount ?? null : null,
      mint: route.feeMint ?? null,
      detail: typeof route.feeRate === 'number' ? `${route.feeRate / 100}% pool fee` : 'Pool fee',
    }));
    return {
      raw: payload,
      context: {},
      quote: {
        provider: 'raydium',
        providerLabel: 'Raydium Trade API',
        routeLabel: payload.data.routePlan.length > 1 ? `Raydium · ${payload.data.routePlan.length} pools` : 'Raydium direct',
        inputMint: request.inputMint,
        outputMint: request.outputMint,
        inAmount: request.amount,
        outAmount: payload.data.outputAmount,
        minimumOut: payload.data.otherAmountThreshold,
        slippageBps: request.slippageBps,
        priceImpactPct: typeof payload.data.priceImpactPct === 'number' ? payload.data.priceImpactPct : null,
        fees,
        networkFeeLamports: null,
        fetchedAt,
        expiresAt: fetchedAt + QUOTE_TTL_MS,
        poolIds: payload.data.routePlan.map((route) => route.poolId).filter((value): value is string => Boolean(value)),
        warnings: [],
      },
    };
  }

  async prepare(request: PrepareRequest, freshQuote: ProviderQuoteResult): Promise<ProviderPrepared> {
    const compute = freshQuote.raw as RaydiumCompute;
    validateCompute(compute, request);
    const priority = await fetchJson<{ success?: boolean; data?: { default?: { h?: number; m?: number } } }>(
      new URL('/main/auto-fee', config.raydiumApiUrl),
      { provider: 'Raydium', timeoutMs: config.requestTimeoutMs },
    );
    const wallet = new PublicKey(request.wallet);
    const inputIsSol = request.inputMint === SOL_MINT;
    const outputIsSol = request.outputMint === SOL_MINT;
    const inputProgram = request.inputTokenProgram === 'token-2022' ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
    const outputProgram = request.outputTokenProgram === 'token-2022' ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
    const inputAccount = inputIsSol ? undefined : getAssociatedTokenAddressSync(new PublicKey(request.inputMint), wallet, false, inputProgram).toBase58();
    const outputAccount = outputIsSol ? undefined : getAssociatedTokenAddressSync(new PublicKey(request.outputMint), wallet, false, outputProgram).toBase58();

    if (inputAccount) {
      const exists = await withRpcFallback((rpc) => rpc.getAccountInfo(new PublicKey(inputAccount), 'confirmed'));
      if (!exists) throw new AppError(409, 'INSUFFICIENT_BALANCE', 'No token account exists for the selected input token. Deposit it first.');
    }

    const payload = await fetchJson<RaydiumTransactions>(new URL('/transaction/swap-base-in', config.raydiumSwapUrl), {
      method: 'POST',
      provider: 'Raydium',
      timeoutMs: config.requestTimeoutMs + 3000,
      headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': 'Flay-Convert/0.1' },
      body: JSON.stringify({
        computeUnitPriceMicroLamports: String(priority.data?.default?.h ?? priority.data?.default?.m ?? 10_000),
        swapResponse: compute,
        txVersion: 'V0',
        wallet: request.wallet,
        wrapSol: inputIsSol,
        unwrapSol: outputIsSol,
        inputAccount,
        outputAccount,
      }),
    });
    if (!payload.success || !payload.data?.length) {
      throw new AppError(502, 'RAYDIUM_BUILD_FAILED', `Raydium: ${payload.msg ?? 'transaction build failed'}`, true);
    }
    if (payload.data.length !== 1 || !payload.data[0]?.transaction) {
      throw new AppError(409, 'MULTI_TRANSACTION_ROUTE_UNSUPPORTED', 'Raydium requires multiple transactions for this route. Choose another route so every signature can be reviewed independently.');
    }
    let transaction: VersionedTransaction;
    try {
      transaction = VersionedTransaction.deserialize(Buffer.from(payload.data[0].transaction, 'base64'));
    } catch {
      throw new AppError(502, 'PROVIDER_TRANSACTION_INVALID', 'Raydium returned an invalid transaction.', true);
    }
    const networkFee = await withRpcFallback(async (rpc) => {
      const fee = await rpc.getFeeForMessage(transaction.message, 'confirmed');
      return fee.value === null ? null : String(fee.value);
    });
    return {
      transaction,
      transactionBase64: payload.data[0].transaction,
      expectedPrograms: ['routeUGWgWzqBWFcrCfv8tritsqukccJPu3q5GPP3xS'],
      expectedPoolIds: compute.data.routePlan.map((route) => route.poolId).filter((value): value is string => Boolean(value)),
      networkFeeLamports: networkFee,
    };
  }
}
