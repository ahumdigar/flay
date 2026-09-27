import {
  Activity,
  AlertCircle,
  ArrowDown,
  ArrowDownUp,
  ArrowRight,
  Banknote,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  CandlestickChart,
  ChartNoAxesCombined,
  Compass,
  Copy,
  ExternalLink,
  Info,
  Layers3,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Wallet,
  X,
} from 'lucide-react';
import bs58 from 'bs58';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { atomicToDecimal, decimalToAtomic } from '../shared/amounts';
import { CORE_TOKEN_MINTS, SOL_MINT } from '../shared/constants';
import { scaledAtomicToDecimal } from '../shared/stock-amounts';
import type {
  ActivityRecord,
  ExecutionResult,
  GasPayment,
  MagicBlockAction,
  MagicBlockBalance,
  MagicBlockExecution,
  MagicBlockPreparedTransaction,
  MagicBlockStatus,
  MarketQuote,
  PreparedTransaction,
  QuoteProvider,
  QuoteResponse,
  StockTradeContext,
  TokenInfo,
  TriggerOrder,
  TriggerOrdersResponse,
  WalletBalances,
} from '../shared/types';
import type { FlayAuth } from './auth';
import { ApiClientError, api, fromBase64, query, readableError, toBase64 } from './lib/api';
import { marketPrepareCandidates, prepareMarketCandidates } from './market-prepare';
import { isCurrentQuoteResponse } from './quote-state';
import FuturesPage from './futures/FuturesPage';
import FundsPage from './fiat/FundsPage';
import StocksPage from './stocks/StocksPage';

type Modal = 'wallet' | 'magicblock' | 'magic-review' | 'magic-success' | 'settings' | 'token' | 'review' | 'success' | 'setup' | null;
type Side = 'from' | 'to';
type OrderType = 'market' | 'limit';
type View = 'convert' | 'stocks' | 'futures' | 'funds' | 'activity';
type RouteChoice = QuoteProvider | 'auto';
export type MagicUnlockStage = 'idle' | 'requesting-challenge' | 'signing-wallet' | 'verifying-signature' | 'loading-balance';

interface HealthResponse {
  status: string;
  network: string;
  readiness: {
    privy: boolean;
    jupiterSwap: boolean;
    jupiterTrigger: boolean;
    rpc: boolean;
    raydium: boolean;
    orca: boolean;
    magicBlock: boolean;
    alchemyPay: boolean;
    xstocks: boolean;
  };
  alchemyPay?: import('../shared/types').AlchemyPayCapability;
  privyFiatOnramp?: {
    provider: 'Privy';
    environment: 'sandbox' | 'production';
    asset: 'USDC';
    network: 'SOL';
    supportedFiat: string[];
    dashboardActivation: 'required';
  };
  providers: {
    authentication: string;
    market: string[];
    limit: string;
    magicBlock: string;
    rpc: string;
    fiatOnRamp: string;
    stocks: string[];
  };
}

interface StoredActivity {
  signature: string;
  kind: 'Market' | 'Limit' | 'Stock';
  provider: string;
  gasPayment?: Pick<GasPayment, 'mode' | 'provider'>;
  createdAt: number;
  stock?: StockTradeContext;
}

const PROVIDER_META: Record<QuoteProvider, { letter: string; short: string }> = {
  jupiter: { letter: 'J', short: 'Jupiter' },
  raydium: { letter: 'R', short: 'Raydium' },
  orca: { letter: 'O', short: 'Orca' },
};

function withUiTimeout<T>(operation: Promise<T>, milliseconds: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error(message)), milliseconds);
    operation.then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand" aria-label="Flay">
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 40 40" fill="none">
          <path d="M10 28.8V10.5h20.2" stroke="currentColor" strokeWidth="5.2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M10.5 20.2h14.7" stroke="currentColor" strokeWidth="5.2" strokeLinecap="round" />
          <path d="m26.2 23.6 5.2-5.2" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" />
        </svg>
      </span>
      {!compact && <span className="brand-name">flay<span>.</span></span>}
    </div>
  );
}

function TokenAvatar({ token, small = false }: { token: TokenInfo; small?: boolean }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={`asset-avatar token-avatar ${small ? 'small' : ''}`} aria-hidden="true">
      {token.logoUri && !failed
        ? <img src={token.logoUri} alt="" onError={() => setFailed(true)} />
        : token.symbol.slice(0, 1).toUpperCase()}
    </span>
  );
}

function VenueAvatar({ provider }: { provider: QuoteProvider }) {
  const meta = PROVIDER_META[provider];
  return <span className={`venue-avatar ${provider}`} aria-hidden="true">{meta.letter}</span>;
}

