import { USDC_MINT } from '../shared/constants';

export const PRIVY_ONRAMP_SOLANA_CHAIN = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' as const;
export const PRIVY_ONRAMP_FIAT = ['USD', 'EUR', 'AUD', 'BRL'] as const;

export type PrivyOnrampFiat = typeof PRIVY_ONRAMP_FIAT[number];
export type PrivyOnrampEnvironment = 'sandbox' | 'production';
export type PrivyOnrampStatus = 'submitted' | 'confirmed' | 'provider-exited';
export type PrivyOnrampRoute = 'privy-quotes' | 'moonpay';

export interface PrivyOnrampRegion {
  country: string;
  region: string | null;
}

const PRIVY_ONRAMP_ROUTE_CACHE_KEY = 'flay:privy-onramp-route:v1';
const PRIVY_ONRAMP_REGION_URL = 'https://ipinfo.io/json';
const EU_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR',
  'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK',
  'SI', 'ES', 'SE',
]);

export const PRIVY_ONRAMP_CHECKOUT_CHANNEL = 'flay:privy-onramp:v1';

export interface PrivyOnrampCheckoutIntent {
  fiat: PrivyOnrampFiat;
  amount: string;
  requestId: string;
}

export interface PrivyOnrampCheckoutResult extends PrivyOnrampCheckoutIntent {
  type: 'flay:privy-onramp-result';
  status: PrivyOnrampStatus;
  wallet: string;
}

const fiatSet = new Set<string>(PRIVY_ONRAMP_FIAT);

export function resolvePrivyOnrampEnvironment(value: string | undefined): PrivyOnrampEnvironment {
  return value === 'production' ? 'production' : 'sandbox';
}

export function normalizePrivyOnrampAmount(value: string): string | null {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value)) return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 1 || amount > 1_000) return null;
  return amount.toFixed(2);
}

export function assertPrivyOnrampFiat(value: string): PrivyOnrampFiat {
  if (!fiatSet.has(value)) throw new Error('Choose a supported fiat currency.');
  return value as PrivyOnrampFiat;
}

function validRequestId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function buildPrivyOnrampCheckoutUrl(
  currentUrl: string,
  fiat: PrivyOnrampFiat,
  amount: string,
  requestId: string,
): string {
  const normalizedAmount = normalizePrivyOnrampAmount(amount);
  if (!normalizedAmount) throw new Error('Enter a fiat amount from 1.00 to 1,000.00.');
  if (!fiatSet.has(fiat)) throw new Error('Choose a supported fiat currency.');
  if (!validRequestId(requestId)) throw new Error('Could not create a secure checkout request.');
  const url = new URL(currentUrl);
  url.search = '';
  url.hash = '';
  url.searchParams.set('flay-onramp', '1');
  url.searchParams.set('fiat', fiat);
  url.searchParams.set('amount', normalizedAmount);
  url.searchParams.set('request', requestId);
  return url.toString();
}

export function parsePrivyOnrampCheckoutIntent(search: string): PrivyOnrampCheckoutIntent | null {
  const params = new URLSearchParams(search);
  if (params.get('flay-onramp') !== '1') return null;
  const fiat = params.get('fiat') ?? '';
  const amount = normalizePrivyOnrampAmount(params.get('amount') ?? '');
  const requestId = params.get('request') ?? '';
  if (!fiatSet.has(fiat) || !amount || !validRequestId(requestId)) return null;
  return { fiat: fiat as PrivyOnrampFiat, amount, requestId };
}

export function isPrivyOnrampCheckoutResult(
  value: unknown,
  requestId: string,
  wallet: string,
): value is PrivyOnrampCheckoutResult {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PrivyOnrampCheckoutResult>;
  return candidate.type === 'flay:privy-onramp-result'
    && candidate.requestId === requestId
    && candidate.wallet === wallet
    && (candidate.status === 'submitted' || candidate.status === 'confirmed' || candidate.status === 'provider-exited')
    && typeof candidate.fiat === 'string'
    && fiatSet.has(candidate.fiat)
    && typeof candidate.amount === 'string'
    && normalizePrivyOnrampAmount(candidate.amount) === candidate.amount;
}

