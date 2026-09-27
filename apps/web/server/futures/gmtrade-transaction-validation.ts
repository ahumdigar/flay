import {
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  type TransactionInstruction,
} from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import type { FuturesPrepareRequest, FuturesRouteQuote, FuturesVenuePortfolio } from '../../shared/futures.js';
import { AppError } from '../errors.js';

const GMTRADE_PROGRAM = 'Gmso1uvJnLbawvw7yezdfCDcPydwW2s2iqG3w6MDucLo';
const CREATE_ORDER_V2 = Buffer.from('c89d03b603a4a2f0', 'hex');
const PREPARE_POSITION = 'b2d7375a890f6c0f';
const PREPARE_USER = 'bead8fc18b50e785';
const CLOSE_ORDER_V2 = 'd5d96264e1cd4cb8';
const GMTRADE_PROGRAM_KEY = new PublicKey(GMTRADE_PROGRAM);
const USDC_KEY = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const PROGRAM_PLACEHOLDER = GMTRADE_PROGRAM_KEY.toBase58();
const EMPTY_SHA256 = Buffer.from('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'hex');
const [DEFAULT_STORE] = PublicKey.findProgramAddressSync([Buffer.from('data_store'), EMPTY_SHA256], GMTRADE_PROGRAM_KEY);
const [EVENT_AUTHORITY] = PublicKey.findProgramAddressSync([Buffer.from('__event_authority')], GMTRADE_PROGRAM_KEY);
const MARKET_DECIMALS = 20;
const ORDER_KIND = {
  marketIncrease: 3,
  marketDecrease: 4,
  limitIncrease: 6,
  limitDecrease: 7,
  stopLossDecrease: 8,
} as const;

class BorshReader {
  private offset: number;
  constructor(private readonly data: Uint8Array, offset = 0) { this.offset = offset; }
  u8(): number {
    if (this.offset >= this.data.length) this.invalid();
    return this.data[this.offset++];
  }
  uint(bytes: number): bigint {
    if (this.offset + bytes > this.data.length) this.invalid();
    let value = 0n;
    for (let index = bytes - 1; index >= 0; index -= 1) value = value * 256n + BigInt(this.data[this.offset + index]);
    this.offset += bytes;
    return value;
  }
  option(bytes: number): bigint | null {
    const tag = this.u8();
    if (tag === 0) return null;
    if (tag !== 1) this.invalid();
    return this.uint(bytes);
  }
  optionU8(): number | null {
    const tag = this.u8();
    if (tag === 0) return null;
    if (tag !== 1) this.invalid();
    return this.u8();
  }
  done(): boolean { return this.offset === this.data.length; }
  private invalid(): never { throw new AppError(409, 'FUTURES_TRANSACTION_INVALID', 'The GMTrade order instruction has invalid encoded fields.'); }
}

export interface GmTradeOrderSemantics {
  kind: number;
  decreaseSwapType: number | null;
  executionFeeLamports: bigint;
  swapPathLength: number;
  collateralAtomic: bigint;
  sizeUsdProtocol: bigint;
  isLong: boolean;
  isCollateralLong: boolean;
  minOutput: bigint | null;
  triggerPriceProtocol: bigint | null;
  acceptablePriceProtocol: bigint | null;
  shouldUnwrapNative: boolean;
  validFromTimestamp: bigint | null;
  callbackVersion: number | null;
}

export function decodeGmTradeCreateOrder(instructions: TransactionInstruction[]): GmTradeOrderSemantics {
  const candidates = instructions.filter((instruction) => instruction.programId.toBase58() === GMTRADE_PROGRAM
    && Buffer.from(instruction.data).subarray(0, 8).equals(CREATE_ORDER_V2));
  if (candidates.length !== 1) throw new AppError(409, 'FUTURES_ROUTE_MISMATCH', 'The GMTrade transaction must contain exactly one reviewed order creation.');
  const data = candidates[0].data;
  if (data.length < 40) throw new AppError(409, 'FUTURES_TRANSACTION_INVALID', 'The GMTrade order instruction is truncated.');
  const reader = new BorshReader(data, 40); // discriminator plus 32-byte order nonce
  const kind = reader.u8();
  const decreaseSwapType = reader.optionU8();
  const executionFeeLamports = reader.uint(8);
  const swapPathLength = reader.u8();
  const collateralAtomic = reader.uint(8);
  const sizeUsdProtocol = reader.uint(16);
  const isLongValue = reader.u8();
  const isCollateralLongValue = reader.u8();
  if (isLongValue > 1 || isCollateralLongValue > 1) throw new AppError(409, 'FUTURES_TRANSACTION_INVALID', 'The GMTrade direction flags are invalid.');
  const result: GmTradeOrderSemantics = {
    kind,
    decreaseSwapType,
    executionFeeLamports,
    swapPathLength,
    collateralAtomic,
    sizeUsdProtocol,
    isLong: isLongValue === 1,
    isCollateralLong: isCollateralLongValue === 1,
    minOutput: reader.option(16),
    triggerPriceProtocol: reader.option(16),
    acceptablePriceProtocol: reader.option(16),
    shouldUnwrapNative: reader.u8() === 1,
    validFromTimestamp: reader.option(8),
    callbackVersion: reader.optionU8(),
  };
  if (!reader.done()) throw new AppError(409, 'FUTURES_TRANSACTION_INVALID', 'The GMTrade order instruction contains trailing encoded fields.');
  return result;
}

function protocolUsd(microUsd: string): bigint {
  return BigInt(microUsd) * 10n ** BigInt(MARKET_DECIMALS - 6);
}

export function gmTradeProtocolPriceToMicro(value: bigint, baseDecimals: number): string {
  const precision = MARKET_DECIMALS - baseDecimals - 6;
  if (precision < 0) throw new AppError(409, 'FUTURES_ROUTE_MISMATCH', 'The GMTrade market precision is unsupported.');
  return (value / 10n ** BigInt(precision)).toString();
}

function protocolPrice(microUsd: string, baseDecimals: number): bigint {
  const precision = MARKET_DECIMALS - baseDecimals - 6;
  if (precision < 0) throw new AppError(409, 'FUTURES_ROUTE_MISMATCH', 'The GMTrade market precision is unsupported.');
  return BigInt(microUsd) * 10n ** BigInt(precision);
}

function mismatch(message: string): never {
  throw new AppError(409, 'FUTURES_ROUTE_MISMATCH', message);
}

export function validateGmTradeOrderSemantics(
  request: FuturesPrepareRequest,
  quote: FuturesRouteQuote | undefined,
  before: FuturesVenuePortfolio | undefined,
  instructions: TransactionInstruction[],
): GmTradeOrderSemantics | null {
  if (request.action === 'cancel' || request.action === 'cancel-conditional') return null;
  if (!['open', 'close', 'reduce', 'take-profit', 'stop-loss'].includes(request.action)) return null;
  const decoded = decodeGmTradeCreateOrder(instructions);
  if (decoded.swapPathLength !== 0) mismatch('GMTrade collateral swap paths are forbidden; the reviewed route must use direct USDC.');
  if (decoded.decreaseSwapType !== null) mismatch('GMTrade decrease swaps are forbidden for Flay direct-USDC positions.');
  if (decoded.executionFeeLamports > 300_000n) mismatch('The GMTrade execution fee exceeds Flay’s reviewed ceiling.');
  if (decoded.validFromTimestamp !== null || decoded.callbackVersion !== null) mismatch('The GMTrade order includes unsupported scheduling or callback behavior.');

  if (request.action === 'open') {
    if (!quote) mismatch('The GMTrade entry transaction is missing its reviewed quote.');
    const expectedKind = quote.orderType === 'market' ? ORDER_KIND.marketIncrease : ORDER_KIND.limitIncrease;
    if (decoded.kind !== expectedKind) mismatch('The GMTrade order kind differs from the reviewed market or limit entry.');
    if (decoded.isLong !== (quote.side === 'long')) mismatch('The GMTrade direction differs from the reviewed route.');
    if (decoded.collateralAtomic !== BigInt(quote.collateralAtomic)) mismatch('The GMTrade collateral differs from the reviewed route.');
    if (decoded.sizeUsdProtocol !== protocolUsd(quote.notionalMicroUsd)) mismatch('The GMTrade notional differs from the reviewed route.');
    const expectedPrice = protocolPrice(quote.acceptablePriceMicroUsd ?? '0', quote.baseDecimals);
    if (decoded.acceptablePriceProtocol !== expectedPrice) mismatch('The GMTrade acceptable price differs from the reviewed route.');
    if (quote.orderType === 'limit' && decoded.triggerPriceProtocol !== expectedPrice) mismatch('The GMTrade limit trigger differs from the reviewed route.');
    if (quote.orderType === 'market' && decoded.triggerPriceProtocol !== null) mismatch('The GMTrade market entry unexpectedly contains a trigger price.');
    return decoded;
  }

  const position = before?.positions.find((item) => item.nativeId === request.nativeId);
  if (!position) mismatch('The GMTrade recovery order is not bound to the reviewed live position.');
  if (decoded.isLong !== (position.side === 'long')) mismatch('The GMTrade recovery direction differs from the original position.');
  const size = BigInt(request.sizeAtomic ?? position.sizeAtomic);
  const expectedCollateral = BigInt(position.collateralAtomic) * size / BigInt(position.sizeAtomic);
  if (decoded.collateralAtomic !== expectedCollateral) mismatch('The GMTrade recovery collateral differs from the reviewed position ratio.');
  const scale = 10n ** BigInt(MARKET_DECIMALS - 6);
  const baseScale = 10n ** BigInt(position.baseDecimals);
  const entry = BigInt(position.entryPriceMicroUsd);
  const minimumSizeUsd = entry * size * scale / baseScale;
  const maximumSizeUsd = (entry + 1n) * size * scale / baseScale + 1n;
  if (decoded.sizeUsdProtocol < minimumSizeUsd || decoded.sizeUsdProtocol > maximumSizeUsd) {
    mismatch('The GMTrade recovery size differs from the reviewed base-size reduction.');
  }
  const expectedKind = request.action === 'take-profit' ? ORDER_KIND.limitDecrease
    : request.action === 'stop-loss' ? ORDER_KIND.stopLossDecrease : ORDER_KIND.marketDecrease;
  if (decoded.kind !== expectedKind) mismatch('The GMTrade recovery order kind differs from the reviewed action.');
  if ((request.action === 'close' || request.action === 'reduce')
      && (decoded.triggerPriceProtocol !== null || decoded.acceptablePriceProtocol === null || decoded.acceptablePriceProtocol <= 0n)) {
    mismatch('The GMTrade market recovery has an invalid trigger or acceptable-price bound.');
  }
  if (request.action === 'take-profit' || request.action === 'stop-loss') {
    const expectedTrigger = protocolPrice(request.triggerPriceMicroUsd ?? '0', position.baseDecimals);
    const expectedExecution = protocolPrice(request.executionPriceMicroUsd ?? '0', position.baseDecimals);
    if (decoded.triggerPriceProtocol !== expectedTrigger) mismatch('The GMTrade conditional trigger differs from the reviewed price.');
    if (decoded.acceptablePriceProtocol !== expectedExecution) mismatch('The GMTrade conditional execution bound differs from the reviewed price.');
  }
  return decoded;
}


function account(instruction: TransactionInstruction, index: number, label: string) {
  const value = instruction.keys[index];
  if (!value) mismatch(`The GMTrade ${label} account is missing.`);
  return value;
}

function expectAccount(instruction: TransactionInstruction, index: number, expected: PublicKey | string, label: string) {
  if (account(instruction, index, label).pubkey.toBase58() !== String(expected)) {
    mismatch(`The GMTrade ${label} account differs from the reviewed action.`);
  }
}

function expectInstructionAccounts(instruction: TransactionInstruction, count: number, label: string) {
  if (instruction.keys.length !== count) mismatch(`The GMTrade ${label} instruction has unexpected accounts.`);
}

function discriminator(instruction: TransactionInstruction): string {
  return Buffer.from(instruction.data).subarray(0, 8).toString('hex');
}

function deriveUser(store: PublicKey, wallet: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('user'), store.toBuffer(), wallet.toBuffer()], GMTRADE_PROGRAM_KEY)[0];
}

