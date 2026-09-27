import { describe, expect, it } from 'vitest';
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Keypair,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { AppError } from '../errors.js';
import { accountRentLamportsFromSimulation, assertMessageUnchanged, classifyFuturesSimulationError, FuturesEntryCircuitBreaker, verifyWalletSignature } from './transaction-service.js';

function transactionFor(signer: Keypair, lamports: number) {
  const message = new TransactionMessage({
    payerKey: signer.publicKey,
    recentBlockhash: '11111111111111111111111111111111',
    instructions: [SystemProgram.transfer({ fromPubkey: signer.publicKey, toPubkey: Keypair.generate().publicKey, lamports })],
  }).compileToV0Message();
  const transaction = new VersionedTransaction(message);
  transaction.sign([signer]);
  return transaction;
}

describe('futures signed-message binding', () => {
  it('verifies the Ed25519 signature against the reviewed wallet and message', () => {
    const signer = Keypair.generate();
    const transaction = transactionFor(signer, 1);
    const message = transaction.message.serialize();
    expect(verifyWalletSignature(message, signer.publicKey.toBase58(), transaction.signatures[0])).toBe(true);
    expect(verifyWalletSignature(message, Keypair.generate().publicKey.toBase58(), transaction.signatures[0])).toBe(false);
  });

  it('rejects any message changed after review', () => {
    const signer = Keypair.generate();
    const reviewed = transactionFor(signer, 1).message.serialize();
    const changed = transactionFor(signer, 2);
    expect(() => assertMessageUnchanged(changed, reviewed)).toThrowError(expect.objectContaining({ code: 'FUTURES_TRANSACTION_CHANGED' }));
  });
});

import { validateFuturesTransaction } from './transaction-service.js';

describe('futures account-rent disclosure', () => {
  it('reports exact created-account rent and fails closed above the RPC response limit', () => {
    expect(accountRentLamportsFromSimulation(0, undefined)).toBe('0');
    expect(accountRentLamportsFromSimulation(2, [{ lamports: 2_039_280 }, { lamports: 1_461_600 }])).toBe('3500880');
    expect(accountRentLamportsFromSimulation(2, [{ lamports: 2_039_280 }])).toBeNull();
    expect(accountRentLamportsFromSimulation(21, [])).toBeNull();
  });
});

describe('futures simulation failure mapping', () => {
  it('turns a stale blockhash into a fresh-review response', () => {
    expect(classifyFuturesSimulationError('BlockhashNotFound')).toMatchObject({
      status: 410,
      code: 'FUTURES_BLOCKHASH_EXPIRED',
      retryable: true,
    });
  });

  it('separates insufficient balance from a generic simulation rejection', () => {
    expect(classifyFuturesSimulationError({ InstructionError: [1, 'insufficient funds'] })).toMatchObject({ code: 'FUTURES_INSUFFICIENT_BALANCE' });
    expect(classifyFuturesSimulationError(
      { InstructionError: [1, { Custom: 1 }] },
      ['Transfer: insufficient lamports 3481559, need 8371840'],
    )).toMatchObject({
      code: 'FUTURES_INSUFFICIENT_BALANCE',
      message: 'This action needs 0.00837184 SOL for account rent, but only 0.003481559 SOL remains after network fees. Add at least 0.004890281 SOL plus a small fee buffer, then retry.',
      retryable: false,
    });
    expect(classifyFuturesSimulationError({ InstructionError: [2, 'Custom'] })).toMatchObject({ code: 'FUTURES_SIMULATION_FAILED', retryable: true });
  });
});

