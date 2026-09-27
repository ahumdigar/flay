import { Keypair, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import {
  PhoenixChallengeStore,
  validatePhoenixWalletChallengeTransaction,
  validatePhoenixWalletProofTransaction,
} from './phoenix-transactions.js';

const memoProgram = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

function challenge(wallet: Keypair, programId = memoProgram, nonceId = 'nonce') {
  const transaction = new Transaction({
    feePayer: wallet.publicKey,
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
  }).add(new TransactionInstruction({
    programId,
    keys: [],
    data: Buffer.from(`phoenix-wallet-transaction-login-v1|${nonceId}|${wallet.publicKey.toBase58()}|2026-09-25T00:00:00.000Z`),
  }));
  return transaction;
}

describe('Phoenix wallet-ownership challenge validation', () => {
  it('accepts only the exact unsigned memo challenge and its wallet signature', () => {
    const wallet = Keypair.generate();
    const unsigned = challenge(wallet);
    const encoded = Buffer.from(unsigned.serialize({ requireAllSignatures: false, verifySignatures: false })).toString('base64');
    const reviewed = validatePhoenixWalletChallengeTransaction(wallet.publicKey.toBase58(), 'nonce', encoded);
    unsigned.sign(wallet);
    const signed = Buffer.from(unsigned.serialize()).toString('base64');
    expect(() => validatePhoenixWalletProofTransaction(wallet.publicKey.toBase58(), signed, reviewed.message)).not.toThrow();
  });

  it('rejects an unsafe program, changed message, and wrong signer', () => {
    const wallet = Keypair.generate();
    const unsafe = challenge(wallet, Keypair.generate().publicKey);
    const unsafeBytes = Buffer.from(unsafe.serialize({ requireAllSignatures: false, verifySignatures: false })).toString('base64');
    expect(() => validatePhoenixWalletChallengeTransaction(wallet.publicKey.toBase58(), 'nonce', unsafeBytes)).toThrowError(expect.objectContaining({ code: 'PHOENIX_CHALLENGE_INVALID' }));

    const exact = challenge(wallet);
    const exactBytes = Buffer.from(exact.serialize({ requireAllSignatures: false, verifySignatures: false })).toString('base64');
    const reviewed = validatePhoenixWalletChallengeTransaction(wallet.publicKey.toBase58(), 'nonce', exactBytes);
    const changed = challenge(wallet);
    changed.sign(wallet);
    expect(() => validatePhoenixWalletProofTransaction(wallet.publicKey.toBase58(), Buffer.from(changed.serialize()).toString('base64'), reviewed.message)).toThrowError(expect.objectContaining({ code: 'PHOENIX_CHALLENGE_SIGNATURE_INVALID' }));

    exact.addSignature(wallet.publicKey, Buffer.alloc(64, 1));
    const wrong = Buffer.from(exact.serialize({ requireAllSignatures: false, verifySignatures: false })).toString('base64');
    expect(() => validatePhoenixWalletProofTransaction(wallet.publicKey.toBase58(), wrong, reviewed.message)).toThrowError(expect.objectContaining({ code: 'PHOENIX_CHALLENGE_SIGNATURE_INVALID' }));
  });

  it('rejects a memo that is not bound to the provider nonce and wallet', () => {
    const wallet = Keypair.generate();
    const wrongNonce = challenge(wallet, memoProgram, 'other-nonce');
    const encoded = Buffer.from(wrongNonce.serialize({ requireAllSignatures: false, verifySignatures: false })).toString('base64');
    expect(() => validatePhoenixWalletChallengeTransaction(wallet.publicKey.toBase58(), 'expected-nonce', encoded)).toThrowError(
      expect.objectContaining({ code: 'PHOENIX_CHALLENGE_INVALID' }),
    );
  });
});

describe('Phoenix challenge lifecycle', () => {
  const record = (wallet: string, expiresAt: number) => ({
    wallet,
    nonceId: 'nonce',
    unsignedMessage: new Uint8Array([1, 2, 3]),
    expiresAt,
  });

  it('binds a challenge to one wallet and consumes a mismatched attempt', () => {
    const now = 1_000;
    const store = new PhoenixChallengeStore(() => now);
    const challengeId = store.add(record('wallet-a', now + 1_000));
    expect(() => store.consume(challengeId, 'wallet-b')).toThrowError(
      expect.objectContaining({ code: 'PHOENIX_CHALLENGE_NOT_FOUND' }),
    );
    expect(() => store.consume(challengeId, 'wallet-a')).toThrowError(
      expect.objectContaining({ code: 'PHOENIX_CHALLENGE_NOT_FOUND' }),
    );
  });

  it('rejects and consumes an expired challenge', () => {
    let now = 1_000;
    const store = new PhoenixChallengeStore(() => now);
    const challengeId = store.add(record('wallet-a', now + 100));
    now += 101;
    expect(() => store.consume(challengeId, 'wallet-a')).toThrowError(
      expect.objectContaining({ code: 'PHOENIX_CHALLENGE_EXPIRED' }),
    );
    expect(() => store.consume(challengeId, 'wallet-a')).toThrowError(
      expect.objectContaining({ code: 'PHOENIX_CHALLENGE_NOT_FOUND' }),
    );
  });

  it('allows exactly one successful consumption', () => {
    const now = 1_000;
    const store = new PhoenixChallengeStore(() => now);
    const challengeId = store.add(record('wallet-a', now + 1_000));
    expect(store.consume(challengeId, 'wallet-a')).toMatchObject({ wallet: 'wallet-a', nonceId: 'nonce' });
    expect(() => store.consume(challengeId, 'wallet-a')).toThrowError(
      expect.objectContaining({ code: 'PHOENIX_CHALLENGE_NOT_FOUND' }),
    );
  });
});
