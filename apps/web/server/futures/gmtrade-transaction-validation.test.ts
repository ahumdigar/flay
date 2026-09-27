import { describe, expect, it } from 'vitest';
import { Keypair, PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import type { FuturesPrepareRequest, FuturesRouteQuote, FuturesVenuePortfolio } from '../../shared/futures.js';
import { decodeGmTradeCreateOrder, validateGmTradeInstructionAccounts, validateGmTradeOrderSemantics } from './gmtrade-transaction-validation.js';

const PROGRAM = 'Gmso1uvJnLbawvw7yezdfCDcPydwW2s2iqG3w6MDucLo';
const wallet = Keypair.generate().publicKey.toBase58();
const baseRequest: FuturesPrepareRequest = { wallet, action: 'open', venue: 'gmtrade', quoteId: crypto.randomUUID(), market: 'SOL-PERP', idempotencyKey: crypto.randomUUID() };
const quote: FuturesRouteQuote = {
  id: baseRequest.quoteId!, venue: 'gmtrade', market: 'SOL-PERP', nativeMarketAddress: Keypair.generate().publicKey.toBase58(),
  nativeMarketTokenAddress: Keypair.generate().publicKey.toBase58(), side: 'long', orderType: 'market', collateralAtomic: '1000000',
  notionalMicroUsd: '2000000', baseSizeAtomic: '20000000', baseDecimals: 9, entryPriceMicroUsd: '100000000',
  acceptablePriceMicroUsd: '100500000', liquidationPriceMicroUsd: null, openingFeeMicroUsd: '1200', executionFeeLamports: '300000',
  networkFeeLamports: null, accountRentLamports: null, immediateCostMicroUsd: '1200', priceImpactBps: 0,
  fundingRateBpsHourly: null, borrowingRateBpsHourly: null, setupSteps: [], executionEligible: true, exclusionCode: null,
  exclusionReason: null, sourceSlot: '1', fetchedAt: Date.now(), expiresAt: Date.now() + 10_000,
};

function le(value: bigint, bytes: number): Buffer {
  const output = Buffer.alloc(bytes);
  let remaining = value;
  for (let index = 0; index < bytes; index += 1) { output[index] = Number(remaining & 255n); remaining >>= 8n; }
  return output;
}
function option(value: bigint | null, bytes: number): Buffer { return value === null ? Buffer.from([0]) : Buffer.concat([Buffer.from([1]), le(value, bytes)]); }
function instruction(overrides: Partial<{ kind: number; path: number; collateral: bigint; size: bigint; long: boolean; trigger: bigint | null; acceptable: bigint | null; fee: bigint }> = {}) {
  const values = {
    kind: 3, path: 0, collateral: 1_000_000n, size: 2_000_000n * 10n ** 14n, long: true,
    trigger: null as bigint | null, acceptable: 100_500_000n * 10n ** 5n, fee: 300_000n,
    ...overrides,
  };
  const data = Buffer.concat([
    Buffer.from('c89d03b603a4a2f0', 'hex'), Buffer.alloc(32), Buffer.from([values.kind, 0]),
    le(values.fee, 8), Buffer.from([values.path]), le(values.collateral, 8), le(values.size, 16),
    Buffer.from([values.long ? 1 : 0, 1]), option(0n, 16), option(values.trigger, 16), option(values.acceptable, 16),
    Buffer.from([0, 0, 0]),
  ]);
  return new TransactionInstruction({ programId: new PublicKey(PROGRAM), keys: [], data });
}



function meta(pubkey: PublicKey, isWritable = false, isSigner = false) { return { pubkey, isWritable, isSigner }; }
function accountBoundInstruction() {
  const built = instruction();
  const program = new PublicKey(PROGRAM);
  const owner = new PublicKey(wallet);
  const store = PublicKey.findProgramAddressSync([Buffer.from('data_store'), Buffer.from('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'hex')], program)[0];
  const market = new PublicKey(quote.nativeMarketAddress);
  const marketToken = new PublicKey(quote.nativeMarketTokenAddress!);
  const usdc = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
  const user = PublicKey.findProgramAddressSync([Buffer.from('user'), store.toBuffer(), owner.toBuffer()], program)[0];
  const order = PublicKey.findProgramAddressSync([Buffer.from('order'), store.toBuffer(), owner.toBuffer(), Buffer.alloc(32)], program)[0];
  const position = PublicKey.findProgramAddressSync([Buffer.from('position'), store.toBuffer(), owner.toBuffer(), marketToken.toBuffer(), usdc.toBuffer(), Buffer.from([1])], program)[0];
  const escrow = getAssociatedTokenAddressSync(usdc, order, true);
  const walletAta = getAssociatedTokenAddressSync(usdc, owner);
  const eventAuthority = PublicKey.findProgramAddressSync([Buffer.from('__event_authority')], program)[0];
  built.keys = [
    meta(owner, true, true), meta(owner, true, true), meta(store), meta(market, true), meta(user, true), meta(order, true), meta(position, true),
    meta(usdc), meta(usdc), meta(usdc), meta(usdc), meta(escrow, true), meta(program), meta(escrow, true), meta(escrow, true), meta(walletAta, true),
    meta(SystemProgram.programId), meta(TOKEN_PROGRAM_ID), meta(ASSOCIATED_TOKEN_PROGRAM_ID), meta(program), meta(program), meta(program), meta(program), meta(eventAuthority), meta(program),
  ];
  return { built, order };
}

describe('GMTrade order semantic validation', () => {
  it('decodes and accepts an exact direct-USDC market entry', () => {
    const decoded = validateGmTradeOrderSemantics(baseRequest, quote, undefined, [instruction()]);
    expect(decoded).toMatchObject({ kind: 3, collateralAtomic: 1_000_000n, sizeUsdProtocol: 2_000_000n * 10n ** 14n, isLong: true, swapPathLength: 0 });
  });

  it.each([
    ['direction', { long: false }],
    ['collateral', { collateral: 2_000_000n }],
    ['notional', { size: 3_000_000n * 10n ** 14n }],
    ['price', { acceptable: 101_000_000n * 10n ** 5n }],
    ['swap path', { path: 1 }],
    ['execution fee', { fee: 300_001n }],
  ] as const)('rejects a changed %s', (_label, change) => {
    expect(() => validateGmTradeOrderSemantics(baseRequest, quote, undefined, [instruction(change)])).toThrowError(expect.objectContaining({ code: 'FUTURES_ROUTE_MISMATCH' }));
  });

  it('requires exactly one native create-order instruction', () => {
    expect(() => decodeGmTradeCreateOrder([])).toThrowError(expect.objectContaining({ code: 'FUTURES_ROUTE_MISMATCH' }));
    expect(() => decodeGmTradeCreateOrder([instruction(), instruction()])).toThrowError(expect.objectContaining({ code: 'FUTURES_ROUTE_MISMATCH' }));
  });

  it('binds a conditional decrease to its original position, size ratio, trigger, and execution bound', () => {
    const position = {
      venue: 'gmtrade' as const, nativeId: Keypair.generate().publicKey.toBase58(), market: 'SOL-PERP', side: 'long' as const,
      sizeAtomic: '1000000000', baseDecimals: 9, collateralAtomic: '4000000', entryPriceMicroUsd: '100000000',
      markPriceMicroUsd: '101000000', liquidationPriceMicroUsd: null, unrealizedPnlMicroUsd: '1000000', leverageBps: 20_000,
      conditionals: [], updatedAt: Date.now(),
    };
    const before = { venue: 'gmtrade', available: true, collateralAtomic: '4000000', withdrawableAtomic: '0', positions: [position], orders: [], orphanedConditionals: [], history: [], error: null, fetchedAt: Date.now() } satisfies FuturesVenuePortfolio;
    const request: FuturesPrepareRequest = { wallet, action: 'take-profit', venue: 'gmtrade', market: 'SOL-PERP', nativeId: position.nativeId, sizeAtomic: '500000000', triggerPriceMicroUsd: '120000000', executionPriceMicroUsd: '119000000', idempotencyKey: crypto.randomUUID() };
    expect(validateGmTradeOrderSemantics(request, undefined, before, [instruction({
      kind: 7, collateral: 2_000_000n, size: 50n * 10n ** 20n, long: true,
      trigger: 120_000_000n * 10n ** 5n,
      acceptable: 119_000_000n * 10n ** 5n,
    })])).toMatchObject({ kind: 7, collateralAtomic: 2_000_000n });
  });

  it('binds every GMTrade order account and rejects added writable accounts or changed receivers', () => {
    const { built } = accountBoundInstruction();
    const decoded = decodeGmTradeCreateOrder([built]);
    expect(() => validateGmTradeInstructionAccounts(baseRequest, quote, quote.nativeMarketAddress, [built], decoded)).not.toThrow();
    const extra = new TransactionInstruction({ programId: built.programId, data: built.data, keys: [...built.keys, meta(Keypair.generate().publicKey, true)] });
    expect(() => validateGmTradeInstructionAccounts(baseRequest, quote, quote.nativeMarketAddress, [extra], decoded)).toThrowError(expect.objectContaining({ code: 'FUTURES_ROUTE_MISMATCH' }));
    const changedReceiver = new TransactionInstruction({ programId: built.programId, data: built.data, keys: built.keys.map((value, index) => index === 1 ? meta(Keypair.generate().publicKey, true) : value) });
    expect(() => validateGmTradeInstructionAccounts(baseRequest, quote, quote.nativeMarketAddress, [changedReceiver], decoded)).toThrowError(expect.objectContaining({ code: 'FUTURES_ROUTE_MISMATCH' }));
  });

  it('rejects an associated-token setup for an account outside the reviewed wallet or order', () => {
    const { built } = accountBoundInstruction();
    const decoded = decodeGmTradeCreateOrder([built]);
    const unexpectedOwner = Keypair.generate().publicKey;
    const usdc = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    const maliciousAta = new TransactionInstruction({
      programId: ASSOCIATED_TOKEN_PROGRAM_ID,
      data: Buffer.from([1]),
      keys: [meta(new PublicKey(wallet), true, true), meta(getAssociatedTokenAddressSync(usdc, unexpectedOwner), true), meta(unexpectedOwner), meta(usdc), meta(SystemProgram.programId), meta(TOKEN_PROGRAM_ID)],
    });
    expect(() => validateGmTradeInstructionAccounts(baseRequest, quote, quote.nativeMarketAddress, [built, maliciousAta], decoded)).toThrowError(expect.objectContaining({ code: 'FUTURES_ROUTE_MISMATCH' }));
  });

});
