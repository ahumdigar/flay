import {
  EMBER_PROGRAM_ADDRESS,
  PHOENIX_PROGRAM_ADDRESS,
  Direction,
  OrderFlags,
  Side,
  getCancelConditionalOrderDecoder,
  getCancelOrdersByIdDecoder,
  getCreateConditionalOrdersAccountDecoder,
  getDepositFundsDecoder,
  getEmberDepositDecoder,
  getEmberWithdrawDecoder,
  getOnboardTraderDelegatedDecoder,
  getPlaceLimitOrderDecoder,
  getPlaceMarketOrderDecoder,
  getPlacePositionConditionalOrderDecoder,
  getRegisterTraderInstructionDecoder,
  getSyncParentToChildDecoder,
  getTransferCollateralChildToParentDecoder,
  getTransferCollateralDecoder,
  getWithdrawFundsDecoder,
} from '@ellipsis-labs/rise';
import { ComputeBudgetProgram, PublicKey, SystemProgram, type TransactionInstruction } from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { AppError } from '../errors.js';
import type { PhoenixExpectedSemantics } from './phoenix-transactions.js';

interface Decoder<T> { decode(bytes: Uint8Array): T }

function decoded<T>(instructions: TransactionInstruction[], program: string, decoder: Decoder<T>): T[] {
  return instructions.flatMap((instruction) => {
    if (instruction.programId.toBase58() !== program) return [];
    try { return [decoder.decode(instruction.data)]; } catch { return []; }
  });
}

function exactlyOne<T>(rows: T[], label: string): T {
  if (rows.length !== 1) throw new AppError(409, 'FUTURES_ROUTE_MISMATCH', `The Phoenix transaction must contain exactly one reviewed ${label} instruction.`);
  return rows[0];
}

function mismatch(message: string): never {
  throw new AppError(409, 'FUTURES_ROUTE_MISMATCH', message);
}

function matching<T>(instructions: TransactionInstruction[], program: string, decoder: Decoder<T>): TransactionInstruction[] {
  return instructions.filter((instruction) => {
    if (instruction.programId.toBase58() !== program) return false;
    try { decoder.decode(instruction.data); return true; } catch { return false; }
  });
}

function assertVenueInstructionCount(instructions: TransactionInstruction[], expected: number) {
  const actual = instructions.filter((instruction) => instruction.programId.toBase58() === String(PHOENIX_PROGRAM_ADDRESS)
    || instruction.programId.toBase58() === String(EMBER_PROGRAM_ADDRESS)).length;
  if (actual !== expected) mismatch('The Phoenix transaction contains an unreviewed venue instruction.');
}

function sideValue(side: 'bid' | 'ask'): Side { return side === 'bid' ? Side.Bid : Side.Ask; }

function assertCollateralTransfer(instructions: TransactionInstruction[], amountAtomic: string) {
  const ember = exactlyOne(decoded(instructions, String(EMBER_PROGRAM_ADDRESS), getEmberDepositDecoder()), 'USDC conversion deposit');
  const deposit = exactlyOne(decoded(instructions, String(PHOENIX_PROGRAM_ADDRESS), getDepositFundsDecoder()), 'Phoenix collateral deposit');
  if (BigInt(ember) !== BigInt(amountAtomic) || BigInt(deposit) !== BigInt(amountAtomic)) {
    mismatch('The Phoenix collateral transfer differs from the reviewed USDC amount.');
  }
}

