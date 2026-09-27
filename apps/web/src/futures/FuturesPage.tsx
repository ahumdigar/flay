import {
  AlertCircle, ArrowDownRight, ArrowRight, ArrowUpRight, BarChart3, Check, ChevronDown,
  CircleDollarSign, Clock3, ExternalLink, LoaderCircle, LockKeyhole, RefreshCw, ShieldCheck,
  SlidersHorizontal, Wallet, X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type {
  CandleInterval, FuturesExecution, FuturesHistoryItem, FuturesMarket, FuturesMarketsResponse, FuturesOrder,
  FuturesPortfolio, FuturesPosition, FuturesPreparedStep, FuturesPrepareRequest,
  FuturesQuotesResponse, FuturesRouteChoice, FuturesRouteQuote, FuturesVenue, PhoenixAccess,
  VenueReadiness,
} from '../../shared/futures';
import { atomicToDecimal, decimalToAtomic } from '../../shared/amounts';
import type { FlayAuth } from '../auth';
import { ApiClientError, api, fromBase64, query, readableError, toBase64 } from '../lib/api';
import { ReferenceChart } from './ReferenceChart';
import './futures.css';

const INTERVALS: CandleInterval[] = ['1m', '5m', '15m', '1h', '4h', '1d'];
type Dialog = 'review' | 'success' | 'position' | 'collateral' | 'phoenix-access' | null;
type PositionAction = 'close' | 'reduce' | 'take-profit' | 'stop-loss';

function usd(value: string | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const amount = Number(value) / 1_000_000;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: amount >= 100 ? 2 : 3, maximumFractionDigits: amount >= 100 ? 2 : 4 }).format(amount);
}

export function usdc(value: string | null | undefined): string {
  if (value === null || value === undefined) return 'Unavailable';
  return `${atomicToDecimal(value, 6)} USDC`;
}

function lamports(value: string | null): string {
  return value === null ? 'Calculated at review' : `${(Number(value) / 1_000_000_000).toFixed(5)} SOL`;
}

export function walletSol(value: string | null | undefined): string {
  return value === null || value === undefined ? 'Unavailable' : `${atomicToDecimal(value, 9)} SOL`;
}

export function hourlyRate(value: string | null): string {
  if (value === null) return 'Unavailable';
  const percent = Number(value) / 100;
  if (!Number.isFinite(percent)) return 'Unavailable';
  return `${percent.toLocaleString('en-US', { maximumFractionDigits: 8 })}%`;
}

export function priceImpact(value: number | null): string {
  if (value === null) return 'Unavailable';
  return `${(value / 100).toLocaleString('en-US', { maximumFractionDigits: 4 })}%`;
}

export function futuresMinimumCollateralMessage(
  collateralAtomic: string,
  walletUsdcAtomic?: string | null,
): string | null {
  const collateral = BigInt(collateralAtomic);
  if (collateral === 0n || collateral >= 1_000_000n) return null;
  const wallet = walletUsdcAtomic ? BigInt(walletUsdcAtomic) : null;
  const balanceDetail = wallet !== null && wallet < 1_000_000n
    ? ` Your wallet has ${atomicToDecimal(wallet, 6)} USDC; add at least ${atomicToDecimal(1_000_000n - wallet, 6)} USDC.`
    : '';
  return `Futures routes require at least 1 USDC collateral.${balanceDetail} GMTrade can require more for a specific market and leverage.`;
}

function short(value: string): string {
  return value.length > 16 ? `${value.slice(0, 7)}…${value.slice(-6)}` : value;
}

function actionLabel(action: FuturesPrepareRequest['action']): string {
  return action === 'activate' || action === 'register' ? 'onboarding' : action.replace('-', ' ');
}

const SOLANA_SIGNATURE_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{64,96}$/;

export function parseSubmittedSignatures(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const signatures = value.flatMap((item): string[] => {
    if (typeof item === 'string') return [item];
    if (!item || typeof item !== 'object') return [];
    const execution = 'execution' in item && item.execution && typeof item.execution === 'object' ? item.execution : item;
    return 'signature' in execution && typeof execution.signature === 'string' ? [execution.signature] : [];
  }).filter((signature) => SOLANA_SIGNATURE_PATTERN.test(signature));
  return [...new Set(signatures)].slice(0, 20);
}

export function futuresQuoteRetryDelay(error: unknown, currentDelayMs: number): number {
  return error instanceof ApiClientError && error.status === 429
    ? Math.min(24_000, Math.max(3_000, currentDelayMs) * 2)
    : 3_000;
}

export function futuresPortfolioRefreshDelay(portfolio: FuturesPortfolio | null): number {
  if (!portfolio) return 60_000;
  return Object.values(portfolio.venues).some((venue) => Boolean(venue.error)) ? 5_000 : 60_000;
}

export function defaultConditionalExecutionPriceMicroUsd(
  triggerPriceMicroUsd: string,
  positionSide: 'long' | 'short',
): string {
  const trigger = BigInt(triggerPriceMicroUsd);
  if (trigger <= 0n) throw new Error('Enter a positive trigger price.');
  if (positionSide === 'long') return (trigger * 9_950n / 10_000n).toString();
  return ((trigger * 10_050n + 9_999n) / 10_000n).toString();
}

export type FuturesEntryPrimaryAction = 'login' | 'review' | 'phoenix-access' | 'phoenix-deposit' | 'unavailable';

export function futuresEntryPrimaryAction(
  authenticated: boolean,
  quote: FuturesRouteQuote | null,
): FuturesEntryPrimaryAction {
  if (!authenticated) return 'login';
  if (quote?.executionEligible) return 'review';
  if (quote?.venue !== 'phoenix') return 'unavailable';
  if (quote.setupSteps.includes('deposit')) return 'phoenix-deposit';
  if (quote.setupSteps.some((step) => step === 'activate' || step === 'register')
    || quote.exclusionCode === 'PHOENIX_ONBOARDING_REQUIRED') return 'phoenix-access';
  return 'unavailable';
}

export function phoenixReadinessDisplay(
  access: PhoenixAccess | null,
  anonymousReadiness: VenueReadiness | null | undefined,
): { ready: boolean; detail: string } {
  if (access) return { ready: access.executionEligible, detail: access.message };
  return {
    ready: anonymousReadiness?.status === 'ready',
    detail: anonymousReadiness?.detail ?? 'Checking',
  };
}

