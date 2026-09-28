import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const shippedRoots = [
  ...['src', 'server', 'shared'].map((entry) => path.join(root, entry)),
  path.resolve(root, '../../services/gmtrade-adapter/src'),
];
const sourceExtensions = new Set(['.ts', '.tsx', '.css', '.html', '.rs']);
const findings = [];

function filesBelow(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(filename) : [filename];
  });
}

for (const filename of shippedRoots.flatMap(filesBelow)) {
  if (!sourceExtensions.has(path.extname(filename)) || /\.test\.[^.]+$/.test(filename)) continue;
  const source = readFileSync(filename, 'utf8');
  for (const [label, expression] of [
    ['unfinished marker', /\b(?:TODO|FIXME|not implemented|coming soon|stub)\b/i],
    ['mocked shipped path', /\bmock(?:ed|ing)?\s+(?:quote|balance|position|order|candle|transaction|fill|pnl)\b/i],
    ['illustrative trading data', /\billustrative\s+(?:quote|balance|position|order|candle|transaction|fill|pnl)\b/i],
  ]) {
    if (expression.test(source)) findings.push(`${path.relative(root, filename)}: ${label}`);
  }
}

const dist = path.join(root, 'dist');
if (!statSync(dist, { throwIfNoEntry: false })?.isDirectory()) findings.push('dist: production bundle is missing');
const bundles = statSync(dist, { throwIfNoEntry: false })?.isDirectory()
  ? filesBelow(dist).filter((filename) => /\.(?:js|css|html|map)$/.test(filename)).map((filename) => [filename, readFileSync(filename, 'utf8')])
  : [];

const envFile = path.join(root, '.env');
if (statSync(envFile, { throwIfNoEntry: false })?.isFile()) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!match || match[1].startsWith('VITE_') || match[2].trim().length < 8) continue;
    const [name, value] = [match[1], match[2].trim()];
    let sensitive = /(?:SECRET|TOKEN|KEY|PRIVATE|PASSWORD)/.test(name);
    if (/URL$/.test(name)) {
      try {
        const url = new URL(value);
        sensitive ||= Boolean(url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== '/'));
      } catch {
        sensitive = true;
      }
    }
    if (sensitive && bundles.some(([, contents]) => contents.includes(value))) findings.push(`dist: server-only ${name} value is present`);
  }
}

for (const [filename, contents] of bundles) {
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(contents)) findings.push(`${path.relative(root, filename)}: private key material`);
  if (/\b(?:PRIVY_VERIFICATION_KEY|PRIVY_APP_SECRET|PRIVY_AUTHORIZATION_PRIVATE_KEY|SOLANA_RPC_URL|JUPITER_API_KEY|PHOENIX_TEST_IDENTITY_TOKEN|ALCHEMY_PAY_APP_SECRET)\b/.test(contents)) {
    findings.push(`${path.relative(root, filename)}: server-only configuration name`);
  }
}

if (findings.length) {
  console.error(findings.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Release source and browser bundle scan passed (${bundles.length} bundle files checked).`);
}
