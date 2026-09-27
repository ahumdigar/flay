import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  Check,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Info,
  LoaderCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { decimalToAtomic } from '../../shared/amounts';
import { USDC_MINT } from '../../shared/constants';
import { scaledAtomicToDecimal, scaledDecimalToAtomic } from '../../shared/stock-amounts';
import type {
  PreparedTransaction,
  StockAsset,
  StockCatalogResponse,
  StockQuoteResponse,
  StockTradeSide,
  WalletBalances,
} from '../../shared/types';
import type { FlayAuth } from '../auth';
import { api, query, readableError } from '../lib/api';
import './stocks.css';

// These twelve canonical xStocks have a current live Jupiter market reference.
// Keep them first so the initial directory never leads with a valid-but-unpriced
// long-tail asset. The complete official catalog remains available through search.
const FEATURED = ['AAPLX', 'NVDAX', 'TSLAX', 'MSFTX', 'AMZNX', 'GOOGLX', 'METAX', 'SPYX', 'QQQX', 'NFLXX', 'AVGOX', 'COINX'];
const DETAIL_REQUEST_TIMEOUT_MS = 8_000;

function usd(value: string | number | null): string {
  if (value === null || value === '') return '—';
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: number < 1 ? 4 : 2 }).format(number);
}

function amount(value: string, maximumFractionDigits = 8): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return value;
  return new Intl.NumberFormat('en-US', { maximumFractionDigits }).format(number);
}

function age(timestamp: number | null): string {
  if (!timestamp) return 'Unavailable';
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 2) return 'Updated now';
  if (seconds < 60) return `Updated ${seconds}s ago`;
  return `Updated ${Math.floor(seconds / 60)}m ago`;
}

function sanitize(value: string): string {
  const filtered = value.replace(/[^0-9.]/g, '');
  const dot = filtered.indexOf('.');
  return dot < 0 ? filtered : `${filtered.slice(0, dot + 1)}${filtered.slice(dot + 1).replace(/\./g, '')}`;
}

export function stockSellAmountExceedsBalance(
  displayAmount: string,
  tokenDecimals: number,
  multiplier: string,
  balanceAtomic: string,
): boolean {
  try {
    return BigInt(scaledDecimalToAtomic(displayAmount, tokenDecimals, multiplier).amountAtomic) > BigInt(balanceAtomic);
  } catch {
    return false;
  }
}

function StockLogo({ asset, small = false }: { asset: StockAsset; small?: boolean }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={`stock-logo ${small ? 'small' : ''}`}>
      {asset.logoUri && !failed
        ? <img src={asset.logoUri} alt="" onError={() => setFailed(true)} />
        : <span>{asset.underlyingSymbol.slice(0, 2)}</span>}
    </span>
  );
}