function VenueMark({ venue, market }: { venue: FuturesVenue; market: FuturesMarket | null }) {
  const data = market?.venues[venue];
  return (
    <div className={`venue-mark ${data?.active ? '' : 'offline'}`}>
      <span className={`venue-glyph ${venue}`}>{venue === 'phoenix' ? 'P' : 'G'}</span>
      <div><small>{venue === 'phoenix' ? 'Phoenix' : 'GMTrade'} mark</small><strong>{usd(data?.markPriceMicroUsd)}</strong></div>
      <span className="mark-status">{data?.active ? 'LIVE' : 'OFFLINE'}</span>
    </div>
  );
}

function RouteCard({ quote, selected, recommended, recommendationLabel, onSelect }: { quote: FuturesRouteQuote; selected: boolean; recommended: boolean; recommendationLabel: FuturesQuotesResponse['recommendationLabel']; onSelect(): void }) {
  return (
    <button className={`futures-route-card ${selected ? 'selected' : ''} ${!quote.executionEligible ? 'ineligible' : ''}`} onClick={onSelect} type="button">
      <div className="route-card-title">
        <span className={`venue-glyph ${quote.venue}`}>{quote.venue === 'phoenix' ? 'P' : 'G'}</span>
        <div><strong>{quote.venue === 'phoenix' ? 'Phoenix' : 'GMTrade'}</strong><small>{quote.executionEligible ? (quote.dataWarning ?? (recommended ? recommendationLabel : 'Available route')) : quote.exclusionReason}</small></div>
        {selected && <span className="route-check"><Check size={13} /></span>}
      </div>
      <div className="route-metrics"><span><small>Entry</small><strong>{usd(quote.entryPriceMicroUsd)}</strong></span><span><small>Immediate cost</small><strong>{usd(quote.immediateCostMicroUsd)}</strong></span><span><small>Impact</small><strong>{priceImpact(quote.priceImpactBps)}</strong></span></div>
    </button>
  );
}