function deriveOrder(store: PublicKey, wallet: PublicKey, instruction: TransactionInstruction): PublicKey {
  const nonce = Buffer.from(instruction.data).subarray(8, 40);
  if (nonce.length !== 32) mismatch('The GMTrade order nonce is invalid.');
  return PublicKey.findProgramAddressSync([Buffer.from('order'), store.toBuffer(), wallet.toBuffer(), nonce], GMTRADE_PROGRAM_KEY)[0];
}

function derivePosition(store: PublicKey, wallet: PublicKey, marketToken: PublicKey, isLong: boolean): PublicKey {
  return PublicKey.findProgramAddressSync([
    Buffer.from('position'), store.toBuffer(), wallet.toBuffer(), marketToken.toBuffer(), USDC_KEY.toBuffer(), Buffer.from([isLong ? 1 : 2]),
  ], GMTRADE_PROGRAM_KEY)[0];
}

function deriveStoreWallet(store: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('store_wallet'), store.toBuffer()], GMTRADE_PROGRAM_KEY)[0];
}

function validateAssociatedTokenInstruction(instruction: TransactionInstruction, wallet: PublicKey, order: PublicKey) {
  expectInstructionAccounts(instruction, 6, 'associated-token setup');
  expectAccount(instruction, 0, wallet, 'associated-token payer');
  const owner = account(instruction, 2, 'associated-token owner').pubkey;
  if (!owner.equals(wallet) && !owner.equals(order)) mismatch('The GMTrade transaction creates a token account for an unexpected owner.');
  expectAccount(instruction, 3, USDC_KEY, 'associated-token mint');
  expectAccount(instruction, 4, SystemProgram.programId, 'associated-token system program');
  expectAccount(instruction, 5, TOKEN_PROGRAM_ID, 'associated-token token program');
  const expectedAta = getAssociatedTokenAddressSync(USDC_KEY, owner, true, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  expectAccount(instruction, 1, expectedAta, 'associated-token destination');
  if (!account(instruction, 0, 'associated-token payer').isSigner || !account(instruction, 0, 'associated-token payer').isWritable
      || account(instruction, 1, 'associated-token destination').isSigner || !account(instruction, 1, 'associated-token destination').isWritable) {
    mismatch('The GMTrade associated-token account roles differ from the reviewed setup.');
  }
}

function validatePrepareUser(instruction: TransactionInstruction, wallet: PublicKey) {
  expectInstructionAccounts(instruction, 4, 'prepare-user');
  expectAccount(instruction, 0, wallet, 'prepare-user owner');
  expectAccount(instruction, 1, DEFAULT_STORE, 'prepare-user store');
  expectAccount(instruction, 2, deriveUser(DEFAULT_STORE, wallet), 'prepare-user PDA');
  expectAccount(instruction, 3, SystemProgram.programId, 'prepare-user system program');
}

function validatePreparePosition(instruction: TransactionInstruction, wallet: PublicKey, market: PublicKey, position: PublicKey) {
  expectInstructionAccounts(instruction, 5, 'prepare-position');
  expectAccount(instruction, 0, wallet, 'prepare-position owner');
  expectAccount(instruction, 1, DEFAULT_STORE, 'prepare-position store');
  expectAccount(instruction, 2, market, 'prepare-position market');
  expectAccount(instruction, 3, position, 'prepare-position PDA');
  expectAccount(instruction, 4, SystemProgram.programId, 'prepare-position system program');
}

function validateCreateOrderAccounts(
  instruction: TransactionInstruction,
  request: FuturesPrepareRequest,
  quote: FuturesRouteQuote | undefined,
  marketAddress: string,
  decoded: GmTradeOrderSemantics,
): PublicKey {
  expectInstructionAccounts(instruction, 25, 'create-order');
  const wallet = new PublicKey(request.wallet);
  const market = new PublicKey(marketAddress);
  const order = deriveOrder(DEFAULT_STORE, wallet, instruction);
  const increase = decoded.kind === ORDER_KIND.marketIncrease || decoded.kind === ORDER_KIND.limitIncrease;
  const position = increase
    ? derivePosition(DEFAULT_STORE, wallet, new PublicKey(quote?.nativeMarketTokenAddress ?? mismatch('The reviewed GMTrade market token is missing.')), decoded.isLong)
    : new PublicKey(request.nativeId ?? mismatch('The reviewed GMTrade position is missing.'));
  const orderAta = getAssociatedTokenAddressSync(USDC_KEY, order, true);
  const walletAta = getAssociatedTokenAddressSync(USDC_KEY, wallet);

  expectAccount(instruction, 0, wallet, 'order owner');
  expectAccount(instruction, 1, wallet, 'order receiver');
  expectAccount(instruction, 2, DEFAULT_STORE, 'order store');
  expectAccount(instruction, 3, market, 'order market');
  expectAccount(instruction, 4, deriveUser(DEFAULT_STORE, wallet), 'order user');
  expectAccount(instruction, 5, order, 'order PDA');
  expectAccount(instruction, 6, position, 'order position');
  expectAccount(instruction, 7, increase ? USDC_KEY : PROGRAM_PLACEHOLDER, 'initial collateral token');
  for (const index of [8, 9, 10]) expectAccount(instruction, index, USDC_KEY, 'direct-USDC token');
  expectAccount(instruction, 11, increase ? orderAta : PROGRAM_PLACEHOLDER, 'initial collateral escrow');
  expectAccount(instruction, 12, increase ? PROGRAM_PLACEHOLDER : orderAta, 'final output escrow');
  expectAccount(instruction, 13, orderAta, 'long-token escrow');
  expectAccount(instruction, 14, orderAta, 'short-token escrow');
  expectAccount(instruction, 15, increase ? walletAta : PROGRAM_PLACEHOLDER, 'initial collateral source');
  expectAccount(instruction, 16, SystemProgram.programId, 'system program');
  expectAccount(instruction, 17, TOKEN_PROGRAM_ID, 'token program');
  expectAccount(instruction, 18, ASSOCIATED_TOKEN_PROGRAM_ID, 'associated-token program');
  for (const index of [19, 20, 21, 22]) expectAccount(instruction, index, PROGRAM_PLACEHOLDER, 'disabled callback');
  expectAccount(instruction, 23, EVENT_AUTHORITY, 'event authority');
  expectAccount(instruction, 24, GMTRADE_PROGRAM_KEY, 'program self account');
  if (!account(instruction, 0, 'order owner').isSigner || !account(instruction, 0, 'order owner').isWritable) mismatch('The GMTrade owner account roles are invalid.');
  return order;
}

function validateCloseOrderAccounts(instruction: TransactionInstruction, request: FuturesPrepareRequest) {
  expectInstructionAccounts(instruction, 30, 'close-order');
  const wallet = new PublicKey(request.wallet);
  const order = new PublicKey(request.nativeId ?? mismatch('The reviewed GMTrade order is missing.'));
  const orderAta = getAssociatedTokenAddressSync(USDC_KEY, order, true);
  const walletAta = getAssociatedTokenAddressSync(USDC_KEY, wallet);
  expectAccount(instruction, 0, wallet, 'close-order executor');
  expectAccount(instruction, 1, DEFAULT_STORE, 'close-order store');
  expectAccount(instruction, 2, deriveStoreWallet(DEFAULT_STORE), 'store wallet');
  for (const index of [3, 4, 5]) expectAccount(instruction, index, wallet, 'close-order wallet receiver');
  expectAccount(instruction, 6, deriveUser(DEFAULT_STORE, wallet), 'close-order user');
  expectAccount(instruction, 8, order, 'close-order native order');
  for (const index of [9, 10, 11, 12]) {
    const value = account(instruction, index, 'close-order direct-USDC token').pubkey.toBase58();
    if (value !== USDC_KEY.toBase58() && value !== PROGRAM_PLACEHOLDER) mismatch('The GMTrade close-order contains a non-USDC token.');
  }
  for (const index of [13, 14, 15, 16]) {
    const value = account(instruction, index, 'close-order escrow').pubkey.toBase58();
    if (value !== orderAta.toBase58() && value !== PROGRAM_PLACEHOLDER) mismatch('The GMTrade close-order contains an unexpected escrow.');
  }
  for (const index of [17, 18, 19, 20]) {
    const value = account(instruction, index, 'close-order wallet token account').pubkey.toBase58();
    if (value !== walletAta.toBase58() && value !== PROGRAM_PLACEHOLDER) mismatch('The GMTrade close-order sends tokens to an unexpected account.');
  }
  expectAccount(instruction, 21, SystemProgram.programId, 'close-order system program');
  expectAccount(instruction, 22, TOKEN_PROGRAM_ID, 'close-order token program');
  expectAccount(instruction, 23, ASSOCIATED_TOKEN_PROGRAM_ID, 'close-order associated-token program');
  for (const index of [24, 25, 26, 27]) expectAccount(instruction, index, PROGRAM_PLACEHOLDER, 'disabled close-order callback');
  expectAccount(instruction, 28, EVENT_AUTHORITY, 'close-order event authority');
  expectAccount(instruction, 29, GMTRADE_PROGRAM_KEY, 'close-order program self account');
  if (!account(instruction, 0, 'close-order executor').isSigner) mismatch('The GMTrade close-order executor is not the reviewed wallet signer.');
  return order;
}

/** Validates exact GMTrade account positions and rejects every unreviewed writable path. */
export function validateGmTradeInstructionAccounts(
  request: FuturesPrepareRequest,
  quote: FuturesRouteQuote | undefined,
  marketAddress: string | null,
  instructions: TransactionInstruction[],
  decoded: GmTradeOrderSemantics | null,
): void {
  const gmInstructions = instructions.filter((instruction) => instruction.programId.equals(GMTRADE_PROGRAM_KEY));
  const wallet = new PublicKey(request.wallet);
  let order: PublicKey;

  if (request.action === 'cancel' || request.action === 'cancel-conditional') {
    if (gmInstructions.length !== 1 || discriminator(gmInstructions[0]) !== CLOSE_ORDER_V2) mismatch('The GMTrade cancellation must contain exactly one native close-order instruction.');
    order = validateCloseOrderAccounts(gmInstructions[0], request);
  } else {
    if (!decoded || !marketAddress) mismatch('The GMTrade order is missing its reviewed semantic or market binding.');
    const create = gmInstructions.filter((instruction) => discriminator(instruction) === CREATE_ORDER_V2.toString('hex'));
    const prepareUsers = gmInstructions.filter((instruction) => discriminator(instruction) === PREPARE_USER);
    const preparePositions = gmInstructions.filter((instruction) => discriminator(instruction) === PREPARE_POSITION);
    const expectedCount = create.length + prepareUsers.length + preparePositions.length;
    if (create.length !== 1 || gmInstructions.length !== expectedCount || prepareUsers.length > 1 || preparePositions.length > 1) {
      mismatch('The GMTrade transaction contains an unreviewed venue instruction.');
    }
    if (request.action !== 'open' && (prepareUsers.length || preparePositions.length)) mismatch('A GMTrade recovery action cannot create unrelated setup accounts.');
    order = validateCreateOrderAccounts(create[0], request, quote, marketAddress, decoded);
    for (const instruction of prepareUsers) validatePrepareUser(instruction, wallet);
    const market = new PublicKey(marketAddress);
    const position = account(create[0], 6, 'order position').pubkey;
    for (const instruction of preparePositions) validatePreparePosition(instruction, wallet, market, position);
  }

  for (const instruction of instructions) {
    if (instruction.programId.equals(GMTRADE_PROGRAM_KEY) || instruction.programId.equals(ComputeBudgetProgram.programId)) continue;
    if (instruction.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
      validateAssociatedTokenInstruction(instruction, wallet, order);
      continue;
    }
    mismatch('The GMTrade transaction contains an unreviewed system or token instruction.');
  }
}
