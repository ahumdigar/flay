import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

const appUrl = process.env.FLAY_BROWSER_URL ?? 'http://127.0.0.1:5173';
const cdpHttp = process.env.FLAY_CDP_URL ?? 'http://127.0.0.1:9222';
let ownedBrowser = null;
async function loadTargets() {
  return fetch(`${cdpHttp}/json/list`).then((response) => {
    if (!response.ok) throw new Error(`CDP returned ${response.status}.`);
    return response.json();
  });
}
let targets;
try {
  targets = await loadTargets();
} catch {
  const candidates = [process.env.CHROMIUM_BIN, process.env.PREFIX ? `${process.env.PREFIX}/lib/chromium/headless_shell` : null, '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean);
  const binary = candidates.find((filename) => existsSync(filename));
  if (!binary) throw new Error('No Chromium CDP endpoint or supported local Chromium binary is available.');
  ownedBrowser = spawn(binary, ['--no-sandbox', '--single-process', '--no-zygote', '--disable-gpu', '--disable-dev-shm-usage', '--remote-debugging-port=9222', 'about:blank'], { stdio: 'ignore' });
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try { targets = await loadTargets(); break; } catch { await new Promise((resolve) => setTimeout(resolve, 150)); }
  }
}
const target = targets?.find((entry) => entry.type === 'page' && entry.webSocketDebuggerUrl);
if (!target) {
  ownedBrowser?.kill('SIGTERM');
  throw new Error('No Chromium page target is available.');
}

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Timed out connecting to Chromium.')), 5_000);
  socket.addEventListener('open', () => { clearTimeout(timeout); resolve(); }, { once: true });
  socket.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('Chromium CDP connection failed.')); }, { once: true });
});

let nextId = 1;
const pending = new Map();
const runtimeExceptions = [];
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    clearTimeout(waiter.timeout);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
    return;
  }
  if (message.method === 'Runtime.exceptionThrown') {
    runtimeExceptions.push(message.params.exceptionDetails.text ?? 'Uncaught browser exception');
  }
});

