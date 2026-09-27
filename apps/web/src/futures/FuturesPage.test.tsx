import { readFileSync } from 'node:fs';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { unconfiguredAuth } from '../auth.js';
import { ApiClientError } from '../lib/api.js';
import type { FuturesPortfolio, FuturesPosition, FuturesRouteQuote, PhoenixAccess, VenueReadiness } from '../../shared/futures.js';
import FuturesPage, { PositionRow, VenueError, defaultConditionalExecutionPriceMicroUsd, futuresEntryPrimaryAction, futuresMinimumCollateralMessage, futuresPortfolioRefreshDelay, futuresQuoteRetryDelay, hourlyRate, parseSubmittedSignatures, phoenixReadinessDisplay, priceImpact, usdc, walletSol } from './FuturesPage.js';

describe('Futures desktop and mobile shell', () => {
  it('renders the live two-venue ticket, stable chart controls, and recovery panels', () => {
    const html = renderToString(<FuturesPage auth={unconfiguredAuth} />);
    expect(html).toContain('PERPETUAL FUTURES');
    expect(html).toMatch(/Phoenix(?:<!-- -->)? mark/);
    expect(html).toMatch(/GMTrade(?:<!-- -->)? mark/);
    expect(html).toContain('Market');
    expect(html).toContain('Limit');
    expect(html).toContain('Positions');
    expect(html).toContain('Orders');
    expect(html).toContain('History');
    expect(html).toContain('Sign in to trade');
    expect(html).toContain('Awaiting quote');
    expect(html).toContain('GMTrade open margin');
    expect(html).toContain('Unavailable');
    for (const interval of ['1m', '5m', '15m', '1h', '4h', '1d']) expect(html).toContain(`>${interval}<`);
  });

  it('keeps the review action sticky in the stacked mobile layout', () => {
    const css = readFileSync(new URL('./futures.css', import.meta.url), 'utf8');
    expect(css).toMatch(/@media\(max-width:1100px\)\{\.futures-layout\{grid-template-columns:1fr\}/);
    expect(css).toMatch(/@media\(max-width:720px\).*\.futures-review-button\{position:sticky;bottom:74px/s);
  });

  it('shows every position field in a labeled mobile card without the old fixed width', () => {
    const position: FuturesPosition = {
      venue: 'phoenix', nativeId: 'SOL:1', market: 'SOL-PERP', side: 'long',
      sizeAtomic: '1000000', baseDecimals: 9, collateralAtomic: '1019588',
      entryPriceMicroUsd: '117500000', markPriceMicroUsd: '118000000',
      liquidationPriceMicroUsd: null, unrealizedPnlMicroUsd: '500', leverageBps: null,
      conditionals: [], updatedAt: Date.now(),
    };
    const html = renderToString(<PositionRow position={position} onManage={() => undefined} />);
    for (const label of ['Market', 'Side', 'Venue', 'Size', 'Entry', 'Unrealized PnL']) expect(html).toContain(`data-label="${label}"`);
    expect(html).toContain('SOL-PERP');
    expect(html).toContain('phoenix');
    expect(html).toContain('0.001 SOL');
    expect(html).toContain('$117.50');
    expect(html).toContain('Manage position');
    const css = readFileSync(new URL('./futures.css', import.meta.url), 'utf8');
    expect(css).not.toContain('.portfolio-row{min-width:700px}');
    expect(css).toMatch(/@media\(max-width:720px\).*\.portfolio-row\{min-width:0;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/s);
  });
});

describe('wallet-specific Phoenix readiness', () => {
  it('replaces anonymous onboarding guidance after wallet execution is verified', () => {
    const anonymous: VenueReadiness = { publicData: true, execution: false, status: 'onboarding-required', detail: 'Wallet onboarding is required for Phoenix execution.', checkedAt: 1 };
    const access: PhoenixAccess = { wallet: 'wallet', publicData: true, activated: true, traderRegistered: true, executionEligible: true, status: 'active', message: 'Phoenix execution is active.', onboardingUrl: 'https://docs.phoenix.trade', checkedAt: 2 };
    expect(phoenixReadinessDisplay(access, anonymous)).toEqual({ ready: true, detail: 'Phoenix execution is active.' });
    expect(phoenixReadinessDisplay(null, anonymous)).toEqual({ ready: false, detail: anonymous.detail });
  });
});

describe('Futures wallet SOL display', () => {
  it('formats the authoritative lamport balance without implying a venue wallet', () => {
    expect(walletSol('2349655')).toBe('0.002349655 SOL');
    expect(walletSol(null)).toBe('Unavailable');
    expect(walletSol('0')).toBe('0 SOL');
    expect(usdc(null)).toBe('Unavailable');
    expect(usdc('0')).toBe('0 USDC');
  });
});

describe('Futures minimum collateral guidance', () => {
  it('distinguishes wallet USDC from GMTrade open margin', () => {
    expect(futuresMinimumCollateralMessage('580000', '580000')).toBe(
      'Futures routes require at least 1 USDC collateral. Your wallet has 0.58 USDC; add at least 0.42 USDC. GMTrade can require more for a specific market and leverage.',
    );
    expect(futuresMinimumCollateralMessage('1000000', '580000')).toBeNull();
    expect(futuresMinimumCollateralMessage('0', '580000')).toBeNull();
  });
});



describe('Futures local continuity storage', () => {
  it('retains only unique Solana signatures and strips legacy execution metadata', () => {
    const first = '1'.repeat(88);
    const second = '2'.repeat(88);
    expect(parseSubmittedSignatures([
      first,
      { execution: { signature: second, venue: 'gmtrade', status: 'filled', detail: 'must not persist' } },
      { signature: first, arbitrary: 'must not persist' },
      'not-a-signature',
    ])).toEqual([first, second]);
    expect(parseSubmittedSignatures({ signature: first })).toEqual([]);
  });
});

describe('Futures quote polling recovery', () => {
  it('uses bounded exponential backoff only for rate limits', () => {
    const limited = new ApiClientError('slow down', 'RATE_LIMITED', 429, true);
    expect(futuresQuoteRetryDelay(limited, 3_000)).toBe(6_000);
    expect(futuresQuoteRetryDelay(limited, 12_000)).toBe(24_000);
    expect(futuresQuoteRetryDelay(limited, 24_000)).toBe(24_000);
    expect(futuresQuoteRetryDelay(new ApiClientError('offline', 'NETWORK_ERROR', 0, true), 24_000)).toBe(3_000);
  });
});

describe('Futures portfolio recovery', () => {
  it('rechecks degraded venue data quickly and restores the normal healthy interval', () => {
    const portfolio = (gmtradeError: string | null) => ({
      venues: { phoenix: { error: null }, gmtrade: { error: gmtradeError } },
    }) as FuturesPortfolio;
    expect(futuresPortfolioRefreshDelay(portfolio('GMTrade adapter is recovering.'))).toBe(5_000);
    expect(futuresPortfolioRefreshDelay(portfolio(null))).toBe(60_000);
    expect(futuresPortfolioRefreshDelay(null)).toBe(60_000);
  });

  it('keeps cached recovery state visible and exposes an immediate retry action', () => {
    const html = renderToString(<VenueError venue="gmtrade" available={false} error="The adapter is recovering." onRetry={() => undefined} />);
    expect(html).toContain('GMTrade data is degraded.');
    expect(html).toContain('Cached positions and recovery controls remain visible.');
    expect(html).toContain('Retry now');
  });
});

describe('Futures hourly venue rates', () => {
  it('formats signed basis-point rates without hiding small live values', () => {
    expect(hourlyRate('0.999999')).toBe('0.00999999%');
    expect(hourlyRate('-0.012345')).toBe('-0.00012345%');
    expect(hourlyRate('0')).toBe('0%');
    expect(hourlyRate(null)).toBe('Unavailable');
  });
});

describe('Futures route cost display', () => {
  it('keeps small simulated price impact visible', () => {
    expect(priceImpact(0)).toBe('0%');
    expect(priceImpact(7)).toBe('0.07%');
    expect(priceImpact(null)).toBe('Unavailable');
  });
});

describe('Futures entry setup action', () => {
  it('routes inaccessible and underfunded Phoenix entries through separate setup reviews', () => {
    const route = (overrides: Partial<FuturesRouteQuote>) => ({
      venue: 'phoenix',
      executionEligible: false,
      exclusionCode: null,
      setupSteps: [],
      ...overrides,
    }) as FuturesRouteQuote;
    expect(futuresEntryPrimaryAction(false, null)).toBe('login');
    expect(futuresEntryPrimaryAction(true, route({ setupSteps: ['activate'], exclusionCode: 'PHOENIX_ONBOARDING_REQUIRED' }))).toBe('phoenix-access');
    expect(futuresEntryPrimaryAction(true, route({ setupSteps: ['deposit'], exclusionCode: 'PHOENIX_COLLATERAL_REQUIRED' }))).toBe('phoenix-deposit');
    expect(futuresEntryPrimaryAction(true, route({ executionEligible: true }))).toBe('review');
    expect(futuresEntryPrimaryAction(true, route({ venue: 'gmtrade' }))).toBe('unavailable');
  });
});

describe('Futures conditional execution bound', () => {
  it('derives the 0.5% fallback with exact integer arithmetic beyond safe-number range', () => {
    const trigger = 9_007_199_254_740_993n;
    expect(defaultConditionalExecutionPriceMicroUsd(trigger.toString(), 'long')).toBe((trigger * 9_950n / 10_000n).toString());
    expect(defaultConditionalExecutionPriceMicroUsd(trigger.toString(), 'short')).toBe(((trigger * 10_050n + 9_999n) / 10_000n).toString());
    expect(() => defaultConditionalExecutionPriceMicroUsd('0', 'long')).toThrow();
  });
});
