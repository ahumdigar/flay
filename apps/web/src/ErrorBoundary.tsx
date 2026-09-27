import { Component, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  failed: boolean;
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: '#f4f7f2', color: '#193126', fontFamily: 'system-ui, sans-serif' }}>
        <section role="alert" style={{ width: 'min(100%, 420px)', padding: 24, border: '1px solid #dce7da', borderRadius: 16, background: '#fff', boxShadow: '0 20px 60px #17301c1c' }}>
          <strong style={{ display: 'block', fontSize: 20 }}>Flay needs to recover this screen</strong>
          <p style={{ margin: '10px 0 18px', color: '#66786b', lineHeight: 1.55 }}>Your transaction was not submitted from this screen. Reload Flay and check Activity before trying again.</p>
          <button type="button" onClick={() => window.location.reload()} style={{ width: '100%', height: 44, border: 0, borderRadius: 9, color: '#fff', background: '#193328', fontWeight: 750 }}>Reload Flay</button>
        </section>
      </main>
    );
  }
}