function ModalShell({
  title,
  subtitle,
  children,
  onClose,
  className = '',
  overlayClassName = '',
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
  overlayClassName?: string;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const first = dialog?.querySelector<HTMLElement>('[data-initial-focus], button, input, select');
    (first ?? dialog)?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
      if (event.key !== 'Tab' || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) return;
      const firstFocusable = focusable[0];
      const lastFocusable = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === firstFocusable) {
        event.preventDefault();
        lastFocusable.focus();
      } else if (!event.shiftKey && document.activeElement === lastFocusable) {
        event.preventDefault();
        firstFocusable.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus();
    };
  }, []);

  return (
    <div className={`modal-overlay ${overlayClassName}`} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} tabIndex={-1} className={`modal ${className}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-heading">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-button modal-close" onClick={onClose} aria-label="Close dialog"><X size={18} /></button>
        </div>
        {children}
      </section>
    </div>
  );
}

function sanitizeDecimal(value: string): string {
  const filtered = value.replace(/[^0-9.]/g, '');
  const dot = filtered.indexOf('.');
  return dot < 0 ? filtered : `${filtered.slice(0, dot + 1)}${filtered.slice(dot + 1).replace(/\./g, '')}`;
}

function shortAddress(address: string, size = 5): string {
  return `${address.slice(0, size)}…${address.slice(-size)}`;
}

function formatAtomic(value: string | undefined | null, token: TokenInfo | undefined, maximum = 6): string {
  if (!value || !token) return '—';
  const number = Number(atomicToDecimal(value, token.decimals));
  if (!Number.isFinite(number)) return atomicToDecimal(value, token.decimals);
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: maximum }).format(number);
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);
}

function formatAge(timestamp: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  return seconds < 2 ? 'just now' : `${seconds}s ago`;
}

function activityStorageKey(wallet: string): string {
  return `flay:activity:v1:${wallet}`;
}

export function activityGasPaymentLabel(gasPayment?: Pick<GasPayment, 'mode' | 'provider'>): string {
  if (gasPayment?.mode === 'provider-sponsored') return `Gas sponsored by ${gasPayment.provider ?? 'provider'}`;
  if (gasPayment?.mode === 'user-paid') return 'Network gas paid by wallet';
  return 'Gas payment not recorded';
}

async function loadAllTriggerOrders(
  wallet: string,
  identityToken: string,
  orderStatus: 'active' | 'history',
): Promise<TriggerOrder[]> {
  const orders: TriggerOrder[] = [];
  for (let page = 1; page <= 25; page += 1) {
    const response = await api<TriggerOrdersResponse>(`/trigger/orders?${query({ wallet, orderStatus, page })}`, { identityToken });
    orders.push(...response.orders);
    if (!response.hasMoreData) return orders;
  }
  throw new Error(`Jupiter returned more than 25 pages of ${orderStatus} orders. Narrow the wallet history before retrying.`);
}

function App({ auth }: { auth: FlayAuth }) {
  const [view, setView] = useState<View>('convert');
  const [orderType, setOrderType] = useState<OrderType>('market');
  const [modal, setModal] = useState<Modal>(null);
  const [pickerSide, setPickerSide] = useState<Side>('from');
  const [catalog, setCatalog] = useState<Record<string, TokenInfo>>({});
  const [fromMint, setFromMint] = useState<string>(CORE_TOKEN_MINTS[0]);
  const [toMint, setToMint] = useState<string>(CORE_TOKEN_MINTS[1]);
  const [amount, setAmount] = useState('0.01');
  const [limitOutput, setLimitOutput] = useState('');
  const [expiryDays, setExpiryDays] = useState('7');
  const [slippageBps, setSlippageBps] = useState(50);
  const [routeChoice, setRouteChoice] = useState<RouteChoice>('auto');
  const [quoteResponse, setQuoteResponse] = useState<QuoteResponse | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteRefreshNonce, setQuoteRefreshNonce] = useState(0);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<PreparedTransaction | null>(null);
  const [sponsoredSubmission, setSponsoredSubmission] = useState<{ preparedId: string; signature: string } | null>(null);
  const [execution, setExecution] = useState<ExecutionResult | null>(null);
  const [executedStock, setExecutedStock] = useState<StockTradeContext | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [magicStatus, setMagicStatus] = useState<MagicBlockStatus | null>(null);
  const [magicBalance, setMagicBalance] = useState<MagicBlockBalance | null>(null);
  const [magicUnlocked, setMagicUnlocked] = useState(false);
  const [magicBusy, setMagicBusy] = useState(false);
  const [magicUnlockStage, setMagicUnlockStage] = useState<MagicUnlockStage>('idle');
  const [magicError, setMagicError] = useState<string | null>(null);
  const [magicPrepared, setMagicPrepared] = useState<MagicBlockPreparedTransaction | null>(null);
  const [magicExecution, setMagicExecution] = useState<MagicBlockExecution | null>(null);
  const [balances, setBalances] = useState<WalletBalances | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [balanceNonce, setBalanceNonce] = useState(0);
  const [ordersNonce, setOrdersNonce] = useState(0);
  const [activeOrders, setActiveOrders] = useState<TriggerOrder[]>([]);
  const [historyOrders, setHistoryOrders] = useState<TriggerOrder[]>([]);
  const [ordersWallet, setOrdersWallet] = useState<string | null>(null);
  const ordersRequestId = useRef(0);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [activityRows, setActivityRows] = useState<Array<{ stored: StoredActivity; onchain: ActivityRecord | null; error: string | null }>>([]);
  const [activityWallet, setActivityWallet] = useState<string | null>(null);
  const activityRequestId = useRef(0);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityFilter, setActivityFilter] = useState<'All' | 'Market' | 'Limit' | 'Stock'>('All');
  const [now, setNow] = useState(Date.now());
  const catalogRef = useRef(catalog);
  catalogRef.current = catalog;

  const fromToken = catalog[fromMint];
  const toToken = catalog[toMint];
  const coreTokens = useMemo(
    () => CORE_TOKEN_MINTS.flatMap((mint) => catalog[mint] ? [catalog[mint]] : []),
    [catalog],
  );
  const currentQuoteResponse = useMemo(() => (
    isCurrentQuoteResponse(quoteResponse, fromMint, toMint, amount, fromToken?.decimals, slippageBps, now)
      ? quoteResponse
      : null
  ), [amount, fromMint, fromToken?.decimals, now, quoteResponse, slippageBps, toMint]);
  const selectedQuote = useMemo(() => {
    if (!currentQuoteResponse?.quotes.length) return null;
    if (routeChoice === 'auto') {
      return currentQuoteResponse.quotes.find((quote) => quote.id === currentQuoteResponse.bestQuoteId) ?? currentQuoteResponse.quotes[0];
    }
    return currentQuoteResponse.quotes.find((quote) => quote.provider === routeChoice) ?? currentQuoteResponse.quotes[0];
  }, [currentQuoteResponse, routeChoice]);

  const registerTokens = useCallback((tokens: TokenInfo[]) => {
    setCatalog((current) => {
      let changed = false;
      const next = { ...current };
      tokens.forEach((token) => {
        if (JSON.stringify(current[token.mint]) !== JSON.stringify(token)) {
          next[token.mint] = token;
          changed = true;
        }
      });
      return changed ? next : current;
    });
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (orderType !== 'market' || modal !== null || actionBusy) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') setQuoteRefreshNonce((value) => value + 1);
    }, 6_000);
    return () => window.clearInterval(interval);
  }, [actionBusy, modal, orderType]);

  useEffect(() => {
    if (!modal) return;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, [modal]);

  useEffect(() => {
    let live = true;
    void Promise.all(CORE_TOKEN_MINTS.map((mint) => api<{ token: TokenInfo }>(`/tokens/${mint}`)))
      .then((responses) => {
        if (live) registerTokens(responses.map((response) => response.token));
      })
      .catch((error) => {
        if (live) setGlobalError(readableError(error));
      });
    void api<HealthResponse>('/health')
      .then((value) => { if (live) setHealth(value); })
      .catch((error) => { if (live) setGlobalError(readableError(error)); });
    void api<MagicBlockStatus>('/magicblock/status')
      .then((value) => { if (live) setMagicStatus(value); })
      .catch(() => {
        if (live) setMagicStatus(null);
      });
    return () => { live = false; };
  }, [registerTokens]);

  useEffect(() => {
    const show = () => setModal('setup');
    window.addEventListener('flay:show-setup', show);
    return () => window.removeEventListener('flay:show-setup', show);
  }, []);

  useEffect(() => {
    if (!fromToken || !toToken || orderType !== 'market') return;
    let atomic: string;
    try {
      atomic = decimalToAtomic(amount, fromToken.decimals);
      if (BigInt(atomic) === 0n) {
        setQuoteResponse(null);
        setQuoteError(null);
        setQuoteLoading(false);
        return;
      }
    } catch (error) {
      setQuoteResponse(null);
      setQuoteError(readableError(error));
      setQuoteLoading(false);
      return;
    }
    const controller = new AbortController();
    setQuoteLoading(true);
    setQuoteError(null);
    const timeout = window.setTimeout(() => {
      void api<QuoteResponse>(`/quotes?${query({
        inputMint: fromToken.mint,
        outputMint: toToken.mint,
        amount: atomic,
        slippageBps,
      })}`, { signal: controller.signal })
        .then((response) => {
          if (controller.signal.aborted) return;
          registerTokens([response.inputToken, response.outputToken]);
          setQuoteResponse(response);
          if (routeChoice !== 'auto' && !response.quotes.some((quote) => quote.provider === routeChoice)) {
            setRouteChoice('auto');
          }
        })
        .catch((error) => {
          if (!controller.signal.aborted) {
            setQuoteResponse(null);
            setQuoteError(readableError(error));
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setQuoteLoading(false);
        });
    }, 800);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [amount, fromMint, fromToken?.decimals, orderType, quoteRefreshNonce, registerTokens, slippageBps, toMint, toToken?.decimals]);

  useEffect(() => {
    ordersRequestId.current += 1;
    activityRequestId.current += 1;
    setActiveOrders([]);
    setHistoryOrders([]);
    setOrdersWallet(null);
    setActivityRows([]);
    setActivityWallet(null);
    setPrepared(null);
    setSponsoredSubmission(null);
    setExecution(null);
    setExecutedStock(null);
    setMagicBalance(null);
    setMagicUnlocked(false);
    setMagicPrepared(null);
    setMagicExecution(null);
    setMagicError(null);
    setModal((current) => ['review', 'success', 'magicblock', 'magic-review', 'magic-success'].includes(current ?? '') ? null : current);
  }, [auth.authenticated, auth.walletAddress]);

  useEffect(() => {
    if (!auth.authenticated || !auth.walletAddress || !auth.identityToken) {
      setBalances(null);
      setBalanceError(null);
      return;
    }
    let live = true;
    setBalanceError(null);
    void api<WalletBalances>(`/balances?${query({ wallet: auth.walletAddress })}`, {
      identityToken: auth.identityToken,
    }).then((response) => {
      if (live) {
        setBalances(response);
        registerTokens(response.balances.map((balance) => balance.token));
      }
    }).catch((error) => {
      if (live) setBalanceError(readableError(error));
    });
    return () => { live = false; };
  }, [auth.authenticated, auth.identityToken, auth.walletAddress, balanceNonce, registerTokens]);

  const refreshOrders = useCallback(async () => {
    const requestId = ++ordersRequestId.current;
    if (!auth.authenticated || !auth.walletAddress || !auth.identityToken) {
      setOrdersWallet(null);
      setActiveOrders([]);
      setHistoryOrders([]);
      setOrdersError(null);
      setOrdersLoading(false);
      return;
    }
    const wallet = auth.walletAddress;
    const identityToken = auth.identityToken;
    setOrdersLoading(true);
    setOrdersError(null);
    try {
      const active = view === 'convert' && orderType === 'limit'
        ? await loadAllTriggerOrders(wallet, identityToken, 'active')
        : [];
      const history = view === 'activity'
        ? await loadAllTriggerOrders(wallet, identityToken, 'history')
        : [];
      if (requestId !== ordersRequestId.current) return;
      setOrdersWallet(wallet);
      setActiveOrders(active);
      setHistoryOrders(history);
      const mints = [...new Set([...active, ...history].flatMap((order) => [order.inputMint, order.outputMint]))];
      const missing = mints.filter((mint) => !catalogRef.current[mint]);
      if (missing.length) {
        const loaded = await Promise.allSettled(missing.map((mint) => api<{ token: TokenInfo }>(`/tokens/${mint}`)));
        if (requestId === ordersRequestId.current) {
          registerTokens(loaded.flatMap((result) => result.status === 'fulfilled' ? [result.value.token] : []));
        }
      }
    } catch (error) {
      if (requestId === ordersRequestId.current) setOrdersError(readableError(error));
    } finally {
      if (requestId === ordersRequestId.current) setOrdersLoading(false);
    }
  }, [auth.authenticated, auth.identityToken, auth.walletAddress, orderType, registerTokens, view]);

  useEffect(() => {
    if (orderType === 'limit' || view === 'activity') void refreshOrders();
  }, [orderType, ordersNonce, refreshOrders, view]);

  const refreshActivity = useCallback(async () => {
    const requestId = ++activityRequestId.current;
    if (!auth.authenticated || !auth.walletAddress || !auth.identityToken) {
      setActivityWallet(null);
      setActivityRows([]);
      setActivityLoading(false);
      return;
    }
    const walletAddress = auth.walletAddress;
    const identityToken = auth.identityToken;
    const stored = readStoredActivity(walletAddress)
      .filter((entry) => activityFilter === 'All' || entry.kind === activityFilter);
    setActivityLoading(true);
    const loaded = await Promise.all(stored.map(async (entry) => {
      try {
        const onchain = await api<ActivityRecord>(`/activity/${entry.signature}?${query({ wallet: walletAddress })}`, {
          identityToken,
        });
        return { stored: entry, onchain, error: null };
      } catch (error) {
        return { stored: entry, onchain: null, error: readableError(error) };
      }
    }));
    if (requestId !== activityRequestId.current) return;
    setActivityWallet(walletAddress);
    setActivityRows(loaded);
    setActivityLoading(false);
  }, [activityFilter, auth.authenticated, auth.identityToken, auth.walletAddress]);

  useEffect(() => {
    if (view === 'activity') void refreshActivity();
  }, [balanceNonce, refreshActivity, view]);

  function navigate(next: View) {
    setView(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openTokenPicker(side: Side) {
    setPickerSide(side);
    setModal('token');
  }

  function applyToken(token: TokenInfo) {
    registerTokens([token]);
    if (pickerSide === 'from') {
      if (token.mint === toMint) setToMint(fromMint);
      setFromMint(token.mint);
    } else {
      if (token.mint === fromMint) setFromMint(toMint);
      setToMint(token.mint);
    }
    setRouteChoice('auto');
    setModal(null);
  }

  function switchTokens() {
    setFromMint(toMint);
    setToMint(fromMint);
    setRouteChoice('auto');
  }

  function requireWallet(): boolean {
    setGlobalError(null);
    if (!auth.configured) {
      setModal('setup');
      return false;
    }
    if (!auth.ready) {
      setGlobalError('Privy is still starting. Try again in a moment.');
      return false;
    }
    if (!auth.authenticated) {
      auth.login();
      return false;
    }
    if (!auth.walletReady || !auth.walletAddress || !auth.identityToken) {
      setGlobalError('Your embedded Solana wallet or identity token is still loading.');
      return false;
    }
    return true;
  }

  async function prepareMarket() {
    if (!selectedQuote || !requireWallet()) return;
    setActionBusy(true);
    setGlobalError(null);
    try {
      const candidates = marketPrepareCandidates(currentQuoteResponse, selectedQuote, routeChoice);
      const response = await prepareMarketCandidates(candidates, routeChoice, (candidate) => (
        api<PreparedTransaction>('/market/prepare', {
          method: 'POST',
          identityToken: auth.identityToken,
          body: JSON.stringify({ quoteId: candidate.id, wallet: auth.walletAddress }),
        })
      ));
      registerPreparedTokens(response);
      setSponsoredSubmission(null);
      setPrepared(response);
      setModal('review');
    } catch (error) {
      setGlobalError(readableError(error));
    } finally {
      setActionBusy(false);
    }
  }

  async function prepareLimit() {
    if (!fromToken || !toToken || !requireWallet()) return;
    setActionBusy(true);
    setGlobalError(null);
    try {
      const makingAmount = decimalToAtomic(amount, fromToken.decimals);
      const takingAmount = decimalToAtomic(limitOutput, toToken.decimals);
      if (BigInt(makingAmount) === 0n || BigInt(takingAmount) === 0n) throw new Error('Enter positive pay and receive amounts.');
      const expiredAt = Math.floor(Date.now() / 1000) + Number(expiryDays) * 86_400;
      const response = await api<PreparedTransaction>('/trigger/create', {
        method: 'POST',
        identityToken: auth.identityToken,
        body: JSON.stringify({
          wallet: auth.walletAddress,
          inputMint: fromToken.mint,
          outputMint: toToken.mint,
          makingAmount,
          takingAmount,
          slippageBps: 0,
          expiredAt,
        }),
      });
      registerPreparedTokens(response);
      setSponsoredSubmission(null);
      setPrepared(response);
      setModal('review');
    } catch (error) {
      setGlobalError(readableError(error));
    } finally {
      setActionBusy(false);
    }
  }

  async function prepareCancellation(order: TriggerOrder) {
    if (!requireWallet()) return;
    setActionBusy(true);
    setGlobalError(null);
    try {
      const response = await api<PreparedTransaction>('/trigger/cancel', {
        method: 'POST',
        identityToken: auth.identityToken,
        body: JSON.stringify({ wallet: auth.walletAddress, order: order.order }),
      });
      registerPreparedTokens(response);
      setSponsoredSubmission(null);
      setPrepared(response);
      setModal('review');
    } catch (error) {
      setGlobalError(readableError(error));
    } finally {
      setActionBusy(false);
    }
  }

  function registerPreparedTokens(value: PreparedTransaction) {
    registerTokens([value.review.inputToken, value.review.outputToken].filter((token): token is TokenInfo => Boolean(token)));
  }

  async function signAndExecute() {
    if (!prepared || !requireWallet()) return;
    setActionBusy(true);
    setGlobalError(null);
    try {
      const privySponsored = prepared.kind === 'market-swap'
        && prepared.gasPayment?.provider === 'Privy'
        && (prepared.provider === 'raydium' || prepared.provider === 'orca');
      let result: ExecutionResult;
      if (privySponsored) {
        let signature = sponsoredSubmission?.preparedId === prepared.preparedId ? sponsoredSubmission.signature : null;
        if (!signature) {
          const venue = prepared.provider === 'raydium' ? 'Raydium' : 'Orca';
          const signatureBytes = await auth.signAndSendSponsoredMarketTransaction(fromBase64(prepared.transaction), venue);
          signature = bs58.encode(signatureBytes);
          if (!/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(signature)) throw new Error('Privy returned a malformed Solana signature.');
          setSponsoredSubmission({ preparedId: prepared.preparedId, signature });
        }
        result = await api<ExecutionResult>('/transactions/sponsored/complete', {
          method: 'POST',
          identityToken: auth.identityToken,
          body: JSON.stringify({ preparedId: prepared.preparedId, signature }),
        });
      } else {
        const signed = await auth.signTransaction(fromBase64(prepared.transaction));
        result = await api<ExecutionResult>('/transactions/execute', {
          method: 'POST',
          identityToken: auth.identityToken,
          body: JSON.stringify({
            preparedId: prepared.preparedId,
            signedTransaction: toBase64(signed),
          }),
        });
      }
      const stock = prepared.review.stock;
      const kind: StoredActivity['kind'] = stock ? 'Stock' : prepared.kind === 'market-swap' ? 'Market' : 'Limit';
      writeStoredActivity(auth.walletAddress!, {
        signature: result.signature,
        kind,
        provider: result.provider,
        ...(result.gasPayment ? {
          gasPayment: {
            mode: result.gasPayment.mode,
            provider: result.gasPayment.provider,
          },
        } : {}),
        createdAt: Date.now(),
        ...(stock ? { stock } : {}),
      });
      setExecutedStock(stock ?? null);
      setExecution(result);
      setSponsoredSubmission(null);
      setPrepared(null);
      setModal('success');
      setBalanceNonce((value) => value + 1);
      setOrdersNonce((value) => value + 1);
    } catch (error) {
      setGlobalError(readableError(error));
    } finally {
      setActionBusy(false);
    }
  }

  async function openMagicBlock() {
    if (!requireWallet()) return;
    setModal('magicblock');
    setMagicError(null);
    setMagicUnlockStage('idle');
    setMagicBusy(true);
    try {
      const status = await api<MagicBlockStatus>('/magicblock/status');
      setMagicStatus(status);
      if (!status.available || !status.mintInitialized || !status.privateTransfers) {
        setMagicBalance(null);
        setMagicUnlocked(false);
        return;
      }
      try {
        const balance = await api<MagicBlockBalance>(`/magicblock/balance?${query({ wallet: auth.walletAddress! })}`, {
          identityToken: auth.identityToken,
        });
        setMagicBalance(balance);
        setMagicUnlocked(true);
      } catch (error) {
        if (error instanceof ApiClientError && error.code === 'MAGICBLOCK_UNLOCK_REQUIRED') {
          setMagicBalance(null);
          setMagicUnlocked(false);
        } else {
          throw error;
        }
      }
    } catch (error) {
      setMagicError(readableError(error));
    } finally {
      setMagicBusy(false);
    }
  }

  async function unlockMagicBlock() {
    if (!requireWallet()) return;
    const wallet = auth.walletAddress!;
    setMagicBusy(true);
    setMagicError(null);
    try {
      setMagicUnlockStage('requesting-challenge');
      const response = await withUiTimeout(
        api<{ challenge: string; expiresAt: number }>(`/magicblock/challenge?${query({ wallet })}`, {
          identityToken: auth.identityToken,
        }),
        12_000,
        'MagicBlock did not return a login challenge in time. Check your connection and retry.',
      );

      setMagicUnlockStage('signing-wallet');
      const signature = await withUiTimeout(
        auth.signMessage(new TextEncoder().encode(response.challenge)),
        60_000,
        'Privy did not return the MagicBlock login signature within one minute. Retry from this account.',
      );

      setMagicUnlockStage('verifying-signature');
      await withUiTimeout(
        api<{ unlocked: true; expiresAt: number }>('/magicblock/login', {
          method: 'POST',
          identityToken: auth.identityToken,
          body: JSON.stringify({
            wallet,
            challenge: response.challenge,
            signature: bs58.encode(signature),
          }),
        }),
        12_000,
        'MagicBlock did not verify the wallet signature in time. Retry with a fresh challenge.',
      );
      setMagicUnlocked(true);

      setMagicUnlockStage('loading-balance');
      const balance = await withUiTimeout(
        api<MagicBlockBalance>(`/magicblock/balance?${query({ wallet })}`, {
          identityToken: auth.identityToken,
        }),
        12_000,
        'The protected balance did not load in time. Retry the unlock.',
      );
      setMagicBalance(balance);
      setModal('magicblock');
    } catch (error) {
      setMagicUnlocked(false);
      setMagicError(readableError(error));
    } finally {
      setMagicUnlockStage('idle');
      setMagicBusy(false);
    }
  }

  async function refreshMagicBlockBalance() {
    if (!requireWallet()) return;
    setMagicBusy(true);
    setMagicError(null);
    try {
      const balance = await api<MagicBlockBalance>(`/magicblock/balance?${query({ wallet: auth.walletAddress! })}`, {
        identityToken: auth.identityToken,
      });
      setMagicBalance(balance);
      setMagicUnlocked(true);
    } catch (error) {
      if (error instanceof ApiClientError && error.code === 'MAGICBLOCK_UNLOCK_REQUIRED') {
        setMagicUnlocked(false);
        setMagicBalance(null);
      }
      setMagicError(readableError(error));
    } finally {
      setMagicBusy(false);
    }
  }

  async function prepareMagicBlock(action: MagicBlockAction, amountValue: string, recipient?: string) {
    if (!requireWallet()) return;
    setMagicBusy(true);
    setMagicError(null);
    try {
      const amountAtomic = decimalToAtomic(amountValue, 6);
      if (BigInt(amountAtomic) === 0n) throw new Error('Enter a positive USDC amount.');
      const response = await api<MagicBlockPreparedTransaction>('/magicblock/prepare', {
        method: 'POST',
        identityToken: auth.identityToken,
        body: JSON.stringify({
          action,
          wallet: auth.walletAddress,
          amountAtomic,
          ...(recipient ? { recipient } : {}),
        }),
      });
      setMagicPrepared(response);
      setModal('magic-review');
    } catch (error) {
      if (error instanceof ApiClientError && error.code === 'MAGICBLOCK_UNLOCK_REQUIRED') {
        setMagicUnlocked(false);
        setMagicBalance(null);
      }
      setMagicError(readableError(error));
    } finally {
      setMagicBusy(false);
    }
  }

  async function signAndExecuteMagicBlock() {
    if (!magicPrepared || !requireWallet()) return;
    setMagicBusy(true);
    setMagicError(null);
    try {
      const signed = await auth.signTransaction(fromBase64(magicPrepared.transaction));
      const result = await api<MagicBlockExecution>('/magicblock/execute', {
        method: 'POST',
        identityToken: auth.identityToken,
        body: JSON.stringify({
          preparedId: magicPrepared.preparedId,
          wallet: auth.walletAddress,
          signedTransaction: toBase64(signed),
        }),
      });
      setMagicExecution(result);
      setMagicPrepared(null);
      setModal('magic-success');
      setBalanceNonce((value) => value + 1);
      window.setTimeout(() => {
        void refreshMagicBlockBalance();
      }, 1200);
    } catch (error) {
      if (error instanceof ApiClientError && error.code === 'MAGICBLOCK_UNLOCK_REQUIRED') setMagicUnlocked(false);
      setMagicError(readableError(error));
    } finally {
      setMagicBusy(false);
    }
  }

  function useBalance() {
    if (!fromToken) return;
    if (!auth.authenticated) {
      auth.login();
      return;
    }
    const balance = balances?.wallet === auth.walletAddress ? balances.balances.find((item) => item.token.mint === fromToken.mint) : undefined;
    if (!balance) {
      setGlobalError(`No confirmed ${fromToken.symbol} balance is available.`);
      return;
    }
    let atomic = BigInt(balance.amountAtomic);
    if (fromToken.mint === SOL_MINT) atomic = atomic > 5_000_000n ? atomic - 5_000_000n : 0n;
    setAmount(atomicToDecimal(atomic, fromToken.decimals));
  }

  const visibleBalances = auth.authenticated && balances?.wallet === auth.walletAddress ? balances : null;
  const inputBalance = visibleBalances?.balances.find((balance) => balance.token.mint === fromMint);
  const inputUsd = fromToken?.usdPrice && amount ? Number(amount) * fromToken.usdPrice : null;
  const marketReady = Boolean(selectedQuote && fromToken && toToken && !quoteLoading);
  const limitReady = Boolean(fromToken && toToken && Number(amount) > 0 && Number(limitOutput) > 0);
  const authNeedsServer = auth.configured && health && !health.readiness.privy;
  const refreshBalances = useCallback(() => setBalanceNonce((value) => value + 1), []);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-top">
          <Logo />
          <div className="workspace-label"><span className="workspace-glyph"><Layers3 size={15} /></span><span>Trading workspace</span><ChevronDown size={14} /></div>
          <nav className="side-nav" aria-label="Main navigation">
            <div className="nav-caption">WORKSPACE</div>
            <button className={`nav-link ${view === 'convert' ? 'active' : ''}`} onClick={() => navigate('convert')} aria-current={view === 'convert' ? 'page' : undefined}><ArrowDownUp size={18} /><span>Convert</span>{view === 'convert' && <span className="active-pin" />}</button>
            <button className={`nav-link ${view === 'stocks' ? 'active' : ''}`} onClick={() => navigate('stocks')} aria-current={view === 'stocks' ? 'page' : undefined}><ChartNoAxesCombined size={18} /><span>Stocks</span>{view === 'stocks' && <span className="active-pin" />}</button>
            <button className={`nav-link ${view === 'futures' ? 'active' : ''}`} onClick={() => navigate('futures')} aria-current={view === 'futures' ? 'page' : undefined}><CandlestickChart size={18} /><span>Futures</span>{view === 'futures' && <span className="active-pin" />}</button>
            <button className={`nav-link ${view === 'funds' ? 'active' : ''}`} onClick={() => navigate('funds')} aria-current={view === 'funds' ? 'page' : undefined}><Banknote size={18} /><span>Add funds</span>{view === 'funds' && <span className="active-pin" />}</button>
            <button className={`nav-link ${view === 'activity' ? 'active' : ''}`} onClick={() => navigate('activity')} aria-current={view === 'activity' ? 'page' : undefined}><Activity size={18} /><span>Activity</span>{view === 'activity' && <span className="active-pin" />}</button>
            <div className="nav-caption nav-caption-secondary">ACCOUNT</div>
            <button className="nav-link" onClick={() => setModal(auth.configured ? 'wallet' : 'setup')}><Wallet size={18} /><span>Wallet</span><ChevronRight size={16} className="nav-end" /></button>
          </nav>
        </div>
        <div className="sidebar-bottom">
          <div className="sidebar-feature">
            <div className="feature-orbit" aria-hidden="true"><span /><span /><span /><i /></div>
            <span className="feature-kicker">LIVE CONVERT</span>
            <strong>Three routes.<br />One exact review.</strong>
            <p>Market execution stays in your embedded wallet.</p>
          </div>
          <div className="sidebar-status"><span className={`status-light ${health ? '' : 'pending'}`} /><span>Mainnet</span><span className="sidebar-status-right">{health ? 'API connected' : 'Connecting'}</span></div>
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-mobile-logo"><Logo compact /><span>flay<span className="logo-period">.</span></span></div>
          <div className="breadcrumb"><span>Workspace</span><ChevronRight size={14} /><strong>{view === 'convert' ? 'Convert' : view === 'stocks' ? 'Stocks' : view === 'futures' ? 'Futures' : view === 'funds' ? 'Add funds' : 'Activity'}</strong></div>
          <div className="topbar-actions">
            <div className="network-pill"><span className="network-dot" /> Solana mainnet</div>
            <button className="top-connect" onClick={() => setModal(auth.configured ? 'wallet' : 'setup')}>
              <Wallet size={16} />
              <span>{auth.walletAddress ? shortAddress(auth.walletAddress, 4) : auth.authenticated ? 'Wallet loading' : 'Sign in'}</span>
            </button>
          </div>
        </header>

        {(!auth.configured || authNeedsServer) && (
          <button className="configuration-banner" onClick={() => setModal('setup')}>
            <AlertCircle size={15} />
            <span><strong>Privy setup required for signing.</strong> Live quotes remain available; add the documented environment values to enable login and execution.</span>
            <ChevronRight size={15} />
          </button>
        )}

        {globalError && (
          <div className="global-error" role="alert">
            <AlertCircle size={17} />
            <span>{globalError}</span>
            <button onClick={() => setGlobalError(null)} aria-label="Dismiss error"><X size={15} /></button>
          </div>
        )}

        {view === 'convert' ? (
          <main className="page-content">
            <section className="page-intro">
              <div className="intro-copy">
                <div className="eyebrow"><span className="eyebrow-line" /> LIVE ON SOLANA MAINNET</div>
                <h1>Convert, <em>considered.</em></h1>
                <p>Compare executable routes, review the exact transaction, and sign from your own wallet.</p>
              </div>
              <div className="intro-aside"><span className="intro-aside-icon"><Compass size={18} /></span><div><strong>Built for the best path</strong><span>Jupiter, Raydium &amp; Orca</span></div></div>
            </section>

            <div className="content-grid">
              <section className="trade-card" aria-label="Convert form">
                <div className="card-head">
                  <div><span className="card-eyebrow">NEW CONVERSION</span><h2>Set up your trade</h2></div>
                  <button className="settings-button" onClick={() => setModal('settings')} aria-label="Trade settings"><Settings2 size={17} /></button>
                </div>
                <div className="trade-tabs" aria-label="Order type">
                  <button aria-pressed={orderType === 'market'} className={orderType === 'market' ? 'selected' : ''} onClick={() => setOrderType('market')}><span className="tab-dot" /> Market</button>
                  <button aria-pressed={orderType === 'limit'} className={orderType === 'limit' ? 'selected' : ''} onClick={() => setOrderType('limit')}><Clock3 size={15} /> Limit</button>
                </div>

                <div className="swap-stack">
                  <div className="asset-input-card">
                    <div className="asset-card-top">
                      <label htmlFor="from-amount">You pay</label>
                      <span>Confirmed balance <strong>{inputBalance ? formatAtomic(inputBalance.amountAtomic, fromToken) : '—'} {inputBalance ? fromToken?.symbol : ''}</strong></span>
                    </div>
                    <div className="asset-card-main">
                      <input id="from-amount" className="amount-input" type="text" inputMode="decimal" autoComplete="off" value={amount} onChange={(event) => setAmount(sanitizeDecimal(event.target.value))} placeholder="0.00" />
                      <button className="asset-selector" onClick={() => openTokenPicker('from')} disabled={!fromToken} aria-label={fromToken ? `Select token to pay, currently ${fromToken.symbol}` : 'Tokens loading'}>
                        {fromToken ? <><TokenAvatar token={fromToken} /><span>{fromToken.symbol}</span></> : <LoaderCircle className="spin" size={20} />}
                        <ChevronDown size={16} />
                      </button>
                    </div>
                    <div className="asset-card-foot">
                      <span>{inputUsd !== null && Number.isFinite(inputUsd) ? `≈ ${formatUsd(inputUsd)} live token price` : 'Enter an exact input amount'}</span>
                      <button onClick={useBalance}>Use balance</button>
                    </div>
                    {fromToken && !fromToken.verified && <div className="token-risk-inline"><AlertCircle size={13} /> Unverified token · verify mint {shortAddress(fromToken.mint)}</div>}
                  </div>

                  <button className="swap-direction" onClick={switchTokens} aria-label="Swap pay and receive tokens"><ArrowDown size={19} /></button>

                  <div className="asset-input-card receive-card">
                    <div className="asset-card-top">
                      <label htmlFor="receive-amount">{orderType === 'market' ? 'You receive (estimated)' : 'Minimum to receive'}</label>
                      <span>{orderType === 'market' ? (quoteLoading ? 'Refreshing live routes' : 'Executable quote') : 'Your trigger price'}</span>
                    </div>
                    <div className="asset-card-main">
                      {orderType === 'market'
                        ? <output id="receive-amount" aria-live="polite" className={`amount-output ${!selectedQuote ? 'muted' : ''}`}>{selectedQuote ? formatAtomic(selectedQuote.outAmount, toToken) : '—'}</output>
                        : <input id="receive-amount" className="amount-input" type="text" inputMode="decimal" autoComplete="off" value={limitOutput} onChange={(event) => setLimitOutput(sanitizeDecimal(event.target.value))} placeholder="0.00" />}
                      <button className="asset-selector" onClick={() => openTokenPicker('to')} disabled={!toToken} aria-label={toToken ? `Select token to receive, currently ${toToken.symbol}` : 'Tokens loading'}>
                        {toToken ? <><TokenAvatar token={toToken} /><span>{toToken.symbol}</span></> : <LoaderCircle className="spin" size={20} />}
                        <ChevronDown size={16} />
                      </button>
                    </div>
                    <div className="asset-card-foot">
                      <span>{orderType === 'market' ? (selectedQuote ? `Minimum ${formatAtomic(selectedQuote.minimumOut, toToken)} ${toToken?.symbol}` : 'Waiting for live routes') : 'Order fills only at this output or better'}</span>
                      <span>{orderType === 'market' && selectedQuote ? formatAge(selectedQuote.fetchedAt, now) : 'Exact input'}</span>
                    </div>
                    {toToken && !toToken.verified && <div className="token-risk-inline"><AlertCircle size={13} /> Unverified token · verify mint {shortAddress(toToken.mint)}</div>}
                  </div>
                </div>

                {orderType === 'market' ? (
                  <div className="trade-details">
                    <div className="detail-row"><span>Route selection <Info size={13} /></span><strong>{routeChoice === 'auto' ? 'Automatic · highest output' : `Manual · ${PROVIDER_META[routeChoice].short}`}</strong></div>
                    <div className="detail-row"><span>Minimum received</span><strong>{selectedQuote ? `${formatAtomic(selectedQuote.minimumOut, toToken)} ${toToken?.symbol}` : '—'}</strong></div>
                    <div className="detail-row"><span>Slippage tolerance</span><button className="text-control" onClick={() => setModal('settings')}>{slippageBps / 100}% <ChevronRight size={13} /></button></div>
                    <div className="detail-row"><span>Flay fee</span><strong>0%</strong></div>
                  </div>
                ) : (
                  <div className="limit-fields">
                    <div className="limit-field">
                      <div><span>Order expiry</span><strong>How long the order stays open</strong></div>
                      <label className="select-wrap"><span className="sr-only">Order expiry</span><select value={expiryDays} onChange={(event) => setExpiryDays(event.target.value)}><option value="1">1 day</option><option value="7">7 days</option><option value="30">30 days</option></select><ChevronDown size={14} /></label>
                    </div>
                    <div className="limit-note"><LockKeyhole size={16} /><p>Execution by Jupiter Trigger V1. Input tokens reside in Jupiter program order accounts until filled or canceled. Jupiter requires at least $5 and charges 0.03% for stable pairs or 0.1% otherwise. Flay adds no fee.</p></div>
                  </div>
                )}

                {quoteError && orderType === 'market' && <InlineError message={quoteError} />}
                {balanceError && <InlineError message={balanceError} />}
                <button
                  className="review-button"
                  disabled={actionBusy || (orderType === 'market' ? !marketReady : !limitReady)}
                  onClick={() => void (orderType === 'market' ? prepareMarket() : prepareLimit())}
                >
                  {actionBusy ? <><LoaderCircle className="spin" size={18} /> Preparing exact transaction</> : <><span>Review {orderType === 'market' ? 'conversion' : 'limit order'}</span><ArrowRight size={19} /></>}
                </button>
                <p className="trade-card-footnote"><ShieldCheck size={15} /> Your embedded wallet signs. Flay never receives its private key.</p>
              </section>

              <div className="right-column">
                {orderType === 'market' ? (
                  <MarketRoutes
                    response={currentQuoteResponse}
                    error={quoteError}
                    selected={selectedQuote}
                    choice={routeChoice}
                    loading={quoteLoading}
                    now={now}
                    outputToken={toToken}
                    inputToken={fromToken}
                    onChoice={setRouteChoice}
                  />
                ) : (
                  <LimitOrdersPanel
                    orders={ordersWallet === auth.walletAddress ? activeOrders : []}
                    catalog={catalog}
                    loading={ordersLoading}
                    error={ordersError}
                    authenticated={auth.authenticated}
                    actionBusy={actionBusy}
                    onRefresh={() => setOrdersNonce((value) => value + 1)}
                    onCancel={(order) => void prepareCancellation(order)}
                    onLogin={auth.login}
                  />
                )}
                <section className="principle-card">
                  <span className="principle-icon"><ShieldCheck size={19} /></span>
                  <div><strong>Exact-message protection</strong><p>Flay checks payer, signer, mints, token accounts, programs, input debit, and minimum output before submission.</p></div>
                  <CheckCircle2 size={17} className="principle-arrow" />
                </section>
              </div>
            </div>

            <section className="below-panel">
              <div className="below-title"><span className="below-kicker">PROVIDER BOUNDARIES</span><h2>Know who does what.</h2></div>
              <div className="below-items">
                <div><span className="below-icon"><Compass size={18} /></span><strong>Trading routes</strong><p>Jupiter Swap V2, Raydium Trade API, and Orca Whirlpools SDK.</p></div>
                <div><span className="below-icon"><LockKeyhole size={18} /></span><strong>Wallet &amp; login</strong><p>Privy creates the exportable embedded Solana wallet and handles signatures.</p></div>
                <div><span className="below-icon"><Layers3 size={18} /></span><strong>Chain access</strong><p>{health ? `Confirmed data through ${health.providers.rpc}.` : 'Loading the configured Solana RPC provider.'}</p></div>
                <div><span className="below-icon"><LockKeyhole size={18} /></span><strong>Optional private account</strong><p>MagicBlock provides permissioned private PER token transfers after deposit.</p></div>
              </div>
            </section>
          </main>
        ) : view === 'stocks' ? (
          <StocksPage
            auth={auth}
            balances={visibleBalances}
            onReview={(value) => {
              registerPreparedTokens(value);
              setSponsoredSubmission(null);
              setExecutedStock(null);
              setPrepared(value);
              setModal('review');
            }}
          />
        ) : view === 'futures' ? (
          <FuturesPage auth={auth} />
        ) : view === 'funds' ? (
          <FundsPage auth={auth} balances={visibleBalances} onBalanceRefresh={refreshBalances} />
        ) : (
          <ActivityPage
            authenticated={auth.authenticated}
            wallet={auth.walletAddress}
            rows={activityWallet === auth.walletAddress ? activityRows : []}
            historyOrders={ordersWallet === auth.walletAddress ? historyOrders : []}
            catalog={catalog}
            loading={activityLoading || ordersLoading}
            filter={activityFilter}
            error={ordersError}
            onFilter={setActivityFilter}
            onRefresh={() => {
              void refreshActivity();
              setOrdersNonce((value) => value + 1);
            }}
            onLogin={auth.login}
            onConvert={() => navigate('convert')}
          />
        )}

        <footer className="page-footer"><span>© 2026 Flay</span><span>Self-custodial Convert on Solana.</span><span>Mainnet <span className="footer-dot">●</span></span></footer>
      </div>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        <button className={view === 'convert' ? 'active' : ''} onClick={() => navigate('convert')}><ArrowDownUp size={20} /><span>Convert</span></button>
        <button className={view === 'stocks' ? 'active' : ''} onClick={() => navigate('stocks')}><ChartNoAxesCombined size={20} /><span>Stocks</span></button>
        <button className={view === 'futures' ? 'active' : ''} onClick={() => navigate('futures')}><CandlestickChart size={20} /><span>Futures</span></button>
        <button className={view === 'funds' ? 'active' : ''} onClick={() => navigate('funds')}><Banknote size={20} /><span>Funds</span></button>
        <button className={view === 'activity' ? 'active' : ''} onClick={() => navigate('activity')}><Activity size={20} /><span>Activity</span></button>
        <button onClick={() => setModal(auth.configured ? 'wallet' : 'setup')}><Wallet size={20} /><span>Wallet</span></button>
      </nav>

      {modal === 'settings' && (
        <ModalShell title="Trade settings" subtitle="Set the maximum movement accepted between review and execution." onClose={() => setModal(null)}>
          <div className="settings-group">
            <label>Slippage tolerance</label>
            <div className="slippage-options">{[10, 50, 100].map((value) => <button key={value} className={slippageBps === value ? 'active' : ''} onClick={() => setSlippageBps(value)}>{value / 100}%</button>)}</div>
            <p>Every provider receives this bound. Flay also checks the simulated wallet output against the fresh minimum before submission.</p>
          </div>
          <div className="settings-warning"><Info size={17} /><span>Higher slippage can produce a worse fill. Quotes expire quickly and are rebuilt at review.</span></div>
          <button className="modal-primary" onClick={() => setModal(null)}>Save settings <Check size={16} /></button>
        </ModalShell>
      )}

      {modal === 'token' && (
        <TokenPicker
          side={pickerSide}
          coreTokens={coreTokens}
          onClose={() => setModal(null)}
          onSelect={applyToken}
        />
      )}

      {modal === 'wallet' && (
        <WalletModal
          auth={auth}
          balances={visibleBalances}
          balanceError={balanceError}
          onClose={() => setModal(null)}
          onRefresh={() => setBalanceNonce((value) => value + 1)}
          onSetup={() => setModal('setup')}
          onMagicBlock={() => void openMagicBlock()}
          onAddFunds={() => { setModal(null); navigate('funds'); }}
          magicStatus={magicStatus}
        />
      )}

      {modal === 'setup' && <SetupModal health={health} onClose={() => setModal(null)} />}

      {modal === 'magicblock' && auth.authenticated && auth.walletAddress && (
        <MagicBlockModal
          wallet={auth.walletAddress}
          baseBalances={visibleBalances}
          status={magicStatus}
          balance={magicBalance}
          unlocked={magicUnlocked}
          busy={magicBusy}
          unlockStage={magicUnlockStage}
          error={magicError}
          onClose={() => setModal(null)}
          onUnlock={() => void unlockMagicBlock()}
          onRefresh={() => void refreshMagicBlockBalance()}
          onPrepare={(action, amountValue, recipient) => void prepareMagicBlock(action, amountValue, recipient)}
        />
      )}

      {modal === 'magic-review' && magicPrepared && auth.authenticated && magicPrepared.wallet === auth.walletAddress && (
        <MagicBlockReviewModal
          prepared={magicPrepared}
          busy={magicBusy}
          error={magicError}
          onClose={() => {
            setMagicPrepared(null);
            setMagicError(null);
            setModal('magicblock');
          }}
          onSubmit={() => void signAndExecuteMagicBlock()}
        />
      )}

      {modal === 'magic-success' && magicExecution && auth.authenticated && (
        <MagicBlockSuccessModal
          execution={magicExecution}
          onClose={() => setModal(null)}
          onReturn={() => {
            setModal('magicblock');
            void refreshMagicBlockBalance();
          }}
        />
      )}

      {modal === 'review' && prepared && auth.authenticated && prepared.wallet === auth.walletAddress && (
        <ReviewModal
          prepared={prepared}
          busy={actionBusy}
          error={globalError}
          sponsoredSubmitted={sponsoredSubmission?.preparedId === prepared.preparedId}
          onClose={() => { setModal(null); setPrepared(null); setSponsoredSubmission(null); }}
          onSubmit={() => void signAndExecute()}
        />
      )}

      {modal === 'success' && execution && auth.authenticated && (
        <ModalShell title={execution.status === 'confirmed' ? 'Confirmed on Solana' : 'Submitted to Solana'} subtitle={execution.gasPayment?.mode === 'provider-sponsored' ? `${execution.gasPayment.provider ?? 'The provider'} paid this swap’s network gas. The transaction is now tracked in Activity.` : 'The signed transaction is now tracked in Activity.'} onClose={() => setModal(null)} className="success-modal">
          <div className="success-mark"><CheckCircle2 size={31} /></div>
          <div className="success-details">{executedStock && <><span>Stock order</span><strong>{executedStock.side === 'buy' ? 'Buy' : 'Sell'} {executedStock.symbol}</strong><span>{executedStock.side === 'buy' ? 'Estimated shares' : 'Estimated proceeds'}</span><strong>{executedStock.expectedOutputDisplay} {executedStock.side === 'buy' ? executedStock.symbol : 'USDC'}</strong></>}<span>Provider</span><strong>{execution.provider}</strong>{execution.gasPayment && <><span>Network gas</span><strong>{execution.gasPayment.mode === 'provider-sponsored' ? `Sponsored by ${execution.gasPayment.provider}` : 'Paid by your wallet'}</strong></>}<span>Signature</span><strong>{shortAddress(execution.signature, 8)}</strong></div>
          <a className="modal-primary link-button" href={execution.explorerUrl} target="_blank" rel="noreferrer">Open Solana Explorer <ExternalLink size={16} /></a>
          <button className="modal-secondary" onClick={() => { setModal(null); navigate('activity'); }}>View activity</button>
        </ModalShell>
      )}
    </div>
  );
}

function MarketRoutes({
  response,
  error,
  selected,
  choice,
  loading,
  now,
  outputToken,
  inputToken,
  onChoice,
}: {
  response: QuoteResponse | null;
  error: string | null;
  selected: MarketQuote | null;
  choice: RouteChoice;
  loading: boolean;
  now: number;
  outputToken?: TokenInfo;
  inputToken?: TokenInfo;
  onChoice: (choice: RouteChoice) => void;
}) {
  return (
    <section className="route-card" aria-label="Live route comparison">
      <div className="route-head">
        <div><span className="card-eyebrow">EXECUTION INTELLIGENCE</span><h2>Live route comparison</h2></div>
        <span className="route-count">{loading ? 'UPDATING' : `${response?.quotes.length ?? 0} LIVE`}</span>
      </div>
      <p className="route-intro">Routes are independent executable quotes. Automatic mode selects the highest token output. Gas sponsorship eligibility is verified on the exact review.</p>
      <div className="route-list" aria-live="polite">
        {loading && !response && <RouteSkeleton />}
        {response?.quotes.map((quote, index) => {
          const isSelected = selected?.id === quote.id;
          return (
            <button key={quote.id} className={`route-option ${isSelected ? 'selected' : ''}`} onClick={() => onChoice(quote.provider)} aria-pressed={isSelected}>
              <span className="route-radio">{isSelected && <Check size={13} strokeWidth={3} />}</span>
              <VenueAvatar provider={quote.provider} />
              <span className="route-name"><strong>{quote.providerLabel}</strong><small>{index === 0 ? 'Highest current output' : quote.routeLabel}</small><small className="gasless-check">Gasless eligibility checked at review</small></span>
              <span className="route-value"><strong>{formatAtomic(quote.outAmount, outputToken)}</strong><small>{outputToken?.symbol} · {formatAge(quote.fetchedAt, now)}</small></span>
            </button>
          );
        })}
        {!loading && response && !response.quotes.length && <div className="no-routes"><AlertCircle size={20} /><strong>No executable routes</strong><span>Review the provider messages below.</span></div>}
        {!loading && !response && <div className="no-routes"><Compass size={20} /><strong>{error ? 'Live routes unavailable' : 'Routes will appear here'}</strong><span>{error ? 'Check the error beside the form and retry.' : 'Choose tokens and enter an amount to compare venues.'}</span></div>}
      </div>
      <div className="route-bottom">
        <button className={`auto-route ${choice === 'auto' ? 'is-auto' : ''}`} onClick={() => onChoice('auto')}><span className="auto-icon"><Sparkles size={15} /></span><span>Auto-select highest output</span><span className="auto-check">{choice === 'auto' && <Check size={13} />}</span></button>
        {selected && (
          <div className="route-metrics">
            <div><span>Minimum output</span><strong>{formatAtomic(selected.minimumOut, outputToken)} {outputToken?.symbol}</strong></div>
            <div><span>Price impact</span><strong>{selected.priceImpactPct === null ? 'Not supplied' : `${selected.priceImpactPct.toFixed(3)}%`}</strong></div>
            <div><span>Venue fees</span><strong>{selected.fees.length ? selected.fees.map((fee) => {
              const feeToken = fee.mint === inputToken?.mint ? inputToken : fee.mint === outputToken?.mint ? outputToken : undefined;
              return fee.amountAtomic && feeToken ? `${formatAtomic(fee.amountAtomic, feeToken)} ${feeToken.symbol}` : fee.detail;
            }).join(' · ') : 'None disclosed'}</strong></div>
            <div><span>Network gas</span><strong>Sponsorship checked at review</strong></div>
          </div>
        )}
        {response?.failures.map((failure) => <div key={failure.provider} className="provider-failure"><AlertCircle size={13} /><span><strong>{PROVIDER_META[failure.provider].short}:</strong> {failure.message}</span></div>)}
        <p className="route-disclaimer"><Info size={14} /> Direct means Flay calls that venue’s own API or SDK. Jupiter may choose another underlying venue and names it above.</p>
      </div>
    </section>
  );
}

function RouteSkeleton() {
  return <div className="route-skeleton"><span /><span /><span /></div>;
}

function LimitOrdersPanel({
  orders,
  catalog,
  loading,
  error,
  authenticated,
  actionBusy,
  onRefresh,
  onCancel,
  onLogin,
}: {
  orders: TriggerOrder[];
  catalog: Record<string, TokenInfo>;
  loading: boolean;
  error: string | null;
  authenticated: boolean;
  actionBusy: boolean;
  onRefresh: () => void;
  onCancel: (order: TriggerOrder) => void;
  onLogin: () => void;
}) {
  return (
    <section className="route-card limit-orders-card" aria-label="Jupiter Trigger orders">
      <div className="route-head">
        <div><span className="card-eyebrow">JUPITER TRIGGER V1</span><h2>Open orders &amp; recovery</h2></div>
        <button className="icon-button" onClick={onRefresh} disabled={loading} aria-label="Refresh open orders"><RefreshCw size={16} className={loading ? 'spin' : ''} /></button>
      </div>
      <p className="route-intro">This recovery list stays separate from market-route availability. Canceling returns unfilled principal to your wallet.</p>
      {!authenticated && <button className="empty-action" onClick={onLogin}>Sign in to load orders <ArrowRight size={15} /></button>}
      {authenticated && !loading && !orders.length && !error && <div className="compact-empty"><Clock3 size={22} /><strong>No active orders</strong><span>Placed orders will remain recoverable here.</span></div>}
      <div className="open-order-list">
        {authenticated && orders.map((order) => {
          const input = catalog[order.inputMint];
          const output = catalog[order.outputMint];
          return (
            <div className="open-order" key={order.order}>
              <div className="open-order-top"><span className="status-chip">{order.status}</span><small>{shortAddress(order.order)}</small></div>
              <strong>{formatAtomic(order.remainingMakingAmount ?? order.makingAmount, input)} {input?.symbol ?? shortAddress(order.inputMint, 3)} <ArrowRight size={13} /> {formatAtomic(order.remainingTakingAmount ?? order.takingAmount, output)} {output?.symbol ?? shortAddress(order.outputMint, 3)}</strong>
              <button disabled={actionBusy} onClick={() => onCancel(order)}>Review cancellation</button>
            </div>
          );
        })}
      </div>
      {error && <InlineError message={error} />}
      <div className="trigger-boundary"><LockKeyhole size={15} /><span>Funds: Jupiter Trigger program accounts<br />Signing: Privy embedded wallet<br />Flay custody and fee: none</span></div>
    </section>
  );
}

function TokenPicker({
  side,
  coreTokens,
  onClose,
  onSelect,
}: {
  side: Side;
  coreTokens: TokenInfo[];
  onClose: () => void;
  onSelect: (token: TokenInfo) => void;
}) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<TokenInfo[]>(coreTokens);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<TokenInfo | null>(null);

  useEffect(() => {
    if (!search.trim()) {
      setResults(coreTokens);
      setError(null);
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      void api<{ tokens: TokenInfo[] }>(`/tokens?${query({ query: search.trim() })}`, { signal: controller.signal })
        .then((response) => { if (!controller.signal.aborted) setResults(response.tokens); })
        .catch((cause) => { if (!controller.signal.aborted) setError(readableError(cause)); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 400);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [coreTokens, search]);

  async function inspectAndSelect(candidate: TokenInfo) {
    setLoading(true);
    setError(null);
    try {
      const { token } = await api<{ token: TokenInfo }>(`/tokens/${candidate.mint}`);
      if (!token.tradable) {
        setError(token.blockedReason ?? 'This token is unsupported.');
        return;
      }
      if (!token.verified) {
        setPending(token);
        return;
      }
      onSelect(token);
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setLoading(false);
    }
  }

  return (
    <ModalShell title="Select a token" subtitle={`Choose the token you want to ${side === 'from' ? 'pay' : 'receive'}. Mint paste is supported.`} onClose={onClose} className="token-modal">
      {pending ? (
        <div className="token-confirm">
          <AlertCircle size={25} />
          <span className="card-eyebrow">UNVERIFIED TOKEN</span>
          <h3>Verify this mint yourself</h3>
          <div className="confirm-token-row"><TokenAvatar token={pending} /><span><strong>{pending.symbol}</strong><small>{pending.name}</small></span></div>
          <code>{pending.mint}</code>
          <p>Symbols and logos can be copied by scam tokens. Flay validated the onchain mint and supported extensions, but Jupiter does not mark this token as verified.</p>
          <button className="modal-primary" onClick={() => onSelect(pending)}>I verified the mint <ArrowRight size={16} /></button>
          <button className="modal-secondary" onClick={() => setPending(null)}>Go back</button>
        </div>
      ) : (
        <>
          <div className="token-search"><Search size={17} /><input autoFocus data-initial-focus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, symbol, or Solana mint" aria-label="Search tokens" />{loading && <LoaderCircle className="spin" size={16} />}</div>
          <div className="token-list">
            {results.map((token) => (
              <button key={token.mint} onClick={() => void inspectAndSelect(token)} disabled={!token.tradable}>
                <TokenAvatar token={token} />
                <span><strong>{token.symbol} {token.verified && <CheckCircle2 className="verified-inline" size={12} />}</strong><small>{token.name} · {shortAddress(token.mint, 3)}</small></span>
                {!token.tradable ? <span className="blocked-label">Unavailable</span> : <ChevronRight size={17} />}
              </button>
            ))}
            {!loading && !results.length && <p className="no-tokens">No indexed tokens matched. Paste the complete mint to inspect it onchain.</p>}
          </div>
          {error && <InlineError message={error} />}
          <p className="token-modal-foot"><Info size={14} /> Metadata comes from Jupiter Tokens. Every selected mint is rechecked through the configured Solana RPC before quoting.</p>
        </>
      )}
    </ModalShell>
  );
}

function WalletModal({
  auth,
  balances,
  balanceError,
  onClose,
  onRefresh,
  onSetup,
  onMagicBlock,
  onAddFunds,
  magicStatus,
}: {
  auth: FlayAuth;
  balances: WalletBalances | null;
  balanceError: string | null;
  onClose: () => void;
  onRefresh: () => void;
  onSetup: () => void;
  onMagicBlock: () => void;
  onAddFunds: () => void;
  magicStatus: MagicBlockStatus | null;
}) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!auth.configured) {
    return <SetupModal health={null} onClose={onClose} />;
  }

  async function copyAddress() {
    if (!auth.walletAddress) return;
    try {
      await navigator.clipboard.writeText(auth.walletAddress);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Your browser blocked clipboard access. Select and copy the address manually.');
    }
  }

  return (
    <ModalShell title={auth.authenticated ? 'Your Solana wallet' : 'Welcome to Flay'} subtitle={auth.authenticated ? 'Privy embedded wallet · Solana mainnet' : 'Google or email creates an exportable embedded wallet.'} onClose={onClose} className="wallet-modal">
      {!auth.authenticated ? (
        <>
          <div className="wallet-graphic"><span className="wallet-graphic-mark"><Wallet size={28} /></span><i className="wallet-orbit one" /><i className="wallet-orbit two" /></div>
          <button className="auth-button primary-auth" onClick={auth.login}><span className="google-g">G</span> Continue with Google or email <ArrowRight size={17} /></button>
          <div className="wallet-assurance"><LockKeyhole size={16} /><span>Privy keeps signing inside its wallet UI. Flay’s server never receives or stores the private key.</span></div>
        </>
      ) : !auth.walletAddress ? (
        <div className="wallet-loading"><LoaderCircle className="spin" size={24} /><span>Creating or reconnecting your embedded Solana wallet…</span></div>
      ) : (
        <>
          <div className="address-card">
            <span>RECEIVE ON SOLANA MAINNET</span>
            <strong>{auth.walletAddress}</strong>
            <button onClick={() => void copyAddress()}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? 'Copied' : 'Copy address'}</button>
          </div>
          <div className="wallet-balance-head"><span>Confirmed balances</span><button onClick={onRefresh}><RefreshCw size={14} /> Refresh</button></div>
          <div className="wallet-balances">
            {balances?.balances.map((balance) => <div key={balance.token.mint}><TokenAvatar token={balance.token} small /><span><strong>{balance.token.symbol}</strong><small>{balance.token.name}</small></span><b>{formatAtomic(balance.amountAtomic, balance.token)}</b></div>)}
            {!balances && !balanceError && <div className="wallet-loading"><LoaderCircle className="spin" size={18} /><span>Loading confirmed balances…</span></div>}
            {balances && !balances.balances.length && <p>No funded balances yet. Send SOL or SPL tokens to the receive address.</p>}
          </div>
          {balanceError && <InlineError message={balanceError} />}
          {error && <InlineError message={error} />}
          <button className="wallet-add-funds" onClick={onAddFunds}>
            <span><Banknote size={18} /></span>
            <span><strong>Add funds with Privy</strong><small>Buy USDC directly to this Solana wallet</small></span>
            <ChevronRight size={16} />
          </button>
          <button className="magic-account-launch" onClick={onMagicBlock}>
            <span className="magic-account-icon"><Layers3 size={18} /></span>
            <span><strong>MagicBlock account</strong><small>{magicStatus?.authorizationMode === 'mock' ? 'Private authorization is paused by the provider' : 'Deposit USDC · private PER transfers'}</small></span>
            <span className={magicStatus?.available && magicStatus.mintInitialized ? 'magic-live' : 'magic-offline'}>
              {magicStatus?.available && magicStatus.mintInitialized ? 'LIVE' : magicStatus?.authorizationMode === 'mock' ? 'PAUSED' : 'CHECK'}
            </span>
            <ChevronRight size={16} />
          </button>
          <button className="modal-primary" onClick={() => void auth.exportWallet().catch((cause) => setError(readableError(cause)))}>Export private key through Privy <ExternalLink size={16} /></button>
          <button className="modal-secondary danger-soft" onClick={() => void auth.logout().then(onClose)}><LogOut size={15} /> Sign out</button>
          <div className="wallet-assurance"><ShieldCheck size={16} /><span>Export runs in Privy’s isolated interface. Flay cannot read the exported key.</span></div>
        </>
      )}
      {auth.configured && !auth.ready && <button className="modal-secondary" onClick={onSetup}>View setup status</button>}
    </ModalShell>
  );
}

export function MagicBlockModal({
  wallet,
  baseBalances,
  status,
  balance,
  unlocked,
  busy,
  unlockStage = 'idle',
  error,
  onClose,
  onUnlock,
  onRefresh,
  onPrepare,
}: {
  wallet: string;
  baseBalances: WalletBalances | null;
  status: MagicBlockStatus | null;
  balance: MagicBlockBalance | null;
  unlocked: boolean;
  busy: boolean;
  unlockStage?: MagicUnlockStage;
  error: string | null;
  onClose: () => void;
  onUnlock: () => void;
  onRefresh: () => void;
  onPrepare: (action: MagicBlockAction, amount: string, recipient?: string) => void;
}) {
  const [action, setAction] = useState<'deposit' | 'transfer' | 'withdraw'>('deposit');
  const [amountValue, setAmountValue] = useState('');
  const [recipient, setRecipient] = useState('');
  const baseUsdc = baseBalances?.balances.find((item) => item.token.mint === status?.token.mint);
  const available = Boolean(status?.available && status.mintInitialized);
  const atomicBalance = balance?.amountAtomic ?? '0';
  const canSubmit = available
    && unlocked
    && Number(amountValue) > 0
    && (action !== 'transfer' || recipient.length >= 32);
  const unlockProgress = unlockStage === 'requesting-challenge'
    ? 'Requesting a fresh TEE challenge…'
    : unlockStage === 'signing-wallet'
      ? 'Signing securely with your Privy wallet…'
      : unlockStage === 'verifying-signature'
        ? 'Verifying the signature with MagicBlock…'
        : unlockStage === 'loading-balance'
          ? 'Loading your protected USDC balance…'
          : 'Unlocking securely…';

  function useMaximum() {
    const atomic = action === 'deposit' ? baseUsdc?.amountAtomic : atomicBalance;
    if (atomic) setAmountValue(atomicToDecimal(atomic, 6));
  }

  function submit() {
    const selected: MagicBlockAction = action === 'transfer' ? 'private-transfer' : action;
    onPrepare(selected, amountValue, action === 'transfer' ? recipient.trim() : undefined);
  }

  return (
    <ModalShell
      title="MagicBlock account"
      subtitle={available ? 'A separate USDC balance for permissioned private PER transfers.' : 'Provider verification is required before private PER access can open.'}
      onClose={onClose}
      className="magicblock-modal"
      overlayClassName={unlockStage === 'signing-wallet' ? 'privy-signing-underlay' : ''}
    >
      <div className={`magic-status-card ${available ? 'ready' : ''}`}>
        <span className="magic-status-icon"><Layers3 size={19} /></span>
        <span><strong>{available ? 'MagicBlock mainnet is ready' : status?.authorizationMode === 'mock' ? 'MagicBlock private access is paused' : status ? 'MagicBlock is unavailable' : 'Checking MagicBlock mainnet'}</strong><small>USDC · {shortAddress(wallet, 5)}</small></span>
        {busy && <LoaderCircle className="spin" size={16} />}
        {!busy && <span className="magic-status-dot" />}
      </div>

      {!unlocked ? (
        <div className="magic-unlock">
          <span className="magic-unlock-icon"><LockKeyhole size={25} /></span>
          <span className="card-eyebrow">{available ? 'PROTECTED ACCOUNT' : 'PROVIDER STATUS'}</span>
          <h3>{available ? 'Unlock your ephemeral balance' : 'Private PER access is not live'}</h3>
          <p>{available ? 'Unlock with MagicBlock’s one-time challenge. The authorization token stays in Flay’s server memory and expires after ten minutes.' : status?.detail ?? 'Flay could not verify MagicBlock private authorization.'}</p>
          {error && <InlineError message={error} />}
          {available && (
            <button className="modal-primary" disabled={busy} onClick={onUnlock}>
              {busy ? <><LoaderCircle className="spin" size={16} /> {unlockProgress}</> : <>Unlock protected balance <ArrowRight size={16} /></>}
            </button>
          )}
          {available && busy && <p className="magic-unlock-progress" role="status">{unlockStage === 'signing-wallet' ? 'Privy approval opens above this account. Flay cannot intercept its controls.' : 'This step will stop automatically if the provider or wallet does not respond.'}</p>}
          <div className="wallet-assurance"><ShieldCheck size={15} /><span>{available ? 'The login signature cannot move funds. It only proves which protected balance you may read.' : 'Flay will enable unlock only after MagicBlock returns verified wallet authorization.'}</span></div>
        </div>
      ) : (
        <>
          <div className="magic-balances">
            <div><span>Solana wallet</span><strong>{baseUsdc ? formatAtomic(baseUsdc.amountAtomic, baseUsdc.token) : '0'} <small>USDC</small></strong><small>Public base-layer balance</small></div>
            <div className="private"><span>MagicBlock</span><strong>{atomicToDecimal(atomicBalance, 6)} <small>USDC</small></strong><small>Protected ephemeral balance</small></div>
          </div>

          {balance && (
            <div className="magic-auth-receipt">
              <div className="magic-auth-receipt-head"><ShieldCheck size={16} /><span><strong>TEE authorization verified</strong><small>Live receipt · no bearer token exposed</small></span><Check size={14} /></div>
              <div className="magic-auth-receipt-grid">
                <span>Wallet signature</span><strong>{balance.authorization.walletSignature}</strong>
                <span>TEE attestation</span><strong>{balance.authorization.teeAttestation}</strong>
                <span>Provider token</span><strong>{balance.authorization.providerToken}</strong>
                <span>Session expires</span><strong>{new Date(balance.authorization.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</strong>
              </div>
              <code>{balance.authorization.source} · {balance.authorization.receiptFingerprint}</code>
            </div>
          )}

          <div className="magic-action-tabs" aria-label="MagicBlock action">
            {(['deposit', 'transfer', 'withdraw'] as const).map((value) => (
              <button key={value} className={action === value ? 'active' : ''} onClick={() => setAction(value)}>
                {value[0].toUpperCase() + value.slice(1)}
              </button>
            ))}
          </div>

          {action === 'transfer' && (
            <div className="magic-per-badge">
              <LockKeyhole size={15} />
              <span><strong>Private PER</strong><small>Permissioned execution inside Intel TDX</small></span>
              <Check size={14} />
            </div>
          )}

          <label className="magic-field">
            <span>{action === 'deposit' ? 'Deposit amount' : action === 'withdraw' ? 'Withdrawal amount' : 'Transfer amount'}</span>
            <div><input value={amountValue} onChange={(event) => setAmountValue(sanitizeDecimal(event.target.value))} inputMode="decimal" placeholder="0.00" /><b>USDC</b><button onClick={useMaximum}>MAX</button></div>
          </label>

          {action === 'transfer' && (
            <label className="magic-field">
              <span>Recipient Solana address</span>
              <div><input className="address-input" value={recipient} onChange={(event) => setRecipient(event.target.value.trim())} placeholder="Recipient wallet" /></div>
            </label>
          )}

          <div className={`magic-disclosure ${action === 'transfer' ? 'private' : ''}`}>
            {action === 'deposit' && <><Info size={15} /><span>Deposit is visible on Solana and moves USDC into a separate MagicBlock ephemeral balance.</span></>}
            {action === 'withdraw' && <><Info size={15} /><span>Withdrawal returns USDC to this embedded wallet and is visible on Solana.</span></>}
            {action === 'transfer' && <><LockKeyhole size={15} /><span>PER protects permissioned state inside Intel TDX. Deposits, withdrawals, and later public settlement can remain observable.</span></>}
          </div>

          {error && <InlineError message={error} />}
          <button className="modal-primary" disabled={busy || !canSubmit} onClick={submit}>
            {busy ? <><LoaderCircle className="spin" size={16} /> Building exact transaction</> : <>Review {action === 'transfer' ? 'private PER transfer' : action} <ArrowRight size={16} /></>}
          </button>
          <button className="modal-secondary" disabled={busy} onClick={onRefresh}><RefreshCw size={14} /> Refresh protected balance</button>
          <p className="review-footnote">Flay uses MagicBlock’s deployed token programs. No Flay smart contract is deployed.</p>
        </>
      )}
    </ModalShell>
  );
}

function MagicBlockReviewModal({
  prepared,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  prepared: MagicBlockPreparedTransaction;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const actionLabel = prepared.action === 'deposit'
    ? 'Deposit to MagicBlock'
    : prepared.action === 'withdraw'
      ? 'Withdraw from MagicBlock'
      : 'Private PER transfer';
  return (
    <ModalShell title={`Review ${actionLabel.toLowerCase()}`} subtitle="MagicBlock built this transaction; Flay checked its signer, accounts, amount, programs, and destination network." onClose={onClose} className="review-modal magic-review-modal">
      <div className="review-live-label"><CheckCircle2 size={15} /> Exact message validated · expires {new Date(prepared.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
      <div className="review-amount"><span>{actionLabel}</span><strong>{atomicToDecimal(prepared.amountAtomic, prepared.decimals)} <small>{prepared.symbol}</small></strong></div>
      <div className="review-rows">
        <div><span>Provider</span><strong>{prepared.provider}</strong></div>
        <div><span>Execution mode</span><strong>{prepared.review.mode}</strong></div>
        <div><span>From</span><strong>{prepared.review.source}</strong></div>
        <div><span>To</span><strong className={prepared.recipient ? 'mono' : ''}>{prepared.recipient ? shortAddress(prepared.recipient, 7) : prepared.review.destination}</strong></div>
        <div><span>Submit to</span><strong>{prepared.sendTo === 'base' ? 'Solana mainnet' : 'MagicBlock ephemeral RPC'}</strong></div>
        <div><span>Provider token fee</span><strong>{atomicToDecimal(prepared.review.providerFees.tokens, prepared.decimals)} {prepared.symbol}</strong></div>
        <div><span>Provider lamport fee</span><strong>{atomicToDecimal(prepared.review.providerFees.lamports, 9)} SOL</strong></div>
        <div><span>Flay fee</span><strong>0%</strong></div>
        <div><span>Message fingerprint</span><strong className="mono">{prepared.messageHash.slice(0, 12)}…{prepared.messageHash.slice(-8)}</strong></div>
      </div>
      <ul className="review-warnings">{prepared.review.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
      {error && <InlineError message={error} />}
      <button className="modal-primary" disabled={busy || Date.now() >= prepared.expiresAt} onClick={onSubmit}>
        {busy ? <><LoaderCircle className="spin" size={16} /> Waiting for wallet and network</> : <>Sign this exact transaction <ArrowRight size={17} /></>}
      </button>
      <p className="review-footnote">After signing, Flay verifies the wallet signature and unchanged message before MagicBlock submits it.</p>
    </ModalShell>
  );
}

function MagicBlockSuccessModal({
  execution,
  onClose,
  onReturn,
}: {
  execution: MagicBlockExecution;
  onClose: () => void;
  onReturn: () => void;
}) {
  return (
    <ModalShell title={execution.confirmed ? 'MagicBlock transaction confirmed' : 'MagicBlock transaction submitted'} subtitle={`Submitted to ${execution.networkLabel}.`} onClose={onClose} className="success-modal">
      <div className="success-mark"><CheckCircle2 size={31} /></div>
      <div className="success-details"><span>Provider</span><strong>{execution.provider}</strong><span>Network</span><strong>{execution.networkLabel}</strong><span>Signature</span><strong>{shortAddress(execution.signature, 8)}</strong></div>
      {execution.explorerUrl && <a className="modal-primary link-button" href={execution.explorerUrl} target="_blank" rel="noreferrer">Open Solana Explorer <ExternalLink size={16} /></a>}
      <button className={execution.explorerUrl ? 'modal-secondary' : 'modal-primary'} onClick={onReturn}>Return to MagicBlock account</button>
    </ModalShell>
  );
}

function SetupModal({ health, onClose }: { health: HealthResponse | null; onClose: () => void }) {
  return (
    <ModalShell title="Wallet signing is unavailable" subtitle="Live market data remains available, but this deployment cannot authenticate wallet signatures yet." onClose={onClose} className="setup-modal">
      <div className="setup-status"><span className={health?.readiness.privy ? 'ready' : ''}>{health?.readiness.privy ? <Check size={14} /> : <AlertCircle size={14} />} Identity service</span><span className={import.meta.env.VITE_PRIVY_APP_ID ? 'ready' : ''}>{import.meta.env.VITE_PRIVY_APP_ID ? <Check size={14} /> : <AlertCircle size={14} />} Wallet connection</span></div>
      <p className="setup-note"><Info size={15} /> Ask the Flay deployment operator to finish wallet authentication setup, then reload this page.</p>
    </ModalShell>
  );
}

export function ReviewModal({
  prepared,
  busy,
  error,
  sponsoredSubmitted = false,
  onClose,
  onSubmit,
}: {
  prepared: PreparedTransaction;
  busy: boolean;
  error: string | null;
  sponsoredSubmitted?: boolean;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const input = prepared.review.inputToken;
  const output = prepared.review.outputToken;
  const sponsored = prepared.kind === 'market-swap' && prepared.gasPayment?.mode === 'provider-sponsored';
  const stock = prepared.review.stock;
  const sponsorName = prepared.gasPayment?.provider ?? 'provider';
  const title = stock ? `Review ${stock.side === 'buy' ? 'stock purchase' : 'stock sale'}` : prepared.kind === 'market-swap' ? 'Review exact conversion' : prepared.kind === 'limit-create' ? 'Review Jupiter limit order' : 'Review order recovery';
  const displayPreparedAmount = (value: string | undefined, token: TokenInfo | undefined) => {
    if (!value || !token) return '—';
    return stock && token.mint === stock.mint
      ? scaledAtomicToDecimal(value, token.decimals, stock.multiplier.value)
      : formatAtomic(value, token);
  };
  return (
    <ModalShell title={title} subtitle="The values below come from the transaction Flay just rebuilt, checked, and simulated." onClose={onClose} className="review-modal">
      <div className="review-live-label"><CheckCircle2 size={15} /> Exact message validated · expires {new Date(prepared.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
      {input && prepared.review.inputAmount && <div className="review-amount"><span>{prepared.kind === 'limit-cancel' ? 'Principal returned' : stock?.side === 'sell' ? 'You sell' : 'You pay'}</span><strong>{displayPreparedAmount(prepared.review.inputAmount, input)} <small>{input.symbol}</small></strong></div>}
      {prepared.kind !== 'limit-cancel' && output && (
        <>
          <div className="review-arrow"><ArrowDown size={18} /></div>
          <div className="review-amount receive"><span>{stock?.side === 'buy' ? 'Fresh estimated shares' : stock?.side === 'sell' ? 'Fresh estimated proceeds' : prepared.kind === 'market-swap' ? 'Fresh estimated output' : 'Minimum order output'}</span><strong>{displayPreparedAmount(prepared.review.expectedOutput, output)} <small>{output.symbol}</small></strong></div>
        </>
      )}
      <div className="review-rows">
        <div><span>Execution provider</span><strong>{prepared.providerLabel}</strong></div>
        {prepared.review.routeLabel && <div><span>Built route</span><strong>{prepared.review.routeLabel}</strong></div>}
        {prepared.review.priceImpactPct !== undefined && prepared.review.priceImpactPct !== null && <div><span>Estimated price impact</span><strong>{prepared.review.priceImpactPct.toFixed(3)}%</strong></div>}
        {prepared.review.fees?.map((fee, index) => <div key={`${fee.label}:${index}`}><span>{fee.label}</span><strong>{fee.amountAtomic && fee.mint === input?.mint && input ? `${displayPreparedAmount(fee.amountAtomic, input)} ${input.symbol}` : fee.detail}</strong></div>)}
        {prepared.review.minimumOutput && output && <div><span>Enforced minimum</span><strong>{displayPreparedAmount(prepared.review.minimumOutput, output)} {output.symbol}</strong></div>}
        {stock && <><div><span>Official xStocks mint</span><strong className="mono">{shortAddress(stock.mint, 7)}</strong></div><div><span>Scaled UI multiplier</span><strong>{stock.multiplier.value}× · {new Date(stock.multiplier.fetchedAt).toLocaleTimeString()}</strong></div><div><span>Issuer reference</span><strong>{stock.referencePrice ? `${stock.referencePrice} USD` : 'Unavailable'}</strong></div></>}
        {prepared.review.slippageBps !== undefined && <div><span>Slippage bound</span><strong>{prepared.review.slippageBps / 100}%</strong></div>}
        <div><span>Network gas</span><strong>{sponsored ? `Sponsored by ${sponsorName}` : prepared.gasPayment?.totalWalletDebitLamports ? `${atomicToDecimal(prepared.gasPayment.totalWalletDebitLamports, 9)} SOL total · paid by wallet` : prepared.review.networkFeeLamports ? `${atomicToDecimal(prepared.review.networkFeeLamports, 9)} SOL · paid by wallet` : 'Paid by wallet · RPC could not estimate'}</strong></div>
        {!sponsored && prepared.gasPayment?.rentFeeLamports && BigInt(prepared.gasPayment.rentFeeLamports) > 0n && <div><span>Account rent / required SOL</span><strong>{atomicToDecimal(prepared.gasPayment.rentFeeLamports, 9)} SOL</strong></div>}
        {prepared.gasPayment && <div><span>Gas payer</span><strong className="mono">{prepared.gasPayment.feePayer ? shortAddress(prepared.gasPayment.feePayer, 7) : 'Assigned by Privy at broadcast'}</strong></div>}
        <div><span>Flay fee</span><strong>0%</strong></div>
        <div><span>Message fingerprint</span><strong className="mono">{prepared.messageHash.slice(0, 12)}…{prepared.messageHash.slice(-8)}</strong></div>
        {prepared.review.order && <div><span>Jupiter order account</span><strong className="mono">{shortAddress(prepared.review.order, 7)}</strong></div>}
      </div>
      {sponsored && <div className="gas-sponsored-note"><Sparkles size={16} /><span><strong>No SOL network gas required for this order.</strong>{prepared.gasPayment?.detail}</span></div>}
      {prepared.review.custody && <div className="custody-review"><LockKeyhole size={15} /><span>{prepared.review.custody}</span></div>}
      <ul className="review-warnings">{prepared.review.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
      {error && <InlineError message={error} />}
      <button className="modal-primary" disabled={busy || (!sponsoredSubmitted && Date.now() >= prepared.expiresAt)} onClick={onSubmit}>
        {busy ? <><LoaderCircle className="spin" size={16} /> Waiting for wallet and network</> : <>{sponsoredSubmitted ? 'Verify sponsored transaction' : sponsored ? 'Sign gasless swap' : 'Sign this exact transaction'} <ArrowRight size={17} /></>}
      </button>
      <p className="review-footnote">{sponsorName === 'Jupiter' && sponsored ? 'After signing, Flay verifies your wallet signature and exact message. Jupiter then adds its payer signature and submits the transaction.' : sponsorName === 'Privy' && sponsored ? 'Privy sponsors and broadcasts the reviewed transaction. Flay then verifies its venue, wallet signature, amounts, and non-user fee payer on Solana.' : 'After signing, Flay compares the message bytes again and runs signature-verified simulation before submission.'}</p>
    </ModalShell>
  );
}

function ActivityPage({
  authenticated,
  wallet,
  rows,
  historyOrders,
  catalog,
  loading,
  filter,
  error,
  onFilter,
  onRefresh,
  onLogin,
  onConvert,
}: {
  authenticated: boolean;
  wallet: string | null;
  rows: Array<{ stored: StoredActivity; onchain: ActivityRecord | null; error: string | null }>;
  historyOrders: TriggerOrder[];
  catalog: Record<string, TokenInfo>;
  loading: boolean;
  filter: 'All' | 'Market' | 'Limit' | 'Stock';
  error: string | null;
  onFilter: (filter: 'All' | 'Market' | 'Limit' | 'Stock') => void;
  onRefresh: () => void;
  onLogin: () => void;
  onConvert: () => void;
}) {
  const showHistory = filter === 'All' || filter === 'Limit';
  return (
    <main className="page-content activity-page">
      <section className="page-intro">
        <div className="intro-copy"><div className="eyebrow"><span className="eyebrow-line" /> CONFIRMED WALLET DELTAS</div><h1>Every move, <em>in view.</em></h1><p>Market signatures are reconciled against Solana; Jupiter supplies limit-order history.</p></div>
      </section>
      <section className="activity-card">
        <div className="activity-card-head">
          <div><span className="card-eyebrow">CONVERSION ACTIVITY</span><h2>{wallet ? shortAddress(wallet, 6) : 'Your transactions'}</h2></div>
          <div className="activity-controls">
            <div className="activity-filters">{(['All', 'Market', 'Limit', 'Stock'] as const).map((value) => <button key={value} className={filter === value ? 'active' : ''} onClick={() => onFilter(value)}>{value}</button>)}</div>
            <button className="refresh-button" onClick={onRefresh} disabled={loading}><RefreshCw size={14} className={loading ? 'spin' : ''} /></button>
          </div>
        </div>
        {!authenticated ? (
          <div className="empty-activity"><div className="empty-activity-icon"><Wallet size={27} /></div><span className="empty-eyebrow">SIGN IN REQUIRED</span><h3>Reconnect your wallet</h3><p>Flay verifies that every activity signature belongs to your embedded Solana wallet.</p><button onClick={onLogin}>Sign in <ArrowRight size={16} /></button></div>
        ) : !loading && !rows.length && (!showHistory || !historyOrders.length) ? (
          <div className="empty-activity"><div className="empty-activity-icon"><Activity size={27} /></div><span className="empty-eyebrow">NO MATCHING ACTIVITY</span><h3>Your ledger starts here</h3><p>Completed conversions and Jupiter Trigger history will appear with real onchain status.</p><button onClick={onConvert}>Open Convert <ArrowRight size={16} /></button></div>
        ) : (
          <div className="activity-list">
            {rows.map(({ stored, onchain, error: rowError }) => (
              <article className="activity-row" key={stored.signature}>
                <div className={`activity-status-icon ${onchain?.status ?? 'pending'}`}>{onchain?.status === 'confirmed' ? <Check size={16} /> : onchain?.status === 'failed' ? <X size={16} /> : <Clock3 size={16} />}</div>
                <div className="activity-main"><span><strong>{stored.kind} · {stored.stock ? `${stored.stock.side === 'buy' ? 'Buy' : 'Sell'} ${stored.stock.symbol}` : stored.provider}</strong><small>{stored.stock ? `${stored.provider} · multiplier ${stored.stock.multiplier.value}×` : activityGasPaymentLabel(stored.gasPayment)}</small><small>{onchain?.blockTime ? new Date(onchain.blockTime * 1000).toLocaleString() : new Date(stored.createdAt).toLocaleString()}</small></span><div className="delta-list">{onchain?.deltas.map((delta) => { const display = stored.stock && delta.mint === stored.stock.mint ? scaledAtomicToDecimal(delta.amountAtomic, delta.decimals, stored.stock.multiplier.value) : delta.uiAmount; return <b className={BigInt(delta.amountAtomic) >= 0n ? 'positive' : 'negative'} key={delta.mint}>{BigInt(delta.amountAtomic) >= 0n ? '+' : ''}{display} {delta.symbol}</b>; })}{rowError && <em>{rowError}</em>}</div></div>
                <a href={onchain?.explorerUrl ?? `https://explorer.solana.com/tx/${stored.signature}?cluster=mainnet-beta`} target="_blank" rel="noreferrer" aria-label="Open in Solana Explorer"><ExternalLink size={16} /></a>
              </article>
            ))}
            {showHistory && historyOrders.map((order) => {
              const input = catalog[order.inputMint];
              const output = catalog[order.outputMint];
              return (
                <article className="activity-row trigger-history-row" key={order.order}>
                  <div className="activity-status-icon confirmed"><Clock3 size={16} /></div>
                  <div className="activity-main"><span><strong>Limit · Jupiter Trigger V1</strong><small>{order.createdAt ? new Date(order.createdAt).toLocaleString() : shortAddress(order.order)}</small></span><div className="delta-list"><b>{formatAtomic(order.makingAmount, input)} {input?.symbol ?? shortAddress(order.inputMint, 3)} → {formatAtomic(order.takingAmount, output)} {output?.symbol ?? shortAddress(order.outputMint, 3)}</b><em>{order.status}</em></div></div>
                  <a href={`https://explorer.solana.com/address/${order.order}?cluster=mainnet-beta`} target="_blank" rel="noreferrer" aria-label="Open order account in Solana Explorer"><ExternalLink size={16} /></a>
                </article>
              );
            })}
          </div>
        )}
        {error && <InlineError message={error} />}
      </section>
    </main>
  );
}