export function validatePhoenixSemantics(expected: PhoenixExpectedSemantics, instructions: TransactionInstruction[]): void {
  switch (expected.action) {
    case 'activate':
    case 'register': {
      exactlyOne(decoded(instructions, String(PHOENIX_PROGRAM_ADDRESS), getOnboardTraderDelegatedDecoder()), 'public onboarding');
      const registrations = decoded(instructions, String(PHOENIX_PROGRAM_ADDRESS), getRegisterTraderInstructionDecoder());
      if (registrations.length !== (expected.includeRegister ? 1 : 0)) mismatch('The Phoenix onboarding registration steps differ from the reviewed wallet state.');
      if (registrations[0] && (registrations[0].maxPositions !== BigInt(expected.maxPositions)
        || registrations[0].traderPdaIndex !== expected.pdaIndex
        || registrations[0].subaccountIndex !== expected.subaccountIndex)) {
        mismatch('The Phoenix onboarding attempts to register an unexpected trader account.');
      }
      assertVenueInstructionCount(instructions, 1 + registrations.length);
      return;
    }
    case 'deposit': {
      assertCollateralTransfer(instructions, expected.amountAtomic);
      assertVenueInstructionCount(instructions, 2);
      return;
    }
    case 'withdraw': {
      const withdraw = exactlyOne(decoded(instructions, String(PHOENIX_PROGRAM_ADDRESS), getWithdrawFundsDecoder()), 'Phoenix collateral withdrawal');
      const ember = exactlyOne(decoded(instructions, String(EMBER_PROGRAM_ADDRESS), getEmberWithdrawDecoder()), 'USDC conversion withdrawal');
      if (BigInt(withdraw) !== BigInt(expected.amountAtomic) || ember === null || BigInt(ember) !== BigInt(expected.amountAtomic)) {
        mismatch('The Phoenix withdrawal differs from the reviewed USDC amount.');
      }
      assertVenueInstructionCount(instructions, 2);
      return;
    }
    case 'open': {
      const transfer = exactlyOne(decoded(instructions, String(PHOENIX_PROGRAM_ADDRESS), getTransferCollateralDecoder()), 'isolated collateral transfer');
      if (BigInt(transfer) !== BigInt(expected.collateralAtomic)) mismatch('The Phoenix isolated collateral transfer differs from the reviewed USDC amount.');
      exactlyOne(decoded(instructions, String(PHOENIX_PROGRAM_ADDRESS), getSyncParentToChildDecoder()), 'isolated parent-to-child sync');
      exactlyOne(decoded(instructions, String(PHOENIX_PROGRAM_ADDRESS), getTransferCollateralChildToParentDecoder()), 'isolated collateral cleanup');
      const registrations = decoded(instructions, String(PHOENIX_PROGRAM_ADDRESS), getRegisterTraderInstructionDecoder());
      if (registrations.length !== (expected.includeRegister ? 1 : 0)) mismatch('The Phoenix isolated registration steps differ from the reviewed bundle.');
      if (registrations[0] && (registrations[0].maxPositions !== 1n || registrations[0].traderPdaIndex !== expected.pdaIndex || registrations[0].subaccountIndex !== expected.subaccountIndex)) {
        mismatch('The Phoenix entry attempts to register an unexpected or non-isolated trader account.');
      }
      if (expected.orderType === 'market') {
        const order = exactlyOne(decoded(instructions, String(PHOENIX_PROGRAM_ADDRESS), getPlaceMarketOrderDecoder()), 'market entry');
        if (order.side !== sideValue(expected.side) || BigInt(order.numBaseLots) !== BigInt(expected.baseLots) || order.priceInTicks === null || BigInt(order.priceInTicks) !== BigInt(expected.priceTicks)) {
          mismatch('The Phoenix market direction, size, or acceptable price differs from the reviewed route.');
        }
        if ((Number(order.orderFlags) & Number(OrderFlags.ReduceOnly)) !== 0) mismatch('A Phoenix entry cannot be reduce-only.');
      } else {
        const order = exactlyOne(decoded(instructions, String(PHOENIX_PROGRAM_ADDRESS), getPlaceLimitOrderDecoder()), 'limit entry');
        if (order.side !== sideValue(expected.side) || BigInt(order.numBaseLots) !== BigInt(expected.baseLots) || BigInt(order.priceInTicks) !== BigInt(expected.priceTicks)) {
          mismatch('The Phoenix limit direction, size, or price differs from the reviewed route.');
        }
        if ((Number(order.orderFlags) & Number(OrderFlags.ReduceOnly)) !== 0) mismatch('A Phoenix entry cannot be reduce-only.');
      }
      assertVenueInstructionCount(instructions, 4 + registrations.length);
      return;
    }
    case 'cancel': {
      const cancel = exactlyOne(decoded(instructions, String(PHOENIX_PROGRAM_ADDRESS), getCancelOrdersByIdDecoder()), 'order cancellation');
      if (cancel.orderIds.length !== 1
        || BigInt(cancel.orderIds[0].orderId.priceInTicks) !== BigInt(expected.priceTicks)
        || BigInt(cancel.orderIds[0].orderId.orderSequenceNumber) !== BigInt(expected.sequenceNumber)) {
        mismatch('The Phoenix cancellation differs from the original venue order.');
      }
      exactlyOne(decoded(instructions, String(PHOENIX_PROGRAM_ADDRESS), getTransferCollateralChildToParentDecoder()), 'cancel collateral cleanup');
      assertVenueInstructionCount(instructions, 2);
      return;
    }
    case 'close':
    case 'reduce': {
      const order = exactlyOne(decoded(instructions, String(PHOENIX_PROGRAM_ADDRESS), getPlaceMarketOrderDecoder()), 'reduce-only market order');
      if (order.side !== sideValue(expected.side) || BigInt(order.numBaseLots) !== BigInt(expected.baseLots)
        || (expected.priceTicks === null ? order.priceInTicks !== null : order.priceInTicks === null || BigInt(order.priceInTicks) !== BigInt(expected.priceTicks))) {
        mismatch('The Phoenix reduction direction, size, or acceptable price differs from review.');
      }
      if ((Number(order.orderFlags) & Number(OrderFlags.ReduceOnly)) === 0) mismatch('Phoenix close and reduce orders must be reduce-only.');
      if (expected.fullClose && BigInt(order.minBaseLotsToFill) !== BigInt(expected.baseLots)) mismatch('A Phoenix full close must fill the complete reviewed size.');
      exactlyOne(decoded(instructions, String(PHOENIX_PROGRAM_ADDRESS), getTransferCollateralChildToParentDecoder()), 'reduce collateral cleanup');
      assertVenueInstructionCount(instructions, 2);
      return;
    }
    case 'take-profit':
    case 'stop-loss': {
      const conditional = exactlyOne(decoded(instructions, String(PHOENIX_PROGRAM_ADDRESS), getPlacePositionConditionalOrderDecoder()), 'position conditional order');
      const trigger = expected.direction === 'greater_than' ? conditional.greaterTriggerOrder : conditional.lessTriggerOrder;
      const opposite = expected.direction === 'greater_than' ? conditional.lessTriggerOrder : conditional.greaterTriggerOrder;
      if (!trigger || opposite !== null || conditional.sizeBaseLots === null
        || BigInt(conditional.sizeBaseLots) !== BigInt(expected.sizeBaseLots)
        || trigger.tradeSide !== sideValue(expected.tradeSide)
        || trigger.triggerDirection !== (expected.direction === 'greater_than' ? Direction.GreaterThan : Direction.LessThan)
        || BigInt(trigger.triggerPrice) !== BigInt(expected.triggerPriceTicks)
        || BigInt(trigger.executionPrice) !== BigInt(expected.executionPriceTicks)) {
        mismatch('The Phoenix TP/SL side, size, trigger, or execution price differs from review.');
      }
      const creates = matching(instructions, String(PHOENIX_PROGRAM_ADDRESS), getCreateConditionalOrdersAccountDecoder());
      if (creates.length > 1) mismatch('The Phoenix transaction contains duplicate conditional-account setup.');
      assertVenueInstructionCount(instructions, 1 + creates.length);
      return;
    }
    case 'cancel-conditional': {
      const cancel = exactlyOne(decoded(instructions, String(PHOENIX_PROGRAM_ADDRESS), getCancelConditionalOrderDecoder()), 'conditional cancellation');
      if (cancel.conditionalOrderIndex !== expected.conditionalIndex || cancel.disableFirst === cancel.disableSecond) {
        mismatch('The Phoenix conditional cancellation differs from the original venue order.');
      }
      assertVenueInstructionCount(instructions, 1);
      return;
    }
  }
}


