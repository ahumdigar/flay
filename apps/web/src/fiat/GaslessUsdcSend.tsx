import bs58 from 'bs58';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { atomicToDecimal, decimalToAtomic } from '../../shared/amounts';
import { USDC_MINT } from '../../shared/constants';
import type {
  GaslessUsdcSendPrepared,
  GaslessUsdcSendStatus,
  RecentGaslessUsdcSend,
  WalletBalances,
} from '../../shared/types';
import type { FlayAuth } from '../auth';
import { api, fromBase64, readableError } from '../lib/api';

const MAX_RECENT_SENDS = 5;

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-6)}`;
}

export function normalizeUsdcSendAmount(value: string): string | null {
  return /^\d*(?:\.\d{0,6})?$/.test(value) ? value : null;
}

function storageKey(wallet: string): string {
  return `flay:gasless-usdc-sends:${wallet}`;
}

export function parseStoredGaslessSends(value: string | null, wallet: string): RecentGaslessUsdcSend[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item): RecentGaslessUsdcSend[] => {
      if (!item || typeof item !== 'object') return [];
      const row = item as Partial<RecentGaslessUsdcSend>;
      if (
        row.wallet !== wallet
        || typeof row.signature !== 'string'
        || !/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(row.signature)
        || typeof row.recipient !== 'string'
        || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(row.recipient)
        || typeof row.amountAtomic !== 'string'
        || !/^[1-9]\d*$/.test(row.amountAtomic)
        || typeof row.createdAt !== 'number'
        || !Number.isFinite(row.createdAt)
        || !['pending', 'confirmed', 'failed'].includes(row.status ?? '')
      ) return [];
      return [{
        signature: row.signature,
        wallet,
        recipient: row.recipient,
        amountAtomic: row.amountAtomic,
        createdAt: row.createdAt,
        status: row.status as RecentGaslessUsdcSend['status'],
      }];
    }).slice(0, MAX_RECENT_SENDS);
  } catch {
    return [];
  }
}

export function sponsorshipError(cause: unknown): string {
  const message = readableError(cause);
  if (/sponsor|credit|billing|tee stack|fee payer/i.test(message)) {
    return `${message} Check Privy Fee sponsorship credits, Solana mainnet, TEE execution, and client sponsorship settings.`;
  }
  return message;
}

export function GaslessUsdcReview({
  prepared,
  busy,
  error,
  onClose,
  onApprove,
}: {
  prepared: GaslessUsdcSendPrepared;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onApprove: () => void;
}) {
  const modalRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const closeAction = useRef(onClose);
  const busyState = useRef(busy);
  closeAction.current = onClose;
  busyState.current = busy;

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyState.current) {
        event.preventDefault();
        closeAction.current();
        return;
      }
      if (event.key !== 'Tab' || !modalRef.current) return;
      const controls = [...modalRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])')];
      if (!controls.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previous?.focus();
    };
  }, []);

  return (
    <div className="send-review-overlay" role="presentation">
      <section ref={modalRef} className="send-review-modal" role="dialog" aria-modal="true" aria-labelledby="send-review-title">
        <button ref={closeRef} className="send-review-close" onClick={onClose} disabled={busy} aria-label="Close review"><X size={17} /></button>
        <span className="send-review-icon"><Send size={20} /></span>
        <div className="card-eyebrow">EXACT TRANSACTION REVIEW</div>
        <h2 id="send-review-title">Send {prepared.amountUi} USDC</h2>
        <p>Verify the full destination before approving the embedded wallet.</p>
        <div className="send-review-details">
          <div><span>Asset</span><strong>USDC · Solana</strong></div>
          <div><span>Amount</span><strong>{prepared.amountUi} USDC</strong></div>
          <div className="wide"><span>Recipient</span><code>{prepared.recipient}</code></div>
          <div><span>Network gas</span><strong>Sponsored by Privy</strong></div>
          <div><span>Flay fee</span><strong>{prepared.review.flayFeePercent}%</strong></div>
        </div>
        <div className="send-sponsored-note"><Sparkles size={16} /><span><strong>No SOL network gas required.</strong>{prepared.gasPayment.detail}</span></div>
        {prepared.review.warnings.map((warning) => <p className="send-review-warning" key={warning}><ShieldCheck size={14} />{warning}</p>)}
        {error && <div className="fiat-error" role="alert"><AlertCircle size={16} /><span>{error}</span></div>}
        <button className="review-button" disabled={busy || prepared.expiresAt <= Date.now()} onClick={onApprove}>
          {busy ? <><LoaderCircle className="spin" size={17} /> Waiting for Privy and Solana</> : <>Approve gasless send <ArrowRight size={17} /></>}
        </button>
        <p className="send-review-footnote">Privy will show a separate approval. Flay submits no wallet-paid fallback.</p>
      </section>
    </div>
  );
}

export default function GaslessUsdcSend({
  auth,
  balances,
  onBalanceRefresh,
}: {
  auth: FlayAuth;
  balances: WalletBalances | null;
  onBalanceRefresh: () => void;
}) {
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [prepared, setPrepared] = useState<GaslessUsdcSendPrepared | null>(null);
  const [recent, setRecent] = useState<RecentGaslessUsdcSend[]>([]);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const usdcBalance = balances?.balances.find((item) => item.token.mint === USDC_MINT);

  useEffect(() => {
    if (!auth.walletAddress || typeof window === 'undefined') {
      setRecent([]);
      return;
    }
    setRecent(parseStoredGaslessSends(window.localStorage.getItem(storageKey(auth.walletAddress)), auth.walletAddress));
  }, [auth.walletAddress]);

  useEffect(() => {
    if (!auth.walletAddress || typeof window === 'undefined') return;
    window.localStorage.setItem(storageKey(auth.walletAddress), JSON.stringify(recent.slice(0, MAX_RECENT_SENDS)));
  }, [auth.walletAddress, recent]);

  const refreshSignature = useCallback(async (signature: string) => {
    if (!auth.walletAddress || !auth.identityToken) return;
    setRefreshing(signature);
    try {
      const row = recent.find((item) => item.signature === signature);
      if (!row) return;
      const activity = await api<GaslessUsdcSendStatus>('/transfers/usdc/status', {
        method: 'POST',
        identityToken: auth.identityToken,
        body: JSON.stringify({
          signature,
          wallet: auth.walletAddress,
          recipient: row.recipient,
          amountAtomic: row.amountAtomic,
        }),
      });
      setRecent((current) => current.map((row) => row.signature === signature ? { ...row, status: activity.status } : row));
      if (activity.status === 'confirmed') onBalanceRefresh();
      if (activity.status === 'failed') setError(activity.error ? `Solana rejected the send: ${activity.error}` : 'Solana rejected the USDC send.');
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setRefreshing(null);
    }
  }, [auth.identityToken, auth.walletAddress, onBalanceRefresh, recent]);

  useEffect(() => {
    const pending = recent.filter((row) => row.status === 'pending').map((row) => row.signature);
    if (!pending.length || !auth.identityToken) return;
    const timer = window.setTimeout(() => pending.forEach((signature) => void refreshSignature(signature)), 4_000);
    return () => window.clearTimeout(timer);
  }, [auth.identityToken, recent, refreshSignature]);

  const amountAtomic = useMemo(() => {
    try {
      const atomic = decimalToAtomic(amount, 6);
      return BigInt(atomic) > 0n ? atomic : null;
    } catch {
      return null;
    }
  }, [amount]);
  const formValid = Boolean(
    auth.walletAddress
    && amountAtomic
    && recipient.trim() !== auth.walletAddress
    && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(recipient.trim())
    && usdcBalance
    && BigInt(amountAtomic ?? '0') <= BigInt(usdcBalance.amountAtomic),
  );

  async function prepareSend() {
    if (!auth.authenticated) return auth.login();
    if (!auth.walletAddress || !auth.identityToken || !amountAtomic || !formValid) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api<GaslessUsdcSendPrepared>('/transfers/usdc/prepare', {
        method: 'POST',
        identityToken: auth.identityToken,
        body: JSON.stringify({ wallet: auth.walletAddress, recipient: recipient.trim(), amountAtomic }),
      });
      setPrepared(result);
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function approveSend() {
    if (!prepared || prepared.expiresAt <= Date.now()) {
      setPrepared(null);
      setError('This review expired. Prepare the send again for a fresh Solana blockhash.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const signatureBytes = await auth.signAndSendSponsoredTransaction(fromBase64(prepared.transaction));
      const signature = bs58.encode(signatureBytes);
      if (!/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(signature)) throw new Error('Privy returned a malformed Solana signature.');
      const row: RecentGaslessUsdcSend = {
        signature,
        wallet: prepared.wallet,
        recipient: prepared.recipient,
        amountAtomic: prepared.amountAtomic,
        createdAt: Date.now(),
        status: 'pending',
      };
      setRecent((current) => [row, ...current.filter((item) => item.signature !== signature)].slice(0, MAX_RECENT_SENDS));
      setPrepared(null);
      setAmount('');
      setRecipient('');
    } catch (cause) {
      setError(sponsorshipError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="fiat-card gasless-send-card" id="send-usdc">
      <div className="fiat-section-head"><div><span className="card-eyebrow">PRIVY GAS SPONSORSHIP</span><h2>Send USDC</h2></div><span className="gasless-send-badge"><Sparkles size={13} /> Gasless</span></div>
      <p className="gasless-send-intro">Send USDC from your embedded wallet without holding SOL. The recipient must already have a Solana USDC account.</p>

      <label className="send-field"><span>Recipient wallet</span><input value={recipient} onChange={(event) => { setRecipient(event.target.value.trim()); setPrepared(null); }} autoComplete="off" spellCheck={false} placeholder="Solana address" aria-label="USDC recipient wallet" /></label>
      <label className="send-field"><span>Amount <small>Available: {usdcBalance ? atomicToDecimal(usdcBalance.amountAtomic, 6) : '—'} USDC</small></span><div><input value={amount} onChange={(event) => { const normalized = normalizeUsdcSendAmount(event.target.value); if (normalized !== null) { setAmount(normalized); setPrepared(null); } }} inputMode="decimal" autoComplete="off" placeholder="0.00" aria-label="USDC send amount" /><strong>USDC</strong><button type="button" disabled={!usdcBalance} onClick={() => setAmount(usdcBalance ? atomicToDecimal(usdcBalance.amountAtomic, 6) : '')}>Max</button></div></label>

      {error && <div className="fiat-error" role="alert"><AlertCircle size={16} /><span>{error}</span></div>}
      <button className="send-prepare-button" disabled={busy || (auth.authenticated && !formValid)} onClick={() => void prepareSend()}>
        {busy && !prepared ? <><LoaderCircle className="spin" size={17} /> Checking exact transfer</> : !auth.authenticated ? <>Sign in to send <ArrowRight size={16} /></> : <>Review gasless send <ArrowRight size={16} /></>}
      </button>
      <p className="send-boundary"><ShieldCheck size={14} /> USDC only · Existing recipient account · 0% Flay fee</p>

      {recent.length > 0 && <div className="recent-send-list">
        <div className="recent-send-title"><span>Recent sends</span><small>Solana is authoritative</small></div>
        {recent.map((row) => <article key={row.signature}>
          <span className={`recent-send-status ${row.status}`}>{row.status === 'confirmed' ? <CheckCircle2 size={15} /> : row.status === 'failed' ? <AlertCircle size={15} /> : <Clock3 size={15} />}</span>
          <div><strong>{atomicToDecimal(row.amountAtomic, 6)} USDC</strong><small>To {shortAddress(row.recipient)} · {row.status}</small></div>
          <button disabled={refreshing === row.signature} onClick={() => void refreshSignature(row.signature)} aria-label="Refresh send status"><RefreshCw className={refreshing === row.signature ? 'spin' : ''} size={14} /></button>
          <a href={`https://explorer.solana.com/tx/${encodeURIComponent(row.signature)}?cluster=mainnet-beta`} target="_blank" rel="noopener noreferrer" aria-label="Open transaction in Explorer"><ExternalLink size={14} /></a>
        </article>)}
      </div>}

      {prepared && <GaslessUsdcReview prepared={prepared} busy={busy} error={error} onClose={() => { if (!busy) setPrepared(null); }} onApprove={() => void approveSend()} />}
    </section>
  );
}
