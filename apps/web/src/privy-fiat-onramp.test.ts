import { describe, expect, it, vi } from 'vitest';
import { USDC_MINT } from '../shared/constants.js';
import {
  PRIVY_ONRAMP_SOLANA_CHAIN,
  assertPrivyOnrampFiat,
  buildPrivyOnrampCheckoutUrl,
  buildPrivyOnrampOptions,
  buildPrivyRegionalMoonPayRequest,
  detectPrivyOnrampRegion,
  isPrivyOnrampCheckoutResult,
  normalizePrivyOnrampAmount,
  parsePrivyOnrampCheckoutIntent,
  readablePrivyOnrampError,
  resolvePrivyOnrampRoute,
  resolvePrivyOnrampEnvironment,
  selectPrivyOnrampRoute,
} from './privy-fiat-onramp.js';

const wallet = 'FexVXRLxhSgV2yW2VSJ54WQ3T58KQUr2Kikvr43nLMc7';
const requestId = '76ae2dac-cc25-4bbb-8ef5-576f25b19620';

describe('Privy fiat onramp boundary', () => {
  it('defaults safely to sandbox and requires an exact production opt-in', () => {
    expect(resolvePrivyOnrampEnvironment(undefined)).toBe('sandbox');
    expect(resolvePrivyOnrampEnvironment('test')).toBe('sandbox');
    expect(resolvePrivyOnrampEnvironment('PRODUCTION')).toBe('sandbox');
    expect(resolvePrivyOnrampEnvironment('production')).toBe('production');
  });

  it('binds the embedded wallet to native Solana USDC and the mainnet CAIP chain', () => {
    expect(buildPrivyOnrampOptions(wallet, 'USD', '50', 'sandbox')).toEqual({
      source: { assets: ['usd', 'eur', 'aud', 'brl'], defaultAsset: 'usd' },
      destination: { asset: USDC_MINT, chain: PRIVY_ONRAMP_SOLANA_CHAIN, address: wallet },
      environment: 'sandbox',
      defaultAmount: '50.00',
    });
  });

  it('selects the provider path from the current region without a user-facing provider choice', () => {
    for (const country of ['BD', 'SG', 'AE']) {
      expect(selectPrivyOnrampRoute({ country, region: null }, 'production')).toBe('moonpay');
    }
    expect(selectPrivyOnrampRoute(null, 'production')).toBe('moonpay');
    expect(selectPrivyOnrampRoute({ country: 'DE', region: 'Berlin' }, 'production')).toBe('privy-quotes');
    expect(selectPrivyOnrampRoute({ country: 'RS', region: 'Belgrade' }, 'production')).toBe('privy-quotes');
    expect(selectPrivyOnrampRoute({ country: 'US', region: 'California' }, 'production')).toBe('privy-quotes');
    expect(selectPrivyOnrampRoute({ country: 'US', region: 'New York' }, 'production')).toBe('moonpay');
    expect(selectPrivyOnrampRoute({ country: 'BD', region: 'Dhaka Division' }, 'sandbox')).toBe('privy-quotes');
  });

  it('builds the automatic non-Stripe path for the same Solana wallet and USDC', () => {
    expect(buildPrivyRegionalMoonPayRequest(wallet, 'USD', '50')).toEqual({
      address: wallet,
      options: {
        chain: 'solana:mainnet',
        asset: 'USDC',
        amount: '50.00',
        defaultFundingMethod: 'card',
        card: { preferredProvider: 'moonpay' },
        uiConfig: {
          receiveFundsTitle: 'Buy Solana USDC',
          receiveFundsSubtitle: 'MoonPay confirms eligibility, payment methods, the final quote, and fees.',
        },
      },
    });
    expect(buildPrivyRegionalMoonPayRequest(wallet, 'EUR', '50').options).not.toHaveProperty('amount');
    expect(() => buildPrivyRegionalMoonPayRequest('bad-wallet', 'USD', '50')).toThrow('still loading');
  });

  it('bounds region lookup, stores only the selected route, and reuses it for the checkout session', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      ip: '198.51.100.10',
      country: 'BD',
      region: 'Dhaka Division',
    }), { status: 200 })) as unknown as typeof fetch;
    await expect(detectPrivyOnrampRegion(fetcher)).resolves.toEqual({ country: 'BD', region: 'Dhaka Division' });
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };
    await expect(resolvePrivyOnrampRoute('production', fetcher, storage)).resolves.toBe('moonpay');
    await expect(resolvePrivyOnrampRoute('production', fetcher, storage)).resolves.toBe('moonpay');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect([...values.values()]).toEqual(['moonpay']);
    expect(JSON.stringify([...values.entries()])).not.toContain('198.51.100.10');
  });

  it('fails region lookup safely to MoonPay and keeps sandbox on the quote path', async () => {
    const unavailable = vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    await expect(resolvePrivyOnrampRoute('production', unavailable, null)).resolves.toBe('moonpay');
    await expect(resolvePrivyOnrampRoute('sandbox', unavailable, null)).resolves.toBe('privy-quotes');
    expect(unavailable).toHaveBeenCalledOnce();
  });

  it('accepts only bounded decimal amounts and the launch currency allowlist', () => {
    expect(normalizePrivyOnrampAmount('1')).toBe('1.00');
    expect(normalizePrivyOnrampAmount('1000.00')).toBe('1000.00');
    for (const value of ['0.99', '1000.01', '1e2', '-2', '2.001', '']) expect(normalizePrivyOnrampAmount(value)).toBeNull();
    expect(assertPrivyOnrampFiat('BRL')).toBe('BRL');
    expect(() => assertPrivyOnrampFiat('BDT')).toThrow('supported fiat currency');
    expect(() => buildPrivyOnrampOptions('bad-wallet', 'USD', '50', 'sandbox')).toThrow('still loading');
  });

  it('keeps cancellation, region, and dashboard failures actionable', () => {
    expect(readablePrivyOnrampError(new Error('User closed modal'))).toContain('closed before submission');
    expect(readablePrivyOnrampError(new Error('Unsupported country'))).toContain('region or currency');
    expect(readablePrivyOnrampError(new Error('Funding provider not configured'))).toContain('Privy Dashboard');
  });

  it('creates a bounded checkout URL without accepting destination data', () => {
    const checkoutUrl = buildPrivyOnrampCheckoutUrl('http://localhost:5173/?old=value#funds', 'USD', '50', requestId);
    const parsedUrl = new URL(checkoutUrl);
    expect(parsedUrl.hash).toBe('');
    expect(parsedUrl.searchParams.get('old')).toBeNull();
    expect(parsedUrl.searchParams.get('flay-onramp')).toBe('1');
    expect(parsedUrl.searchParams.get('fiat')).toBe('USD');
    expect(parsedUrl.searchParams.get('amount')).toBe('50.00');
    expect(parsedUrl.toString()).not.toContain(wallet);
    expect(parsePrivyOnrampCheckoutIntent(parsedUrl.search)).toEqual({ fiat: 'USD', amount: '50.00', requestId });
    expect(parsePrivyOnrampCheckoutIntent('?flay-onramp=1&fiat=BDT&amount=50.00&request=' + requestId)).toBeNull();
    expect(() => buildPrivyOnrampCheckoutUrl('http://localhost:5173', 'USD', '50', 'bad-request')).toThrow('secure checkout');
  });

  it('accepts only the current checkout result and authenticated wallet', () => {
    const result = { type: 'flay:privy-onramp-result', requestId, status: 'submitted', fiat: 'USD', amount: '50.00', wallet };
    expect(isPrivyOnrampCheckoutResult(result, requestId, wallet)).toBe(true);
    expect(isPrivyOnrampCheckoutResult({ ...result, requestId: 'c6995fa4-7fcc-4bfd-9dd5-944f00d1cd0a' }, requestId, wallet)).toBe(false);
    expect(isPrivyOnrampCheckoutResult({ ...result, wallet: 'other-wallet' }, requestId, wallet)).toBe(false);
    expect(isPrivyOnrampCheckoutResult({ ...result, status: 'confirmed', amount: '50.0' }, requestId, wallet)).toBe(false);
    expect(isPrivyOnrampCheckoutResult({ ...result, status: 'provider-exited' }, requestId, wallet)).toBe(true);
  });
});
