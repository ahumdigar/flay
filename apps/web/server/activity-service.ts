import { PublicKey } from '@solana/web3.js';
import { atomicToDecimal } from '../shared/amounts.js';
import { SOL_MINT } from '../shared/constants.js';
import type { ActivityDelta, ActivityRecord } from '../shared/types.js';
import { AppError } from './errors.js';
import { withRpcFallback } from './rpc.js';
import { TokenService } from './tokens.js';

interface RawTokenBalance {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: {
    amount: string;
    decimals: number;
  };
}

export class ActivityService {
  constructor(private readonly tokens: TokenService) {}

  async get(wallet: string, signature: string): Promise<ActivityRecord> {
    const transaction = await withRpcFallback((rpc) => rpc.getParsedTransaction(signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    }));

    if (!transaction) {
      const status = await withRpcFallback((rpc) => rpc.getSignatureStatuses([signature], { searchTransactionHistory: true }));
      const current = status.value[0];
      return {
        signature,
        explorerUrl: explorer(signature),
        status: current?.err ? 'failed' : 'pending',
        blockTime: null,
        slot: null,
        feeLamports: null,
        error: current?.err ? JSON.stringify(current.err).slice(0, 300) : null,
        deltas: [],
      };
    }

    const keys = transaction.transaction.message.accountKeys;
    const walletIndex = keys.findIndex((key) => key.pubkey.equals(new PublicKey(wallet)));
    if (walletIndex < 0) throw new AppError(403, 'ACTIVITY_WALLET_MISMATCH', 'This transaction does not involve the signed-in wallet.');

    const meta = transaction.meta;
    const preToken = (meta?.preTokenBalances ?? []) as RawTokenBalance[];
    const postToken = (meta?.postTokenBalances ?? []) as RawTokenBalance[];
    const tokenKeys = new Set([
      ...preToken.filter((item) => item.owner === wallet).map((item) => `${item.accountIndex}:${item.mint}`),
      ...postToken.filter((item) => item.owner === wallet).map((item) => `${item.accountIndex}:${item.mint}`),
    ]);
    const rawDeltas = [...tokenKeys].map((key) => {
      const [accountIndexText, mint] = key.split(':');
      const accountIndex = Number(accountIndexText);
      const before = preToken.find((item) => item.accountIndex === accountIndex && item.mint === mint && item.owner === wallet);
      const after = postToken.find((item) => item.accountIndex === accountIndex && item.mint === mint && item.owner === wallet);
      const decimals = after?.uiTokenAmount.decimals ?? before?.uiTokenAmount.decimals ?? 0;
      return {
        mint,
        decimals,
        amount: BigInt(after?.uiTokenAmount.amount ?? '0') - BigInt(before?.uiTokenAmount.amount ?? '0'),
      };
    }).filter((item) => item.amount !== 0n);

    const byMint = new Map<string, { decimals: number; amount: bigint }>();
    for (const delta of rawDeltas) {
      const current = byMint.get(delta.mint);
      byMint.set(delta.mint, {
        decimals: delta.decimals,
        amount: (current?.amount ?? 0n) + delta.amount,
      });
    }

    const walletLamports = meta
      ? BigInt(meta.postBalances[walletIndex] ?? 0) - BigInt(meta.preBalances[walletIndex] ?? 0)
      : 0n;
    if (walletLamports !== 0n) byMint.set(SOL_MINT, { decimals: 9, amount: walletLamports });

    const deltas: ActivityDelta[] = await Promise.all([...byMint.entries()].map(async ([mint, value]) => {
      let symbol = mint === SOL_MINT ? 'SOL' : `${mint.slice(0, 4)}…`;
      try {
        symbol = (await this.tokens.getByMint(mint)).symbol;
      } catch {
        // On-chain delta remains authoritative if optional metadata lookup fails.
      }
      return {
        mint,
        symbol,
        decimals: value.decimals,
        amountAtomic: value.amount.toString(),
        uiAmount: atomicToDecimal(value.amount, value.decimals),
      };
    }));

    return {
      signature,
      explorerUrl: explorer(signature),
      status: meta?.err ? 'failed' : 'confirmed',
      blockTime: transaction.blockTime ?? null,
      slot: transaction.slot,
      feeLamports: meta ? String(meta.fee) : null,
      error: meta?.err ? JSON.stringify(meta.err).slice(0, 300) : null,
      deltas,
    };
  }
}

function explorer(signature: string): string {
  return `https://explorer.solana.com/tx/${encodeURIComponent(signature)}?cluster=mainnet-beta`;
}