function expectKey(instruction: TransactionInstruction, index: number, expected: PublicKey | string, label: string) {
  if (instruction.keys[index]?.pubkey.toBase58() !== String(expected)) mismatch(`The Phoenix ${label} account differs from review.`);
}

function requireWalletSigner(instruction: TransactionInstruction, wallet: PublicKey, label: string) {
  if (!instruction.keys.some((key) => key.pubkey.equals(wallet) && key.isSigner)) mismatch(`The Phoenix ${label} is not authorized by the reviewed wallet.`);
}

function requireMarket(instruction: TransactionInstruction, marketAddress: string | null, label: string) {
  if (!marketAddress || !instruction.keys.some((key) => key.pubkey.toBase58() === marketAddress && key.isWritable)) {
    mismatch(`The Phoenix ${label} is not bound to the reviewed market.`);
  }
}

function exactInstruction(instructions: TransactionInstruction[], program: string, decoder: Decoder<unknown>, label: string): TransactionInstruction {
  return exactlyOne(matching(instructions, program, decoder), label);
}

function traderPda(wallet: PublicKey, pdaIndex = 0, subaccountIndex = 0): PublicKey {
  return PublicKey.findProgramAddressSync([
    Buffer.from('trader'), wallet.toBuffer(), Buffer.from([pdaIndex]), Buffer.from([subaccountIndex]),
  ], new PublicKey(String(PHOENIX_PROGRAM_ADDRESS)))[0];
}

