const SOLANA_RATE_LIMIT_PATTERNS = [
  /\b429\b/,
  /connection rate limits exceeded/i,
  /too many requests/i,
  /request limit reached/i,
];

let installed = false;

function rejectionMessage(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  return typeof reason === 'string' ? reason : '';
}

export function isRecoverableBackgroundRpcRejection(reason: unknown): boolean {
  const message = rejectionMessage(reason);
  const rateLimited = SOLANA_RATE_LIMIT_PATTERNS.some((pattern) => pattern.test(message));
  const identifiesRpc = /jsonrpc|solana rpc|connection rate limits exceeded|dashboard\.quicknode\.com|"code"\s*:\s*-32007/i.test(message);
  return rateLimited && identifiesRpc;
}

export function isRecoverableBackgroundPhoenixRejection(reason: unknown): boolean {
  const message = rejectionMessage(reason);
  return /^Failed to connect to the Phoenix HTTP API \(GET https:\/\/perp-api\.phoenix\.trade\/[^)\s]*\): This operation was aborted$/.test(message);
}

export function installProcessSafety(): void {
  if (installed) return;
  installed = true;
  process.on('unhandledRejection', (reason) => {
    if (isRecoverableBackgroundRpcRejection(reason)) {
      // Do not emit the provider payload: it may contain request metadata. The
      // request path still receives its normal error; this protects only an
      // orphaned provider rejection that would otherwise terminate Node.
      process.stderr.write(`${new Date().toISOString()} Recoverable background Solana RPC rate limit was contained.\n`);
      return;
    }
    if (isRecoverableBackgroundPhoenixRejection(reason)) {
      // Rise can abandon its own background metadata start after the bounded
      // provider request times out. The caller still observes Phoenix as
      // degraded; this prevents that orphaned rejection from taking down the
      // unrelated Convert, Funds, and Stocks paths.
      process.stderr.write(`${new Date().toISOString()} Recoverable background Phoenix connection timeout was contained.\n`);
      return;
    }
    // Unknown unhandled failures remain fatal. The supervisor records the exit
    // and starts a clean process rather than leaving corrupted state alive.
    throw reason instanceof Error ? reason : new Error('Unhandled background rejection.');
  });
}
