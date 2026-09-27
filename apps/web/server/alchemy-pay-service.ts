import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PublicKey } from '@solana/web3.js';
import type {
  AlchemyPayCapability,
  AlchemyPayCheckout,
  AlchemyPayEnvironment,
  FiatOrder,
  FiatOrderStatus,
} from '../shared/types.js';
import { USDC_MINT } from '../shared/constants.js';
import { config } from './config.js';
import { AppError } from './errors.js';
import { fetchJson } from './fetch-json.js';
import { withRpcFallback } from './rpc.js';

const CALLBACK_PATH = '/api/fiat/alchemy-pay/webhook';
const RAMP_SIGNING_PATH = '/index/rampPageBuy';
const CHECKOUT_LIFETIME_MS = 24 * 60 * 60_000;
const WEBHOOK_MAX_AGE_MS = 5 * 60_000;
const MAX_ORDERS = 5_000;
const RETENTION_MS = 90 * 24 * 60 * 60_000;

interface StoredFiatOrder extends FiatOrder {
  identityHash: string;
}

interface StoreFile {
  version: 1;
  orders: StoredFiatOrder[];
}

interface AlchemyPayOptions {
  environment: AlchemyPayEnvironment;
  appId?: string;
  appSecret?: string;
  publicUrl?: string;
  orderStorePath?: string;
  allowedFiat: string[];
  minFiatAmount: string;
  maxFiatAmount: string;
  clock?: () => number;
}

interface ProviderOrder {
  appId?: string;
  merchantOrderNo?: string;
  orderNo?: string;
  side?: string;
  amount?: string;
  fiat?: string;
  crypto?: string;
  network?: string;
  address?: string;
  status?: string;
  txHash?: string;
  cryptoQuantity?: string;
  rampFee?: string;
  message?: string;
}

interface ProviderResponse {
  success?: boolean;
  returnCode?: string;
  returnMsg?: string;
  data?: ProviderOrder;
}

interface TokenBalanceLike {
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string };
}

function identityHash(userId: string): string {
  return createHash('sha256').update(`flay:alchemy-pay:${userId}`).digest('hex');
}

export function canonicalObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value)
    .filter(([key, item]) => key !== 'signature' && key !== 'newSignature' && item !== '' && item !== null && item !== undefined)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
}

export function canonicalQuery(parameters: Record<string, string>): string {
  return Object.entries(parameters)
    .filter(([, value]) => value !== '')
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}

export function alchemyPaySignature(content: string, secret: string): string {
  return createHmac('sha256', secret).update(content).digest('base64');
}

export function signRampParameters(parameters: Record<string, string>, secret: string): string {
  const timestamp = parameters.timestamp;
  if (!/^\d{13}$/.test(timestamp ?? '')) throw new Error('A 13-digit timestamp is required.');
  const query = canonicalQuery(parameters);
  return alchemyPaySignature(`${timestamp}GET${RAMP_SIGNING_PATH}?${query}`, secret);
}

export function verifyAlchemyPayWebhook(
  body: Record<string, unknown>,
  timestamp: string,
  signature: string,
  secret: string,
  now = Date.now(),
): boolean {
  if (!/^\d{13}$/.test(timestamp) || Math.abs(now - Number(timestamp)) > WEBHOOK_MAX_AGE_MS) return false;
  if (!signature || signature.length > 256) return false;
  const sorted = canonicalObject(body);
  const expected = alchemyPaySignature(`${timestamp}POST${CALLBACK_PATH}${JSON.stringify(sorted)}`, secret);
  const expectedBytes = Buffer.from(expected);
  const receivedBytes = Buffer.from(signature);
  return expectedBytes.length === receivedBytes.length && timingSafeEqual(expectedBytes, receivedBytes);
}

export function verifiedUsdcReceiptAtomic(
  preBalances: readonly TokenBalanceLike[] | null | undefined,
  postBalances: readonly TokenBalanceLike[] | null | undefined,
  wallet: string,
): bigint {
  const total = (balances: readonly TokenBalanceLike[] | null | undefined) => (balances ?? [])
    .filter((balance) => balance.mint === USDC_MINT && balance.owner === wallet)
    .reduce((sum, balance) => sum + BigInt(balance.uiTokenAmount.amount), 0n);
  return total(postBalances) - total(preBalances);
}

