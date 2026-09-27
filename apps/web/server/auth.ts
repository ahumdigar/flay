import { verifyIdentityToken } from '@privy-io/node';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config.js';
import { AppError } from './errors.js';

export interface FlayIdentity {
  userId: string;
  embeddedSolanaWallets: string[];
}

interface LinkedAccountLike {
  type?: unknown;
  chain_type?: unknown;
  wallet_client_type?: unknown;
  connector_type?: unknown;
  user_can_sign?: unknown;
  address?: unknown;
}

export function embeddedSolanaAddresses(accounts: readonly LinkedAccountLike[]): string[] {
  return accounts.flatMap((account) => (
    account.type === 'wallet'
    && account.chain_type === 'solana'
    && (account.wallet_client_type === 'privy' || account.wallet_client_type === 'privy-v2')
    && account.connector_type === 'embedded'
    && account.user_can_sign !== false
    && typeof account.address === 'string'
      ? [account.address]
      : []
  ));
}

declare global {
  namespace Express {
    interface Request {
      flayIdentity?: FlayIdentity;
    }
  }
}

export async function requireIdentity(request: Request, _response: Response, next: NextFunction) {
  try {
    if (!config.privyAppId || !config.privyVerificationKey) {
      throw new AppError(503, 'AUTH_NOT_CONFIGURED', 'Privy server verification is not configured yet.');
    }
    const token = request.header('x-privy-identity-token');
    if (!token || token.length > 20_000) {
      throw new AppError(401, 'AUTH_REQUIRED', 'Sign in to continue.');
    }
    const user = await verifyIdentityToken({
      identity_token: token,
      app_id: config.privyAppId,
      verification_key: config.privyVerificationKey,
    });
    const wallets = embeddedSolanaAddresses(user.linked_accounts);

    if (!wallets.length) {
      throw new AppError(
        403,
        'EMBEDDED_WALLET_REQUIRED',
        'Your identity token does not include an exportable Privy Solana wallet. Enable identity tokens and Solana embedded wallets in Privy.',
      );
    }
    request.flayIdentity = { userId: user.id, embeddedSolanaWallets: wallets };
    next();
  } catch (error) {
    if (error instanceof AppError) return next(error);
    return next(new AppError(401, 'INVALID_IDENTITY_TOKEN', 'Your sign-in session expired or could not be verified. Sign in again.'));
  }
}

export function assertIdentityWallet(request: Request, wallet: string): void {
  const identity = request.flayIdentity;
  if (!identity) throw new AppError(401, 'AUTH_REQUIRED', 'Sign in to continue.');
  if (!identity.embeddedSolanaWallets.includes(wallet)) {
    throw new AppError(403, 'WALLET_MISMATCH', 'The selected wallet is not the embedded Solana wallet in this sign-in session.');
  }
}
