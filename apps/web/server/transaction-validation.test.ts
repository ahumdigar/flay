import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createCloseAccountInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { describe, expect, it } from 'vitest';
import { AppError } from './errors.js';
import {
  assertMessageUnchanged,
  assertPrivySponsoredMarketReceipt,
  assertPrivySponsoredMarketTransactionSafe,
  assertWalletSignature,
  deserializeSignedTransaction,
  simulationError,
  transactionBindsExpectedToken,
  validateTransactionSigners,
} from './transaction-validation.js';
import type { TokenInfo } from '../shared/types.js';

function transfer(lamports: number): VersionedTransaction {
  const payer = Keypair.generate().publicKey;
  const recipient = Keypair.generate().publicKey;
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: '11111111111111111111111111111111',
    instructions: [SystemProgram.transfer({ fromPubkey: payer, toPubkey: recipient, lamports })],
  }).compileToV0Message();
  return new VersionedTransaction(message);
}

function sponsoredTransfer(sponsor: Keypair, wallet: Keypair, extra?: Keypair): VersionedTransaction {
  const recipient = Keypair.generate().publicKey;
  const instructions = [SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: recipient, lamports: 1 })];
  if (extra) instructions.push(SystemProgram.transfer({ fromPubkey: extra.publicKey, toPubkey: recipient, lamports: 1 }));
  const message = new TransactionMessage({
    payerKey: sponsor.publicKey,
    recentBlockhash: '11111111111111111111111111111111',
    instructions,
  }).compileToV0Message();
  return new VersionedTransaction(message);
}

function initializedTokenAccount(mint: PublicKey, owner: PublicKey) {
  const data = Buffer.alloc(165);
  mint.toBuffer().copy(data, 0);
  owner.toBuffer().copy(data, 32);
  data.writeBigUInt64LE(1n, 64);
  data[108] = 1;
  return {
    data,
    executable: false,
    lamports: 2_039_280,
    owner: TOKEN_PROGRAM_ID,
    rentEpoch: 0,
  };
}