function cents(value: string, label: string): bigint {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value)) {
    throw new AppError(400, 'FIAT_AMOUNT_INVALID', `${label} must be a normal decimal with at most two places.`);
  }
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}

function normalizedAmount(value: string): string {
  const amount = cents(value, 'Fiat amount');
  return `${amount / 100n}.${(amount % 100n).toString().padStart(2, '0')}`;
}

function normalizedProviderAmount(value: string): string {
  const match = /^(?:0|[1-9]\d*)(?:\.(\d{1,18}))?$/.exec(value);
  if (!match || (match[1]?.slice(2).replace(/0/g, '') ?? '')) {
    throw new AppError(409, 'FIAT_PROVIDER_MISMATCH', 'Alchemy Pay returned a fiat amount with unexpected precision.');
  }
  const whole = value.split('.')[0];
  return `${BigInt(whole)}.${(match[1] ?? '').slice(0, 2).padEnd(2, '0')}`;
}

function publicOrigin(value: string, environment: AlchemyPayEnvironment): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new AppError(503, 'ALCHEMY_PAY_URL_INVALID', 'Alchemy Pay public URL is invalid.'); }
  const localTest = environment === 'test' && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !localTest) {
    throw new AppError(503, 'ALCHEMY_PAY_HTTPS_REQUIRED', 'Alchemy Pay callbacks require a public HTTPS Flay URL.');
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new AppError(503, 'ALCHEMY_PAY_URL_INVALID', 'Alchemy Pay public URL must be an origin without a path, query, or credentials.');
  }
  return url.origin;
}

function checkoutHost(environment: AlchemyPayEnvironment): string {
  return environment === 'production' ? 'https://ramp.alchemypay.org/' : 'https://ramptest.alchemypay.org/';
}

function apiHost(environment: AlchemyPayEnvironment): string {
  return environment === 'production' ? 'https://openapi.alchemypay.org/' : 'https://openapi-test.alchemypay.org/';
}

function merchantOrderNo(now: number): string {
  return `FLAY${now.toString(36).toUpperCase()}${randomBytes(10).toString('hex').toUpperCase()}`;
}

function mapProviderStatus(value: string): FiatOrderStatus {
  switch (value.toUpperCase()) {
    case 'FINISHED': return 'provider-finished';
    case 'PAY_SUCCESS':
    case 'TRANSFER':
    case 'PENDING': return 'payment-pending';
    case 'CANCEL': return 'expired';
    case 'PAY_FAIL':
    case 'RISK_CONTROL':
    case 'REFUNDED': return 'provider-failed';
    default: return 'review-required';
  }
}

const statusRank: Record<FiatOrderStatus, number> = {
  created: 0,
  'payment-pending': 1,
  'provider-failed': 2,
  expired: 2,
  'review-required': 2,
  'provider-finished': 3,
  confirmed: 4,
};

function safePublic(order: StoredFiatOrder): FiatOrder {
  const { identityHash: _identityHash, ...value } = order;
  return structuredClone(value);
}

function validStoredOrder(value: unknown): value is StoredFiatOrder {
  if (!value || typeof value !== 'object') return false;
  const order = value as Partial<StoredFiatOrder>;
  return typeof order.merchantOrderNo === 'string'
    && typeof order.identityHash === 'string'
    && typeof order.wallet === 'string'
    && typeof order.fiat === 'string'
    && typeof order.fiatAmount === 'string'
    && typeof order.status === 'string'
    && typeof order.checkoutUrl === 'string'
    && typeof order.createdAt === 'number';
}