function validateConversionFlow(instructions: TransactionInstruction[], wallet: PublicKey, withdraw: boolean) {
  const ember = exactInstruction(instructions, String(EMBER_PROGRAM_ADDRESS), withdraw ? getEmberWithdrawDecoder() : getEmberDepositDecoder(), withdraw ? 'USDC conversion withdrawal' : 'USDC conversion deposit');
  if (ember.keys.length !== 8) mismatch('The Phoenix conversion contains unexpected accounts.');
  requireWalletSigner(ember, wallet, 'conversion');
  expectKey(ember, 7, TOKEN_PROGRAM_ID, 'conversion token program');
  const usdc = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
  const wrappedMint = ember.keys[withdraw ? 2 : 3]?.pubkey;
  if (!wrappedMint) mismatch('The Phoenix conversion mint is missing.');
  expectKey(ember, withdraw ? 3 : 2, usdc, 'USDC mint');
  expectKey(ember, withdraw ? 5 : 4, getAssociatedTokenAddressSync(usdc, wallet), 'wallet USDC receiver');
  expectKey(ember, withdraw ? 4 : 5, getAssociatedTokenAddressSync(wrappedMint, wallet), 'wallet Phoenix-token account');
  return { wrappedMint, ember };
}

function validateTraderInstruction(instruction: TransactionInstruction, wallet: PublicKey, marketAddress: string | null, label: string, pdaIndex = 0, subaccountIndex = 0) {
  requireWalletSigner(instruction, wallet, label);
  if (!instruction.keys.some((key) => key.pubkey.equals(traderPda(wallet, pdaIndex, subaccountIndex)))) mismatch(`The Phoenix ${label} targets an unexpected trader account.`);
  if (marketAddress) requireMarket(instruction, marketAddress, label);
}