describe('signed transaction binding', () => {
  it('binds an SPL asset through its exact canonical wallet account when a venue omits the mint key', () => {
    const wallet = Keypair.generate().publicKey;
    const mint = Keypair.generate().publicKey;
    const token: TokenInfo = {
      mint: mint.toBase58(), symbol: 'TKN', name: 'Token', decimals: 6, logoUri: null,
      tokenProgram: 'spl-token', verified: true, tags: [], extensions: [], tradable: true,
      blockedReason: null, usdPrice: null,
    };
    const canonicalAccount = getAssociatedTokenAddressSync(mint, wallet).toBase58();
    expect(transactionBindsExpectedToken(new Set([canonicalAccount]), token, wallet)).toBe(true);
    expect(transactionBindsExpectedToken(new Set([Keypair.generate().publicKey.toBase58()]), token, wallet)).toBe(false);
    expect(transactionBindsExpectedToken(new Set([mint.toBase58()]), token, wallet)).toBe(true);
  });

  it('reports an exact rent shortfall from simulation logs', () => {
    const error = simulationError(
      { InstructionError: [0, { Custom: 1 }] },
      ['Transfer: insufficient lamports 1398305, need 1488440'],
    );
    expect(error).toMatchObject({ code: 'INSUFFICIENT_SOL', status: 409 });
    expect(error.message).toContain('0.000090135 SOL more');
    expect(error.message).toContain('direct route');
  });

  it('accepts only the exact reviewed message bytes', () => {
    const reviewed = transfer(1);
    expect(() => assertMessageUnchanged(reviewed, reviewed.message.serialize())).not.toThrow();

    const changed = transfer(2);
    expect(() => assertMessageUnchanged(changed, reviewed.message.serialize())).toThrowError(AppError);
    try {
      assertMessageUnchanged(changed, reviewed.message.serialize());
    } catch (error) {
      expect((error as AppError).code).toBe('TRANSACTION_CHANGED');
    }
  });

  it('round-trips a valid transaction and rejects invalid signed bytes', () => {
    const transaction = transfer(1);
    const encoded = Buffer.from(transaction.serialize()).toString('base64');
    expect(deserializeSignedTransaction(encoded).message.serialize()).toEqual(transaction.message.serialize());

    expect(() => deserializeSignedTransaction('bm90IGEgdHJhbnNhY3Rpb24=')).toThrowError(AppError);
    try {
      deserializeSignedTransaction('bm90IGEgdHJhbnNhY3Rpb24=');
    } catch (error) {
      expect((error as AppError).code).toBe('SIGNED_TRANSACTION_INVALID');
    }
  });

  it('allows only the recorded Jupiter payer on a sponsored partial transaction', () => {
    const sponsor = Keypair.generate();
    const wallet = Keypair.generate();
    const transaction = sponsoredTransfer(sponsor, wallet);
    expect(() => validateTransactionSigners(transaction, {
      wallet: wallet.publicKey.toBase58(),
      feePayer: sponsor.publicKey.toBase58(),
      allowedExternalSigners: [sponsor.publicKey.toBase58()],
      rejectUnknownSigners: true,
    })).not.toThrow();

    const wrongPayer = Keypair.generate().publicKey.toBase58();
    expect(() => validateTransactionSigners(transaction, {
      wallet: wallet.publicKey.toBase58(),
      feePayer: wrongPayer,
      allowedExternalSigners: [wrongPayer],
      rejectUnknownSigners: true,
    })).toThrowError(expect.objectContaining({ code: 'PAYER_MISMATCH' }));
  });

  it('rejects undeclared required signers on a sponsored transaction', () => {
    const sponsor = Keypair.generate();
    const wallet = Keypair.generate();
    const transaction = sponsoredTransfer(sponsor, wallet, Keypair.generate());
    expect(() => validateTransactionSigners(transaction, {
      wallet: wallet.publicKey.toBase58(),
      feePayer: sponsor.publicKey.toBase58(),
      allowedExternalSigners: [sponsor.publicKey.toBase58()],
      rejectUnknownSigners: true,
    })).toThrowError(expect.objectContaining({ code: 'UNEXPECTED_SIGNER' }));
  });

  it('cryptographically verifies the taker signature while the sponsor signature is absent', () => {
    const sponsor = Keypair.generate();
    const wallet = Keypair.generate();
    const transaction = sponsoredTransfer(sponsor, wallet);
    transaction.sign([wallet]);
    expect(() => assertWalletSignature(transaction, wallet.publicKey.toBase58())).not.toThrow();
    expect(transaction.signatures[0].every((byte) => byte === 0)).toBe(true);

    transaction.signatures[1][0] ^= 1;
    expect(() => assertWalletSignature(transaction, wallet.publicKey.toBase58()))
      .toThrowError(expect.objectContaining({ code: 'WALLET_SIGNATURE_INVALID' }));
  });

  it('rejects a missing taker signature', () => {
    const sponsor = Keypair.generate();
    const wallet = Keypair.generate();
    const transaction = sponsoredTransfer(sponsor, wallet);
    expect(() => assertWalletSignature(transaction, wallet.publicKey.toBase58()))
      .toThrowError(expect.objectContaining({ code: 'WALLET_SIGNATURE_MISSING' }));
  });

  it('keeps native SOL and direct rent/system actions outside Privy swap sponsorship', async () => {
    const wallet = Keypair.generate();
    const transaction = transfer(1);
    const spl = (mint: string, symbol: string): TokenInfo => ({
      mint,
      symbol,
      name: symbol,
      decimals: 6,
      logoUri: null,
      tokenProgram: 'spl-token',
      verified: true,
      tags: [],
      extensions: [],
      tradable: true,
      blockedReason: null,
      usdPrice: null,
    });
    const native = { ...spl('So11111111111111111111111111111111111111112', 'SOL'), tokenProgram: 'native' as const };
    const output = spl(Keypair.generate().publicKey.toBase58(), 'OUT');
    await expect(assertPrivySponsoredMarketTransactionSafe(transaction, {
      kind: 'market-swap',
      provider: 'raydium',
      wallet: transaction.message.staticAccountKeys[0].toBase58(),
      inputToken: native,
      outputToken: output,
      expectedPrograms: [],
      expectedPoolIds: [],
    })).rejects.toMatchObject({ code: 'PRIVY_SPONSORSHIP_INELIGIBLE' });

    const systemMessage = new TransactionMessage({
      payerKey: wallet.publicKey,
      recentBlockhash: '11111111111111111111111111111111',
      instructions: [SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 })],
    }).compileToV0Message();
    await expect(assertPrivySponsoredMarketTransactionSafe(new VersionedTransaction(systemMessage), {
      kind: 'market-swap',
      provider: 'orca',
      wallet: wallet.publicKey.toBase58(),
      inputToken: spl(Keypair.generate().publicKey.toBase58(), 'IN'),
      outputToken: output,
      expectedPrograms: [],
      expectedPoolIds: [],
    })).rejects.toMatchObject({ code: 'PRIVY_SPONSORSHIP_INELIGIBLE' });
  });

  it('accepts the sponsorship boundary only when both canonical SPL accounts already exist', async () => {
    const wallet = Keypair.generate();
    const inputMint = Keypair.generate().publicKey;
    const outputMint = Keypair.generate().publicKey;
    const token = (mint: PublicKey, symbol: string): TokenInfo => ({
      mint: mint.toBase58(), symbol, name: symbol, decimals: 6, logoUri: null, tokenProgram: 'spl-token',
      verified: true, tags: [], extensions: [], tradable: true, blockedReason: null, usdPrice: null,
    });
    const message = new TransactionMessage({
      payerKey: wallet.publicKey,
      recentBlockhash: '11111111111111111111111111111111',
      instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 })],
    }).compileToV0Message();
    const transaction = new VersionedTransaction(message);
    const expectations = {
      kind: 'market-swap' as const,
      provider: 'orca' as const,
      wallet: wallet.publicKey.toBase58(),
      inputToken: token(inputMint, 'IN'),
      outputToken: token(outputMint, 'OUT'),
      expectedPrograms: [],
      expectedPoolIds: [],
    };
    const existingAccounts = async (addresses: PublicKey[]) => addresses.map((address) => {
      const mint = address.equals(getAssociatedTokenAddressSync(inputMint, wallet.publicKey)) ? inputMint : outputMint;
      return initializedTokenAccount(mint, wallet.publicKey);
    });

    await expect(assertPrivySponsoredMarketTransactionSafe(transaction, expectations, existingAccounts)).resolves.toBeUndefined();
    await expect(assertPrivySponsoredMarketTransactionSafe(transaction, expectations, async () => [initializedTokenAccount(inputMint, wallet.publicKey), null]))
      .rejects.toMatchObject({ code: 'PRIVY_SPONSORSHIP_INELIGIBLE' });
  });

  it('rejects associated-account creation and token-account closure from sponsorship', async () => {
    const wallet = Keypair.generate();
    const inputMint = Keypair.generate().publicKey;
    const outputMint = Keypair.generate().publicKey;
    const inputAta = getAssociatedTokenAddressSync(inputMint, wallet.publicKey);
    const token = (mint: PublicKey, symbol: string): TokenInfo => ({
      mint: mint.toBase58(), symbol, name: symbol, decimals: 6, logoUri: null, tokenProgram: 'spl-token',
      verified: true, tags: [], extensions: [], tradable: true, blockedReason: null, usdPrice: null,
    });
    const expectations = {
      kind: 'market-swap' as const,
      provider: 'raydium' as const,
      wallet: wallet.publicKey.toBase58(),
      inputToken: token(inputMint, 'IN'),
      outputToken: token(outputMint, 'OUT'),
      expectedPrograms: [],
      expectedPoolIds: [],
    };
    const closeMessage = new TransactionMessage({
      payerKey: wallet.publicKey,
      recentBlockhash: '11111111111111111111111111111111',
      instructions: [createCloseAccountInstruction(inputAta, wallet.publicKey, wallet.publicKey)],
    }).compileToV0Message();
    await expect(assertPrivySponsoredMarketTransactionSafe(new VersionedTransaction(closeMessage), expectations))
      .rejects.toMatchObject({ code: 'PRIVY_SPONSORSHIP_INELIGIBLE' });

    const associatedMessage = new TransactionMessage({
      payerKey: wallet.publicKey,
      recentBlockhash: '11111111111111111111111111111111',
      instructions: [{ programId: ASSOCIATED_TOKEN_PROGRAM_ID, keys: [], data: Buffer.alloc(0) }],
    }).compileToV0Message();
    await expect(assertPrivySponsoredMarketTransactionSafe(new VersionedTransaction(associatedMessage), expectations))
      .rejects.toMatchObject({ code: 'PRIVY_SPONSORSHIP_INELIGIBLE' });
  });

  it('verifies a sponsored receipt has a non-user payer, zero user SOL debit, exact input, and minimum output', () => {
    const wallet = Keypair.generate().publicKey.toBase58();
    const sponsor = Keypair.generate().publicKey.toBase58();
    const inputMint = Keypair.generate().publicKey.toBase58();
    const outputMint = Keypair.generate().publicKey.toBase58();
    const token = (mint: string, symbol: string): TokenInfo => ({ mint, symbol, name: symbol, decimals: 6, logoUri: null, tokenProgram: 'spl-token', verified: true, tags: [], extensions: [], tradable: true, blockedReason: null, usdPrice: null });
    const expectations = {
      kind: 'market-swap' as const,
      provider: 'raydium' as const,
      wallet,
      inputToken: token(inputMint, 'IN'),
      outputToken: token(outputMint, 'OUT'),
      inputAmount: '10',
      minimumOutput: '4',
      expectedPrograms: [],
      expectedPoolIds: [],
    };
    const receipt = {
      signature: 'signature',
      transactionSignatures: ['signature', 'wallet-signature'],
      accountKeys: [sponsor, wallet],
      feeLamports: 5_000,
      error: null,
      preBalances: [1_000_000, 20_000],
      postBalances: [995_000, 20_000],
      preTokenBalances: [
        { mint: inputMint, owner: wallet, uiTokenAmount: { amount: '20' } },
        { mint: outputMint, owner: wallet, uiTokenAmount: { amount: '1' } },
      ],
      postTokenBalances: [
        { mint: inputMint, owner: wallet, uiTokenAmount: { amount: '10' } },
        { mint: outputMint, owner: wallet, uiTokenAmount: { amount: '6' } },
      ],
    };
    expect(() => assertPrivySponsoredMarketReceipt(receipt, expectations)).not.toThrow();
    expect(() => assertPrivySponsoredMarketReceipt({ ...receipt, transactionSignatures: ['different'] }, expectations))
      .toThrowError(expect.objectContaining({ code: 'SPONSORED_SIGNATURE_MISMATCH' }));
    expect(() => assertPrivySponsoredMarketReceipt({ ...receipt, accountKeys: [wallet] }, expectations))
      .toThrowError(expect.objectContaining({ code: 'SPONSOR_FEE_PAYER_MISMATCH' }));
    expect(() => assertPrivySponsoredMarketReceipt({ ...receipt, postBalances: [995_000, 19_999] }, expectations))
      .toThrowError(expect.objectContaining({ code: 'SPONSORED_SOL_DEBIT' }));
    expect(() => assertPrivySponsoredMarketReceipt({ ...receipt, postTokenBalances: [
      { mint: inputMint, owner: wallet, uiTokenAmount: { amount: '11' } },
      { mint: outputMint, owner: wallet, uiTokenAmount: { amount: '6' } },
    ] }, expectations)).toThrowError(expect.objectContaining({ code: 'INPUT_AMOUNT_MISMATCH' }));
    expect(() => assertPrivySponsoredMarketReceipt({ ...receipt, postTokenBalances: [
      { mint: inputMint, owner: wallet, uiTokenAmount: { amount: '10' } },
      { mint: outputMint, owner: wallet, uiTokenAmount: { amount: '4' } },
    ] }, expectations)).toThrowError(expect.objectContaining({ code: 'MINIMUM_OUTPUT_MISMATCH' }));
  });
});
