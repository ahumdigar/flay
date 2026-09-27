import { Connection } from '@solana/web3.js';
import { config } from './config.js';
import { AppError } from './errors.js';

export const connection = new Connection(config.rpcUrl, {
  commitment: config.commitment,
  confirmTransactionInitialTimeout: 45_000,
  disableRetryOnRateLimit: true,
});

export const fallbackConnection = config.fallbackRpcUrl
  ? new Connection(config.fallbackRpcUrl, {
      commitment: config.commitment,
      confirmTransactionInitialTimeout: 45_000,
      disableRetryOnRateLimit: true,
    })
  : null;

export async function withRpcFallback<T>(operation: (rpc: Connection) => Promise<T>): Promise<T> {
  try {
    return await operation(connection);
  } catch (primaryError) {
    if (!fallbackConnection) {
      throw new AppError(
        503,
        'RPC_UNAVAILABLE',
        primaryError instanceof Error ? `Solana RPC: ${primaryError.message}` : 'Solana RPC is unavailable.',
        true,
      );
    }
    try {
      return await operation(fallbackConnection);
    } catch {
      throw new AppError(503, 'RPC_UNAVAILABLE', 'Both configured Solana RPC endpoints are unavailable.', true);
    }
  }
}
