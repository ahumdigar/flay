import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';

const appUrl = process.env.FLAY_BROWSER_URL ?? 'http://127.0.0.1:5173';
const cdpHttp = process.env.FLAY_CDP_URL ?? 'http://127.0.0.1:9222';
let ownedBrowser = null;
const loadTargets = () => fetch(`${cdpHttp}/json/list`).then((response) => {
  if (!response.ok) throw new Error(`CDP returned ${response.status}.`);
  return response.json();
});
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
if (!target) throw new Error('No Chromium page target is available.');

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
  } else if (message.method === 'Runtime.exceptionThrown') {
    runtimeExceptions.push(message.params.exceptionDetails.text ?? 'Uncaught browser exception');
  }
});
function command(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP ${method} timed out.`)); }, 30_000);
    pending.set(id, { resolve, reject, timeout });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const response = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text ?? 'Browser evaluation failed.');
  return response.result.value;
}
async function audit(width, height) {
  await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false, screenWidth: width, screenHeight: height });
  const url = new URL(appUrl);
  url.searchParams.set('flay-onramp', '1');
  url.searchParams.set('fiat', 'USD');
  url.searchParams.set('amount', '50.00');
  url.searchParams.set('request', '76ae2dac-cc25-4bbb-8ef5-576f25b19620');
  await command('Page.navigate', { url: url.toString() });
  await evaluate(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 20000;
    const poll = () => {
      if (document.body?.innerText.includes('ISOLATED PROVIDER CHECKOUT')) return resolve(true);
      if (Date.now() >= deadline) return reject(new Error('Timed out waiting for checkout'));
      setTimeout(poll, 100);
    };
    poll();
  })`);
  await evaluate(`new Promise((resolve) => {
    const deadline = Date.now() + 3000;
    const poll = () => {
      if (sessionStorage.getItem('flay:privy-onramp-route:v1') || Date.now() >= deadline) return resolve(true);
      setTimeout(poll, 50);
    };
    poll();
  })`);
  return evaluate(`(() => ({
    viewport: { width: innerWidth, height: innerHeight },
    production: document.body.innerText.includes('Real payment'),
    destination: document.body.innerText.includes('Native USDC · Solana'),
    automatic: document.body.innerText.includes('Sign in to continue') || document.body.innerText.includes('Continue to provider'),
    manualProviderAbsent: !document.body.innerText.includes('Open MoonPay directly') && !document.body.innerText.includes('Try automatic provider'),
    regionalRoute: sessionStorage.getItem('flay:privy-onramp-route:v1'),
    isolated: document.body.innerText.includes('original Flay trading tab remains available'),
    noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth + 1,
  }))()`);
}

await command('Page.enable');
await command('Runtime.enable');
const desktop = await audit(900, 900);
const mobile = await audit(390, 844);
const checks = [desktop, mobile].flatMap((result) => [result.production, result.destination, result.automatic, result.manualProviderAbsent, result.regionalRoute === 'moonpay', result.isolated, result.noHorizontalOverflow]);
if (checks.some((value) => !value) || runtimeExceptions.length) {
  console.error(JSON.stringify({ desktop, mobile, runtimeExceptions }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ desktop, mobile, runtimeExceptions }, null, 2));
}
socket.close();
ownedBrowser?.kill('SIGTERM');