export function buildPrivyOnrampOptions(
  wallet: string,
  fiat: PrivyOnrampFiat,
  amount: string,
  environment: PrivyOnrampEnvironment,
) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) throw new Error('Your embedded Solana wallet is still loading.');
  const normalizedAmount = normalizePrivyOnrampAmount(amount);
  if (!normalizedAmount) throw new Error('Enter a fiat amount from 1.00 to 1,000.00.');
  const defaultAsset = fiat.toLowerCase() as Lowercase<PrivyOnrampFiat>;
  return {
    source: {
      assets: PRIVY_ONRAMP_FIAT.map((currency) => currency.toLowerCase()) as Lowercase<PrivyOnrampFiat>[],
      defaultAsset,
    },
    destination: {
      asset: USDC_MINT,
      chain: PRIVY_ONRAMP_SOLANA_CHAIN,
      address: wallet,
    },
    environment,
    defaultAmount: normalizedAmount,
  };
}

export function selectPrivyOnrampRoute(
  region: PrivyOnrampRegion | null,
  environment: PrivyOnrampEnvironment,
): PrivyOnrampRoute {
  if (environment === 'sandbox') return 'privy-quotes';
  if (!region) return 'moonpay';
  const country = region.country.toUpperCase();
  if (country === 'RS' || EU_COUNTRIES.has(country)) return 'privy-quotes';
  if (country !== 'US') return 'moonpay';
  const subdivision = region.region?.trim().toLowerCase() ?? '';
  return subdivision === 'new york' || subdivision === 'ny' ? 'moonpay' : 'privy-quotes';
}

export function buildPrivyRegionalMoonPayRequest(
  wallet: string,
  fiat: PrivyOnrampFiat,
  amount: string,
) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) throw new Error('Your embedded Solana wallet is still loading.');
  const normalizedAmount = normalizePrivyOnrampAmount(amount);
  if (!normalizedAmount) throw new Error('Enter a fiat amount from 1.00 to 1,000.00.');
  return {
    address: wallet,
    options: {
      chain: 'solana:mainnet' as const,
      asset: 'USDC' as const,
      defaultFundingMethod: 'card' as const,
      card: { preferredProvider: 'moonpay' as const },
      ...(fiat === 'USD' ? { amount: normalizedAmount } : {}),
      uiConfig: {
        receiveFundsTitle: 'Buy Solana USDC',
        receiveFundsSubtitle: 'MoonPay confirms eligibility, payment methods, the final quote, and fees.',
      },
    },
  };
}

export async function detectPrivyOnrampRegion(
  fetcher: typeof fetch = fetch,
  timeoutMs = 1_200,
): Promise<PrivyOnrampRegion | null> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(PRIVY_ONRAMP_REGION_URL, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const body = await response.text();
    if (body.length > 4_096) return null;
    const value = JSON.parse(body) as { country?: unknown; region?: unknown };
    if (typeof value.country !== 'string' || !/^[A-Za-z]{2}$/.test(value.country)) return null;
    const region = typeof value.region === 'string' && value.region.length <= 80 ? value.region : null;
    return { country: value.country.toUpperCase(), region };
  } catch {
    return null;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

function sessionRouteStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

export async function resolvePrivyOnrampRoute(
  environment: PrivyOnrampEnvironment,
  fetcher: typeof fetch = fetch,
  storage: Pick<Storage, 'getItem' | 'setItem'> | null = sessionRouteStorage(),
): Promise<PrivyOnrampRoute> {
  if (environment === 'sandbox') return 'privy-quotes';
  const cached = storage?.getItem(PRIVY_ONRAMP_ROUTE_CACHE_KEY);
  if (cached === 'privy-quotes' || cached === 'moonpay') return cached;
  const route = selectPrivyOnrampRoute(await detectPrivyOnrampRegion(fetcher), environment);
  try {
    storage?.setItem(PRIVY_ONRAMP_ROUTE_CACHE_KEY, route);
  } catch {
    // Checkout remains usable when session storage is unavailable.
  }
  return route;
}

function privyOnrampErrorText(error: unknown): string {
  if (error instanceof Error) return `${error.name} ${error.message}`.trim();
  if (typeof error === 'string') return error;
  if (!error || typeof error !== 'object') return 'Privy could not start the fiat onramp.';
  const record = error as Record<string, unknown>;
  return ['name', 'message', 'code', 'reason', 'details']
    .map((key) => record[key])
    .filter((value): value is string => typeof value === 'string')
    .join(' ') || 'Privy could not start the fiat onramp.';
}

export function readablePrivyOnrampError(error: unknown): string {
  const message = privyOnrampErrorText(error);
  if (/cancel|closed|exited|dismiss/i.test(message)) return 'The onramp was closed before submission. You can try again.';
  if (/region|country|location|unsupported/i.test(message)) return 'No Privy onramp provider is available for this region or currency. Try another supported currency.';
  if (/config|enable|provider|funding/i.test(message)) return 'Privy card onramps are not enabled for this app yet. Enable Card onramps under Funding in the Privy Dashboard.';
  return message;
}