function command(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP ${method} timed out.`));
    }, 45_000);
    pending.set(id, { resolve, reject, timeout });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const response = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text ?? 'Browser evaluation failed.');
  return response.result.value;
}

async function waitForText(text, timeoutMs = 30_000) {
  const encoded = JSON.stringify(text);
  return evaluate(`new Promise((resolve, reject) => {
    const deadline = Date.now() + ${timeoutMs};
    const poll = () => {
      if (document.body?.innerText.includes(${encoded})) return resolve(true);
      if (Date.now() >= deadline) return reject(new Error('Timed out waiting for ' + ${encoded}));
      setTimeout(poll, 100);
    };
    poll();
  })`);
}

async function waitForCompleteStockCatalog(timeoutMs = 150_000) {
  return evaluate(`new Promise((resolve, reject) => {
    const deadline = Date.now() + ${timeoutMs};
    const poll = async () => {
      try {
        const response = await fetch('/api/stocks');
        const catalog = await response.json();
        if (response.ok && catalog.directoryComplete === true) return resolve(true);
      } catch {
        // The Stocks page has its own explicit provider-unavailable state.
      }
      if (Date.now() >= deadline) return reject(new Error('Timed out waiting for the complete official xStocks catalog.'));
      setTimeout(poll, 500);
    };
    poll();
  })`);
}

async function waitForStockDirectoryUi(timeoutMs = 20_000) {
  return evaluate(`new Promise((resolve, reject) => {
    const deadline = Date.now() + ${timeoutMs};
    const poll = () => {
      const buttons = document.querySelectorAll('.stock-quick-switch nav button:not(.all)');
      if (buttons.length >= 9) return resolve(true);
      if (Date.now() >= deadline) return reject(new Error('Timed out waiting for the complete xStocks directory in the browser.'));
      setTimeout(poll, 100);
    };
    poll();
  })`);
}

async function waitForInitialStockPrices(timeoutMs = 20_000) {
  return evaluate(`new Promise((resolve, reject) => {
    const deadline = Date.now() + ${timeoutMs};
    const poll = () => {
      const rows = [...document.querySelectorAll('.stock-list > button')];
      const values = rows.map((row) => row.querySelector('.stock-list-price strong')?.textContent.trim());
      if (rows.length === 12 && values.every((value) => value && value !== 'Loading…' && value !== 'Unavailable')) return resolve(true);
      if (Date.now() >= deadline) return reject(new Error('Timed out waiting for all twelve initial xStock prices.'));
      setTimeout(poll, 100);
    };
    poll();
  })`);
}

async function openFutures(width, height) {
  await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false, screenWidth: width, screenHeight: height });
  await command('Page.navigate', { url: appUrl });
  await waitForText('Convert, considered.', 20_000);
  const clicked = await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((entry) => entry.textContent.trim() === 'Futures');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) throw new Error('Futures navigation control was not found.');
  await waitForText('PERPETUAL FUTURES', 20_000);
  await new Promise((resolve) => setTimeout(resolve, 4_000));
}

async function exerciseFuturesControls() {
  return evaluate(`(async () => {
    const chartSnapshot = () => [...document.querySelectorAll('.futures-chart-canvas canvas')].map((canvas) => canvas.toDataURL()).join('|');
    const click = (selector, label) => {
      const button = [...document.querySelectorAll(selector)].find((node) => node.textContent.trim() === label);
      if (!button) return null;
      button.click();
      return button;
    };
    const before = chartSnapshot();
    const phoenix = click('.route-choice-head button', 'Phoenix');
    await new Promise((resolve) => setTimeout(resolve, 150));
    const routeActive = Boolean(phoenix?.classList.contains('active'));
    const stable = before === chartSnapshot();
    const short = click('.direction-tabs button', 'Short');
    const limit = click('.order-tabs button', 'Limit');
    await new Promise((resolve) => setTimeout(resolve, 50));
    const tradeControls = Boolean(short?.classList.contains('active') && limit?.classList.contains('active') && document.querySelector('input[placeholder="0.00"]'));
    click('.direction-tabs button', 'Long');
    click('.order-tabs button', 'Market');
    click('.route-choice-head button', 'Auto');
    return { chartStableAcrossRouteChoice: stable, routeControlInteractive: routeActive, tradeControlsInteractive: tradeControls };
  })()`);
}

async function exerciseModalKeyboard() {
  return evaluate(`(async () => {
    const manage = [...document.querySelectorAll('.collateral-ledger button')].find((node) => node.textContent.includes('Manage'));
    if (!manage) return { keyboardModalOpened: false, keyboardInitialFocus: false, keyboardFocusTrapped: false, keyboardEscapeClosed: false, keyboardFocusRestored: false };
    manage.focus();
    manage.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const dialog = document.querySelector('[role="dialog"]');
    const close = dialog?.querySelector('button[aria-label="Close"]');
    const focusable = dialog ? [...dialog.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')] : [];
    const initial = document.activeElement === close;
    close?.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    const trapped = focusable.length > 0 && document.activeElement === focusable.at(-1);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    return {
      keyboardModalOpened: Boolean(dialog),
      keyboardInitialFocus: initial,
      keyboardFocusTrapped: trapped,
      keyboardEscapeClosed: !document.querySelector('[role="dialog"]'),
      keyboardFocusRestored: document.activeElement === manage,
    };
  })()`);
}

async function exercisePortfolioRowLayout() {
  return evaluate(`(() => {
    const host = document.querySelector('.futures-portfolio-card');
    if (!host) return { portfolioRowFits: false, portfolioTableFits: false, portfolioLabelsVisible: false, portfolioActionVisible: false };
    const table = document.createElement('div');
    table.className = 'portfolio-table audit-portfolio-probe';
    const row = document.createElement('div');
    row.className = 'portfolio-row portfolio-position-row';
    const fields = [
      ['strong', 'Market', 'SOL-PERP', 'portfolio-market'],
      ['span', 'Side', 'long', 'long'],
      ['span', 'Venue', 'phoenix', ''],
      ['span', 'Size', '0.001 SOL', ''],
      ['span', 'Entry', '$117.50', ''],
      ['span', 'Unrealized PnL', '$0.0005', ''],
    ];
    for (const [tag, label, value, className] of fields) {
      const node = document.createElement(tag);
      node.dataset.label = label;
      node.textContent = value;
      node.className = className;
      row.append(node);
    }
    const button = document.createElement('button');
    button.textContent = 'Manage position';
    row.append(button);
    table.append(row);
    host.append(table);
    const hostBox = host.getBoundingClientRect();
    const rowBox = row.getBoundingClientRect();
    const buttonBox = button.getBoundingClientRect();
    const firstField = row.querySelector('[data-label]');
    const labelsVisible = firstField ? getComputedStyle(firstField, '::before').display !== 'none' : false;
    const result = {
      portfolioRowFits: rowBox.left >= hostBox.left - 1 && rowBox.right <= hostBox.right + 1 && rowBox.right <= innerWidth + 1,
      portfolioTableFits: table.scrollWidth <= table.clientWidth + 1,
      portfolioLabelsVisible: labelsVisible,
      portfolioActionVisible: buttonBox.left >= hostBox.left - 1 && buttonBox.right <= hostBox.right + 1 && buttonBox.width > 0,
    };
    table.remove();
    return result;
  })()`);
}

async function exerciseShellRegression() {
  return evaluate(`(async () => {
    const visibleButton = (label) => [...document.querySelectorAll('button')].find((node) => {
      const box = node.getBoundingClientRect();
      return node.textContent.trim() === label && box.width > 0 && box.height > 0;
    });
    const activity = visibleButton('Activity');
    activity?.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const activityVisible = document.body.innerText.includes('Reconnect your wallet') && document.body.innerText.includes('Activity');
    const wallet = visibleButton('Wallet');
    wallet?.focus();
    wallet?.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const walletDialogVisible = Boolean(document.querySelector('[role="dialog"]')) && (document.body.innerText.includes('Welcome to Flay') || document.body.innerText.includes('Your Solana wallet') || document.body.innerText.includes('Wallet signing is unavailable'));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    const walletRecovered = !document.querySelector('[role="dialog"]') && document.activeElement === wallet;
    visibleButton('Convert')?.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const convertVisible = document.body.innerText.includes('Convert, considered.');
    const gaslessScopeVisible = document.body.innerText.includes('Gas sponsorship eligibility is verified on the exact review.');
    return { activityVisible, walletDialogVisible, walletRecovered, convertVisible, gaslessScopeVisible };
  })()`);
}

async function exerciseFundsPage() {
  const clicked = await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((node) => {
      const box = node.getBoundingClientRect();
      return ['Add funds', 'Funds'].includes(node.textContent.trim()) && box.width > 0 && box.height > 0;
    });
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) throw new Error('Add funds navigation control was not found.');
  await waitForText('Add funds, directly.', 20_000);
  await new Promise((resolve) => setTimeout(resolve, 500));
  return evaluate(`(() => ({
    addFundsVisible: document.body.innerText.includes('Buy Solana USDC'),
    providerBoundaryVisible: document.body.innerText.includes("Privy's provider handles the regulated flow"),
    custodyBoundaryVisible: document.body.innerText.includes('Flay never receives card, bank, or KYC data'),
    destinationVisible: document.body.innerText.includes('USDC on Solana'),
    environmentVisible: document.body.innerText.includes('Privy onramp sandbox.') || document.body.innerText.includes('Live provider checkout.'),
    isolatedActionVisible: document.body.innerText.includes('Provider checkout opens in a separate tab'),
    gaslessSendVisible: document.body.innerText.includes('PRIVY GAS SPONSORSHIP') && document.body.innerText.includes('Existing recipient account'),
    gaslessBoundaryVisible: document.body.innerText.includes('USDC only · Existing recipient account · 0% Flay fee'),
    sendShortcutAboveFold: (() => {
      const node = document.querySelector('.funds-send-action');
      if (!node || node.getAttribute('href') !== '#send-usdc') return false;
      const box = node.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && box.top >= 0 && box.bottom <= innerHeight;
    })(),
    sendShortcutTargetsForm: Boolean(document.querySelector('.funds-send-action[href="#send-usdc"]') && document.querySelector('#send-usdc.gasless-send-card')),
    safePaymentFields: [...document.querySelectorAll('.funds-page input')].every((node) => ['Fiat amount', 'USDC recipient wallet', 'USDC send amount'].includes(node.getAttribute('aria-label'))),
    noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth + 1,
  }))()`);
}

async function auditStocks(width, height) {
  await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false, screenWidth: width, screenHeight: height });
  await command('Page.navigate', { url: appUrl });
  await waitForText('Convert, considered.', 20_000);
  const clicked = await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((node) => {
      const box = node.getBoundingClientRect();
      return node.textContent.trim() === 'Stocks' && box.width > 0 && box.height > 0;
    });
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) throw new Error('Stocks navigation control was not found.');
  await waitForText('TOKENIZED EQUITIES ON SOLANA', 20_000);
  await waitForText('Apple xStock', 30_000);
  await waitForCompleteStockCatalog();
  await waitForStockDirectoryUi();
  const initialPricesVisible = await waitForInitialStockPrices();
  const switchedStock = await evaluate(`(() => {
    const button = [...document.querySelectorAll('.stock-quick-switch nav button')].find((node) => node.textContent.trim() === 'NVDA');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (switchedStock) await waitForText('NVIDIA xStock', 20_000);
  const searchTarget = await evaluate(`(async () => {
    const response = await fetch('/api/stocks');
    const catalog = await response.json();
    const previewSymbols = new Set(['AAPLX', 'NVDAX', 'TSLAX', 'MSFTX', 'AMZNX', 'GOOGLX', 'METAX', 'SPYX', 'QQQX', 'NFLXX', 'AVGOX', 'COINX']);
    const asset = [...catalog.assets].reverse().find((candidate) => !previewSymbols.has(candidate.symbol.toUpperCase()));
    const input = document.querySelector('.stock-search input');
    if (!asset || !input) return null;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, asset.symbol);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return { symbol: asset.symbol, underlyingSymbol: asset.underlyingSymbol };
  })()`);
  if (searchTarget) await waitForText(searchTarget.underlyingSymbol, 20_000);
  const encodedSearchSymbol = JSON.stringify(searchTarget?.symbol ?? '');
  const encodedSearchLabel = JSON.stringify(searchTarget?.underlyingSymbol ?? '');
  return evaluate(`(() => ({
    pageVisible: document.body.innerText.includes('Markets, within reach.'),
    officialDirectoryVisible: document.body.innerText.includes('MARKET DIRECTORY') && document.body.innerText.includes('Canonical symbols and Solana mints'),
    referenceSeparated: (document.body.innerText.includes('Issuer reference') || document.body.innerText.includes('Market reference')) && document.body.innerText.includes('EXECUTION ROUTE'),
    multiplierVisible: document.body.innerText.includes('Scaled UI Amount'),
    providerVisible: document.body.innerText.includes('xStocks × Jupiter'),
    disclosureVisible: document.body.innerText.includes('Tokenized security') && document.body.innerText.includes('does not provide brokerage'),
    buySellVisible: [...document.querySelectorAll('.stock-side-tabs button')].map((node) => node.textContent.trim()).join(',') === 'Buy,Sell',
    popularStocks: [...document.querySelectorAll('.stock-quick-switch nav button:not(.all)')].map((node) => node.textContent.trim()),
    allStocksVisible: Boolean([...document.querySelectorAll('.stock-quick-switch button.all')].find((node) => node.textContent.includes('All stocks'))),
    catalogCountVisible: /\\d[\\d,]+ supported/.test(document.body.innerText),
    initialPricesVisible: ${JSON.stringify(initialPricesVisible)},
    featuredSelectionWorks: document.querySelector('.stock-quick-switch button.active')?.textContent.trim() === 'NVDA' && document.body.innerText.includes('NVIDIA xStock'),
    fullCatalogSearchWorks: Boolean(${encodedSearchSymbol}) && [...document.querySelectorAll('.stock-list > button')].some((node) => node.textContent.includes(${encodedSearchLabel})),
    noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth + 1,
    mobileNavColumns: getComputedStyle(document.querySelector('.mobile-nav')).gridTemplateColumns.split(' ').filter(Boolean).length,
  }))()`);
}

async function auditIsolatedCheckout(width, height) {
  const checkoutUrl = new URL(appUrl);
  checkoutUrl.searchParams.set('flay-onramp', '1');
  checkoutUrl.searchParams.set('fiat', 'USD');
  checkoutUrl.searchParams.set('amount', '50.00');
  checkoutUrl.searchParams.set('request', '76ae2dac-cc25-4bbb-8ef5-576f25b19620');
  await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false, screenWidth: width, screenHeight: height });
  await command('Page.navigate', { url: checkoutUrl.toString() });
  await waitForText('ISOLATED PROVIDER CHECKOUT', 20_000);
  await evaluate(`new Promise((resolve) => {
    const deadline = Date.now() + 3000;
    const poll = () => {
      if (sessionStorage.getItem('flay:privy-onramp-route:v1') || Date.now() >= deadline) return resolve(true);
      setTimeout(poll, 50);
    };
    poll();
  })`);
  return evaluate(`(() => ({
    pageVisible: document.body.innerText.includes('Buy Solana USDC'),
    isolationExplained: document.body.innerText.includes('original Flay trading tab remains available'),
    deliberateLaunchVisible: document.body.innerText.includes('Sign in to continue') || document.body.innerText.includes('Continue to provider'),
    manualProviderAbsent: !document.body.innerText.includes('Open MoonPay directly') && !document.body.innerText.includes('Try automatic provider'),
    regionalRoute: sessionStorage.getItem('flay:privy-onramp-route:v1'),
    destinationVisible: document.body.innerText.includes('Native USDC · Solana'),
    environmentVisible: document.body.innerText.includes('Real payment') || document.body.innerText.includes('Sandbox test'),
    closeVisible: document.body.innerText.includes('Close this checkout tab'),
    noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth + 1,
  }))()`);
}

function auditExpression(mode, width) {
  return `(() => {
    const visible = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return false;
      const style = getComputedStyle(node);
      const box = node.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0;
    };
    const layout = document.querySelector('.futures-layout');
    const review = document.querySelector('.futures-review-button');
    const intervalLabels = [...document.querySelectorAll('.chart-intervals button')].map((node) => node.textContent.trim());
    const routeLabels = [...document.querySelectorAll('.route-choice-head button')].map((node) => node.textContent.trim());
    return {
      mode: ${JSON.stringify(mode)},
      viewport: { width: innerWidth, height: innerHeight },
      bodyScrollWidth: document.documentElement.scrollWidth,
      noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth + 1,
      overflowingElements: [...document.querySelectorAll('body *')].map((node) => {
        const box = node.getBoundingClientRect();
        return { node: node.tagName.toLowerCase() + (node.className && typeof node.className === 'string' ? '.' + node.className.trim().replace(/\s+/g, '.') : ''), left: Math.round(box.left), right: Math.round(box.right), width: Math.round(box.width), scrollWidth: node.scrollWidth };
      }).filter((item) => item.right > innerWidth + 1 || item.left < -1).sort((a, b) => b.right - a.right).slice(0, 20),
      chartVisible: visible('.futures-chart-card'),
      ticketVisible: visible('.futures-ticket'),
      portfolioVisible: visible('.futures-portfolio-card'),
      reviewVisible: visible('.futures-review-button'),
      intervalLabels,
      routeLabels,
      columns: layout ? getComputedStyle(layout).gridTemplateColumns.split(' ').filter(Boolean).length : 0,
      sidebarDisplay: getComputedStyle(document.querySelector('.sidebar')).display,
      mobileNavDisplay: getComputedStyle(document.querySelector('.mobile-nav')).display,
      reviewPosition: review ? getComputedStyle(review).position : null,
      mobileNavColumns: getComputedStyle(document.querySelector('.mobile-nav')).gridTemplateColumns.split(' ').filter(Boolean).length,
      chartAttribution: document.body.innerText.includes('Charts by TradingView'),
      honestDataState: document.body.innerText.includes('Latest candle') || document.body.innerText.includes('Freshness unavailable'),
    };
  })()`;
}

await command('Page.enable');
await command('Runtime.enable');
const outputDir = path.resolve('artifacts/browser');
mkdirSync(outputDir, { recursive: true });
const results = [];

await openFutures(1440, 1000);
results.push({ ...(await evaluate(auditExpression('desktop', 1440))), ...(await exercisePortfolioRowLayout()), ...(await exerciseFuturesControls()), ...(await exerciseModalKeyboard()) });
let shot = await command('Page.captureScreenshot', { format: 'png', fromSurface: true });
writeFileSync(path.join(outputDir, 'futures-desktop.png'), Buffer.from(shot.data, 'base64'));
const desktopFunds = await exerciseFundsPage();
shot = await command('Page.captureScreenshot', { format: 'png', fromSurface: true });
writeFileSync(path.join(outputDir, 'funds-desktop.png'), Buffer.from(shot.data, 'base64'));
const desktopStocks = await auditStocks(1440, 1000);
shot = await command('Page.captureScreenshot', { format: 'png', fromSurface: true });
writeFileSync(path.join(outputDir, 'stocks-desktop.png'), Buffer.from(shot.data, 'base64'));

await openFutures(390, 844);
results.push({ ...(await evaluate(auditExpression('mobile', 390))), ...(await exercisePortfolioRowLayout()), ...(await exerciseFuturesControls()), ...(await exerciseModalKeyboard()) });
shot = await command('Page.captureScreenshot', { format: 'png', fromSurface: true });
writeFileSync(path.join(outputDir, 'futures-mobile.png'), Buffer.from(shot.data, 'base64'));
const shellRegression = await exerciseShellRegression();
const mobileFunds = await exerciseFundsPage();
shot = await command('Page.captureScreenshot', { format: 'png', fromSurface: true });
writeFileSync(path.join(outputDir, 'funds-mobile.png'), Buffer.from(shot.data, 'base64'));
const mobileStocks = await auditStocks(390, 844);
shot = await command('Page.captureScreenshot', { format: 'png', fromSurface: true });
writeFileSync(path.join(outputDir, 'stocks-mobile.png'), Buffer.from(shot.data, 'base64'));
const desktopCheckout = await auditIsolatedCheckout(900, 900);
shot = await command('Page.captureScreenshot', { format: 'png', fromSurface: true });
writeFileSync(path.join(outputDir, 'onramp-checkout-desktop.png'), Buffer.from(shot.data, 'base64'));
const mobileCheckout = await auditIsolatedCheckout(390, 844);
shot = await command('Page.captureScreenshot', { format: 'png', fromSurface: true });
writeFileSync(path.join(outputDir, 'onramp-checkout-mobile.png'), Buffer.from(shot.data, 'base64'));

const [desktop, mobile] = results;
const expectedIntervals = ['1m', '5m', '15m', '1h', '4h', '1d'];
const expectedRoutes = ['Auto', 'Phoenix', 'GMTrade'];
const checks = [
  desktop.noHorizontalOverflow && mobile.noHorizontalOverflow,
  desktop.chartVisible && desktop.ticketVisible && desktop.portfolioVisible && desktop.reviewVisible,
  mobile.chartVisible && mobile.ticketVisible && mobile.portfolioVisible && mobile.reviewVisible,
  desktop.columns === 2 && mobile.columns === 1,
  desktop.sidebarDisplay !== 'none' && mobile.sidebarDisplay === 'none',
  desktop.mobileNavDisplay === 'none' && mobile.mobileNavDisplay !== 'none',
  mobile.reviewPosition === 'sticky' && mobile.mobileNavColumns === 6,
  expectedIntervals.every((value) => desktop.intervalLabels.includes(value) && mobile.intervalLabels.includes(value)),
  expectedRoutes.every((value) => desktop.routeLabels.includes(value) && mobile.routeLabels.includes(value)),
  desktop.chartAttribution && mobile.chartAttribution && desktop.honestDataState && mobile.honestDataState,
  desktop.chartStableAcrossRouteChoice && mobile.chartStableAcrossRouteChoice,
  desktop.routeControlInteractive && mobile.routeControlInteractive && desktop.tradeControlsInteractive && mobile.tradeControlsInteractive,
  desktop.keyboardModalOpened && mobile.keyboardModalOpened && desktop.keyboardInitialFocus && mobile.keyboardInitialFocus,
  desktop.keyboardFocusTrapped && mobile.keyboardFocusTrapped && desktop.keyboardEscapeClosed && mobile.keyboardEscapeClosed,
  desktop.keyboardFocusRestored && mobile.keyboardFocusRestored,
  desktop.portfolioRowFits && desktop.portfolioTableFits && desktop.portfolioActionVisible && !desktop.portfolioLabelsVisible,
  mobile.portfolioRowFits && mobile.portfolioTableFits && mobile.portfolioActionVisible && mobile.portfolioLabelsVisible,
  shellRegression.activityVisible && shellRegression.walletDialogVisible && shellRegression.walletRecovered && shellRegression.convertVisible && shellRegression.gaslessScopeVisible,
  desktopFunds.addFundsVisible && mobileFunds.addFundsVisible && desktopFunds.providerBoundaryVisible && mobileFunds.providerBoundaryVisible,
  desktopFunds.custodyBoundaryVisible && mobileFunds.custodyBoundaryVisible && desktopFunds.destinationVisible && mobileFunds.destinationVisible,
  desktopFunds.environmentVisible && mobileFunds.environmentVisible && desktopFunds.isolatedActionVisible && mobileFunds.isolatedActionVisible && desktopFunds.safePaymentFields && mobileFunds.safePaymentFields,
  desktopFunds.gaslessSendVisible && mobileFunds.gaslessSendVisible && desktopFunds.gaslessBoundaryVisible && mobileFunds.gaslessBoundaryVisible,
  desktopFunds.sendShortcutAboveFold && mobileFunds.sendShortcutAboveFold && desktopFunds.sendShortcutTargetsForm && mobileFunds.sendShortcutTargetsForm,
  desktopFunds.noHorizontalOverflow && mobileFunds.noHorizontalOverflow,
  desktopStocks.pageVisible && mobileStocks.pageVisible && desktopStocks.officialDirectoryVisible && mobileStocks.officialDirectoryVisible,
  desktopStocks.referenceSeparated && mobileStocks.referenceSeparated && desktopStocks.multiplierVisible && mobileStocks.multiplierVisible,
  desktopStocks.providerVisible && mobileStocks.providerVisible && desktopStocks.disclosureVisible && mobileStocks.disclosureVisible,
  desktopStocks.buySellVisible && mobileStocks.buySellVisible && desktopStocks.noHorizontalOverflow && mobileStocks.noHorizontalOverflow,
  desktopStocks.popularStocks.length >= 9 && mobileStocks.popularStocks.length >= 9 && desktopStocks.allStocksVisible && mobileStocks.allStocksVisible,
  desktopStocks.catalogCountVisible && mobileStocks.catalogCountVisible,
  desktopStocks.initialPricesVisible && mobileStocks.initialPricesVisible,
  desktopStocks.featuredSelectionWorks && mobileStocks.featuredSelectionWorks,
  desktopStocks.fullCatalogSearchWorks && mobileStocks.fullCatalogSearchWorks,
  mobileStocks.mobileNavColumns === 6,
  desktopCheckout.pageVisible && mobileCheckout.pageVisible && desktopCheckout.isolationExplained && mobileCheckout.isolationExplained,
  desktopCheckout.deliberateLaunchVisible && mobileCheckout.deliberateLaunchVisible && desktopCheckout.destinationVisible && mobileCheckout.destinationVisible,
  desktopCheckout.manualProviderAbsent && mobileCheckout.manualProviderAbsent,
  ['privy-quotes', 'moonpay'].includes(desktopCheckout.regionalRoute) && ['privy-quotes', 'moonpay'].includes(mobileCheckout.regionalRoute),
  desktopCheckout.environmentVisible && mobileCheckout.environmentVisible && desktopCheckout.closeVisible && mobileCheckout.closeVisible,
  desktopCheckout.noHorizontalOverflow && mobileCheckout.noHorizontalOverflow,
  runtimeExceptions.length === 0,
];
if (checks.some((value) => !value)) {
  console.error(JSON.stringify({ results, shellRegression, desktopFunds, mobileFunds, desktopStocks, mobileStocks, desktopCheckout, mobileCheckout, runtimeExceptions }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ results, shellRegression, desktopFunds, mobileFunds, desktopStocks, mobileStocks, desktopCheckout, mobileCheckout, runtimeExceptions, screenshots: ['artifacts/browser/futures-desktop.png', 'artifacts/browser/futures-mobile.png', 'artifacts/browser/funds-desktop.png', 'artifacts/browser/funds-mobile.png', 'artifacts/browser/stocks-desktop.png', 'artifacts/browser/stocks-mobile.png', 'artifacts/browser/onramp-checkout-desktop.png', 'artifacts/browser/onramp-checkout-mobile.png'] }, null, 2));
}
socket.close();
ownedBrowser?.kill('SIGTERM');
