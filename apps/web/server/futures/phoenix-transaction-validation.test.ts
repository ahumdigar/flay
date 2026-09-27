import { describe, expect, it } from 'vitest';
import {
  PHOENIX_PROGRAM_ADDRESS,
  OrderFlags,
  Side,
  getCancelOrdersByIdEncoder,
  getOnboardTraderDelegatedEncoder,
  getPlaceMarketOrderEncoder,
  getRegisterTraderInstructionEncoder,
  getSyncParentToChildEncoder,
  getTransferCollateralChildToParentEncoder,
  getTransferCollateralEncoder,
} from '@ellipsis-labs/rise';
import { Keypair, PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { atomicToDecimalString, type PhoenixExpectedSemantics } from './phoenix-transactions.js';
import { validatePhoenixInstructionAccounts, validatePhoenixSemantics } from './phoenix-transaction-validation.js';

function instruction(program: string, data: ArrayLike<number>) {
  return new TransactionInstruction({ programId: new PublicKey(program), keys: [], data: Buffer.from(Array.from(data)) });
}
function isolatedBundle(amount: bigint, order = marketOrder()) {
  return [
    instruction(String(PHOENIX_PROGRAM_ADDRESS), getSyncParentToChildEncoder().encode(undefined)),
    instruction(String(PHOENIX_PROGRAM_ADDRESS), getTransferCollateralEncoder().encode(amount)),
    order,
    instruction(String(PHOENIX_PROGRAM_ADDRESS), getTransferCollateralChildToParentEncoder().encode(undefined)),
  ];
}
function marketOrder(overrides: Partial<Record<'side' | 'priceInTicks' | 'numBaseLots' | 'minBaseLotsToFill' | 'orderFlags', bigint | number>> = {}) {
  return instruction(String(PHOENIX_PROGRAM_ADDRESS), getPlaceMarketOrderEncoder().encode({
    side: Side.Bid,
    priceInTicks: 100n,
    numBaseLots: 20n,
    numQuoteLots: null,
    minBaseLotsToFill: 20n,
    minQuoteLotsToFill: 1n,
    selfTradeBehavior: 0,
    matchLimit: null,
    clientOrderId: 0n,
    lastValidSlot: null,
    orderFlags: OrderFlags.None,
    cancelExisting: false,
    ...overrides,
  } as never));
}

const open: PhoenixExpectedSemantics = {
  action: 'open', orderType: 'market', side: 'bid', baseLots: '20', priceTicks: '100', collateralAtomic: '1000000', pdaIndex: 0, subaccountIndex: 1, includeRegister: false,
};

describe('Phoenix exact amount conversion', () => {
  it('preserves atomic precision without floating point', () => {
    expect(atomicToDecimalString('1000000', 6)).toBe('1');
    expect(atomicToDecimalString('1500001', 6)).toBe('1.500001');
    expect(atomicToDecimalString('9007199254740993', 6)).toBe('9007199254.740993');
  });
});

describe('Phoenix instruction semantic validation', () => {
  it('accepts the exact market direction, size, price, and collateral transfer', () => {
    expect(() => validatePhoenixSemantics(open, isolatedBundle(1_000_000n))).not.toThrow();
  });

  it.each([
    ['direction', { side: Side.Ask }],
    ['price', { priceInTicks: 101n }],
    ['size', { numBaseLots: 21n }],
    ['entry reduce flag', { orderFlags: OrderFlags.ReduceOnly }],
  ] as const)('rejects a changed %s', (_label, mutation) => {
    expect(() => validatePhoenixSemantics(open, isolatedBundle(1_000_000n, marketOrder(mutation)))).toThrowError(expect.objectContaining({ code: 'FUTURES_ROUTE_MISMATCH' }));
  });

  it('accepts only an isolated child registration in a first-entry bundle', () => {
    const expected = { ...open, includeRegister: true } satisfies PhoenixExpectedSemantics;
    const registration = instruction(String(PHOENIX_PROGRAM_ADDRESS), getRegisterTraderInstructionEncoder().encode({ maxPositions: 1n, traderPreferenceBits: 0, traderPdaIndex: 0, subaccountIndex: 1 }));
    expect(() => validatePhoenixSemantics(expected, [registration, ...isolatedBundle(1_000_000n)])).not.toThrow();
    const crossRegistration = instruction(String(PHOENIX_PROGRAM_ADDRESS), getRegisterTraderInstructionEncoder().encode({ maxPositions: 32n, traderPreferenceBits: 0, traderPdaIndex: 0, subaccountIndex: 1 }));
    expect(() => validatePhoenixSemantics(expected, [crossRegistration, ...isolatedBundle(1_000_000n)])).toThrowError(expect.objectContaining({ code: 'FUTURES_ROUTE_MISMATCH' }));
  });

  it('rejects changed collateral and duplicate economic instructions', () => {
    expect(() => validatePhoenixSemantics(open, isolatedBundle(2_000_000n))).toThrowError(expect.objectContaining({ code: 'FUTURES_ROUTE_MISMATCH' }));
    expect(() => validatePhoenixSemantics(open, [...isolatedBundle(1_000_000n), marketOrder()])).toThrowError(expect.objectContaining({ code: 'FUTURES_ROUTE_MISMATCH' }));
  });

  it('binds an entry bundle to one nonzero isolated child account', () => {
    const wallet = Keypair.generate().publicKey;
    const market = Keypair.generate().publicKey;
    const program = new PublicKey(String(PHOENIX_PROGRAM_ADDRESS));
    const parent = PublicKey.findProgramAddressSync([Buffer.from('trader'), wallet.toBuffer(), Buffer.from([0]), Buffer.from([0])], program)[0];
    const child = PublicKey.findProgramAddressSync([Buffer.from('trader'), wallet.toBuffer(), Buffer.from([0]), Buffer.from([1])], program)[0];
    const readonly = () => ({ pubkey: Keypair.generate().publicKey, isWritable: false, isSigner: false });
    const sync = new TransactionInstruction({ programId: program, data: Buffer.from(getSyncParentToChildEncoder().encode(undefined)), keys: [readonly(), readonly(), readonly(), { pubkey: wallet, isWritable: false, isSigner: false }, { pubkey: parent, isWritable: false, isSigner: false }, { pubkey: child, isWritable: true, isSigner: false }] });
    const transfer = new TransactionInstruction({ programId: program, data: Buffer.from(getTransferCollateralEncoder().encode(1_000_000n)), keys: [readonly(), readonly(), readonly(), { pubkey: wallet, isWritable: false, isSigner: true }, { pubkey: parent, isWritable: true, isSigner: false }, { pubkey: child, isWritable: true, isSigner: false }] });
    const order = new TransactionInstruction({ programId: program, data: marketOrder().data, keys: [readonly(), readonly(), readonly(), { pubkey: wallet, isWritable: false, isSigner: true }, { pubkey: child, isWritable: true, isSigner: false }, { pubkey: market, isWritable: true, isSigner: false }] });
    const sweep = new TransactionInstruction({ programId: program, data: Buffer.from(getTransferCollateralChildToParentEncoder().encode(undefined)), keys: [readonly(), readonly(), readonly(), { pubkey: wallet, isWritable: false, isSigner: false }, { pubkey: child, isWritable: true, isSigner: false }, { pubkey: parent, isWritable: true, isSigner: false }] });
    expect(() => validatePhoenixInstructionAccounts(open, wallet.toBase58(), market.toBase58(), [sync, transfer, order, sweep])).not.toThrow();
    const wrongChild = Keypair.generate().publicKey;
    const altered = new TransactionInstruction({ programId: program, data: transfer.data, keys: transfer.keys.map((key, index) => index === 5 ? { ...key, pubkey: wrongChild } : key) });
    expect(() => validatePhoenixInstructionAccounts(open, wallet.toBase58(), market.toBase58(), [sync, altered, order, sweep])).toThrowError(expect.objectContaining({ code: 'FUTURES_ROUTE_MISMATCH' }));
  });

  it('requires the reduce-only flag and full size for a Phoenix close', () => {
    const close: PhoenixExpectedSemantics = { action: 'close', side: 'ask', baseLots: '20', priceTicks: '99', fullClose: true, pdaIndex: 0, subaccountIndex: 1 };
    const valid = marketOrder({ side: Side.Ask, priceInTicks: 99n, orderFlags: OrderFlags.ReduceOnly });
    const cleanup = instruction(String(PHOENIX_PROGRAM_ADDRESS), getTransferCollateralChildToParentEncoder().encode(undefined));
    expect(() => validatePhoenixSemantics(close, [valid, cleanup])).not.toThrow();
    expect(() => validatePhoenixSemantics(close, [valid])).toThrowError(expect.objectContaining({ code: 'FUTURES_ROUTE_MISMATCH' }));
    expect(() => validatePhoenixSemantics(close, [marketOrder({ side: Side.Ask, priceInTicks: 99n }), cleanup])).toThrowError(expect.objectContaining({ code: 'FUTURES_ROUTE_MISMATCH' }));
    expect(() => validatePhoenixSemantics(close, [marketOrder({ side: Side.Ask, priceInTicks: 99n, orderFlags: OrderFlags.ReduceOnly, minBaseLotsToFill: 19n }), cleanup])).toThrowError(expect.objectContaining({ code: 'FUTURES_ROUTE_MISMATCH' }));
  });

  it('requires the reviewed cancellation and its collateral cleanup', () => {
    const cancel: PhoenixExpectedSemantics = { action: 'cancel', priceTicks: '100', sequenceNumber: '7', pdaIndex: 0, subaccountIndex: 1 };
    const valid = instruction(String(PHOENIX_PROGRAM_ADDRESS), getCancelOrdersByIdEncoder().encode({
      orderIds: [{ nodePointer: null, orderId: { priceInTicks: 100n, orderSequenceNumber: 7n } }],
    } as never));
    const cleanup = instruction(String(PHOENIX_PROGRAM_ADDRESS), getTransferCollateralChildToParentEncoder().encode(undefined));
    expect(() => validatePhoenixSemantics(cancel, [valid, cleanup])).not.toThrow();
    expect(() => validatePhoenixSemantics(cancel, [valid])).toThrowError(expect.objectContaining({ code: 'FUTURES_ROUTE_MISMATCH' }));
    const changed = instruction(String(PHOENIX_PROGRAM_ADDRESS), getCancelOrdersByIdEncoder().encode({
      orderIds: [{ nodePointer: null, orderId: { priceInTicks: 101n, orderSequenceNumber: 7n } }],
    } as never));
    expect(() => validatePhoenixSemantics(cancel, [changed, cleanup])).toThrowError(expect.objectContaining({ code: 'FUTURES_ROUTE_MISMATCH' }));
  });

  it('binds cancel and close collateral cleanup to the exact child and parent PDAs', () => {
    const wallet = Keypair.generate().publicKey;
    const market = Keypair.generate().publicKey;
    const program = new PublicKey(String(PHOENIX_PROGRAM_ADDRESS));
    const parent = PublicKey.findProgramAddressSync([Buffer.from('trader'), wallet.toBuffer(), Buffer.from([0]), Buffer.from([0])], program)[0];
    const child = PublicKey.findProgramAddressSync([Buffer.from('trader'), wallet.toBuffer(), Buffer.from([0]), Buffer.from([1])], program)[0];
    const readonly = () => ({ pubkey: Keypair.generate().publicKey, isWritable: false, isSigner: false });
    const sweep = new TransactionInstruction({
      programId: program,
      data: Buffer.from(getTransferCollateralChildToParentEncoder().encode(undefined)),
      keys: [readonly(), readonly(), readonly(), { pubkey: wallet, isWritable: false, isSigner: false }, { pubkey: child, isWritable: true, isSigner: false }, { pubkey: parent, isWritable: true, isSigner: false }],
    });
    const cancelExpected: PhoenixExpectedSemantics = { action: 'cancel', priceTicks: '100', sequenceNumber: '7', pdaIndex: 0, subaccountIndex: 1 };
    const cancel = new TransactionInstruction({
      programId: program,
      data: Buffer.from(getCancelOrdersByIdEncoder().encode({ orderIds: [{ nodePointer: null, orderId: { priceInTicks: 100n, orderSequenceNumber: 7n } }] } as never)),
      keys: [readonly(), readonly(), readonly(), { pubkey: wallet, isWritable: false, isSigner: true }, { pubkey: child, isWritable: true, isSigner: false }, { pubkey: market, isWritable: true, isSigner: false }],
    });
    expect(() => validatePhoenixInstructionAccounts(cancelExpected, wallet.toBase58(), market.toBase58(), [cancel, sweep])).not.toThrow();
    const redirectedCancelSweep = new TransactionInstruction({ programId: program, data: sweep.data, keys: sweep.keys.map((key, index) => index === 5 ? { ...key, pubkey: Keypair.generate().publicKey } : key) });
    expect(() => validatePhoenixInstructionAccounts(cancelExpected, wallet.toBase58(), market.toBase58(), [cancel, redirectedCancelSweep])).toThrowError(expect.objectContaining({ code: 'FUTURES_ROUTE_MISMATCH' }));

    const closeExpected: PhoenixExpectedSemantics = { action: 'close', side: 'ask', baseLots: '20', priceTicks: '99', fullClose: true, pdaIndex: 0, subaccountIndex: 1 };
    const close = new TransactionInstruction({
      programId: program,
      data: marketOrder({ side: Side.Ask, priceInTicks: 99n, orderFlags: OrderFlags.ReduceOnly }).data,
      keys: [readonly(), readonly(), readonly(), { pubkey: wallet, isWritable: false, isSigner: true }, { pubkey: child, isWritable: true, isSigner: false }, { pubkey: market, isWritable: true, isSigner: false }],
    });
    expect(() => validatePhoenixInstructionAccounts(closeExpected, wallet.toBase58(), market.toBase58(), [close, sweep])).not.toThrow();
    const redirectedCloseSweep = new TransactionInstruction({ programId: program, data: sweep.data, keys: sweep.keys.map((key, index) => index === 4 ? { ...key, pubkey: Keypair.generate().publicKey } : key) });
    expect(() => validatePhoenixInstructionAccounts(closeExpected, wallet.toBase58(), market.toBase58(), [close, redirectedCloseSweep])).toThrowError(expect.objectContaining({ code: 'FUTURES_ROUTE_MISMATCH' }));
  });

  it('binds registration to the reviewed wallet and its exact isolated trader PDA', () => {
    const wallet = Keypair.generate().publicKey;
    const program = new PublicKey(String(PHOENIX_PROGRAM_ADDRESS));
    const trader = PublicKey.findProgramAddressSync([Buffer.from('trader'), wallet.toBuffer(), Buffer.from([0]), Buffer.from([0])], program)[0];
    const keys = [
      { pubkey: program, isWritable: false, isSigner: false },
      { pubkey: Keypair.generate().publicKey, isWritable: false, isSigner: false },
      { pubkey: Keypair.generate().publicKey, isWritable: false, isSigner: false },
      { pubkey: wallet, isWritable: true, isSigner: true },
      { pubkey: wallet, isWritable: true, isSigner: true },
      { pubkey: trader, isWritable: true, isSigner: false },
      { pubkey: SystemProgram.programId, isWritable: false, isSigner: false },
    ];
    const registration = new TransactionInstruction({
      programId: program,
      keys,
      data: Buffer.from(Array.from(getRegisterTraderInstructionEncoder().encode({ maxPositions: 32n, traderPreferenceBits: 0, traderPdaIndex: 0, subaccountIndex: 0 }))),
    });
    const onboarder = Keypair.generate().publicKey;
    const onboarding = new TransactionInstruction({
      programId: program,
      keys: [
        { pubkey: program, isWritable: false, isSigner: false },
        { pubkey: Keypair.generate().publicKey, isWritable: false, isSigner: false },
        { pubkey: Keypair.generate().publicKey, isWritable: false, isSigner: false },
        { pubkey: onboarder, isWritable: false, isSigner: true },
        { pubkey: Keypair.generate().publicKey, isWritable: true, isSigner: false },
        { pubkey: trader, isWritable: true, isSigner: false },
      ],
      data: Buffer.from(getOnboardTraderDelegatedEncoder().encode(undefined)),
    });
    const expected: PhoenixExpectedSemantics = { action: 'register', includeRegister: true, maxPositions: '32', pdaIndex: 0, subaccountIndex: 0, onboarder: onboarder.toBase58() };
    expect(() => validatePhoenixSemantics(expected, [registration, onboarding])).not.toThrow();
    expect(() => validatePhoenixInstructionAccounts(expected, wallet.toBase58(), null, [registration, onboarding])).not.toThrow();
    const wrongTrader = new TransactionInstruction({ programId: program, keys: keys.map((key, index) => index === 5 ? { ...key, pubkey: Keypair.generate().publicKey } : key), data: registration.data });
    expect(() => validatePhoenixInstructionAccounts(expected, wallet.toBase58(), null, [wrongTrader, onboarding])).toThrowError(expect.objectContaining({ code: 'FUTURES_ROUTE_MISMATCH' }));
    const extraWritable = new TransactionInstruction({ programId: program, keys: [...keys, { pubkey: Keypair.generate().publicKey, isWritable: true, isSigner: false }], data: registration.data });
    expect(() => validatePhoenixInstructionAccounts(expected, wallet.toBase58(), null, [extraWritable, onboarding])).toThrowError(expect.objectContaining({ code: 'FUTURES_ROUTE_MISMATCH' }));

    const alreadyRegistered: PhoenixExpectedSemantics = { ...expected, action: 'activate', includeRegister: false };
    expect(() => validatePhoenixSemantics(alreadyRegistered, [onboarding])).not.toThrow();
    expect(() => validatePhoenixInstructionAccounts(alreadyRegistered, wallet.toBase58(), null, [onboarding])).not.toThrow();
    const redirectedOnboarding = new TransactionInstruction({ programId: program, keys: onboarding.keys.map((key, index) => index === 5 ? { ...key, pubkey: Keypair.generate().publicKey } : key), data: onboarding.data });
    expect(() => validatePhoenixInstructionAccounts(alreadyRegistered, wallet.toBase58(), null, [redirectedOnboarding])).toThrowError(expect.objectContaining({ code: 'FUTURES_ROUTE_MISMATCH' }));
    const changedOnboarder = new TransactionInstruction({ programId: program, keys: onboarding.keys.map((key, index) => index === 3 ? { ...key, pubkey: Keypair.generate().publicKey } : key), data: onboarding.data });
    expect(() => validatePhoenixInstructionAccounts(alreadyRegistered, wallet.toBase58(), null, [changedOnboarder])).toThrowError(expect.objectContaining({ code: 'FUTURES_ROUTE_MISMATCH' }));
  });

});