export default function FuturesPage({ auth }: { auth: FlayAuth }) {
  const [registry, setRegistry] = useState<FuturesMarketsResponse | null>(null);
  const [marketSymbol, setMarketSymbol] = useState('SOL-PERP');
  const [interval, setInterval] = useState<CandleInterval>('15m');
  const [candles, setCandles] = useState<Awaited<ReturnType<typeof loadCandles>> | null>(null);
  const [candleError, setCandleError] = useState<string | null>(null);
  const [candleLoading, setCandleLoading] = useState(false);
  const [side, setSide] = useState<'long' | 'short'>('long');
  const [orderType, setOrderType] = useState<'market' | 'limit'>('market');
  const [collateral, setCollateral] = useState('');
  const [leverage, setLeverage] = useState(2);
  const [limitPrice, setLimitPrice] = useState('');
  const [slippageBps] = useState(50);
  const [choice, setChoice] = useState<FuturesRouteChoice>('auto');
  const [quotes, setQuotes] = useState<FuturesQuotesResponse | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoteRefreshNonce, setQuoteRefreshNonce] = useState(0);
  const quoteBackoffRef = useRef(3_000);
  const [marketPulse, setMarketPulse] = useState(0);
  const [portfolioPulse, setPortfolioPulse] = useState(0);
  const [portfolio, setPortfolio] = useState<FuturesPortfolio | null>(null);
  const [portfolioError, setPortfolioError] = useState<string | null>(null);
  const [phoenixAccess, setPhoenixAccess] = useState<PhoenixAccess | null>(null);
  const [phoenixConnected, setPhoenixConnected] = useState(false);
  const [bottomTab, setBottomTab] = useState<'positions' | 'orders' | 'history'>('positions');
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [prepared, setPrepared] = useState<FuturesPreparedStep | null>(null);
  const [execution, setExecution] = useState<FuturesExecution | null>(null);
  const [localSignatures, setLocalSignatures] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [managedPosition, setManagedPosition] = useState<FuturesPosition | null>(null);
  const [positionAction, setPositionAction] = useState<PositionAction>('close');
  const [positionSize, setPositionSize] = useState('');
  const [triggerPrice, setTriggerPrice] = useState('');
  const [executionPrice, setExecutionPrice] = useState('');
  const [collateralAction, setCollateralAction] = useState<'deposit' | 'withdraw'>('deposit');
  const [collateralAmount, setCollateralAmount] = useState('');
  const quoteSequence = useRef(0);
  const market = registry?.markets.find((item) => item.symbol === marketSymbol) ?? registry?.markets[0] ?? null;
  const portfolioRefreshDelay = futuresPortfolioRefreshDelay(portfolio);

  useEffect(() => {
    if (dialog === 'review' || busy) return;
    const timer = window.setTimeout(() => setMarketPulse((value) => value + 1), 20_000);
    return () => window.clearTimeout(timer);
  }, [busy, dialog, marketPulse]);

  useEffect(() => {
    if (!auth.authenticated || dialog === 'review' || busy) return;
    const timer = window.setTimeout(() => setPortfolioPulse((value) => value + 1), portfolioRefreshDelay);
    return () => window.clearTimeout(timer);
  }, [auth.authenticated, busy, dialog, portfolioPulse, portfolioRefreshDelay]);

  useEffect(() => {
    if (!auth.walletAddress) { setLocalSignatures([]); return; }
    const key = `flay:futures:${auth.walletAddress}`;
    try {
      const signatures = parseSubmittedSignatures(JSON.parse(localStorage.getItem(key) ?? '[]'));
      setLocalSignatures(signatures);
      localStorage.setItem(key, JSON.stringify(signatures));
    } catch {
      localStorage.removeItem(key);
      setLocalSignatures([]);
    }
  }, [auth.walletAddress]);

  useEffect(() => {
    setPhoenixConnected(false);
  }, [auth.walletAddress]);

  useEffect(() => {
    let active = true;
    void api<FuturesMarketsResponse>('/futures/markets').then((value) => {
      if (!active) return;
      setRegistry(value);
      if (!value.markets.some((item) => item.symbol === marketSymbol) && value.markets[0]) setMarketSymbol(value.markets[0].symbol);
    }).catch((error) => { if (active) setQuoteError(readableError(error)); });
    return () => { active = false; };
  }, [marketPulse, marketSymbol, refreshNonce]);

  useEffect(() => {
    let active = true;
    setCandleLoading(true); setCandleError(null);
    void loadCandles(marketSymbol, interval).then((value) => { if (active) setCandles(value); }).catch((error) => { if (active) { setCandles(null); setCandleError(readableError(error)); } }).finally(() => { if (active) setCandleLoading(false); });
    return () => { active = false; };
  }, [interval, marketSymbol, refreshNonce]);

  useEffect(() => {
    if (!auth.authenticated || !auth.walletAddress || !auth.identityToken) { setPortfolio(null); setPhoenixAccess(null); return; }
    let active = true;
    const identityToken = auth.identityToken;
    const wallet = auth.walletAddress;
    void Promise.all([
      api<FuturesPortfolio>(`/futures/portfolio?${query({ wallet })}`, { identityToken }),
      api<PhoenixAccess>(`/futures/phoenix/access?${query({ wallet })}`, { identityToken }),
    ]).then(([portfolioValue, access]) => {
      if (!active) return;
      setPortfolio(portfolioValue); setPhoenixAccess(access); setPortfolioError(null);
    }).catch((error) => { if (active) setPortfolioError(readableError(error)); });
    return () => { active = false; };
  }, [auth.authenticated, auth.identityToken, auth.walletAddress, portfolioPulse, refreshNonce]);

  useEffect(() => {
    const sequence = ++quoteSequence.current;
    if (!auth.authenticated || !auth.walletAddress || !auth.identityToken || !market) { setQuotes(null); setQuoteLoading(false); return; }
    let collateralAtomic: string;
    try {
      collateralAtomic = decimalToAtomic(collateral, 6);
      const minimumError = futuresMinimumCollateralMessage(collateralAtomic, portfolio?.walletUsdcAtomic);
      if (minimumError) { setQuotes(null); setQuoteError(minimumError); setQuoteLoading(false); return; }
    } catch { setQuotes(null); setQuoteLoading(false); return; }
    let limitPriceMicroUsd: string | undefined;
    if (orderType === 'limit') {
      try { limitPriceMicroUsd = decimalToAtomic(limitPrice, 6); if (BigInt(limitPriceMicroUsd) === 0n) throw new Error(); } catch { setQuotes(null); setQuoteLoading(false); return; }
    }
    if (dialog === 'review' || busy) { setQuoteLoading(false); return; }
    const controller = new AbortController();
    let refreshTimer = 0;
    const timer = window.setTimeout(() => {
      setQuoteLoading(true); setQuoteError(null);
      let nextDelay = quoteBackoffRef.current;
      void api<FuturesQuotesResponse>('/futures/quotes', {
        method: 'POST', identityToken: auth.identityToken!, signal: controller.signal,
        body: JSON.stringify({ wallet: auth.walletAddress!, market: market.symbol, side, orderType, collateralAtomic, leverageBps: leverage * 10_000, ...(limitPriceMicroUsd ? { limitPriceMicroUsd } : {}), slippageBps, routeChoice: choice }),
      }).then((value) => {
        if (sequence !== quoteSequence.current) return;
        setQuotes(value); quoteBackoffRef.current = 6_000; nextDelay = 6_000;
      }).catch((error) => {
        if (controller.signal.aborted || sequence !== quoteSequence.current) return;
        setQuoteError(readableError(error));
        nextDelay = futuresQuoteRetryDelay(error, quoteBackoffRef.current);
        quoteBackoffRef.current = nextDelay;
      }).finally(() => {
        if (sequence !== quoteSequence.current) return;
        setQuoteLoading(false);
        refreshTimer = window.setTimeout(() => setQuoteRefreshNonce((value) => value + 1), nextDelay);
      });
    }, quoteRefreshNonce === 0 ? 450 : 0);
    return () => { window.clearTimeout(timer); window.clearTimeout(refreshTimer); controller.abort(); };
  }, [auth.authenticated, auth.identityToken, auth.walletAddress, busy, choice, collateral, dialog, leverage, limitPrice, market, orderType, portfolio?.walletUsdcAtomic, quoteRefreshNonce, refreshNonce, side, slippageBps]);

  useEffect(() => {
    if (!execution || execution.status !== 'submitted' || !auth.walletAddress || !auth.identityToken) return;
    let active = true;
    let attempts = 0;
    const poll = async () => {
      attempts += 1;
      try {
        const next = await api<FuturesExecution>(`/futures/execution/${execution.executionId}?${query({ wallet: auth.walletAddress! })}`, { identityToken: auth.identityToken });
        if (!active) return;
        setExecution(next); rememberSignature(next);
        if (next.status !== 'submitted') { setRefreshNonce((value) => value + 1); return; }
      } catch (error) {
        if (active) setActionError(readableError(error));
      }
      if (active && attempts < 25) window.setTimeout(() => void poll(), 1_200);
    };
    const timer = window.setTimeout(() => void poll(), 900);
    return () => { active = false; window.clearTimeout(timer); };
  }, [auth.identityToken, auth.walletAddress, execution?.executionId, execution?.status]);

  const selected = useMemo(() => {
    if (!quotes) return null;
    const venue = choice === 'auto' ? quotes.recommendedVenue : choice;
    return quotes.quotes.find((quote) => quote.venue === venue) ?? null;
  }, [choice, quotes]);
  const entryPrimaryAction = futuresEntryPrimaryAction(auth.authenticated, selected);
  const allPositions = portfolio ? [...portfolio.venues.phoenix.positions, ...portfolio.venues.gmtrade.positions] : [];
  const allOrders = portfolio ? [...portfolio.venues.phoenix.orders, ...portfolio.venues.gmtrade.orders] : [];
  const allOrphaned = portfolio ? [...portfolio.venues.phoenix.orphanedConditionals, ...portfolio.venues.gmtrade.orphanedConditionals] : [];
  const venueHistory = portfolio ? [...portfolio.venues.phoenix.history, ...portfolio.venues.gmtrade.history] : [];
  const providerSignatures = new Set(venueHistory.flatMap((item) => item.signature ? [item.signature] : []));
  const continuitySignatures = localSignatures.filter((signature) => !providerSignatures.has(signature));
  const allHistory = [...venueHistory].sort((a, b) => b.occurredAt - a.occurredAt);
  const historyCount = allHistory.length + continuitySignatures.length;
  const phoenixReadiness = phoenixReadinessDisplay(phoenixAccess, registry?.venueReadiness.phoenix);

  function rememberSignature(next: FuturesExecution) {
    if (!auth.walletAddress || !SOLANA_SIGNATURE_PATTERN.test(next.signature)) return;
    setLocalSignatures((current) => {
      const value = [next.signature, ...current.filter((signature) => signature !== next.signature)].slice(0, 20);
      localStorage.setItem(`flay:futures:${auth.walletAddress}`, JSON.stringify(value));
      return value;
    });
  }

  function requireWallet(): boolean {
    setActionError(null);
    if (!auth.configured || !auth.authenticated) { auth.login(); return false; }
    if (!auth.ready || !auth.walletReady || !auth.walletAddress || !auth.identityToken) {
      setActionError('Your embedded Solana wallet or identity token is still loading.');
      return false;
    }
    return true;
  }

  async function connectPhoenix() {
    if (!requireWallet()) return false;
    try {
      try {
        await api('/futures/phoenix/auth/login', {
          method: 'POST', identityToken: auth.identityToken!,
          body: JSON.stringify({ wallet: auth.walletAddress! }),
        });
      } catch (error) {
        if (!(error instanceof ApiClientError) || error.code !== 'PHOENIX_WALLET_PROOF_REQUIRED') throw error;
        const challenge = await api<{ challengeId: string; transaction: string }>('/futures/phoenix/auth/challenge', {
          method: 'POST', identityToken: auth.identityToken!,
          body: JSON.stringify({ wallet: auth.walletAddress! }),
        });
        const signed = await auth.signTransaction(fromBase64(challenge.transaction));
        await api('/futures/phoenix/auth/login', {
          method: 'POST', identityToken: auth.identityToken!,
          body: JSON.stringify({ wallet: auth.walletAddress!, challengeId: challenge.challengeId, signedTransaction: toBase64(signed) }),
        });
      }
      setPhoenixConnected(true);
      return true;
    } catch (error) {
      setActionError(readableError(error));
      return false;
    }
  }

  async function prepareAction(input: Omit<FuturesPrepareRequest, 'wallet' | 'idempotencyKey'>) {
    if (!requireWallet()) return;
    setBusy(true); setActionError(null);
    try {
      const requiresPhoenixSession = input.venue === 'phoenix' && input.action !== 'activate' && input.action !== 'register';
      if (requiresPhoenixSession && !phoenixConnected && !await connectPhoenix()) return;
      const value = await api<FuturesPreparedStep>('/futures/prepare', {
        method: 'POST', identityToken: auth.identityToken!,
        body: JSON.stringify({ ...input, wallet: auth.walletAddress!, idempotencyKey: crypto.randomUUID() }),
      });
      setPrepared(value); setExecution(null); setDialog('review');
    } catch (error) {
      setActionError(readableError(error));
    } finally {
      setBusy(false);
    }
  }

  function reviewEntry() {
    if (!auth.authenticated) { auth.login(); return; }
    if (!selected?.executionEligible) return;
    void prepareAction({ action: 'open', venue: selected.venue, quoteId: selected.id, market: selected.market });
  }


  function primaryEntryAction() {
    if (!auth.authenticated) { auth.login(); return; }
    if (entryPrimaryAction === 'phoenix-access') {
      setActionError(null);
      setDialog('phoenix-access');
      return;
    }
    if (entryPrimaryAction === 'phoenix-deposit') {
      setCollateralAction('deposit');
      setCollateralAmount('');
      setActionError(null);
      setDialog('collateral');
      return;
    }
    reviewEntry();
  }

  async function signAndExecute() {
    if (!prepared || !requireWallet()) return;
    setBusy(true); setActionError(null);
    try {
      const signed = await auth.signTransaction(fromBase64(prepared.transaction));
      const result = await api<FuturesExecution>('/futures/execute', {
        method: 'POST', identityToken: auth.identityToken!,
        body: JSON.stringify({ preparedId: prepared.preparedId, wallet: auth.walletAddress!, signedTransaction: toBase64(signed), idempotencyKey: crypto.randomUUID() }),
      });
      setExecution(result); rememberSignature(result); setPrepared(null); setDialog('success');
    } catch (error) {
      setActionError(readableError(error));
    } finally {
      setBusy(false);
    }
  }

  async function activatePhoenix() {
    if (!requireWallet()) return;
    await prepareAction({ action: 'activate', venue: 'phoenix' });
  }

  function openPosition(position: FuturesPosition) {
    setManagedPosition(position); setPositionAction('close');
    setPositionSize(atomicToDecimal(position.sizeAtomic, position.baseDecimals));
    setTriggerPrice(''); setExecutionPrice(''); setActionError(null); setDialog('position');
  }

  function submitPositionAction() {
    if (!managedPosition) return;
    let sizeAtomic: string | undefined;
    if (positionAction === 'reduce') {
      try { sizeAtomic = decimalToAtomic(positionSize, managedPosition.baseDecimals); } catch (error) { setActionError(readableError(error)); return; }
    }
    let triggerPriceMicroUsd: string | undefined;
    let executionPriceMicroUsd: string | undefined;
    if (positionAction === 'take-profit' || positionAction === 'stop-loss') {
      try {
        triggerPriceMicroUsd = decimalToAtomic(triggerPrice, 6);
        executionPriceMicroUsd = executionPrice
          ? decimalToAtomic(executionPrice, 6)
          : defaultConditionalExecutionPriceMicroUsd(triggerPriceMicroUsd, managedPosition.side);
      } catch (error) { setActionError(readableError(error)); return; }
    }
    void prepareAction({
      action: positionAction, venue: managedPosition.venue, nativeId: managedPosition.nativeId,
      market: managedPosition.market,
      ...(sizeAtomic ? { sizeAtomic } : positionAction === 'take-profit' || positionAction === 'stop-loss'
        ? { sizeAtomic: managedPosition.sizeAtomic } : {}),
      ...(triggerPriceMicroUsd ? { triggerPriceMicroUsd, executionPriceMicroUsd } : {}),
    });
  }

  function submitCollateral() {
    try {
      const amountAtomic = decimalToAtomic(collateralAmount, 6);
      void prepareAction({ action: collateralAction, venue: 'phoenix', amountAtomic });
    } catch (error) { setActionError(readableError(error)); }
  }

  return (
    <main className="futures-page">
      <section className="futures-market-head">
        <div className="futures-market-select">
          <span className="market-coin">{market?.baseSymbol.slice(0, 1) ?? '—'}</span>
          <div><span>PERPETUAL FUTURES</span><select value={marketSymbol} onChange={(event) => setMarketSymbol(event.target.value)} aria-label="Futures market">{registry?.markets.length ? registry.markets.map((item) => <option key={item.symbol}>{item.symbol}</option>) : <option>{marketSymbol}</option>}</select></div><ChevronDown size={16} />
        </div>
        <div className="market-stat"><span>Reference</span><strong>{usd(market?.venues.phoenix?.markPriceMicroUsd)}</strong></div>
        <div className="market-stat"><span>Launch universe</span><strong>{registry ? `${registry.markets.length} available markets` : 'Loading'}</strong></div>
        <div className="market-stat"><span>Margin</span><strong>Isolated · max 10×</strong></div>
        <button className="futures-refresh" onClick={() => setRefreshNonce((value) => value + 1)}><RefreshCw size={15} /> Refresh</button>
      </section>

      {registry && !registry.markets.length && <div className="futures-provider-banner"><AlertCircle size={16} /><span><strong>Futures entry is paused</strong> Neither Phoenix nor GMTrade currently exposes a verified launch market. Existing recovery actions remain available below.</span></div>}

      <div className="futures-layout">
        <section className="futures-chart-card">
          <div className="futures-chart-head"><div><span className="section-kicker">STABLE REFERENCE</span><h2>{marketSymbol} <small>· USD</small></h2></div><div className="chart-intervals">{INTERVALS.map((item) => <button key={item} className={interval === item ? 'active' : ''} onClick={() => setInterval(item)}>{item}</button>)}</div></div>
          <ReferenceChart data={candles} loading={candleLoading} error={candleError} />
          <div className="chart-source"><span><BarChart3 size={14} /> {candles?.source ?? 'Phoenix external reference'}</span><span>{candles?.latestCandleAt ? `Latest candle ${new Date(candles.latestCandleAt).toLocaleString()}` : 'Freshness unavailable'}</span><a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">Charts by TradingView <ExternalLink size={12} /></a></div>
          <div className="venue-marks"><VenueMark venue="phoenix" market={market} /><VenueMark venue="gmtrade" market={market} /></div>
        </section>

        <section className="futures-ticket">
          <div className="ticket-head"><div><span className="section-kicker">NEW POSITION</span><h2>Build your trade</h2></div><span className="isolated-pill"><LockKeyhole size={13} /> Isolated</span></div>
          <div className="direction-tabs"><button className={side === 'long' ? 'long active' : ''} onClick={() => setSide('long')}><ArrowUpRight size={16} /> Long</button><button className={side === 'short' ? 'short active' : ''} onClick={() => setSide('short')}><ArrowDownRight size={16} /> Short</button></div>
          <div className="order-tabs"><button className={orderType === 'market' ? 'active' : ''} onClick={() => setOrderType('market')}>Market</button><button className={orderType === 'limit' ? 'active' : ''} onClick={() => setOrderType('limit')}>Limit</button></div>
          <label className="futures-field"><span>Collateral <small>Wallet: {usdc(portfolio?.walletUsdcAtomic)}</small></span><div><input value={collateral} onChange={(event) => setCollateral(event.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" placeholder="0.00" /><strong>USDC</strong></div></label>
          {orderType === 'limit' && <label className="futures-field"><span>Limit price <small>USD per {market?.baseSymbol}</small></span><div><input value={limitPrice} onChange={(event) => setLimitPrice(event.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" placeholder="0.00" /><strong>USD</strong></div></label>}
          <div className="leverage-field"><span><label htmlFor="futures-leverage">Leverage</label><strong>{leverage}×</strong></span><input id="futures-leverage" type="range" min="1" max="10" step="1" value={leverage} onChange={(event) => setLeverage(Number(event.target.value))} /><div><span>1×</span><span>5×</span><span>10×</span></div></div>
          <div className="ticket-summary"><div><span>Position notional</span><strong>{collateral && Number.isFinite(Number(collateral)) ? usd(String(Math.round(Number(collateral) * leverage * 1_000_000))) : '—'}</strong></div><div><span>Estimated liquidation</span><strong>{usd(selected?.liquidationPriceMicroUsd)}</strong></div><div><span>Acceptable price</span><strong>{usd(selected?.acceptablePriceMicroUsd)}</strong></div><div><span>Slippage bound</span><strong>{slippageBps / 100}%</strong></div></div>
          <div className="route-choice-head"><span><SlidersHorizontal size={14} /> Route <small>{quotes?.recommendationLabel ?? 'Awaiting quote'}</small></span><div>{(['auto', 'phoenix', 'gmtrade'] as const).map((item) => <button key={item} className={choice === item ? 'active' : ''} onClick={() => setChoice(item)}>{item === 'auto' ? 'Auto' : item === 'phoenix' ? 'Phoenix' : 'GMTrade'}</button>)}</div></div>
          <div className="route-cards">{quoteLoading && !quotes ? <div className="route-loading"><LoaderCircle className="spin" size={17} /> Comparing exact venue costs</div> : quotes?.quotes.map((quote) => <RouteCard key={quote.id} quote={quote} selected={selected?.id === quote.id} recommended={quotes.recommendedVenue === quote.venue} recommendationLabel={quotes.recommendationLabel} onSelect={() => setChoice(quote.venue)} />)}</div>
          {selected && !selected.executionEligible && selected.venue === 'gmtrade' && <div className="futures-inline-error"><AlertCircle size={14} />{selected.exclusionReason}</div>}
          {selected?.setupSteps.length ? <div className="futures-setup-note"><ShieldCheck size={14} /><span><strong>Setup before entry</strong>{selected.setupSteps.map((step) => step === 'activate' ? 'Onboard Phoenix wallet' : step === 'register' ? 'Complete Phoenix onboarding' : 'Deposit Phoenix collateral').join(' · ')}</span></div> : null}
          {quoteError && <div className="futures-inline-error"><AlertCircle size={14} />{quoteError}</div>}
          {selected && <div className="selected-costs"><div><span>Opening fee</span><strong>{usd(selected.openingFeeMicroUsd)}</strong></div><div><span>Execution fee</span><strong>{lamports(selected.executionFeeLamports)}</strong></div><div><span>Funding / hour</span><strong>{hourlyRate(selected.fundingRateBpsHourly)}</strong></div><div><span>Borrowing / hour</span><strong>{hourlyRate(selected.borrowingRateBpsHourly)}</strong></div><div><span>Flay fee</span><strong>0%</strong></div></div>}
          <button className={`futures-review-button ${side}`} disabled={busy || (auth.authenticated && entryPrimaryAction === 'unavailable')} onClick={primaryEntryAction}>{busy ? <><LoaderCircle className="spin" size={17} /> Building exact action</> : !auth.authenticated ? <><Wallet size={17} /> Sign in to trade</> : entryPrimaryAction === 'phoenix-access' ? <>Set up Phoenix <ArrowRight size={17} /></> : entryPrimaryAction === 'phoenix-deposit' ? <>Deposit Phoenix collateral <ArrowRight size={17} /></> : selected?.executionEligible ? <>Review exact {side} <ArrowRight size={17} /></> : <>No executable route</>}</button>
          <p className="futures-risk"><ShieldCheck size={14} /> Your Privy wallet signs every setup and trade transaction. Futures activity remains public on Solana.</p>
        </section>
      </div>

      <section className="futures-portfolio-card">
        <div className="portfolio-tabs"><div>{(['positions', 'orders', 'history'] as const).map((tab) => <button key={tab} className={bottomTab === tab ? 'active' : ''} onClick={() => setBottomTab(tab)}>{tab[0].toUpperCase() + tab.slice(1)} <span>{tab === 'positions' ? allPositions.length : tab === 'orders' ? allOrders.length : historyCount}</span></button>)}</div><div className="collateral-ledger"><span title="The same embedded Solana wallet pays both venues' network fees and account rent.">Wallet {usdc(portfolio?.walletUsdcAtomic)} · {walletSol(portfolio?.walletSolLamports)}</span><button onClick={() => { setCollateralAmount(''); setActionError(null); setDialog('collateral'); }}>Phoenix {usdc(portfolio?.venues.phoenix.collateralAtomic)} · Manage</button><span title="GMTrade uses wallet USDC directly for entry; this is collateral committed to open positions and orders.">GMTrade open margin {usdc(portfolio?.venues.gmtrade.collateralAtomic)}</span></div></div>
        {portfolioError && <div className="futures-inline-error"><AlertCircle size={14} />{portfolioError}</div>}
        {portfolio?.walletBalancesError && <div className="futures-inline-error provider"><AlertCircle size={14} /><span><strong>Wallet balances are {portfolio.walletBalancesStale ? 'cached' : 'unavailable'}.</strong> {portfolio.walletBalancesError}</span></div>}
        {portfolio && (['phoenix', 'gmtrade'] as const).map((venue) => portfolio.venues[venue].error ? <VenueError key={venue} venue={venue} available={portfolio.venues[venue].available} error={portfolio.venues[venue].error} onRetry={() => setPortfolioPulse((value) => value + 1)} /> : null)}
        {actionError && !dialog && <div className="futures-inline-error"><AlertCircle size={14} />{actionError}</div>}
        {allOrphaned.length > 0 && <div className="futures-orphaned"><AlertCircle size={16} /><div><strong>Orphaned protection orders</strong><span>These orders no longer protect a full live position. Review and cancel them on their original venue.</span>{allOrphaned.map((item) => <button key={`${item.venue}:${item.nativeId}`} disabled={busy} onClick={() => void prepareAction({ action: 'cancel-conditional', venue: item.venue, nativeId: item.nativeId, market: item.market })}>{item.venue} · {item.kind} · Cancel</button>)}</div></div>}
        {!auth.authenticated ? <div className="portfolio-empty"><Wallet size={24} /><strong>Sign in to load venue positions</strong><span>Flay binds portfolio requests to your embedded Solana wallet.</span><button onClick={auth.login}>Sign in</button></div> : bottomTab === 'positions' && !allPositions.length ? <EmptyPortfolio icon={<CircleDollarSign size={23} />} title="No open positions" text="Live Phoenix and GMTrade positions appear only after their original venue confirms them." /> : bottomTab === 'orders' && !allOrders.length ? <EmptyPortfolio icon={<Clock3 size={23} />} title="No resting orders" text="Limit orders remain attributed to their original venue." /> : bottomTab === 'history' && historyCount === 0 ? <EmptyPortfolio icon={<BarChart3 size={23} />} title="No futures history" text="Confirmed venue activity appears here without fabricated status." /> : <div className="portfolio-table">{bottomTab === 'positions' ? allPositions.map((position) => <PositionRow key={`${position.venue}:${position.nativeId}`} position={position} onManage={() => openPosition(position)} />) : bottomTab === 'orders' ? allOrders.map((order) => <OrderRow key={`${order.venue}:${order.nativeId}`} order={order} busy={busy} onCancel={() => void prepareAction({ action: 'cancel', venue: order.venue, nativeId: order.nativeId, market: order.market })} />) : <>{allHistory.map((item) => <HistoryRow key={`${item.venue}:${item.nativeId}:${item.occurredAt}`} item={item} />)}{continuitySignatures.map((signature) => <ContinuityRow key={signature} signature={signature} />)}</>}</div>}
        <div className="venue-readiness"><span className={phoenixReadiness.ready ? 'ready' : ''}><i /> Phoenix: {phoenixReadiness.detail}</span><span className={registry?.venueReadiness.gmtrade.status === 'ready' ? 'ready' : ''}><i /> GMTrade: {registry?.venueReadiness.gmtrade.detail ?? 'Checking'}</span>{phoenixAccess && !phoenixAccess.executionEligible && <button onClick={() => { setActionError(null); setDialog('phoenix-access'); }}>Set up Phoenix</button>}</div>
      </section>

      {dialog === 'review' && prepared && <ReviewDialog prepared={prepared} busy={busy} error={actionError} onClose={() => setDialog(null)} onConfirm={() => void signAndExecute()} />}
      {dialog === 'success' && execution && <ExecutionDialog execution={execution} error={actionError} onClose={() => { setDialog(null); setRefreshNonce((value) => value + 1); }} />}
      {dialog === 'collateral' && <Modal title="Phoenix collateral" subtitle="Wallet USDC and Phoenix collateral are separate balances." onClose={() => setDialog(null)}>
        <div className="futures-dialog-tabs"><button className={collateralAction === 'deposit' ? 'active' : ''} onClick={() => setCollateralAction('deposit')}>Deposit</button><button className={collateralAction === 'withdraw' ? 'active' : ''} onClick={() => setCollateralAction('withdraw')}>Withdraw</button></div>
        <div className="futures-balance-pair"><span>Wallet<strong>{usdc(portfolio?.walletUsdcAtomic)}</strong></span><span>Phoenix withdrawable<strong>{usdc(portfolio?.venues.phoenix.withdrawableAtomic)}</strong></span></div>
        <label className="futures-dialog-field"><span>Amount</span><div><input value={collateralAmount} onChange={(event) => setCollateralAmount(event.target.value.replace(/[^0-9.]/g, ''))} placeholder="0.00" inputMode="decimal" /><b>USDC</b></div></label>
        {actionError && <div className="futures-inline-error"><AlertCircle size={14} />{actionError}</div>}
        <button className="modal-primary" disabled={busy || Number(collateralAmount) <= 0} onClick={submitCollateral}>{busy ? <LoaderCircle className="spin" size={16} /> : null} Review {collateralAction}</button>
        <p className="futures-dialog-note">Withdrawal is disabled above the venue-reported safe amount and Phoenix checks cooldown and margin again onchain.</p>
      </Modal>}
      {dialog === 'position' && managedPosition && <Modal title={`Manage ${managedPosition.market}`} subtitle={`${managedPosition.venue} · ${managedPosition.side} · original venue locked`} onClose={() => setDialog(null)}>
        <div className="futures-dialog-tabs">{(['close', 'reduce', 'take-profit', 'stop-loss'] as const).map((action) => <button key={action} className={positionAction === action ? 'active' : ''} onClick={() => setPositionAction(action)}>{action === 'take-profit' ? 'TP' : action === 'stop-loss' ? 'SL' : action[0].toUpperCase() + action.slice(1)}</button>)}</div>
        <div className="futures-balance-pair"><span>Live size<strong>{atomicToDecimal(managedPosition.sizeAtomic, managedPosition.baseDecimals)}</strong></span><span>Liquidation<strong>{usd(managedPosition.liquidationPriceMicroUsd)}</strong></span></div>
        {positionAction === 'reduce' && <label className="futures-dialog-field"><span>Reduce size</span><div><input value={positionSize} onChange={(event) => setPositionSize(event.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" /><b>{managedPosition.market.replace('-PERP', '')}</b></div></label>}
        {(positionAction === 'take-profit' || positionAction === 'stop-loss') && <><label className="futures-dialog-field"><span>Trigger price</span><div><input value={triggerPrice} onChange={(event) => setTriggerPrice(event.target.value.replace(/[^0-9.]/g, ''))} placeholder="0.00" inputMode="decimal" /><b>USD</b></div></label><label className="futures-dialog-field"><span>Execution limit <small>0.5% bound if blank</small></span><div><input value={executionPrice} onChange={(event) => setExecutionPrice(event.target.value.replace(/[^0-9.]/g, ''))} placeholder="Auto" inputMode="decimal" /><b>USD</b></div></label></>}
        {managedPosition.conditionals.length > 0 && <div className="futures-conditionals">{managedPosition.conditionals.map((item) => <div key={item.nativeId}><span><strong>{item.kind === 'take-profit' ? 'Take profit' : 'Stop loss'}</strong><small>{usd(item.triggerPriceMicroUsd)} · {item.status}{item.orphaned ? ' · orphaned' : ''}</small></span><button disabled={busy} onClick={() => void prepareAction({ action: 'cancel-conditional', venue: item.venue, nativeId: item.nativeId, market: managedPosition.market })}>Cancel</button></div>)}</div>}
        {actionError && <div className="futures-inline-error"><AlertCircle size={14} />{actionError}</div>}
        <button className="modal-primary" disabled={busy || ((positionAction === 'take-profit' || positionAction === 'stop-loss') && Number(triggerPrice) <= 0)} onClick={submitPositionAction}>{busy ? <LoaderCircle className="spin" size={16} /> : null} Review {positionAction.replace('-', ' ')}</button>
      </Modal>}
      {dialog === 'phoenix-access' && <Modal title="Set up Phoenix" subtitle="Phoenix public onboarding creates your trader account and trading permission in one reviewed Solana transaction." onClose={() => setDialog(null)}>
        <div className="phoenix-access-state"><span className="venue-glyph phoenix">P</span><span><strong>{phoenixAccess?.message ?? 'Checking onboarding'}</strong><small>{auth.walletAddress ? short(auth.walletAddress) : 'Sign in first'}</small></span></div>
        {!phoenixAccess?.activated && <button className="modal-primary" disabled={busy} onClick={() => void activatePhoenix()}>{busy ? <LoaderCircle className="spin" size={16} /> : null} Review public onboarding</button>}
        {actionError && <div className="futures-inline-error"><AlertCircle size={14} />{actionError}</div>}
        <p className="futures-dialog-note">Your wallet pays Solana network fees and any trader-account rent. Flay validates the exact wallet, trader PDA, programs, signer, and instructions before asking you to sign.</p>
        <a className="futures-doc-link" href={phoenixAccess?.onboardingUrl ?? 'https://docs.phoenix.trade/sdk/register'} target="_blank" rel="noreferrer">Phoenix onboarding documentation <ExternalLink size={13} /></a>
      </Modal>}
    </main>
  );
}

export function PositionRow({ position, onManage }: { position: FuturesPosition; onManage(): void }) {
  const base = position.market.replace('-PERP', '');
  return <div className="portfolio-row portfolio-position-row"><strong className="portfolio-market" data-label="Market">{position.market}</strong><span className={position.side} data-label="Side">{position.side}</span><span data-label="Venue">{position.venue}</span><span data-label="Size">{`${atomicToDecimal(position.sizeAtomic, position.baseDecimals)} ${base}`}</span><span data-label="Entry">{usd(position.entryPriceMicroUsd)}</span><span data-label="Unrealized PnL">{usd(position.unrealizedPnlMicroUsd)}</span><button onClick={onManage}>Manage position</button></div>;
}

export function VenueError({ venue, available, error, onRetry }: { venue: FuturesVenue; available: boolean; error: string; onRetry(): void }) {
  const label = venue === 'phoenix' ? 'Phoenix' : 'GMTrade';
  return <div className="futures-inline-error provider"><AlertCircle size={14} /><span><strong>{`${label} data is degraded.`}</strong> {available ? 'Live positions and recovery controls remain available. ' : 'Cached positions and recovery controls remain visible. '}{error}</span><button type="button" onClick={onRetry}>Retry now</button></div>;
}

function OrderRow({ order, busy, onCancel }: { order: FuturesOrder; busy: boolean; onCancel(): void }) {
  const base = order.market.replace('-PERP', '');
  return <div className="portfolio-row portfolio-order-row"><strong className="portfolio-market" data-label="Market">{order.market}</strong><span className={order.side} data-label="Side">{order.side}</span><span data-label="Venue">{order.venue}</span><span data-label="Remaining">{`${atomicToDecimal(order.remainingSizeAtomic, order.baseDecimals)} ${base}`}</span><span data-label="Limit price">{usd(order.limitPriceMicroUsd)}</span><span data-label="Status">{order.status}</span><button disabled={busy} onClick={onCancel}>Cancel order</button></div>;
}

function HistoryRow({ item }: { item: FuturesHistoryItem }) {
  return <div className="portfolio-row portfolio-history-row"><strong className="portfolio-market" data-label="Market">{item.market}</strong><span data-label="Action">{item.kind}</span><span data-label="Venue">{item.venue}</span><span data-label="Size (atomic)">{item.sizeAtomic ?? '—'}</span><span data-label="Price">{usd(item.priceMicroUsd)}</span><span data-label="Status">{item.status}</span>{item.signature ? <a href={`https://explorer.solana.com/tx/${item.signature}?cluster=mainnet-beta`} target="_blank" rel="noreferrer">Explorer</a> : <span data-label="Transaction">—</span>}</div>;
}

function ContinuityRow({ signature }: { signature: string }) {
  return <div className="portfolio-row portfolio-history-row"><strong className="portfolio-market" data-label="Activity">Solana submission</strong><span data-label="State">Awaiting venue sync</span><span data-label="Venue">—</span><span data-label="Size">—</span><span data-label="Price">—</span><span data-label="Status">submitted</span><a href={`https://explorer.solana.com/tx/${signature}?cluster=mainnet-beta`} target="_blank" rel="noreferrer">Explorer</a></div>;
}

function Modal({ title, subtitle, onClose, children }: { title: string; subtitle: string; onClose(): void; children: ReactNode }) {
  const modalRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !modalRef.current) return;
      const focusable = Array.from(modalRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'));
      if (focusable.length === 0) {
        event.preventDefault();
        modalRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus();
    };
  }, [onClose]);
  return <div className="modal-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section ref={modalRef} className="modal futures-modal" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}><div className="modal-heading"><div><h2>{title}</h2><p>{subtitle}</p></div><button ref={closeRef} className="modal-close" onClick={onClose} aria-label="Close"><X size={17} /></button></div>{children}</section></div>;
}

function ReviewDialog({ prepared, busy, error, onClose, onConfirm }: { prepared: FuturesPreparedStep; busy: boolean; error: string | null; onClose(): void; onConfirm(): void }) {
  const review = prepared.review;
  return <Modal title={`Review ${actionLabel(prepared.action)}`} subtitle={`${prepared.venue === 'phoenix' ? 'Phoenix' : 'GMTrade'} · exact unsigned Solana message`} onClose={onClose}>
    <div className="futures-review-hero"><span className={`venue-glyph ${prepared.venue}`}>{prepared.venue === 'phoenix' ? 'P' : 'G'}</span><span><small>{review.market ?? 'Collateral action'}</small><strong>{review.side ? `${review.side.toUpperCase()} · ${review.orderType}` : actionLabel(prepared.action).toUpperCase()}</strong></span></div>
    <div className="futures-review-grid"><span>Collateral<strong>{review.collateralAtomic ? usdc(review.collateralAtomic) : '—'}</strong></span><span>Size<strong>{review.sizeAtomic ?? '—'}</strong></span><span>Bound price<strong>{usd(review.priceMicroUsd)}</strong></span><span>Execution fee<strong>{review.executionFeeLamports === null ? 'Not reported' : lamports(review.executionFeeLamports)}</strong></span><span>Solana network fee<strong>{review.networkFeeLamports === null ? 'Unavailable' : lamports(review.networkFeeLamports)}</strong></span><span>New-account rent<strong>{review.accountRentLamports === null ? 'Unavailable' : review.accountRentLamports === '0' ? 'None' : lamports(review.accountRentLamports)}</strong></span></div>
    {(review.triggerPriceMicroUsd || review.executionPriceMicroUsd) && <div className="futures-review-grid"><span>Trigger<strong>{usd(review.triggerPriceMicroUsd)}</strong></span><span>Execution bound<strong>{usd(review.executionPriceMicroUsd)}</strong></span></div>}
    <div className="futures-message-proof"><span>MESSAGE HASH</span><code>{review.market ? prepared.messageHash : short(prepared.messageHash)}</code><small>{review.programs.length} verified program{review.programs.length === 1 ? '' : 's'} · {review.lookupTables.length} lookup table{review.lookupTables.length === 1 ? '' : 's'}</small></div>
    <div className="futures-warning-list">{review.warnings.map((warning) => <p key={warning}><ShieldCheck size={13} />{warning}</p>)}</div>
    {error && <div className="futures-inline-error"><AlertCircle size={14} />{error}</div>}
    <button className="modal-primary" disabled={busy} onClick={onConfirm}>{busy ? <><LoaderCircle className="spin" size={16} /> Checking and submitting</> : <>Sign exact transaction <ArrowRight size={16} /></>}</button>
  </Modal>;
}

function ExecutionDialog({ execution, error, onClose }: { execution: FuturesExecution; error: string | null; onClose(): void }) {
  const pending = execution.status === 'submitted';
  return <Modal title={pending ? 'Transaction submitted' : `Venue state: ${execution.status}`} subtitle={`${execution.venue} · ${actionLabel(execution.action)}`} onClose={onClose}>
    <div className={`futures-execution-state ${execution.status}`}><span>{pending ? <LoaderCircle className="spin" size={24} /> : execution.status === 'failed' ? <AlertCircle size={24} /> : <Check size={24} />}</span><strong>{execution.status.toUpperCase()}</strong><p>{execution.detail}</p></div>
    <a className="modal-secondary link-button" href={execution.explorerUrl} target="_blank" rel="noreferrer">Open Solana Explorer <ExternalLink size={14} /></a>
    {error && <div className="futures-inline-error"><AlertCircle size={14} />{error}</div>}
    <button className="modal-primary" onClick={onClose}>{pending ? 'Continue in background' : 'Done'}</button>
  </Modal>;
}

function EmptyPortfolio({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return <div className="portfolio-empty">{icon}<strong>{title}</strong><span>{text}</span></div>;
}

function loadCandles(symbol: string, interval: CandleInterval) {
  return api<import('../../shared/futures').FuturesCandlesResponse>(`/futures/candles?${query({ symbol, interval })}`);
}
