import { Percentage } from '@orca-so/common-sdk';
import {
  PriceMath,
  WhirlpoolContext,
  buildWhirlpoolClient,
  swapQuoteByInputToken,
} from '@orca-so/whirlpools-sdk';
import {
  PublicKey,
  Transaction,
  VersionedTransaction,
  type Signer,
} from '@solana/web3.js';
import BN from 'bn.js';
import { QUOTE_TTL_MS } from '../../shared/constants.js';
import type { ProviderQuoteResult } from '../domain.js';
import { config } from '../config.js';
import { AppError } from '../errors.js';
import { fetchJson } from '../fetch-json.js';
import { connection, withRpcFallback } from '../rpc.js';
import type { PrepareRequest, ProviderPrepared, QuoteAdapter, QuoteRequest } from './types.js';

interface OrcaPoolRow {
  address?: string;
  tokenMintA?: string;
  tokenMintB?: string;
  feeRate?: number;
  tvlUsdc?: string;
  hasWarning?: boolean;
  tokenA?: { decimals?: number };
  tokenB?: { decimals?: number };
}

interface OrcaPools {
  data?: OrcaPoolRow[];
}

function dummyWallet(owner: PublicKey) {
  return {
    publicKey: owner,
    async signTransaction<T extends Transaction | VersionedTransaction>(transaction: T): Promise<T> {
      return transaction;
    },
    async signAllTransactions<T extends Transaction | VersionedTransaction>(transactions: T[]): Promise<T[]> {
      return transactions;
    },
  };
}

function matchesPair(pool: OrcaPoolRow, inputMint: string, outputMint: string): boolean {
  return (
    (pool.tokenMintA === inputMint && pool.tokenMintB === outputMint)
    || (pool.tokenMintA === outputMint && pool.tokenMintB === inputMint)
  );
}

async function discoverPools(request: QuoteRequest): Promise<OrcaPoolRow[]> {
  const url = new URL('/v2/solana/pools', config.orcaApiUrl);
  url.searchParams.set('tokens', `${request.inputMint},${request.outputMint}`);
  const payload = await fetchJson<OrcaPools>(url, {
    provider: 'Orca',
    timeoutMs: config.requestTimeoutMs,
    headers: { accept: 'application/json', 'user-agent': 'Flay-Convert/0.1' },
  });
  return (Array.isArray(payload.data) ? payload.data : [])
    .filter((pool) => pool.address && matchesPair(pool, request.inputMint, request.outputMint) && !pool.hasWarning)
    .sort((a, b) => Number(b.tvlUsdc ?? 0) - Number(a.tvlUsdc ?? 0))
    .slice(0, 4);
}

export class OrcaAdapter implements QuoteAdapter {
  async quote(request: QuoteRequest): Promise<ProviderQuoteResult> {
    const rows = await discoverPools(request);
    if (!rows.length) throw new AppError(404, 'NO_DIRECT_ROUTE', 'Orca has no eligible direct Whirlpool for this pair.');

    const owner = PublicKey.default;
    const ctx = WhirlpoolContext.from(connection, dummyWallet(owner));
    const client = buildWhirlpoolClient(ctx);
    const candidates = await Promise.allSettled(rows.map(async (row) => {
      const poolAddress = new PublicKey(row.address!);
      const pool = await client.getPool(poolAddress, { maxAge: 0 });
      const quote = await swapQuoteByInputToken(
        pool,
        new PublicKey(request.inputMint),
        new BN(request.amount),
        Percentage.fromFraction(request.slippageBps, 10_000),
        ctx.program.programId,
        ctx.fetcher,
        { maxAge: 0 },
      );
      const data = pool.getData();
      const decimalsA = row.tokenA?.decimals ?? 0;
      const decimalsB = row.tokenB?.decimals ?? 0;
      const spotBPerA = Number(PriceMath.sqrtPriceX64ToPrice(data.sqrtPrice, decimalsA, decimalsB).toString());
      const inputHuman = Number(request.amount) / 10 ** (request.inputMint === row.tokenMintA ? decimalsA : decimalsB);
      const idealHuman = request.inputMint === row.tokenMintA ? inputHuman * spotBPerA : inputHuman / spotBPerA;
      const outputDecimals = request.outputMint === row.tokenMintA ? decimalsA : decimalsB;
      const actualHuman = Number(quote.estimatedAmountOut.toString()) / 10 ** outputDecimals;
      const priceImpactPct = idealHuman > 0 && Number.isFinite(idealHuman)
        ? Math.max(0, (1 - actualHuman / idealHuman) * 100)
        : null;
      return { row, quote, priceImpactPct };
    }));

    const successful = candidates
      .flatMap((candidate) => candidate.status === 'fulfilled' ? [candidate.value] : [])
      .sort((a, b) => BigInt(a.quote.estimatedAmountOut.toString()) > BigInt(b.quote.estimatedAmountOut.toString()) ? -1 : 1);
    if (!successful.length) {
      throw new AppError(404, 'NO_DIRECT_ROUTE', 'Orca pools exist for this pair, but none can currently quote this amount.');
    }
    const best = successful[0];
    const fetchedAt = Date.now();
    return {
      raw: { pool: best.row.address },
      context: { pool: best.row.address },
      quote: {
        provider: 'orca',
        providerLabel: 'Orca Whirlpools SDK',
        routeLabel: 'Orca direct Whirlpool',
        inputMint: request.inputMint,
        outputMint: request.outputMint,
        inAmount: request.amount,
        outAmount: best.quote.estimatedAmountOut.toString(),
        minimumOut: best.quote.otherAmountThreshold.toString(),
        slippageBps: request.slippageBps,
        priceImpactPct: best.priceImpactPct,
        fees: [{
          label: 'Orca liquidity fee',
          amountAtomic: best.quote.estimatedFeeAmount.toString(),
          mint: request.inputMint,
          detail: typeof best.row.feeRate === 'number' ? `${best.row.feeRate / 10_000}% Whirlpool fee` : 'Whirlpool fee',
        }],
        networkFeeLamports: null,
        fetchedAt,
        expiresAt: fetchedAt + QUOTE_TTL_MS,
        poolIds: [best.row.address!],
        warnings: [],
      },
    };
  }

