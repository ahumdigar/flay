import { describe, expect, it } from 'vitest';
import { EphemeralStore } from './prepared-store.js';
import { QuoteService } from './quote-service.js';
import { StockService } from './stocks-service.js';
import { TokenService } from './tokens.js';

const LIVE = process.env.LIVE_STOCKS_TESTS === '1';
const describeLive = LIVE ? describe : describe.skip;

describeLive('live xStocks and Jupiter read-only acceptance', () => {
  it('resolves AAPLx and builds a wallet-bound small-value Jupiter Router transaction', async () => {
    const tokens = new TokenService();
    const quotes = new QuoteService(tokens, new EphemeralStore());
    const stocks = new StockService(tokens, quotes);
    const catalog = await stocks.catalog(true);
    const official = catalog.assets.find((asset) => asset.symbol === 'AAPLx');
    expect(catalog.status).toBe('live');
    expect(catalog.assets.length).toBeGreaterThan(100);
    expect(official?.mint).toBe('XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp');

    const result = await stocks.quote({
      wallet: 'FexVXRLxhSgV2yW2VSJ54WQ3T58KQUr2Kikvr43nLMc7',
      symbol: 'AAPLx',
      side: 'buy',
      amount: '0.01',
      slippageBps: 50,
    });
    expect(result.asset.mint).toBe(official?.mint);
    expect(result.asset.token?.tokenProgram).toBe('token-2022');
    expect(Number(result.trade.multiplier.value)).toBeGreaterThan(0);
    expect(Number(result.trade.expectedOutputDisplay)).toBeGreaterThan(0);
    expect(result.quoteResponse.quotes.length).toBeGreaterThan(0);
    expect(result.quoteResponse.quotes.every((quote) => quote.provider === 'jupiter')).toBe(true);
    expect(result.quoteResponse.quotes.every((quote) => quote.providerLabel === 'Jupiter Swap V2 Router')).toBe(true);
    expect(result.quoteResponse.failures).toEqual([]);
  }, 45_000);
});
