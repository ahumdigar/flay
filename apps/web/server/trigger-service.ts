import { VersionedTransaction } from '@solana/web3.js';
import { PREPARED_TTL_MS } from '../shared/constants.js';
import { checkSpendableBalance } from './balance-check.js';
import type { TriggerOrder, TriggerOrdersResponse } from '../shared/types.js';
import { config, providerHeaders } from './config.js';
import { AppError } from './errors.js';
import { fetchJson } from './fetch-json.js';
import { EphemeralStore } from './prepared-store.js';
import { withRpcFallback } from './rpc.js';
import { TokenService } from './tokens.js';
import {
  JUPITER_TRIGGER_V1_PROGRAMS,
  simulateAndVerifyDeltas,
  validateTransactionStructure,
  type TransactionExpectations,
} from './transaction-validation.js';

const CUSTODY = 'Open-order funds reside in Jupiter Trigger V1 program accounts until fill or cancellation. Flay never controls them.';

interface TriggerCreateInput {
  wallet: string;
  inputMint: string;
  outputMint: string;
  makingAmount: string;
  takingAmount: string;
  slippageBps: number;
  expiredAt?: number;
}

interface TriggerBuildResponse {
  order?: string;
  transaction?: string;
  requestId?: string;
}

interface TriggerRawOrder {
  orderKey?: string;
  order?: string;
  status?: string;
  inputMint?: string;
  outputMint?: string;
  rawMakingAmount?: string;
  rawTakingAmount?: string;
  rawRemainingMakingAmount?: string;
  rawRemainingTakingAmount?: string;
  makingAmount?: string;
  takingAmount?: string;
  remainingMakingAmount?: string;
  remainingTakingAmount?: string;
  createdAt?: string;
  expiredAt?: number | string | null;
}

interface TriggerListResponse {
  orders?: TriggerRawOrder[];
  page?: number;
  totalPages?: number;
  hasMoreData?: boolean;
}

function parseTransaction(base64: string): VersionedTransaction {
  try {
    const bytes = Buffer.from(base64, 'base64');
    if (bytes.length > 1232) throw new Error('too large');
    return VersionedTransaction.deserialize(bytes);
  } catch {
    throw new AppError(502, 'TRIGGER_TRANSACTION_INVALID', 'Jupiter Trigger returned an invalid Solana transaction.', true);
  }
}

function normalizeOrder(order: TriggerRawOrder): TriggerOrder {
  const rawStatus = order.status ?? 'Unknown';
  return {
    order: order.orderKey ?? order.order ?? '',
    status: rawStatus,
    inputMint: order.inputMint ?? '',
    outputMint: order.outputMint ?? '',
    makingAmount: order.rawMakingAmount ?? order.makingAmount ?? '0',
    takingAmount: order.rawTakingAmount ?? order.takingAmount ?? '0',
    remainingMakingAmount: order.rawRemainingMakingAmount ?? order.remainingMakingAmount ?? null,
    remainingTakingAmount: order.rawRemainingTakingAmount ?? order.remainingTakingAmount ?? null,
    createdAt: order.createdAt ?? null,
    expiredAt: order.expiredAt === null || order.expiredAt === undefined ? null : Number(order.expiredAt),
    rawStatus,
  };
}

export class TriggerService {
  constructor(
    private readonly tokens: TokenService,
    private readonly store: EphemeralStore,
  ) {}

  async create(input: TriggerCreateInput) {
    const [inputToken, outputToken] = await Promise.all([
      this.tokens.getByMint(input.inputMint),
      this.tokens.getByMint(input.outputMint),
    ]);
    if (!inputToken.tradable) throw new AppError(409, 'INPUT_TOKEN_UNSUPPORTED', inputToken.blockedReason ?? 'The input token is unsupported.');
    if (!outputToken.tradable) throw new AppError(409, 'OUTPUT_TOKEN_UNSUPPORTED', outputToken.blockedReason ?? 'The output token is unsupported.');
    await checkSpendableBalance(input.wallet, inputToken, input.makingAmount);

    const response = await fetchJson<TriggerBuildResponse>(new URL('/trigger/v1/createOrder', config.jupiterBaseUrl), {
      method: 'POST',
      provider: 'Jupiter Trigger',
      headers: providerHeaders(true),
      timeoutMs: Math.max(config.requestTimeoutMs, 20_000),
      body: JSON.stringify({
        inputMint: input.inputMint,
        outputMint: input.outputMint,
        maker: input.wallet,
        payer: input.wallet,
        params: {
          makingAmount: input.makingAmount,
          takingAmount: input.takingAmount,
          slippageBps: String(input.slippageBps),
          ...(input.expiredAt ? { expiredAt: String(input.expiredAt) } : {}),
        },
        computeUnitPrice: 'auto',
        wrapAndUnwrapSol: true,
      }),
    });
    if (!response.order || !response.transaction || !response.requestId) {
      throw new AppError(502, 'TRIGGER_BUILD_FAILED', 'Jupiter Trigger did not return a complete create-order transaction.', true);
    }

    const transaction = parseTransaction(response.transaction);
    const expectations: TransactionExpectations = {
      kind: 'limit-create',
      provider: 'jupiter-trigger',
      wallet: input.wallet,
      inputToken,
      outputToken,
      inputAmount: input.makingAmount,
      minimumOutput: input.takingAmount,
      expectedPrograms: JUPITER_TRIGGER_V1_PROGRAMS,
      expectedPoolIds: [],
      order: response.order,
    };
    const validated = await validateTransactionStructure(transaction, expectations);
    await simulateAndVerifyDeltas(transaction, expectations, validated, false);
    const networkFee = await withRpcFallback(async (rpc) => {
      const fee = await rpc.getFeeForMessage(transaction.message, 'confirmed');
      return fee.value === null ? null : String(fee.value);
    });
    const record = this.store.putPrepared({
      kind: 'limit-create',
      provider: 'jupiter-trigger',
      wallet: input.wallet,
      requestId: response.requestId,
      order: response.order,
      unsignedMessage: validated.messageBytes,
      expectations,
      public: {
        kind: 'limit-create',
        provider: 'jupiter-trigger',
        providerLabel: 'Jupiter Trigger V1',
        wallet: input.wallet,
        transaction: response.transaction,
        messageHash: validated.messageHash,
        expiresAt: Date.now() + PREPARED_TTL_MS,
        review: {
          inputToken,
          outputToken,
          inputAmount: input.makingAmount,
          expectedOutput: input.takingAmount,
          minimumOutput: input.takingAmount,
          slippageBps: input.slippageBps,
          networkFeeLamports: networkFee,
          order: response.order,
          custody: CUSTODY,
          warnings: [
            'Jupiter Trigger requires at least $5 of input value.',
            'Jupiter charges 0.03% for stable pairs and 0.1% for other pairs when an order fills.',
            'Trigger V1 receives critical-only maintenance from Jupiter.',
            'Flay charges no additional fee.',
          ],
        },
      },
    });
    return record.public;
  }