  async prepare(request: PrepareRequest, freshQuote: ProviderQuoteResult): Promise<ProviderPrepared> {
    const poolAddress = typeof freshQuote.context.pool === 'string'
      ? freshQuote.context.pool
      : freshQuote.quote.poolIds[0];
    if (!poolAddress) throw new AppError(502, 'ORCA_POOL_MISSING', 'Orca did not identify the quoted pool.', true);

    const owner = new PublicKey(request.wallet);
    const ctx = WhirlpoolContext.from(connection, dummyWallet(owner));
    const client = buildWhirlpoolClient(ctx);
    let pool;
    try {
      pool = await client.getPool(new PublicKey(poolAddress), { maxAge: 0 });
    } catch {
      throw new AppError(502, 'ORCA_POOL_UNAVAILABLE', 'Orca pool state could not be loaded from the Solana RPC.', true);
    }
    const quote = await swapQuoteByInputToken(
      pool,
      new PublicKey(request.inputMint),
      new BN(request.amount),
      Percentage.fromFraction(request.slippageBps, 10_000),
      ctx.program.programId,
      ctx.fetcher,
      { maxAge: 0 },
    );
    const builder = await pool.swap(quote, owner);
    const payload = await builder.build({
      maxSupportedTransactionVersion: 0,
      blockhashCommitment: 'confirmed',
      computeBudgetOption: { type: 'fixed', priorityFeeLamports: 5_000 },
    });
    if (!(payload.transaction instanceof VersionedTransaction)) {
      throw new AppError(409, 'LEGACY_TRANSACTION_UNSUPPORTED', 'Orca built a legacy transaction. Choose another route so Flay can validate a versioned transaction.');
    }
    const transaction = payload.transaction;
    if (payload.signers.length) transaction.sign(payload.signers as Signer[]);
    const transactionBase64 = Buffer.from(transaction.serialize()).toString('base64');
    const networkFee = await withRpcFallback(async (rpc) => {
      const fee = await rpc.getFeeForMessage(transaction.message, 'confirmed');
      return fee.value === null ? null : String(fee.value);
    });
    return {
      transaction,
      transactionBase64,
      expectedPrograms: [ctx.program.programId.toBase58()],
      expectedPoolIds: [poolAddress],
      networkFeeLamports: networkFee,
      finalQuote: {
        ...freshQuote.quote,
        outAmount: quote.estimatedAmountOut.toString(),
        minimumOut: quote.otherAmountThreshold.toString(),
        fetchedAt: Date.now(),
        expiresAt: Date.now() + QUOTE_TTL_MS,
        fees: [{
          ...freshQuote.quote.fees[0],
          amountAtomic: quote.estimatedFeeAmount.toString(),
        }],
      },
    };
  }
}