class FiatOrderStore {
  private readonly orders = new Map<string, StoredFiatOrder>();
  private readonly ready: Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string, private readonly clock: () => number) {
    this.ready = this.load();
  }

  private async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as Partial<StoreFile>;
      if (parsed.version !== 1 || !Array.isArray(parsed.orders) || !parsed.orders.every(validStoredOrder)) {
        throw new Error('unsupported order store format');
      }
      parsed.orders.forEach((order) => this.orders.set(order.merchantOrderNo, order));
      this.sweep();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw new AppError(503, 'FIAT_ORDER_STORE_UNAVAILABLE', 'The fiat order store could not be loaded safely.');
    }
  }

  private sweep(): void {
    const cutoff = this.clock() - RETENTION_MS;
    for (const [id, order] of this.orders) if (order.updatedAt < cutoff) this.orders.delete(id);
    const ordered = [...this.orders.values()].sort((left, right) => right.updatedAt - left.updatedAt);
    ordered.slice(MAX_ORDERS).forEach((order) => this.orders.delete(order.merchantOrderNo));
  }

  private async persist(): Promise<void> {
    this.sweep();
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
    const payload: StoreFile = { version: 1, orders: [...this.orders.values()] };
    await writeFile(temporary, `${JSON.stringify(payload)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, this.filePath);
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(async () => {
      await this.ready;
      return operation();
    });
    this.queue = result.catch(() => undefined);
    return result;
  }

  add(order: StoredFiatOrder): Promise<void> {
    return this.serial(async () => {
      if (this.orders.has(order.merchantOrderNo)) throw new AppError(409, 'FIAT_ORDER_CONFLICT', 'Generate a fresh fiat order.');
      this.orders.set(order.merchantOrderNo, structuredClone(order));
      await this.persist();
    });
  }

  get(id: string): Promise<StoredFiatOrder | null> {
    return this.serial(async () => structuredClone(this.orders.get(id) ?? null));
  }

  list(ownerHash: string, wallet: string): Promise<StoredFiatOrder[]> {
    return this.serial(async () => [...this.orders.values()]
      .filter((order) => order.identityHash === ownerHash && order.wallet === wallet)
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, 100)
      .map((order) => structuredClone(order)));
  }

  update(id: string, mutate: (order: StoredFiatOrder) => void): Promise<StoredFiatOrder> {
    return this.serial(async () => {
      const order = this.orders.get(id);
      if (!order) throw new AppError(404, 'FIAT_ORDER_NOT_FOUND', 'This fiat order was not found.');
      mutate(order);
      order.updatedAt = this.clock();
      await this.persist();
      return structuredClone(order);
    });
  }
}

export class AlchemyPayService {
  private readonly options: AlchemyPayOptions;
  private readonly store: FiatOrderStore;
  private readonly checkoutLimits = new Map<string, { resetAt: number; count: number }>();

  constructor(overrides: Partial<AlchemyPayOptions> = {}) {
    this.options = {
      ...config.alchemyPay,
      ...overrides,
      allowedFiat: overrides.allowedFiat ?? config.alchemyPay.allowedFiat,
      clock: overrides.clock ?? Date.now,
    };
    const storePath = this.options.orderStorePath ?? path.resolve(process.cwd(), '.flay-data/alchemy-pay-orders.json');
    this.store = new FiatOrderStore(storePath, this.options.clock!);
  }

  capability(): AlchemyPayCapability {
    return {
      configured: Boolean(this.options.appId && this.options.appSecret && this.options.publicUrl),
      environment: this.options.environment,
      provider: 'Alchemy Pay',
      asset: 'USDC',
      network: 'SOL',
      allowedFiat: [...this.options.allowedFiat],
      minFiatAmount: normalizedAmount(this.options.minFiatAmount),
      maxFiatAmount: normalizedAmount(this.options.maxFiatAmount),
    };
  }

  private credentials(): { appId: string; appSecret: string; origin: string } {
    if (!this.options.appId || !this.options.appSecret || !this.options.publicUrl) {
      throw new AppError(503, 'ALCHEMY_PAY_NOT_CONFIGURED', 'Alchemy Pay merchant credentials and the public Flay URL are not configured yet.');
    }
    if (!/^[A-Za-z0-9_-]{4,128}$/.test(this.options.appId) || this.options.appSecret.length < 8) {
      throw new AppError(503, 'ALCHEMY_PAY_CREDENTIALS_INVALID', 'Alchemy Pay merchant credentials are invalid.');
    }
    return { appId: this.options.appId, appSecret: this.options.appSecret, origin: publicOrigin(this.options.publicUrl, this.options.environment) };
  }

  async createCheckout(input: { wallet: string; fiat: string; fiatAmount: string }, userId: string): Promise<AlchemyPayCheckout> {
    const { appId, appSecret, origin } = this.credentials();
    const wallet = new PublicKey(input.wallet).toBase58();
    const fiat = input.fiat.toUpperCase();
    if (!this.options.allowedFiat.includes(fiat)) throw new AppError(400, 'FIAT_CURRENCY_UNSUPPORTED', `${fiat} is not enabled for Flay fiat deposits.`);
    const amount = normalizedAmount(input.fiatAmount);
    const amountCents = cents(amount, 'Fiat amount');
    if (amountCents < cents(this.options.minFiatAmount, 'Minimum fiat amount') || amountCents > cents(this.options.maxFiatAmount, 'Maximum fiat amount')) {
      throw new AppError(400, 'FIAT_AMOUNT_OUT_OF_RANGE', `Enter between ${normalizedAmount(this.options.minFiatAmount)} and ${normalizedAmount(this.options.maxFiatAmount)} ${fiat}.`);
    }
    this.enforceCheckoutLimit(identityHash(userId), wallet);
    const now = this.options.clock!();
    const orderNo = merchantOrderNo(now);
    const parameters: Record<string, string> = {
      address: wallet,
      appId,
      callbackUrl: `${origin}${CALLBACK_PATH}`,
      crypto: 'USDC',
      fiat,
      fiatAmount: amount,
      merchantName: 'Flay',
      merchantOrderNo: orderNo,
      network: 'SOL',
      redirectUrl: `${origin}/?fiatOrder=${encodeURIComponent(orderNo)}`,
      showTable: 'buy',
      timestamp: String(now),
    };
    const sign = signRampParameters(parameters, appSecret);
    const query = new URLSearchParams({ ...parameters, sign });
    const checkoutUrl = new URL(`?${query.toString()}`, checkoutHost(this.options.environment)).toString();
    const order: StoredFiatOrder = {
      merchantOrderNo: orderNo,
      identityHash: identityHash(userId),
      wallet,
      fiat,
      fiatAmount: amount,
      crypto: 'USDC',
      network: 'SOL',
      status: 'created',
      providerStatus: null,
      providerOrderNo: null,
      cryptoQuantity: null,
      rampFee: null,
      txHash: null,
      checkoutUrl,
      environment: this.options.environment,
      createdAt: now,
      updatedAt: now,
      expiresAt: now + CHECKOUT_LIFETIME_MS,
      confirmedAt: null,
      error: null,
    };
    await this.store.add(order);
    return {
      order: safePublic(order),
      provider: 'Alchemy Pay',
      disclosure: [
        'Alchemy Pay handles payment, identity checks, pricing, and delivery.',
        'USDC is delivered directly to your exportable Privy wallet on Solana.',
        'Payment methods and final fees depend on your country and appear in checkout.',
      ],
    };
  }

  private enforceCheckoutLimit(ownerHash: string, wallet: string): void {
    const now = this.options.clock!();
    for (const [key, value] of this.checkoutLimits) if (value.resetAt <= now) this.checkoutLimits.delete(key);
    const key = `${ownerHash}:${wallet}`;
    const current = this.checkoutLimits.get(key);
    const bucket = !current || current.resetAt <= now ? { resetAt: now + 10 * 60_000, count: 0 } : current;
    bucket.count += 1;
    this.checkoutLimits.set(key, bucket);
    if (bucket.count > 5) throw new AppError(429, 'FIAT_CHECKOUT_RATE_LIMITED', 'Too many fiat checkouts were created for this wallet. Reuse an existing checkout or wait ten minutes.', true);
  }

  async list(wallet: string, userId: string): Promise<FiatOrder[]> {
    const now = this.options.clock!();
    const records = await this.store.list(identityHash(userId), wallet);
    const output: FiatOrder[] = [];
    for (const record of records) {
      let current = record;
      if ((record.status === 'created' || record.status === 'payment-pending') && record.expiresAt <= now) {
        current = await this.store.update(record.merchantOrderNo, (order) => { order.status = 'expired'; });
      }
      if (current.status === 'provider-finished') current = await this.reconcile(current);
      output.push(safePublic(current));
    }
    return output;
  }

  async get(merchantOrderNo: string, wallet: string, userId: string): Promise<FiatOrder> {
    const order = await this.owned(merchantOrderNo, wallet, userId);
    return safePublic(order.status === 'provider-finished' ? await this.reconcile(order) : order);
  }

  async refresh(merchantOrderNo: string, wallet: string, userId: string): Promise<FiatOrder> {
    const order = await this.owned(merchantOrderNo, wallet, userId);
    const provider = await this.queryProvider(order);
    const updated = await this.applyProvider(order, provider);
    return safePublic(updated.status === 'provider-finished' ? await this.reconcile(updated) : updated);
  }

  private async owned(merchantOrderNo: string, wallet: string, userId: string): Promise<StoredFiatOrder> {
    const order = await this.store.get(merchantOrderNo);
    if (!order) throw new AppError(404, 'FIAT_ORDER_NOT_FOUND', 'This fiat order was not found.');
    if (order.identityHash !== identityHash(userId) || order.wallet !== wallet) throw new AppError(403, 'FIAT_ORDER_FORBIDDEN', 'This fiat order belongs to another wallet.');
    return order;
  }

  private async queryProvider(order: StoredFiatOrder): Promise<ProviderOrder> {
    const { appId, appSecret } = this.credentials();
    const timestamp = String(this.options.clock!());
    const query = canonicalQuery({ merchantOrderNo: order.merchantOrderNo, side: 'BUY' });
    const requestPath = `/open/api/v4/merchant/query/trade?${query}`;
    const sign = alchemyPaySignature(`${timestamp}GET${requestPath}`, appSecret);
    const response = await fetchJson<ProviderResponse | ProviderOrder>(new URL(requestPath, apiHost(this.options.environment)), {
      provider: 'Alchemy Pay',
      headers: { accept: 'application/json', appid: appId, timestamp, sign },
      timeoutMs: 10_000,
      maxBytes: 128_000,
    });
    const provider = 'data' in response && response.data ? response.data : response as ProviderOrder;
    if (!provider.status) throw new AppError(502, 'ALCHEMY_PAY_STATUS_INVALID', 'Alchemy Pay returned an incomplete order status.', true);
    return provider;
  }

  private validateProvider(order: StoredFiatOrder, value: ProviderOrder): void {
    if (value.appId && value.appId !== this.options.appId) throw new AppError(409, 'FIAT_PROVIDER_MISMATCH', 'Alchemy Pay returned another merchant application.');
    if (value.merchantOrderNo && value.merchantOrderNo !== order.merchantOrderNo) throw new AppError(409, 'FIAT_PROVIDER_MISMATCH', 'Alchemy Pay returned another merchant order.');
    if (value.side && value.side !== 'BUY') throw new AppError(409, 'FIAT_PROVIDER_MISMATCH', 'Alchemy Pay returned an off-ramp order.');
    if (value.address && value.address !== order.wallet) throw new AppError(409, 'FIAT_PROVIDER_MISMATCH', 'Alchemy Pay returned another destination wallet.');
    if (value.crypto && value.crypto !== 'USDC') throw new AppError(409, 'FIAT_PROVIDER_MISMATCH', 'Alchemy Pay returned another asset.');
    if (value.network && value.network !== 'SOL') throw new AppError(409, 'FIAT_PROVIDER_MISMATCH', 'Alchemy Pay returned another network.');
    if (value.fiat && value.fiat !== order.fiat) throw new AppError(409, 'FIAT_PROVIDER_MISMATCH', 'Alchemy Pay returned another fiat currency.');
    if (value.amount && normalizedProviderAmount(value.amount) !== order.fiatAmount) throw new AppError(409, 'FIAT_PROVIDER_MISMATCH', 'Alchemy Pay returned another fiat amount.');
  }

  private async applyProvider(order: StoredFiatOrder, value: ProviderOrder): Promise<StoredFiatOrder> {
    this.validateProvider(order, value);
    const nextStatus = mapProviderStatus(value.status!);
    return this.store.update(order.merchantOrderNo, (current) => {
      if (current.status === 'confirmed') return;
      if (statusRank[nextStatus] >= statusRank[current.status] || ['provider-failed', 'expired', 'review-required'].includes(current.status)) current.status = nextStatus;
      current.providerStatus = value.status!.toUpperCase();
      current.providerOrderNo = value.orderNo ?? current.providerOrderNo;
      current.cryptoQuantity = value.cryptoQuantity ?? current.cryptoQuantity;
      current.rampFee = value.rampFee ?? current.rampFee;
      current.txHash = value.txHash ?? current.txHash;
      current.error = value.message?.slice(0, 240) ?? (nextStatus === 'review-required' ? `Unrecognized provider status: ${value.status}` : null);
    });
  }

  async webhook(body: Record<string, unknown>, timestamp: string | undefined): Promise<void> {
    const { appId, appSecret } = this.credentials();
    const signature = typeof body.newSignature === 'string' ? body.newSignature : '';
    if (!timestamp || !verifyAlchemyPayWebhook(body, timestamp, signature, appSecret, this.options.clock!())) {
      throw new AppError(401, 'ALCHEMY_PAY_WEBHOOK_INVALID', 'The Alchemy Pay callback signature or timestamp is invalid.');
    }
    const stringField = (name: string, required = true): string | undefined => {
      const value = body[name];
      if (typeof value === 'string' && value.length > 0 && value.length <= 256) return value;
      if (required) throw new AppError(400, 'ALCHEMY_PAY_WEBHOOK_INVALID', `The Alchemy Pay callback is missing ${name}.`);
      return undefined;
    };
    if (stringField('appId') !== appId) throw new AppError(409, 'ALCHEMY_PAY_WEBHOOK_MISMATCH', 'The callback belongs to another merchant application.');
    const merchantOrderNo = stringField('merchantOrderNo')!;
    const order = await this.store.get(merchantOrderNo);
    if (!order) throw new AppError(404, 'FIAT_ORDER_NOT_FOUND', 'The callback references an unknown fiat order.');
    const provider: ProviderOrder = {
      appId,
      merchantOrderNo,
      orderNo: stringField('orderNo', false),
      side: 'BUY',
      address: stringField('address'),
      amount: stringField('amount'),
      fiat: stringField('fiat'),
      crypto: stringField('crypto'),
      network: stringField('network'),
      status: stringField('status'),
      txHash: stringField('txHash', false),
      cryptoQuantity: stringField('cryptoQuantity', false),
      rampFee: stringField('rampFee', false),
      message: stringField('message', false),
    };
    if (provider.status?.toUpperCase() === 'FINISHED' && !provider.txHash) throw new AppError(409, 'ALCHEMY_PAY_WEBHOOK_MISMATCH', 'A finished callback must include its Solana transaction.');
    const updated = await this.applyProvider(order, provider);
    if (updated.status === 'provider-finished') await this.reconcile(updated);
  }

  private async reconcile(order: StoredFiatOrder): Promise<StoredFiatOrder> {
    if (!order.txHash || !/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(order.txHash)) return order;
    try {
      const transaction = await withRpcFallback((rpc) => rpc.getParsedTransaction(order.txHash!, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      }));
      if (!transaction) return order;
      if (transaction.meta?.err) {
        return this.store.update(order.merchantOrderNo, (current) => {
          current.status = 'review-required';
          current.error = 'Alchemy Pay reported delivery, but the Solana transaction failed.';
        });
      }
      const received = verifiedUsdcReceiptAtomic(transaction.meta?.preTokenBalances, transaction.meta?.postTokenBalances, order.wallet);
      if (received <= 0n) {
        return this.store.update(order.merchantOrderNo, (current) => {
          current.status = 'review-required';
          current.error = 'The reported Solana transaction did not credit USDC to the reviewed wallet.';
        });
      }
      return this.store.update(order.merchantOrderNo, (current) => {
        current.status = 'confirmed';
        current.confirmedAt = this.options.clock!();
        current.error = null;
      });
    } catch (error) {
      if (error instanceof AppError && error.code !== 'RPC_UNAVAILABLE') throw error;
      return order;
    }
  }
}