  async list(wallet: string, status: 'active' | 'history', page: number): Promise<TriggerOrdersResponse> {
    const url = new URL('/trigger/v1/getTriggerOrders', config.jupiterBaseUrl);
    url.searchParams.set('user', wallet);
    url.searchParams.set('orderStatus', status);
    url.searchParams.set('page', String(page));
    const response = await fetchJson<TriggerListResponse>(url, {
      provider: 'Jupiter Trigger',
      headers: providerHeaders(),
      timeoutMs: Math.max(config.requestTimeoutMs, 15_000),
    });
    const orders = (Array.isArray(response.orders) ? response.orders : [])
      .map(normalizeOrder)
      .filter((order) => order.order && order.inputMint && order.outputMint);
    return {
      orders,
      hasMoreData: response.hasMoreData ?? (Number(response.page ?? page) < Number(response.totalPages ?? 0)),
      page: Number(response.page ?? page),
      providerLabel: 'Jupiter Trigger V1',
      custody: CUSTODY,
    };
  }

  async cancel(wallet: string, orderAddress: string) {
    const active = await this.list(wallet, 'active', 1);
    let selected = active.orders.find((order) => order.order === orderAddress);
    let page = 1;
    while (!selected && active.hasMoreData && page < 25) {
      page += 1;
      const next = await this.list(wallet, 'active', page);
      selected = next.orders.find((order) => order.order === orderAddress);
      if (!next.hasMoreData) break;
    }
    if (!selected) throw new AppError(404, 'ORDER_NOT_ACTIVE', 'That Jupiter Trigger order is not active for this wallet.');

    const inputToken = await this.tokens.getByMint(selected.inputMint);
    const outputToken = await this.tokens.getByMint(selected.outputMint);
    const response = await fetchJson<TriggerBuildResponse>(new URL('/trigger/v1/cancelOrder', config.jupiterBaseUrl), {
      method: 'POST',
      provider: 'Jupiter Trigger',
      headers: providerHeaders(true),
      timeoutMs: Math.max(config.requestTimeoutMs, 20_000),
      body: JSON.stringify({
        maker: wallet,
        computeUnitPrice: 'auto',
        order: orderAddress,
      }),
    });
    if (!response.transaction || !response.requestId) {
      throw new AppError(502, 'TRIGGER_CANCEL_BUILD_FAILED', 'Jupiter Trigger did not return a complete cancellation transaction.', true);
    }

    const transaction = parseTransaction(response.transaction);
    const recovery = selected.remainingMakingAmount ?? selected.makingAmount;
    const expectations: TransactionExpectations = {
      kind: 'limit-cancel',
      provider: 'jupiter-trigger',
      wallet,
      inputToken,
      outputToken,
      inputAmount: recovery,
      expectedPrograms: JUPITER_TRIGGER_V1_PROGRAMS,
      expectedPoolIds: [],
      order: orderAddress,
    };
    const validated = await validateTransactionStructure(transaction, expectations);
    await simulateAndVerifyDeltas(transaction, expectations, validated, false);
    const networkFee = await withRpcFallback(async (rpc) => {
      const fee = await rpc.getFeeForMessage(transaction.message, 'confirmed');
      return fee.value === null ? null : String(fee.value);
    });
    const record = this.store.putPrepared({
      kind: 'limit-cancel',
      provider: 'jupiter-trigger',
      wallet,
      requestId: response.requestId,
      order: orderAddress,
      unsignedMessage: validated.messageBytes,
      expectations,
      public: {
        kind: 'limit-cancel',
        provider: 'jupiter-trigger',
        providerLabel: 'Jupiter Trigger V1',
        wallet,
        transaction: response.transaction,
        messageHash: validated.messageHash,
        expiresAt: Date.now() + PREPARED_TTL_MS,
        review: {
          inputToken,
          outputToken,
          inputAmount: recovery,
          networkFeeLamports: networkFee,
          order: orderAddress,
          custody: CUSTODY,
          warnings: ['Cancellation returns the unfilled input principal to your wallet. Only the network fee is paid.'],
        },
      },
    });
    return record.public;
  }
}
