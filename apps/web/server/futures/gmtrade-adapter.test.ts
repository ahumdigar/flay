import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FuturesVenueMarket } from '../../shared/futures.js';
import { GmTradeAdapter, gmTradeQuoteError } from './gmtrade-adapter.js';

const originalBinary = process.env.GMTRADE_ADAPTER_BIN;
const originalTimeout = process.env.GMTRADE_ADAPTER_TIMEOUT_MS;

afterEach(() => {
  if (originalBinary === undefined) delete process.env.GMTRADE_ADAPTER_BIN;
  else process.env.GMTRADE_ADAPTER_BIN = originalBinary;
  if (originalTimeout === undefined) delete process.env.GMTRADE_ADAPTER_TIMEOUT_MS;
  else process.env.GMTRADE_ADAPTER_TIMEOUT_MS = originalTimeout;
  vi.restoreAllMocks();
});

async function executable(source: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'flay-gm-adapter-'));
  const filename = path.join(directory, 'adapter.mjs');
  await writeFile(filename, '#!' + process.execPath + '\n' + source, 'utf8');
  await chmod(filename, 0o700);
  return filename;
}

describe('GMTrade sidecar supervision', () => {
  it('uses the documented fifteen-second timeout when no override is configured', () => {
    delete process.env.GMTRADE_ADAPTER_TIMEOUT_MS;
    const adapter = new GmTradeAdapter();
    expect((adapter as unknown as { requestTimeoutMs: number }).requestTimeoutMs).toBe(15_000);
    adapter.close();
  });

  it('turns the venue minimum-collateral failure into an actionable route message', () => {
    expect(gmTradeQuoteError(new Error('model: liquidatable position: min collateral: 9000000')))
      .toBe('GMTrade requires more collateral for this market and leverage. Increase the collateral amount and refresh routes.');
  });

  it('coalesces identical market loads inside the freshness window', async () => {
    const adapter = new GmTradeAdapter();
    const market = { venue: 'gmtrade', nativeSymbol: 'SOL' } as FuturesVenueMarket;
    const command = vi.spyOn(adapter, 'command').mockResolvedValue([market]);
    const [first, second] = await Promise.all([adapter.markets(), adapter.markets()]);
    expect(first).toEqual([market]);
    expect(second).toEqual([market]);
    expect(command).toHaveBeenCalledTimes(1);
  });

  it('kills a timed-out process and reports a bounded failure', async () => {
    process.env.GMTRADE_ADAPTER_BIN = await executable("process.stdin.resume();\n");
    process.env.GMTRADE_ADAPTER_TIMEOUT_MS = '100';
    const adapter = new GmTradeAdapter();
    await expect(adapter.command('health')).rejects.toThrow('did not respond in time');
    await expect(adapter.command('health')).rejects.toThrow('temporarily unavailable');
    expect(adapter.diagnostics()).toMatchObject({ requests: 1, failures: 1, running: false });
    adapter.close();
  });

  it('rejects a crash and restarts after the supervised cooldown', async () => {
    const filename = await executable("process.stdin.once('data', () => process.exit(1));\n");
    process.env.GMTRADE_ADAPTER_BIN = filename;
    process.env.GMTRADE_ADAPTER_TIMEOUT_MS = '500';
    const adapter = new GmTradeAdapter();
    await expect(adapter.command('health')).rejects.toThrow('exited before responding');
    await writeFile(filename, `#!${process.execPath}
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  const newline = buffer.indexOf('\\n');
  if (newline < 0) return;
  const request = JSON.parse(buffer.slice(0, newline));
  process.stdout.write(JSON.stringify({ id: request.id, ok: true, result: { ready: true } }) + '\\n');
});
`, 'utf8');
    await new Promise((resolve) => setTimeout(resolve, 1_050));
    await expect(adapter.command<{ ready: boolean }>('health')).resolves.toEqual({ ready: true });
    adapter.close();
  });

  it('does not retry a transaction build after the sidecar crashes', async () => {
    process.env.GMTRADE_ADAPTER_BIN = await executable("process.stdin.once('data', () => process.exit(1));\n");
    process.env.GMTRADE_ADAPTER_TIMEOUT_MS = '500';
    const adapter = new GmTradeAdapter();

    await expect(adapter.prepareAction({ action: 'open' })).rejects.toThrow('exited before responding');

    expect(adapter.diagnostics()).toMatchObject({ requests: 1, failures: 1, running: false });
    adapter.close();
  });
});
