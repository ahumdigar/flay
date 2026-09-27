import { readFileSync } from 'node:fs';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { unconfiguredAuth } from '../auth.js';
import StocksPage from './StocksPage.js';
import { stockSellAmountExceedsBalance } from './StocksPage.js';

describe('Stocks workspace shell', () => {
  it('blocks a scaled stock sell amount above the confirmed raw balance', () => {
    expect(stockSellAmountExceedsBalance('0.01', 8, '1.0032690125398187', '38121')).toBe(true);
    expect(stockSellAmountExceedsBalance('0.00038246', 8, '1.0032690125398187', '38121')).toBe(false);
  });

  it('renders honest provider, custody, execution, and security boundaries', () => {
    const html = renderToString(<StocksPage auth={unconfiguredAuth} balances={null} onReview={() => undefined} />);
    expect(html).toContain('TOKENIZED EQUITIES ON SOLANA');
    expect(html).toContain('Markets,');
    expect(html).toContain('xStocks × Jupiter');
    expect(html).toContain('Issuer data vs execution');
    expect(html).toContain('Tokenized security');
    expect(html).toContain('does not provide brokerage');
    expect(html).toContain('Self-custodial settlement');
  });

  it('ships responsive directory, ticket, and disclosure layouts', () => {
    const css = readFileSync(new URL('./stocks.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.stocks-layout\{display:grid;grid-template-columns:/);
    expect(css).toMatch(/@media\(max-width:1050px\)\{\.stocks-layout\{grid-template-columns:1fr\}/);
    expect(css).toMatch(/@media\(max-width:620px\).*\.stock-disclosures\{grid-template-columns:1fr\}/s);
    expect(css).toContain('.stock-quick-switch');
    expect(css).toMatch(/\.stock-quick-switch nav\{display:flex;flex-wrap:wrap/);
  });

  it('ships a visible multi-stock switcher and full-directory action', () => {
    const source = readFileSync(new URL('./StocksPage.tsx', import.meta.url), 'utf8');
    for (const symbol of ['AAPLX', 'NVDAX', 'TSLAX', 'MSFTX', 'AMZNX', 'GOOGLX', 'METAX', 'SPYX', 'QQQX', 'NFLXX', 'AVGOX', 'COINX']) {
      expect(source).toContain(symbol);
    }
    expect(source).toContain('POPULAR XSTOCKS');
    expect(source).toContain('All stocks');
    expect(source).toContain("document.getElementById('stock-directory')");
  });

  it('ships an actionable official-data unavailable state for both Stocks panels', () => {
    const source = readFileSync(new URL('./StocksPage.tsx', import.meta.url), 'utf8');
    expect(source).toContain('Official catalog unavailable');
    expect(source).toContain('Official xStocks data unavailable');
    expect(source).toContain('Official data unavailable');
    expect(source).toContain('Retry catalog');
    expect(source).toContain('catalog.directoryComplete');
  });

  it('bounds a slow asset-detail request and preserves a retryable state', () => {
    const source = readFileSync(new URL('./StocksPage.tsx', import.meta.url), 'utf8');
    expect(source).toContain('DETAIL_REQUEST_TIMEOUT_MS = 8_000');
    expect(source).toContain('Official asset verification took too long. Retry to check the live provider again.');
    expect(source).toContain('controller.abort()');
    expect(source).toContain('On-chain Token-2022 verification is temporarily unavailable. Trading stays disabled until it succeeds.');
    expect(source).toContain('Retry verification');
  });

  it('labels Jupiter market-price fallback separately from an issuer reference', () => {
    const source = readFileSync(new URL('./StocksPage.tsx', import.meta.url), 'utf8');
    expect(source).toContain("price?.source === 'jupiter' ? 'Market reference' : price?.source === 'xstocks' ? 'Issuer reference' : 'No live provider price'");
    expect(source).toContain("detail.referencePriceSource === 'jupiter' ? 'Market reference' : 'Issuer reference'");
    expect(source).toContain('No live provider price');
    expect(source).toContain("? 'Unavailable' : 'Loading…'");
  });

  it('shows the real route failure with an explicit retry action', () => {
    const source = readFileSync(new URL('./StocksPage.tsx', import.meta.url), 'utf8');
    expect(source).toContain("quoteError ?? 'Enter an amount to request an executable Jupiter path.'");
    expect(source).toContain('Retry route');
    expect(source).toContain('setQuoteRefreshNonce((value) => value + 1)');
    expect(source).toContain("disabled={prepareBusy || (auth.authenticated && !canReview)}");
    expect(source).toContain("setTradeAmount(stockBalanceDisplay)");
    expect(source).toContain('Reduce the amount to your confirmed');
  });
});