describe('futures unsigned transaction structure', () => {
  it('rejects the wrong fee payer and a missing reviewed market', async () => {
    const wallet = Keypair.generate();
    const other = Keypair.generate();
    const blockhash = Keypair.generate().publicKey.toBase58();
    const transaction = new VersionedTransaction(new TransactionMessage({
      payerKey: other.publicKey,
      recentBlockhash: blockhash,
      instructions: [],
    }).compileToV0Message());
    await expect(validateFuturesTransaction(transaction, wallet.publicKey.toBase58(), [], [])).rejects.toMatchObject({ code: 'FUTURES_PAYER_MISMATCH' });

    const walletTransaction = new VersionedTransaction(new TransactionMessage({
      payerKey: wallet.publicKey,
      recentBlockhash: blockhash,
      instructions: [],
    }).compileToV0Message());
    await expect(validateFuturesTransaction(walletTransaction, wallet.publicKey.toBase58(), [], [other.publicKey.toBase58()])).rejects.toMatchObject({ code: 'FUTURES_ROUTE_MISMATCH' });
  });

  it('rejects unknown programs and top-level SOL recipients', async () => {
    const wallet = Keypair.generate();
    const recipient = Keypair.generate();
    const blockhash = Keypair.generate().publicKey.toBase58();
    const unknownProgram = Keypair.generate().publicKey;
    const unknown = new VersionedTransaction(new TransactionMessage({
      payerKey: wallet.publicKey,
      recentBlockhash: blockhash,
      instructions: [{ programId: unknownProgram, keys: [], data: Buffer.alloc(0) }],
    }).compileToV0Message());
    await expect(validateFuturesTransaction(unknown, wallet.publicKey.toBase58(), [], [])).rejects.toMatchObject({ code: 'FUTURES_PROGRAM_NOT_ALLOWED' });

    const transfer = new VersionedTransaction(new TransactionMessage({
      payerKey: wallet.publicKey,
      recentBlockhash: blockhash,
      instructions: [SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: recipient.publicKey, lamports: 1 })],
    }).compileToV0Message());
    await expect(validateFuturesTransaction(transfer, wallet.publicKey.toBase58(), [], [])).rejects.toMatchObject({ code: 'FUTURES_UNEXPECTED_RECIPIENT' });
  });

  it('rejects unreviewed lookup tables and excessive priority fees', async () => {
    const wallet = Keypair.generate();
    const table = new AddressLookupTableAccount({
      key: Keypair.generate().publicKey,
      state: {
        deactivationSlot: 0xffffffffffffffffn,
        lastExtendedSlot: 0,
        lastExtendedSlotStartIndex: 0,
        authority: undefined,
        addresses: [Keypair.generate().publicKey],
      },
    });
    const withLookup = new VersionedTransaction(new TransactionMessage({
      payerKey: wallet.publicKey,
      recentBlockhash: Keypair.generate().publicKey.toBase58(),
      instructions: [{ programId: SystemProgram.programId, keys: [{ pubkey: table.state.addresses[0], isSigner: false, isWritable: false }], data: Buffer.alloc(0) }],
    }).compileToV0Message([table]));
    await expect(validateFuturesTransaction(withLookup, wallet.publicKey.toBase58(), [], [])).rejects.toMatchObject({ code: 'FUTURES_LOOKUP_TABLE_NOT_ALLOWED' });

    const costly = new VersionedTransaction(new TransactionMessage({
      payerKey: wallet.publicKey,
      recentBlockhash: Keypair.generate().publicKey.toBase58(),
      instructions: [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000_001n })],
    }).compileToV0Message());
    await expect(validateFuturesTransaction(costly, wallet.publicKey.toBase58(), [], [])).rejects.toMatchObject({ code: 'FUTURES_PRIORITY_FEE_EXCEEDED' });
  });

  it('allows only an explicitly reviewed additional signer, whether or not it already signed', async () => {
    const wallet = Keypair.generate();
    const extra = Keypair.generate();
    const program = Keypair.generate().publicKey;
    const build = () => new VersionedTransaction(new TransactionMessage({
      payerKey: wallet.publicKey,
      recentBlockhash: Keypair.generate().publicKey.toBase58(),
      instructions: [{
        programId: program,
        keys: [{ pubkey: extra.publicKey, isSigner: true, isWritable: false }],
        data: Buffer.alloc(0),
      }],
    }).compileToV0Message());
    const unsigned = build();
    await expect(validateFuturesTransaction(unsigned, wallet.publicKey.toBase58(), [program.toBase58()], [])).rejects.toMatchObject({ code: 'FUTURES_UNEXPECTED_SIGNER' });
    const signed = build();
    signed.sign([wallet, extra]);
    await expect(validateFuturesTransaction(signed, wallet.publicKey.toBase58(), [program.toBase58()], [])).rejects.toMatchObject({ code: 'FUTURES_UNEXPECTED_SIGNER' });
    await expect(validateFuturesTransaction(unsigned, wallet.publicKey.toBase58(), [program.toBase58()], [], [], [extra.publicKey.toBase58()])).resolves.toMatchObject({ programs: [program.toBase58()] });
  });
});

describe('futures entry circuit breaker', () => {
  it('opens after repeated structural failures, ignores user errors, and recovers after cooldown', () => {
    const circuit = new FuturesEntryCircuitBreaker(3, 1_000);
    circuit.recordFailure(new AppError(409, 'FUTURES_INSUFFICIENT_BALANCE', 'user balance'), 100);
    expect(circuit.snapshot(100).consecutiveFailures).toBe(0);
    for (const now of [100, 200, 300]) circuit.recordFailure(new AppError(409, 'FUTURES_PROGRAM_NOT_ALLOWED', 'invalid provider transaction'), now);
    expect(circuit.snapshot(300)).toMatchObject({ consecutiveFailures: 3, open: true, lastReason: 'FUTURES_PROGRAM_NOT_ALLOWED' });
    expect(() => circuit.assertAvailable(400)).toThrowError(expect.objectContaining({ code: 'FUTURES_ENTRY_CIRCUIT_OPEN' }));
    expect(() => circuit.assertAvailable(1_301)).not.toThrow();
    expect(circuit.snapshot(1_301)).toMatchObject({ consecutiveFailures: 0, open: false });
  });
});
