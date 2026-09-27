import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/dm-sans';
import '@fontsource-variable/sora';
import App from './App';
import ErrorBoundary from './ErrorBoundary';
import { ConfiguredPrivyApp } from './PrivyRoot';
import { unconfiguredAuth } from './auth';
import './styles.css';

const privyAppId = import.meta.env.VITE_PRIVY_APP_ID?.trim();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      {privyAppId ? <ConfiguredPrivyApp appId={privyAppId} /> : <App auth={unconfiguredAuth} />}
    </ErrorBoundary>
  </React.StrictMode>,
);