export default function StocksPage({
  auth,
  balances,
  onReview,
}: {
  auth: FlayAuth;
  balances: WalletBalances | null;
  onReview: (prepared: PreparedTransaction) => void;
}) {
  const [catalog, setCatalog] = useState<StockCatalogResponse | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedSymbol, setSelectedSymbol] = useState('');
  const [detail, setDetail] = useState<StockAsset | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [prices, setPrices] = useState<Record<string, { value: string; source: 'xstocks' | 'jupiter'; fetchedAt: number }>>({});
  const [attemptedPrices, setAttemptedPrices] = useState<Set<string>>(new Set());
  const [side, setSide] = useState<StockTradeSide>('buy');
  const [tradeAmount, setTradeAmount] = useState('10');
  const [slippageBps, setSlippageBps] = useState(50);
  const [quote, setQuote] = useState<StockQuoteResponse | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [prepareBusy, setPrepareBusy] = useState(false);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [quoteRefreshNonce, setQuoteRefreshNonce] = useState(0);
  const [now, setNow] = useState(Date.now());
  const catalogProviderStatus = catalog
    ? catalog.directoryComplete
      ? String(catalog.assets.length) + ' Solana assets · ' + catalog.status
      : 'Official directory updating · ' + String(catalog.assets.length) + ' ready'
    : catalogError
      ? 'Official data unavailable'
      : catalogLoading
        ? 'Connecting to official data'
        : 'Official data unavailable';

  const loadCatalog = () => {
    setCatalogLoading(true);
    setCatalogError(null);
    void api<StockCatalogResponse>('/stocks')
      .then((response) => {
        setCatalog(response);
        setSelectedSymbol((current) => current || response.assets.find((asset) => asset.symbol.toUpperCase() === 'AAPLX')?.symbol || response.assets[0]?.symbol || '');
      })
      .catch((error) => setCatalogError(readableError(error)))
      .finally(() => setCatalogLoading(false));
  };

  useEffect(loadCatalog, []);

  useEffect(() => {
    if (!catalog || catalog.directoryComplete) return;
    const refresh = window.setTimeout(loadCatalog, 4_000);
    return () => window.clearTimeout(refresh);
  }, [catalog]);

  useEffect(() => {
    const clock = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(clock);
  }, []);

  useEffect(() => {
    if (!auth.authenticated) return;
    const refresh = window.setInterval(() => {
      if (document.visibilityState === 'visible') setQuoteRefreshNonce((value) => value + 1);
    }, 8_000);
    return () => window.clearInterval(refresh);
  }, [auth.authenticated]);

  const visibleAssets = useMemo(() => {
    if (!catalog) return [];
    const needle = search.trim().toLowerCase();
    const matches = needle
      ? catalog.assets.filter((asset) => `${asset.symbol} ${asset.underlyingSymbol} ${asset.name}`.toLowerCase().includes(needle))
      : [...catalog.assets].sort((left, right) => {
        const leftIndex = FEATURED.indexOf(left.symbol.toUpperCase());
        const rightIndex = FEATURED.indexOf(right.symbol.toUpperCase());
        if (leftIndex >= 0 || rightIndex >= 0) return (leftIndex < 0 ? 999 : leftIndex) - (rightIndex < 0 ? 999 : rightIndex);
        return left.underlyingSymbol.localeCompare(right.underlyingSymbol);
      });
    return matches.slice(0, search.trim() ? 24 : 12);
  }, [catalog, search]);

  const featuredAssets = useMemo(() => {
    if (!catalog) return [];
    const official = new Map(catalog.assets.map((asset) => [asset.symbol.toUpperCase(), asset]));
    return FEATURED.map((symbol) => official.get(symbol)).filter((asset): asset is StockAsset => Boolean(asset));
  }, [catalog]);

  useEffect(() => {
    if (!visibleAssets.length) return;
    const controller = new AbortController();
    const symbols = visibleAssets.map((asset) => asset.symbol).join(',');
    void api<{ prices: Record<string, { value: string; source: 'xstocks' | 'jupiter'; fetchedAt: number }> }>(`/stocks-prices?${query({ symbols })}`, { signal: controller.signal })
      .then((response) => { if (!controller.signal.aborted) setPrices((current) => ({ ...current, ...response.prices })); })
      .catch(() => undefined)
      .finally(() => {
        if (!controller.signal.aborted) setAttemptedPrices((current) => new Set([...current, ...visibleAssets.map((asset) => asset.symbol.toUpperCase())]));
      });
    return () => controller.abort();
  }, [visibleAssets.map((asset) => asset.symbol).join(',')]);

  useEffect(() => {
    if (!selectedSymbol) return;
    let live = true;
    const controller = new AbortController();
    let timedOut = false;
    setDetailLoading(true);
    setDetailError(null);
    setQuote(null);
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, DETAIL_REQUEST_TIMEOUT_MS);
    void api<{ asset: StockAsset }>(`/stocks/${encodeURIComponent(selectedSymbol)}`, { signal: controller.signal })
      .then((response) => {
        if (!live) return;
        setDetail(response.asset);
        if (response.asset.referencePrice && response.asset.referencePriceFetchedAt) {
          setPrices((current) => ({ ...current, [response.asset.symbol.toUpperCase()]: { value: response.asset.referencePrice!, source: response.asset.referencePriceSource ?? 'xstocks', fetchedAt: response.asset.referencePriceFetchedAt! } }));
        }
      })
      .catch((error) => {
        if (live) {
          setDetail(null);
          setDetailError(timedOut ? 'Official asset verification took too long. Retry to check the live provider again.' : readableError(error));
        }
      })
      .finally(() => { window.clearTimeout(timeout); if (live) setDetailLoading(false); });
    return () => { live = false; window.clearTimeout(timeout); controller.abort(); };
  }, [selectedSymbol, refreshNonce]);

  const usdcBalance = balances?.balances.find((balance) => balance.token.mint === USDC_MINT);
  const stockBalance = detail ? balances?.balances.find((balance) => balance.token.mint === detail.mint) : undefined;
  const stockBalanceDisplay = detail?.token && detail.multiplier
    ? scaledAtomicToDecimal(stockBalance?.amountAtomic ?? '0', detail.token.decimals, detail.multiplier.value)
    : '0';
  const inputBalanceDisplay = side === 'buy' ? (usdcBalance?.uiAmount ?? '0') : stockBalanceDisplay;
  let insufficient = false;
  if (balances) {
    try {
      if (side === 'buy') insufficient = BigInt(decimalToAtomic(tradeAmount, 6)) > BigInt(usdcBalance?.amountAtomic ?? '0');
      else if (detail?.token && detail.multiplier) {
        insufficient = stockSellAmountExceedsBalance(
          tradeAmount,
          detail.token.decimals,
          detail.multiplier.value,
          stockBalance?.amountAtomic ?? '0',
        );
      }
    } catch {
      insufficient = false;
    }
  }

  useEffect(() => {
    setQuote(null);
    setQuoteError(null);
    if (!detail?.token || !detail.multiplier || !tradeAmount || !auth.authenticated || !auth.walletAddress || !auth.identityToken) {
      setQuoteLoading(false);
      return;
    }
    if (insufficient) {
      setQuoteLoading(false);
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setQuoteLoading(true);
      void api<StockQuoteResponse>('/stocks/quotes', {
        method: 'POST',
        identityToken: auth.identityToken,
        signal: controller.signal,
        body: JSON.stringify({ wallet: auth.walletAddress, symbol: detail.symbol, side, amount: tradeAmount, slippageBps }),
      }).then((response) => {
        if (!controller.signal.aborted) {
          setQuote(response);
          setDetail(response.asset);
        }
      }).catch((error) => {
        if (!controller.signal.aborted) setQuoteError(readableError(error));
      }).finally(() => {
        if (!controller.signal.aborted) setQuoteLoading(false);
      });
    }, 650);
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [auth.authenticated, auth.identityToken, auth.walletAddress, detail?.symbol, detail?.multiplier?.value, insufficient, side, slippageBps, tradeAmount, refreshNonce, quoteRefreshNonce]);

  const route = quote?.quoteResponse.quotes.find((candidate) => candidate.id === quote.quoteResponse.bestQuoteId) ?? quote?.quoteResponse.quotes[0] ?? null;
  const quoteExpired = route ? route.expiresAt <= now : true;
  const canReview = Boolean(route && !quoteLoading && !quoteExpired && !insufficient && catalog?.status === 'live');
  const executionPrice = quote && Number(quote.trade.expectedOutputDisplay) > 0 && Number(quote.trade.normalizedInputDisplay) > 0
    ? side === 'buy'
      ? Number(quote.trade.normalizedInputDisplay) / Number(quote.trade.expectedOutputDisplay)
      : Number(quote.trade.expectedOutputDisplay) / Number(quote.trade.normalizedInputDisplay)
    : null;

  function useBalance() {
    if (!auth.authenticated) return auth.login();
    setTradeAmount(inputBalanceDisplay);
  }

  async function prepare() {
    if (!auth.configured) return auth.login();
    if (!auth.authenticated) return auth.login();
    if (!auth.walletAddress || !auth.identityToken || !route) {
      setPrepareError('Your embedded Solana wallet is still loading.');
      return;
    }
    setPrepareBusy(true);
    setPrepareError(null);
    try {
      const prepared = await api<PreparedTransaction>('/market/prepare', {
        method: 'POST',
        identityToken: auth.identityToken,
        body: JSON.stringify({ quoteId: route.id, wallet: auth.walletAddress }),
      });
      onReview(prepared);
    } catch (error) {
      setPrepareError(readableError(error));
    } finally {
      setPrepareBusy(false);
    }
  }

  return (
    <main className="page-content stocks-page">
      <section className="page-intro stocks-intro">
        <div className="intro-copy">
          <div className="eyebrow"><span className="eyebrow-line" /> TOKENIZED EQUITIES ON SOLANA</div>
          <h1>Markets, <em>within reach.</em></h1>
          <p>Discover official xStocks and trade the best executable Jupiter path from your own wallet.</p>
        </div>
        <div className="stock-provider-pill"><span className={catalog?.status === 'live' ? 'live' : ''} /><div><strong>xStocks × Jupiter</strong><small>{catalogProviderStatus}</small></div></div>
      </section>

      <div className="stocks-layout">
        <section className="stock-market-card" id="stock-directory">
          <div className="stock-card-heading"><div><span className="card-eyebrow">MARKET DIRECTORY</span><h2>Tokenized stocks</h2></div><button onClick={loadCatalog} disabled={catalogLoading} aria-label="Refresh stock catalog"><RefreshCw size={15} className={catalogLoading ? 'spin' : ''} /></button></div>
          <label className="stock-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search company or ticker" /><span>{catalog?.assets.length ?? '—'}</span></label>
          {catalog?.warning && <div className="stock-warning"><AlertCircle size={14} /><span>{catalog.warning}</span></div>}
          <div className="stock-list" aria-live="polite">
            {catalogLoading && !catalog && Array.from({ length: 6 }, (_, index) => <div className="stock-list-skeleton" key={index} />)}
            {visibleAssets.map((asset) => {
              const price = prices[asset.symbol.toUpperCase()];
              return (
                <button key={asset.symbol} className={selectedSymbol === asset.symbol ? 'selected' : ''} onClick={() => setSelectedSymbol(asset.symbol)}>
                  <StockLogo asset={asset} small />
                  <span><strong>{asset.underlyingSymbol}</strong><small>{asset.name.replace(/ xStock$/i, '')}</small></span>
                  <span className="stock-list-price"><strong>{price ? usd(price.value) : attemptedPrices.has(asset.symbol.toUpperCase()) ? 'Unavailable' : 'Loading…'}</strong><small>{asset.isTradingHalted ? 'Halted' : asset.openNow === false ? 'Reference closed' : price?.source === 'jupiter' ? 'Market reference' : price?.source === 'xstocks' ? 'Issuer reference' : 'No live provider price'}</small></span>
                  <ChevronRight size={14} />
                </button>
              );
            })}
            {!catalogLoading && !visibleAssets.length && (catalogError ? (
              <div className="stock-list-empty"><AlertCircle size={20} /><strong>Official catalog unavailable</strong><span>{catalogError}</span><button onClick={loadCatalog}>Retry catalog</button></div>
            ) : <div className="stock-list-empty"><Search size={20} /><strong>No matching xStock</strong><span>Try its company name or underlying ticker.</span></div>)}
          </div>
          <p className="stock-list-foot"><Info size={13} /> {catalog?.directoryComplete ? 'Search all ' + catalog.assets.length.toLocaleString() + ' official Solana xStocks.' : 'The full official Solana xStocks directory is updating.'} Canonical symbols and Solana mints come from the public xStocks API.</p>
        </section>

        <section className="stock-trade-card">
          {detailLoading && !detail ? (
            <div className="stock-detail-loading"><LoaderCircle className="spin" size={24} /><strong>Verifying official asset</strong><span>Loading price, multiplier, and onchain mint state.</span></div>
          ) : detail ? (
            <>
              <div className="stock-quick-switch">
                <div><span>POPULAR XSTOCKS</span><strong>{catalog?.assets.length.toLocaleString() ?? '—'} supported</strong></div>
                <nav aria-label="Popular xStocks">
                  {featuredAssets.map((asset) => (
                    <button
                      key={asset.symbol}
                      className={selectedSymbol === asset.symbol ? 'active' : ''}
                      onClick={() => setSelectedSymbol(asset.symbol)}
                    >
                      {asset.underlyingSymbol}
                    </button>
                  ))}
                  <button
                    className="all"
                    onClick={() => document.getElementById('stock-directory')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  >
                    All stocks <ChevronRight size={11} />
                  </button>
                </nav>
              </div>
              <div className="stock-hero">
                <StockLogo asset={detail} />
                <div><span className="card-eyebrow">{detail.exchange ?? 'TOKENIZED EQUITY'} · {detail.currency}</span><h2>{detail.underlyingSymbol} <small>{detail.symbol}</small></h2><p>{detail.name}</p></div>
                <div className="stock-reference"><span>{detail.referencePriceSource === 'jupiter' ? 'Market reference' : 'Issuer reference'}</span><strong>{usd(detail.referencePrice)}</strong><small>{age(detail.referencePriceFetchedAt)}</small></div>
              </div>
              <div className="stock-session-row">
                <span className={!detail.isTradingHalted ? 'open' : ''}><i />{detail.isTradingHalted ? 'Issuer halted' : detail.openNow === false ? 'Reference market closed' : 'Reference market open'}</span>
                <span><Clock3 size={12} />{detail.tradingPeriod ?? detail.tradingHoursMode ?? 'Schedule unavailable'}</span>
                <button onClick={() => setRefreshNonce((value) => value + 1)}><RefreshCw size={12} /> Refresh</button>
              </div>

              <div className="stock-side-tabs" aria-label="Stock trade side">
                <button className={side === 'buy' ? 'active' : ''} onClick={() => { setSide('buy'); setTradeAmount('10'); }}>Buy</button>
                <button className={side === 'sell' ? 'active sell' : ''} onClick={() => { setSide('sell'); setTradeAmount(stockBalanceDisplay); }}>Sell</button>
              </div>
              <div className="stock-amount-field">
                <div><label htmlFor="stock-amount">{side === 'buy' ? 'You pay' : 'You sell'}</label><span>Balance <strong>{amount(inputBalanceDisplay)} {side === 'buy' ? 'USDC' : detail.symbol}</strong></span></div>
                <div><input id="stock-amount" inputMode="decimal" autoComplete="off" value={tradeAmount} onChange={(event) => setTradeAmount(sanitize(event.target.value))} placeholder="0.00" /><strong>{side === 'buy' ? 'USDC' : detail.symbol}</strong></div>
                <button onClick={useBalance}>Use balance</button>
              </div>

              <div className="stock-receive-panel">
                <span>{side === 'buy' ? 'Estimated shares' : 'Estimated proceeds'}</span>
                <strong>{quoteLoading ? <LoaderCircle className="spin" size={19} /> : quote?.trade.expectedOutputDisplay ? amount(quote.trade.expectedOutputDisplay) : '—'} <small>{side === 'buy' ? detail.symbol : 'USDC'}</small></strong>
                <small>{route ? `Minimum ${amount(quote?.trade.minimumOutputDisplay ?? '0')} ${side === 'buy' ? detail.symbol : 'USDC'}` : insufficient ? `Reduce the amount to your confirmed ${detail.symbol} balance.` : auth.authenticated ? 'Waiting for an executable Jupiter route' : 'Sign in to request an executable route'}</small>
              </div>

              <div className="stock-route-card">
                <div className="stock-route-head"><span><Sparkles size={14} /> EXECUTION ROUTE</span><strong>{route ? 'LIVE' : quoteLoading ? 'UPDATING' : 'WAITING'}</strong></div>
                {route ? <div className="stock-route-live"><span className="jupiter-orb">J</span><span><strong>{route.providerLabel}</strong><small>{route.routeLabel}</small></span><Check size={15} /></div> : <div className="stock-route-empty"><BarChart3 size={18} /><span>{insufficient ? `Enter no more than ${amount(inputBalanceDisplay)} ${detail.symbol}.` : quoteError ?? 'Enter an amount to request an executable Jupiter path.'}</span></div>}
                <div className="stock-route-metrics">
                  <div><span>Execution price</span><strong>{executionPrice === null ? '—' : usd(executionPrice)}</strong></div>
                  <div><span>Price impact</span><strong>{route?.priceImpactPct === null || route?.priceImpactPct === undefined ? '—' : `${route.priceImpactPct.toFixed(3)}%`}</strong></div>
                  <div><span>Slippage</span><select value={slippageBps} onChange={(event) => setSlippageBps(Number(event.target.value))} aria-label="Stock slippage"><option value="10">0.1%</option><option value="50">0.5%</option><option value="100">1%</option></select></div>
                  <div><span>Flay fee</span><strong>0%</strong></div>
                </div>
              </div>

              {detail.multiplier && <div className="stock-multiplier"><TrendingUp size={15} /><span><strong>Scaled UI Amount {detail.multiplier.value}×</strong><small>Applied to shares, holdings, review, and receipt · {age(detail.multiplier.fetchedAt)}</small></span>{detail.multiplier.nextValue && <em>Next {detail.multiplier.nextValue}×</em>}</div>}
              {!detail.token && <div className="stock-error"><AlertCircle size={14} /><span>On-chain Token-2022 verification is temporarily unavailable. Trading stays disabled until it succeeds.</span><button onClick={() => setRefreshNonce((value) => value + 1)}>Retry verification</button></div>}
              {insufficient && <div className="stock-error"><Wallet size={14} /><span>Your confirmed {side === 'buy' ? 'USDC' : detail.symbol} balance is below this exact input.</span></div>}
              {quoteError && <div className="stock-error"><AlertCircle size={14} /><span>{quoteError}</span><button onClick={() => setQuoteRefreshNonce((value) => value + 1)} disabled={quoteLoading}>Retry route</button></div>}
              {prepareError && <div className="stock-error"><AlertCircle size={14} /><span>{prepareError}</span></div>}
              <button className="stock-review-button" disabled={prepareBusy || (auth.authenticated && !canReview)} onClick={() => void prepare()}>
                {prepareBusy ? <><LoaderCircle className="spin" size={17} /> Building exact transaction</> : !auth.authenticated ? <>Sign in to trade <ArrowRight size={17} /></> : <>{side === 'buy' ? 'Review stock purchase' : 'Review stock sale'} <ArrowRight size={17} /></>}
              </button>
              <p className="stock-custody"><ShieldCheck size={14} /> Privy requests your signature. Flay never receives your private key.</p>
            </>
          ) : (
            <div className="stock-detail-loading"><AlertCircle size={24} /><strong>{catalogError ? 'Official xStocks data unavailable' : 'Asset detail unavailable'}</strong><span>{catalogError ?? detailError ?? 'Choose an xStock from the directory.'}</span><button onClick={catalogError ? loadCatalog : () => setRefreshNonce((value) => value + 1)}>{catalogError ? 'Retry catalog' : 'Retry'}</button></div>
          )}
        </section>
      </div>

      <section className="stock-disclosures">
        <div><CircleDollarSign size={18} /><span><strong>Issuer data vs execution</strong><small>xStocks supplies canonical asset data and issuer references when available. Market references and every executable price, liquidity, impact, and minimum output come from Jupiter.</small></span></div>
        <div><ShieldCheck size={18} /><span><strong>Tokenized security</strong><small>xStocks availability depends on your jurisdiction and issuer rules. Flay does not provide brokerage, issuance, redemption, dividends, or shareholder rights.</small></span></div>
        <div><Sparkles size={18} /><span><strong>Self-custodial settlement</strong><small>The official Token-2022 asset settles to your embedded Solana wallet after your approval.</small></span></div>
      </section>
    </main>
  );
}