/** Verifies wallet, PDA, receiver, mint, market, and common-program accounts independently of instruction data. */
export function validatePhoenixInstructionAccounts(
  expected: PhoenixExpectedSemantics,
  walletAddress: string,
  marketAddress: string | null,
  instructions: TransactionInstruction[],
): void {
  const wallet = new PublicKey(walletAddress);
  const allowedAtaMints = new Set<string>();
  if (expected.action === 'activate' || expected.action === 'register') {
    const onboarding = exactInstruction(instructions, String(PHOENIX_PROGRAM_ADDRESS), getOnboardTraderDelegatedDecoder(), 'public onboarding');
    expectKey(onboarding, 3, expected.onboarder, 'onboarding signer');
    if (!onboarding.keys[3]?.isSigner) mismatch('The Phoenix onboarding authority is not the reviewed provider signer.');
    expectKey(onboarding, 5, traderPda(wallet, expected.pdaIndex, expected.subaccountIndex), 'onboarding trader PDA');
    if (expected.includeRegister) {
      const register = exactInstruction(instructions, String(PHOENIX_PROGRAM_ADDRESS), getRegisterTraderInstructionDecoder(), 'onboarding registration');
      if (register.keys.length !== 7) mismatch('The Phoenix registration contains unexpected accounts.');
      expectKey(register, 3, wallet, 'registration payer');
      expectKey(register, 4, wallet, 'registration authority');
      expectKey(register, 5, traderPda(wallet, expected.pdaIndex, expected.subaccountIndex), 'registration trader PDA');
      expectKey(register, 6, SystemProgram.programId, 'registration system program');
    }
  } else if (expected.action === 'deposit') {
    const { wrappedMint, ember } = validateConversionFlow(instructions, wallet, false);
    allowedAtaMints.add(wrappedMint.toBase58());
    const deposit = exactInstruction(instructions, String(PHOENIX_PROGRAM_ADDRESS), getDepositFundsDecoder(), 'collateral deposit');
    validateTraderInstruction(deposit, wallet, null, 'collateral deposit');
    expectKey(deposit, 4, ember.keys[5].pubkey, 'deposit Phoenix-token source');
    expectKey(deposit, 7, TOKEN_PROGRAM_ID, 'deposit token program');
  } else if (expected.action === 'open') {
    const parent = traderPda(wallet, 0, 0);
    const child = traderPda(wallet, expected.pdaIndex, expected.subaccountIndex);
    if (expected.includeRegister) {
      const register = exactInstruction(instructions, String(PHOENIX_PROGRAM_ADDRESS), getRegisterTraderInstructionDecoder(), 'isolated registration');
      if (register.keys.length !== 7) mismatch('The Phoenix isolated registration contains unexpected accounts.');
      expectKey(register, 3, wallet, 'isolated registration payer');
      expectKey(register, 4, wallet, 'isolated registration authority');
      expectKey(register, 5, child, 'isolated registration trader PDA');
      expectKey(register, 6, SystemProgram.programId, 'isolated registration system program');
    }
    const sync = exactInstruction(instructions, String(PHOENIX_PROGRAM_ADDRESS), getSyncParentToChildDecoder(), 'isolated parent-to-child sync');
    expectKey(sync, 3, wallet, 'isolated sync wallet');
    expectKey(sync, 4, parent, 'isolated sync parent');
    expectKey(sync, 5, child, 'isolated sync child');
    const transfer = exactInstruction(instructions, String(PHOENIX_PROGRAM_ADDRESS), getTransferCollateralDecoder(), 'isolated collateral transfer');
    requireWalletSigner(transfer, wallet, 'isolated collateral transfer');
    expectKey(transfer, 4, parent, 'isolated collateral source');
    expectKey(transfer, 5, child, 'isolated collateral destination');
    const order = exactInstruction(instructions, String(PHOENIX_PROGRAM_ADDRESS), expected.orderType === 'market' ? getPlaceMarketOrderDecoder() : getPlaceLimitOrderDecoder(), `${expected.orderType} entry`);
    validateTraderInstruction(order, wallet, marketAddress, `${expected.orderType} entry`, expected.pdaIndex, expected.subaccountIndex);
    expectKey(order, 4, child, 'isolated order trader PDA');
    const sweep = exactInstruction(instructions, String(PHOENIX_PROGRAM_ADDRESS), getTransferCollateralChildToParentDecoder(), 'isolated collateral cleanup');
    expectKey(sweep, 3, wallet, 'isolated cleanup wallet');
    expectKey(sweep, 4, child, 'isolated cleanup child');
    expectKey(sweep, 5, parent, 'isolated cleanup parent');
  } else if (expected.action === 'withdraw') {
    const { wrappedMint, ember } = validateConversionFlow(instructions, wallet, true);
    allowedAtaMints.add(wrappedMint.toBase58());
    const withdraw = exactInstruction(instructions, String(PHOENIX_PROGRAM_ADDRESS), getWithdrawFundsDecoder(), 'collateral withdrawal');
    validateTraderInstruction(withdraw, wallet, null, 'collateral withdrawal');
    expectKey(withdraw, 7, ember.keys[4].pubkey, 'withdrawal Phoenix-token receiver');
    expectKey(withdraw, 8, TOKEN_PROGRAM_ID, 'withdrawal token program');
  } else {
    const decoder = expected.action === 'cancel' ? getCancelOrdersByIdDecoder()
      : expected.action === 'close' || expected.action === 'reduce' ? getPlaceMarketOrderDecoder()
        : expected.action === 'take-profit' || expected.action === 'stop-loss' ? getPlacePositionConditionalOrderDecoder()
          : getCancelConditionalOrderDecoder();
    const action = exactInstruction(instructions, String(PHOENIX_PROGRAM_ADDRESS), decoder, expected.action);
    validateTraderInstruction(action, wallet, marketAddress, expected.action, expected.pdaIndex, expected.subaccountIndex);
    if (expected.action === 'cancel' || expected.action === 'close' || expected.action === 'reduce') {
      const cleanup = exactInstruction(instructions, String(PHOENIX_PROGRAM_ADDRESS), getTransferCollateralChildToParentDecoder(), `${expected.action} collateral cleanup`);
      expectKey(cleanup, 3, wallet, `${expected.action} cleanup wallet`);
      expectKey(cleanup, 4, traderPda(wallet, expected.pdaIndex, expected.subaccountIndex), `${expected.action} cleanup child`);
      expectKey(cleanup, 5, traderPda(wallet, 0, 0), `${expected.action} cleanup parent`);
    }
    if (expected.action === 'take-profit' || expected.action === 'stop-loss') {
      const creates = matching(instructions, String(PHOENIX_PROGRAM_ADDRESS), getCreateConditionalOrdersAccountDecoder());
      if (creates[0]) {
        if (creates[0].keys.length !== 8) mismatch('The Phoenix conditional-account setup contains unexpected accounts.');
        expectKey(creates[0], 3, wallet, 'conditional-account payer');
        expectKey(creates[0], 4, wallet, 'conditional-account wallet');
        expectKey(creates[0], 5, traderPda(wallet, expected.pdaIndex, expected.subaccountIndex), 'conditional-account trader PDA');
        expectKey(creates[0], 7, SystemProgram.programId, 'conditional-account system program');
      }
    }
  }

  const usdc = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
  allowedAtaMints.add(usdc.toBase58());
  for (const instruction of instructions) {
    if (instruction.programId.toBase58() === String(PHOENIX_PROGRAM_ADDRESS)
        || instruction.programId.toBase58() === String(EMBER_PROGRAM_ADDRESS)
        || instruction.programId.equals(ComputeBudgetProgram.programId)) continue;
    if (instruction.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID) && (expected.action === 'deposit' || expected.action === 'withdraw')) {
      if (instruction.keys.length !== 6) mismatch('The Phoenix associated-token setup has unexpected accounts.');
      expectKey(instruction, 0, wallet, 'associated-token payer');
      expectKey(instruction, 2, wallet, 'associated-token owner');
      const mint = instruction.keys[3]?.pubkey;
      if (!mint || !allowedAtaMints.has(mint.toBase58())) mismatch('The Phoenix transaction creates an account for an unexpected token mint.');
      expectKey(instruction, 1, getAssociatedTokenAddressSync(mint, wallet), 'associated-token destination');
      expectKey(instruction, 4, SystemProgram.programId, 'associated-token system program');
      expectKey(instruction, 5, TOKEN_PROGRAM_ID, 'associated-token token program');
      continue;
    }
    mismatch('The Phoenix transaction contains an unreviewed system or token instruction.');
  }
}
