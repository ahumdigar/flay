import {
  AlertCircle,
  ArrowRight,
  Banknote,
  Check,
  CheckCircle2,
  Copy,
  CreditCard,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  Send,
  ShieldCheck,
  Smartphone,
  Wallet,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { atomicToDecimal } from '../../shared/amounts';
import { USDC_MINT } from '../../shared/constants';
import type { WalletBalances } from '../../shared/types';
import type { FlayAuth } from '../auth';
import {
  PRIVY_ONRAMP_FIAT,
  PRIVY_ONRAMP_CHECKOUT_CHANNEL,
  assertPrivyOnrampFiat,
  buildPrivyOnrampCheckoutUrl,
  isPrivyOnrampCheckoutResult,
  normalizePrivyOnrampAmount,
  type PrivyOnrampFiat,
  type PrivyOnrampStatus,
} from '../privy-fiat-onramp';
import GaslessUsdcSend from './GaslessUsdcSend';

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-6)}`;
}

function normalizeInput(value: string): string {
  const filtered = value.replace(/[^0-9.]/g, '');
  const [whole = '', ...parts] = filtered.split('.');
  return parts.length ? `${whole}.${parts.join('').slice(0, 2)}` : whole;
}

interface OnrampResult {
  status: PrivyOnrampStatus;
  fiat: PrivyOnrampFiat;
  amount: string;
  wallet: string;
}

export default function FundsPage({
  auth,
  balances,
  onBalanceRefresh,
}: {
  auth: FlayAuth;
  balances: WalletBalances | null;
  onBalanceRefresh: () => void;
}) {
  const [amount, setAmount] = useState('50.00');
  const [fiat, setFiat] = useState<PrivyOnrampFiat>('USD');
  const [result, setResult] = useState<OnrampResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const checkoutRequestRef = useRef<string | null>(null);
  const refreshOnFocusRef = useRef(false);

  const normalizedAmount = useMemo(() => normalizePrivyOnrampAmount(amount), [amount]);
  const usdcBalance = balances?.balances.find((item) => item.token.mint === USDC_MINT);

  useEffect(() => {
    if (!('BroadcastChannel' in window)) return undefined;
    const channel = new BroadcastChannel(PRIVY_ONRAMP_CHECKOUT_CHANNEL);
    channel.onmessage = (event: MessageEvent<unknown>) => {
      const requestId = checkoutRequestRef.current;
      const wallet = auth.walletAddress;
      if (!requestId || !wallet || !isPrivyOnrampCheckoutResult(event.data, requestId, wallet)) return;
      setResult({ status: event.data.status, fiat: event.data.fiat, amount: event.data.amount, wallet });
      setCheckoutOpen(false);
      refreshOnFocusRef.current = false;
      onBalanceRefresh();
    };
    return () => channel.close();
  }, [auth.walletAddress, onBalanceRefresh]);

  useEffect(() => {
    const refreshAfterCheckout = () => {
      if (!refreshOnFocusRef.current) return;
      refreshOnFocusRef.current = false;
      onBalanceRefresh();
    };
    window.addEventListener('focus', refreshAfterCheckout);
    return () => window.removeEventListener('focus', refreshAfterCheckout);
  }, [onBalanceRefresh]);

  async function openOnramp() {
    if (!auth.authenticated) return auth.login();
    if (!auth.walletReady || !auth.walletAddress) {
      setError('Your embedded Solana wallet is still loading. Wait a moment and retry.');
      return;
    }
    if (!normalizedAmount) {
      setError('Enter a fiat amount from 1.00 to 1,000.00. The provider confirms its final regional limit.');
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const requestId = window.crypto.randomUUID();
      const checkoutUrl = buildPrivyOnrampCheckoutUrl(window.location.href, fiat, normalizedAmount, requestId);
      const checkoutWindow = window.open(checkoutUrl, '_blank');
      if (!checkoutWindow) throw new Error('Your browser blocked the checkout tab. Allow popups for Flay and retry.');
      checkoutWindow.opener = null;
      checkoutRequestRef.current = requestId;
      refreshOnFocusRef.current = true;
      setCheckoutOpen(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Flay could not open the checkout tab.');
    } finally {
      setLoading(false);
    }
  }

  async function copyWallet() {
    if (!auth.walletAddress) return;
    try {
      await navigator.clipboard.writeText(auth.walletAddress);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setError('Your browser blocked clipboard access. Select the wallet address and copy it manually.');
    }
  }

  return (
    <main className="page-content funds-page">
      <section className="page-intro funds-intro">
        <div className="intro-copy">
          <div className="eyebrow"><span className="eyebrow-line" /> FIAT TO SOLANA</div>
          <h1>Add funds, <em>directly.</em></h1>
          <p>Buy Solana USDC through Privy's secure onramp and receive it in your exportable wallet.</p>
        </div>
        <div className="intro-aside"><span className="intro-aside-icon"><Banknote size={18} /></span><div><strong>Non-custodial delivery</strong><span>Privy onramp → your wallet</span></div></div>
      </section>

      <nav className="funds-action-nav" aria-label="Funds actions">
        <a href="#buy-usdc"><CreditCard size={16} /><span><strong>Buy USDC</strong><small>Cards with Privy</small></span></a>
        <a className="funds-send-action" href="#send-usdc"><Send size={16} /><span><strong>Send USDC</strong><small>Gasless with Privy</small></span><ArrowRight size={16} /></a>
      </nav>

      {auth.fiatOnrampEnvironment === 'sandbox' && (
        <div className="fiat-test-banner"><AlertCircle size={16} /><span><strong>Privy onramp sandbox.</strong> Test the complete card flow without moving real funds. Production requires an explicit environment switch and provider availability.</span></div>
      )}
      {auth.fiatOnrampEnvironment === 'production' && (
        <div className="fiat-live-banner"><AlertCircle size={16} /><span><strong>Live provider checkout.</strong> Quotes, identity verification, and payments are real. Review the provider and fees before authorizing payment.</span></div>
      )}

      <div className="funds-grid">
        <section className="fiat-card funding-card" id="buy-usdc">
          <div className="card-head"><div><span className="card-eyebrow">PRIVY CARD ONRAMP</span><h2>Buy Solana USDC</h2></div><span className="privy-mark">P</span></div>

          <label className="fiat-field">
            <span>Starting amount</span>
            <div>
              <input value={amount} inputMode="decimal" autoComplete="off" onChange={(event) => { setAmount(normalizeInput(event.target.value)); setResult(null); setError(null); }} aria-label="Fiat amount" />
              <select value={fiat} onChange={(event) => { setFiat(assertPrivyOnrampFiat(event.target.value)); setResult(null); setError(null); }} aria-label="Fiat currency">
                {PRIVY_ONRAMP_FIAT.map((currency) => <option key={currency}>{currency}</option>)}
              </select>
            </div>
            <small>Privy selects an available provider for your region. That provider confirms the final minimum, quote, fees, and eligibility.</small>
          </label>

          <div className="fiat-destination">
            <div className="usdc-orb">$</div>
            <span><small>FIXED DESTINATION</small><strong>Native USDC on Solana</strong><em>{auth.walletAddress ? shortAddress(auth.walletAddress) : 'Sign in to create your wallet'}</em></span>
            <CheckCircle2 size={17} />
          </div>

          <div className="fiat-review">
            <div><span>Orchestrator</span><strong>Privy</strong></div>
            <div><span>Possible provider</span><strong>Stripe · Meld · MoonPay · Coinbase</strong></div>
            <div><span>Flay custody</span><strong>None</strong></div>
            <div><span>Flay fee</span><strong>0%</strong></div>
          </div>

          <div className="onramp-methods" aria-label="Possible payment methods">
            <span><CreditCard size={14} /> Debit or credit card</span>
            <span><Smartphone size={14} /> Apple Pay or Google Pay</span>
          </div>

          {error && <div className="fiat-error" role="alert"><AlertCircle size={16} /><span>{error}</span></div>}

          {checkoutOpen && <div className="fiat-checkout-open" role="status"><CheckCircle2 size={16} /><span><strong>Checkout opened in a separate tab.</strong> You can keep trading in Flay. Close the checkout tab if its provider becomes stuck.</span></div>}

          <p className="fiat-isolation-note"><ShieldCheck size={14} /> Provider checkout opens in a separate tab so delayed SMS or KYC cannot block Flay trading.</p>

          <button className="review-button" disabled={loading || (auth.authenticated && (!auth.walletReady || !normalizedAmount))} onClick={() => void openOnramp()}>
            {loading ? <><LoaderCircle className="spin" size={18} /> Opening secure checkout</> : !auth.authenticated ? <><Wallet size={18} /> Sign in to add funds</> : <><span>Open checkout in separate tab</span><ArrowRight size={18} /></>}
          </button>
          <p className="trade-card-footnote"><ShieldCheck size={15} /> Privy's regulated provider receives payment and KYC data. Flay never receives card, bank, or KYC data.</p>

          {result && (
            <div className="checkout-ready" role="status">
              <span className="checkout-ready-icon"><Check size={18} /></span>
              <div>
                <strong>{result.status === 'confirmed' ? 'Provider confirmed purchase' : result.status === 'submitted' ? 'Purchase submitted' : 'Provider flow closed'}</strong>
                <small>{result.amount} {result.fiat} · USDC on Solana · {shortAddress(result.wallet)}</small>
              </div>
              <button onClick={onBalanceRefresh}><RefreshCw size={14} /> Refresh balance</button>
              <p>{result.status === 'confirmed' ? 'Privy reports completion. Solana balance remains the final delivery record.' : result.status === 'submitted' ? 'The provider is finalizing payment or delivery. Check your wallet balance again shortly.' : 'Flay did not receive an authoritative purchase status. Refresh the wallet balance to verify whether funds arrived.'}</p>
            </div>
          )}
        </section>

        <div className="funds-side">
          <section className="fiat-card wallet-receive-card">
            <div className="fiat-section-head"><div><span className="card-eyebrow">RECEIVING WALLET</span><h2>Your Solana account</h2></div><LockKeyhole size={18} /></div>
            {auth.walletAddress ? <><code>{auth.walletAddress}</code><button onClick={() => void copyWallet()}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? 'Copied' : 'Copy wallet'}</button></> : <button className="empty-action" onClick={auth.login}>Sign in to create your wallet <ArrowRight size={15} /></button>}
            <div className="wallet-usdc-balance"><span>Confirmed USDC</span><strong>{usdcBalance ? atomicToDecimal(usdcBalance.amountAtomic, 6) : '—'} <small>USDC</small></strong><button onClick={onBalanceRefresh}><RefreshCw size={13} /> Refresh balance</button></div>
          </section>

          <GaslessUsdcSend auth={auth} balances={balances} onBalanceRefresh={onBalanceRefresh} />

          <section className="fiat-card provider-boundary-card">
            <span className="provider-boundary-icon"><ShieldCheck size={19} /></span>
            <div><strong>Privy's provider handles the regulated flow</strong><p>Provider choice, payment methods, identity checks, pricing, fees, and availability stay inside Privy's secure modal. USDC is delivered directly to the wallet above.</p></div>
          </section>
        </div>
      </div>

      <section className="fiat-card fiat-orders-card onramp-explainer">
        <div className="fiat-section-head"><div><span className="card-eyebrow">PROVIDER ROUTING</span><h2>One checkout, available provider.</h2></div><ShieldCheck size={18} /></div>
        <div className="onramp-steps">
          <div><span>1</span><strong>Flay fixes the destination</strong><p>Your authenticated wallet, native Solana USDC, and the Solana network are set inside the Privy bridge.</p></div>
          <div><span>2</span><strong>Privy selects availability</strong><p>Stripe, Meld, MoonPay, or Coinbase may serve the checkout based on currency and region.</p></div>
          <div><span>3</span><strong>Solana confirms delivery</strong><p>Refresh the wallet balance after submission. Flay does not fabricate provider orders or settlement.</p></div>
        </div>
        <p className="onramp-coverage-note"><AlertCircle size={14} /> USD, EUR, AUD, and BRL are enabled in this launch UI. BDT and broader coverage require Meld configuration and KYB in the Privy Dashboard.</p>
      </section>
    </main>
  );
}
