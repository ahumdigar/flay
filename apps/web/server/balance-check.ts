import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  unpackAccount,
} from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';
import type { TokenInfo } from '../shared/types.js';
import { AppError } from './errors.js';
import { withRpcFallback } from './rpc.js';

// Allows network fees, a priority fee, and one new token account or order account.
const FEE_AND_RENT_RESERVE = 5_000_000n;

export function assertSpendableBalance(
  token: TokenInfo,
  amount: string,
  solLamports: bigint,
  inputAccountAmount?: bigint,
  solReserveLamports = FEE_AND_RENT_RESERVE,
): void {
  const inputAmount = BigInt(amount);
  const neededSol = solReserveLamports + (token.tokenProgram === 'native' ? inputAmount : 0n);
  if (solLamports < neededSol) {
    throw new AppError(
      409,
      'INSUFFICIENT_SOL',
      `Keep at least 0.005 SOL beyond the trade amount for network fees and account rent. Your wallet needs more SOL.`,
    );
  }
  if (token.tokenProgram !== 'native' && (inputAccountAmount ?? 0n) < inputAmount) {
    throw new AppError(409, 'INSUFFICIENT_BALANCE', `Your wallet does not have enough confirmed ${token.symbol} in its associated token account.`);
  }
}

export async function checkSpendableBalance(
  wallet: string,
  token: TokenInfo,
  amount: string,
  options: { solReserveLamports?: bigint } = {},
): Promise<void> {
  const owner = new PublicKey(wallet);
  const solReserveLamports = options.solReserveLamports ?? FEE_AND_RENT_RESERVE;
  if (token.tokenProgram === 'native') {
    const lamports = await withRpcFallback((rpc) => rpc.getBalance(owner, 'confirmed'));
    assertSpendableBalance(token, amount, BigInt(lamports), undefined, solReserveLamports);
    return;
  }

  const program = token.tokenProgram === 'token-2022' ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
  const address = getAssociatedTokenAddressSync(new PublicKey(token.mint), owner, false, program);
  const [lamports, accountInfo] = await Promise.all([
    withRpcFallback((rpc) => rpc.getBalance(owner, 'confirmed')),
    withRpcFallback((rpc) => rpc.getAccountInfo(address, 'confirmed')),
  ]);
  if (!accountInfo) {
    throw new AppError(409, 'INPUT_ACCOUNT_MISSING', `No ${token.symbol} associated token account exists for this wallet. Deposit the token first.`);
  }
  let accountAmount: bigint;
  try {
    const account = unpackAccount(address, accountInfo, program);
    if (!account.owner.equals(owner) || !account.mint.equals(new PublicKey(token.mint))) {
      throw new Error('wrong token account');
    }
    accountAmount = account.amount;
  } catch {
    throw new AppError(409, 'INPUT_ACCOUNT_INVALID', `The wallet's ${token.symbol} token account cannot be used for this trade.`);
  }
  assertSpendableBalance(token, amount, BigInt(lamports), accountAmount, solReserveLamports);
}
