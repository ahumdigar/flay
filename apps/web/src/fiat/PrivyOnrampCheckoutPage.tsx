import { AlertCircle, ArrowRight, CheckCircle2, CreditCard, LoaderCircle, ShieldCheck, X } from 'lucide-react';
import { useState } from 'react';
import type { FlayAuth } from '../auth';
import {
  PRIVY_ONRAMP_CHECKOUT_CHANNEL,
  readablePrivyOnrampError,
  type PrivyOnrampCheckoutIntent,
  type PrivyOnrampStatus,
} from '../privy-fiat-onramp';

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-6)}`;
}

export default function PrivyOnrampCheckoutPage({
  auth,
  intent,
}: {
  auth: FlayAuth;
  intent: PrivyOnrampCheckoutIntent;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<PrivyOnrampStatus | null>(null);

  async function openProvider() {
    if (!auth.authenticated) {
      auth.login();
      return;
    }
    if (!auth.walletReady || !auth.walletAddress) {
      setError('Your embedded Solana wallet is still loading. Wait a moment and retry.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await auth.fundUsdcWithFiat({ fiat: intent.fiat, amount: intent.amount });
      setStatus(response.status);
      if ('BroadcastChannel' in window) {
        const channel = new BroadcastChannel(PRIVY_ONRAMP_CHECKOUT_CHANNEL);
        channel.postMessage({
          type: 'flay:privy-onramp-result',
          requestId: intent.requestId,
          status: response.status,
          fiat: intent.fiat,
          amount: intent.amount,
          wallet: auth.walletAddress,
        });
        channel.close();
      }
    } catch (cause) {
      setError(readablePrivyOnrampError(cause));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="onramp-window">
      <section className="onramp-window-card">
        <div className="onramp-window-brand"><span className="brand-mark">F</span><strong>flay.</strong><button onClick={() => window.close()} aria-label="Close checkout tab"><X size={18} /></button></div>
        <div className="onramp-window-icon"><CreditCard size={25} /></div>
        <span className="card-eyebrow">ISOLATED PROVIDER CHECKOUT</span>
        <h1>Buy Solana USDC</h1>
        <p>Privy and its selected provider will open in this tab. Your original Flay trading tab remains available if SMS, KYC, or provider service is delayed.</p>

        <div className="onramp-window-summary">
          <div><span>Starting amount</span><strong>{intent.amount} {intent.fiat}</strong></div>
          <div><span>Destination</span><strong>Native USDC · Solana</strong></div>
          <div><span>Wallet</span><strong>{auth.walletAddress ? shortAddress(auth.walletAddress) : 'Loading…'}</strong></div>
          <div><span>Environment</span><strong>{auth.fiatOnrampEnvironment === 'production' ? 'Real payment' : 'Sandbox test'}</strong></div>
        </div>

        <div className="onramp-window-note"><ShieldCheck size={17} /><span>Use your real residence, phone, and identity details. The provider controls eligibility, verification, pricing, and delivery.</span></div>

        {error && <div className="fiat-error" role="alert"><AlertCircle size={16} /><span>{error}</span></div>}
        {status && <div className="checkout-ready" role="status"><CheckCircle2 size={18} /><div><strong>{status === 'confirmed' ? 'Provider confirmed purchase' : status === 'submitted' ? 'Purchase submitted' : 'Provider flow closed'}</strong><small>{status === 'provider-exited' ? 'Check the provider result, then return to Flay and refresh your USDC balance.' : 'Return to Flay and refresh your USDC balance.'}</small></div></div>}

        {!status && (
          <button className="review-button" disabled={loading || (auth.authenticated && !auth.walletReady)} onClick={() => void openProvider()}>
            {loading ? <><LoaderCircle className="spin" size={18} /> Opening available provider</> : !auth.authenticated ? <>Sign in to continue <ArrowRight size={18} /></> : <>Continue to provider <ArrowRight size={18} /></>}
          </button>
        )}
        <button className="onramp-window-close" onClick={() => window.close()}>Close this checkout tab</button>
      </section>
    </main>
  );
}