function InlineError({ message }: { message: string }) {
  return <div className="inline-error" role="alert"><AlertCircle size={14} /><span>{message}</span></div>;
}

function isStoredStockContext(value: unknown): value is StockTradeContext {
  if (!value || typeof value !== 'object') return false;
  const stock = value as Partial<StockTradeContext>;
  const multiplier = stock.multiplier as Partial<StockTradeContext['multiplier']> | undefined;
  return (stock.side === 'buy' || stock.side === 'sell')
    && typeof stock.symbol === 'string'
    && typeof stock.mint === 'string'
    && typeof stock.expectedOutputDisplay === 'string'
    && Boolean(multiplier && typeof multiplier.value === 'string' && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(multiplier.value));
}

function readStoredActivity(wallet: string): StoredActivity[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(activityStorageKey(wallet)) ?? '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is StoredActivity => {
      if (item === null || typeof item !== 'object') return false;
      const stored = item as StoredActivity;
      if (typeof stored.signature !== 'string' || !['Market', 'Limit', 'Stock'].includes(stored.kind)) return false;
      return stored.kind !== 'Stock' || isStoredStockContext(stored.stock);
    }).slice(0, 50);
  } catch {
    return [];
  }
}

function writeStoredActivity(wallet: string, entry: StoredActivity): void {
  const current = readStoredActivity(wallet).filter((item) => item.signature !== entry.signature);
  localStorage.setItem(activityStorageKey(wallet), JSON.stringify([entry, ...current].slice(0, 50)));
}

export default App;
