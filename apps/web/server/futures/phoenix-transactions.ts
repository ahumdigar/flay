import {
  EMBER_PROGRAM_ADDRESS,
  MAX_SUBACCOUNTS,
  MarginType,
  PHOENIX_PROGRAM_ADDRESS,
  PhoenixHttpClient,
  OrderFlags,
  Side,
  createPhoenixClient,
  getPlaceLimitOrderDecoder,
  getPlaceMarketOrderDecoder,
  getRegisterTraderInstructionDecoder,
  priceUsdToTicks,
  type InstructionsWithAccountsAndData,
} from '@ellipsis-labs/rise';
import { PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import type {
  FuturesPrepareRequest,
  FuturesRouteQuote,
} from '../../shared/futures.js';
import { config } from '../config.js';
import { AppError } from '../errors.js';

const SESSION_EVICTION_MS = 10 * 60_000;
const AUTH_CHALLENGE_MAX_MS = 5 * 60_000;
const AUTH_MEMO_PROGRAMS = new Set([
  'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
  'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo',
]);
const AUTH_MEMO_PREFIX = 'phoenix-wallet-transaction-login-v1';

interface AuthenticatedPhoenix {
  client: PhoenixHttpClient;
  expiresAt: number;
}

interface PhoenixWalletChallenge {
  wallet: string;
  nonceId: string;
  unsignedMessage: Uint8Array;
  expiresAt: number;
}

export interface PhoenixWalletProof {
  challengeId: string;
  signedTransaction: string;
}

export class PhoenixChallengeStore {
  private readonly records = new Map<string, PhoenixWalletChallenge>();

  constructor(
    private readonly clock: () => number = Date.now,
    private readonly maxSize = 500,
  ) {}

  add(challenge: PhoenixWalletChallenge): string {
    this.sweep();
    const challengeId = crypto.randomUUID();
    this.records.set(challengeId, challenge);
    while (this.records.size > this.maxSize) {
      this.records.delete(this.records.keys().next().value!);
    }
    return challengeId;
  }

  consume(challengeId: string, wallet: string): PhoenixWalletChallenge {
    const challenge = this.records.get(challengeId);
    this.records.delete(challengeId);
    if (!challenge || challenge.wallet !== wallet) {
      throw new AppError(404, 'PHOENIX_CHALLENGE_NOT_FOUND', 'Prepare a fresh Phoenix wallet challenge.', true);
    }
    if (challenge.expiresAt <= this.clock()) {
      throw new AppError(410, 'PHOENIX_CHALLENGE_EXPIRED', 'The Phoenix wallet challenge expired. Prepare it again.', true);
    }
    return challenge;
  }

  sweep(now = this.clock()): void {
    for (const [id, challenge] of this.records) {
      if (challenge.expiresAt <= now) this.records.delete(id);
    }
  }
}

export type PhoenixExpectedSemantics =
  | { action: 'activate' | 'register'; includeRegister: boolean; maxPositions: string; pdaIndex: number; subaccountIndex: number; onboarder: string }
  | { action: 'deposit'; amountAtomic: string }
  | { action: 'withdraw'; amountAtomic: string }
  | { action: 'open'; orderType: 'market' | 'limit'; side: 'bid' | 'ask'; baseLots: string; priceTicks: string; collateralAtomic: string; pdaIndex: 0; subaccountIndex: number; includeRegister: boolean }
  | { action: 'cancel'; priceTicks: string; sequenceNumber: string; pdaIndex: number; subaccountIndex: number }
  | { action: 'close' | 'reduce'; side: 'bid' | 'ask'; baseLots: string; priceTicks: string | null; fullClose: boolean; pdaIndex: number; subaccountIndex: number }
  | { action: 'take-profit' | 'stop-loss'; tradeSide: 'bid' | 'ask'; direction: 'greater_than' | 'less_than'; sizeBaseLots: string; triggerPriceTicks: string; executionPriceTicks: string; pdaIndex: number; subaccountIndex: number }
  | { action: 'cancel-conditional'; conditionalIndex: number; direction: 'greater_than' | 'less_than'; pdaIndex: number; subaccountIndex: number };

export interface PhoenixBuiltAction {
  instructions: TransactionInstruction[];
  transaction?: string;
  allowedPrograms: string[];
  allowedAdditionalSigners: string[];
  marketAddress: string | null;
  warnings: string[];
  expected: PhoenixExpectedSemantics;
}

interface PhoenixTransactionLifetime {
  blockhash: string;
  lastValidBlockHeight: number;
}

interface ParsedPositionId {
  pdaIndex: number;
  subaccountIndex: number;
  symbol: string;
  side?: 'long' | 'short';
}

interface ParsedOrderId extends ParsedPositionId {
  priceTicks: string;
  sequenceNumber: string;
}

interface ParsedConditionalId extends ParsedPositionId {
  kind: 'take-profit' | 'stop-loss';
  direction: 'greater_than' | 'less_than';
  conditionalIndex: number;
}

export function validatePhoenixWalletChallengeTransaction(wallet: string, nonceId: string, encoded: string): { transaction: Transaction; message: Uint8Array } {
  let transaction: Transaction;
  try { transaction = Transaction.from(Buffer.from(encoded, 'base64')); } catch {
    throw new AppError(502, 'PHOENIX_CHALLENGE_INVALID', 'Phoenix returned a malformed wallet-ownership challenge.', true);
  }
  const walletKey = new PublicKey(wallet);
  const exactSigner = transaction.signatures.length === 1 && transaction.signatures[0]?.publicKey.equals(walletKey);
  const instruction = transaction.instructions[0];
  const memoParts = instruction ? Buffer.from(instruction.data).toString('utf8').split('|') : [];
  const exactMemo = transaction.instructions.length === 1
    && AUTH_MEMO_PROGRAMS.has(instruction?.programId.toBase58())
    && instruction.data.length <= 1_024
    && instruction.keys.every((key) => key.pubkey.equals(walletKey) && key.isSigner && !key.isWritable)
    && memoParts.length === 4
    && memoParts[0] === AUTH_MEMO_PREFIX
    && memoParts[1] === nonceId
    && memoParts[2] === wallet
    && Number.isFinite(Date.parse(memoParts[3] ?? ''));
  if (!transaction.feePayer?.equals(walletKey) || !transaction.recentBlockhash || !exactSigner || !exactMemo) {
    throw new AppError(502, 'PHOENIX_CHALLENGE_INVALID', 'Phoenix returned an unsafe wallet-ownership challenge.', true);
  }
  return { transaction, message: transaction.serializeMessage() };
}

export function validatePhoenixWalletProofTransaction(wallet: string, encoded: string, expectedMessage: Uint8Array): Transaction {
  let transaction: Transaction;
  try { transaction = Transaction.from(Buffer.from(encoded, 'base64')); } catch {
    throw new AppError(400, 'PHOENIX_CHALLENGE_SIGNATURE_INVALID', 'The signed Phoenix wallet challenge is malformed.');
  }
  const signer = transaction.signatures.find((entry) => entry.publicKey.toBase58() === wallet);
  if (!Buffer.from(transaction.serializeMessage()).equals(Buffer.from(expectedMessage)) || !signer?.signature || !transaction.verifySignatures(false)) {
    throw new AppError(409, 'PHOENIX_CHALLENGE_SIGNATURE_INVALID', 'The signed Phoenix wallet challenge differs from the reviewed message.');
  }
  return transaction;
}

function asSafeNumber(value: string, label: string): number {
  const parsed = BigInt(value);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new AppError(400, 'FUTURES_AMOUNT_TOO_LARGE', `${label} exceeds the native venue builder limit.`);
  }
  return Number(parsed);
}

export function atomicToDecimalString(value: string, decimals: number): string {
  const amount = BigInt(value);
  if (amount < 0n || !Number.isInteger(decimals) || decimals < 0) {
    throw new AppError(400, 'FUTURES_AMOUNT_INVALID', 'The venue amount is invalid.');
  }
  if (decimals === 0) return amount.toString();
  const scale = 10n ** BigInt(decimals);
  const whole = amount / scale;
  const fraction = (amount % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function isolatedSubaccountForOrder(wallet: string, orderType: 'market' | 'limit', instructions: TransactionInstruction[]): number {
  const decoder = orderType === 'market' ? getPlaceMarketOrderDecoder() : getPlaceLimitOrderDecoder();
  const orders = instructions.filter((instruction) => {
    if (instruction.programId.toBase58() !== String(PHOENIX_PROGRAM_ADDRESS)) return false;
    try { decoder.decode(instruction.data); return true; } catch { return false; }
  });
  if (orders.length !== 1 || !orders[0].keys[4]) {
    throw new AppError(502, 'PHOENIX_ORDER_BUNDLE_INVALID', 'Phoenix returned an invalid isolated order bundle.', true);
  }
  const walletKey = new PublicKey(wallet);
  const traderAccount = orders[0].keys[4].pubkey;
  for (let index = 1; index <= MAX_SUBACCOUNTS; index += 1) {
    const candidate = PublicKey.findProgramAddressSync([
      Buffer.from('trader'), walletKey.toBuffer(), Buffer.from([0]), Buffer.from([index]),
    ], new PublicKey(String(PHOENIX_PROGRAM_ADDRESS)))[0];
    if (candidate.equals(traderAccount)) return index;
  }
  throw new AppError(502, 'PHOENIX_ISOLATED_ACCOUNT_INVALID', 'Phoenix did not bind the order to a reviewed isolated subaccount.', true);
}

function kitInstructionToWeb3(instruction: InstructionsWithAccountsAndData): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(instruction.programAddress),
    keys: instruction.accounts.map((account) => ({
      pubkey: new PublicKey(account.address),
      isSigner: account.role === 2 || account.role === 3,
      isWritable: account.role === 1 || account.role === 3,
    })),
    data: Buffer.from(instruction.data),
  });
}

function apiInstructionToWeb3(instruction: { programId: string; data: number[]; keys: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }> }): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(instruction.programId),
    keys: instruction.keys.map((key) => ({ pubkey: new PublicKey(key.pubkey), isSigner: key.isSigner, isWritable: key.isWritable })),
    data: Buffer.from(instruction.data),
  });
}

function parsePositionId(nativeId: string | undefined): ParsedPositionId {
  const parts = nativeId?.split(':') ?? [];
  const pdaIndex = Number(parts[0]);
  const subaccountIndex = Number(parts[1]);
  const symbol = parts[2] ?? '';
  const side = parts[3] === 'long' || parts[3] === 'short' ? parts[3] : undefined;
  if (!Number.isInteger(pdaIndex) || pdaIndex < 0 || !Number.isInteger(subaccountIndex) || subaccountIndex < 0 || !/^[A-Z0-9_-]{2,20}$/.test(symbol)) {
    throw new AppError(400, 'FUTURES_NATIVE_ID_INVALID', 'The Phoenix position identifier is invalid. Refresh the portfolio and try again.');
  }
  return { pdaIndex, subaccountIndex, symbol, side };
}

function parseOrderId(nativeId: string | undefined): ParsedOrderId {
  const parts = nativeId?.split(':') ?? [];
  const position = parsePositionId(parts.slice(0, 4).join(':'));
  const priceTicks = parts[4] ?? '';
  const sequenceNumber = parts[5] ?? '';
  if (!/^\d+$/.test(priceTicks) || !/^\d+$/.test(sequenceNumber)) {
    throw new AppError(400, 'FUTURES_NATIVE_ID_INVALID', 'The Phoenix order identifier is invalid. Refresh the portfolio and try again.');
  }
  return { ...position, priceTicks, sequenceNumber };
}

function parseConditionalId(nativeId: string | undefined): ParsedConditionalId {
  const parts = nativeId?.split(':') ?? [];
  const position = parsePositionId(parts.slice(0, 4).join(':'));
  const kind = parts[4];
  const direction = parts[5];
  const conditionalIndex = Number(parts[6]);
  if ((kind !== 'take-profit' && kind !== 'stop-loss') || (direction !== 'greater_than' && direction !== 'less_than') || !Number.isInteger(conditionalIndex) || conditionalIndex < 0) {
    throw new AppError(400, 'FUTURES_NATIVE_ID_INVALID', 'The Phoenix conditional identifier is invalid. Refresh the portfolio and try again.');
  }
  return { ...position, kind, direction, conditionalIndex };
}

function oppositeSide(side: 'long' | 'short'): Side {
  return side === 'long' ? Side.Ask : Side.Bid;
}

export class PhoenixTransactionBuilder {
  private readonly publicClient = new PhoenixHttpClient({ timeout: 8_000, rateLimitRetry: { maxRetries: 1, maxTotalWaitMs: 1_000 } });
  private readonly nativeClient = createPhoenixClient({ rpcUrl: config.rpcUrl, ws: false });
  private readonly authenticated = new Map<string, AuthenticatedPhoenix>();
  private readonly challenges = new PhoenixChallengeStore();

  async challenge(wallet: string) {
    this.sweepSessions();
    const client = new PhoenixHttpClient({ auth: true, timeout: 8_000, rateLimitRetry: { maxRetries: 1, maxTotalWaitMs: 1_000 } });
    try {
      const auth = client.auth();
      if (!auth) throw new AppError(503, 'PHOENIX_AUTH_UNAVAILABLE', 'Phoenix authentication is unavailable.', true);
      const response = await auth.getWalletTransactionChallenge(wallet);
      const { message } = validatePhoenixWalletChallengeTransaction(wallet, response.nonce_id, response.unsigned_transaction);
      const providerExpiry = Date.parse(response.expires_at);
      const expiresAt = Math.min(Number.isFinite(providerExpiry) ? providerExpiry : Date.now() + AUTH_CHALLENGE_MAX_MS, Date.now() + AUTH_CHALLENGE_MAX_MS);
      if (expiresAt <= Date.now()) throw new AppError(410, 'PHOENIX_CHALLENGE_EXPIRED', 'Phoenix returned an expired wallet challenge.', true);
      const challengeId = this.challenges.add({
        wallet,
        nonceId: response.nonce_id,
        unsignedMessage: message,
        expiresAt,
      });
      return { wallet, challengeId, transaction: response.unsigned_transaction, expiresAt };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(502, 'PHOENIX_CHALLENGE_FAILED', error instanceof Error ? error.message : 'Phoenix wallet challenge is unavailable.', true);
    } finally {
      client.dispose();
    }
  }

  async login(wallet: string, proof?: PhoenixWalletProof) {
    this.sweepSessions();
    const existing = this.authenticated.get(wallet);
    if (existing && existing.expiresAt > Date.now() + 30_000) {
      return { wallet, authenticated: true, expiresAt: existing.expiresAt };
    }
    if (!proof) {
      throw new AppError(409, 'PHOENIX_WALLET_PROOF_REQUIRED', 'Phoenix requires a one-time wallet-ownership challenge.', true);
    }
    const challenge = this.challenges.consume(proof.challengeId, wallet);
    validatePhoenixWalletProofTransaction(wallet, proof.signedTransaction, challenge.unsignedMessage);
    const client = new PhoenixHttpClient({
      auth: true,
      timeout: 8_000,
      rateLimitRetry: { maxRetries: 1, maxTotalWaitMs: 1_000 },
    });
    const auth = client.auth();
    if (!auth) throw new AppError(503, 'PHOENIX_AUTH_UNAVAILABLE', 'Phoenix authentication is unavailable.', true);
    try {
      const session = await auth.loginWithWalletTransaction(wallet, proof.signedTransaction, challenge.nonceId);
      const expiresAt = Math.min(session.refreshExpiresAt, Date.now() + SESSION_EVICTION_MS);
      this.authenticated.set(wallet, { client, expiresAt });
      return { wallet, authenticated: true, expiresAt };
    } catch (error) {
      client.dispose();
      throw new AppError(403, 'PHOENIX_LOGIN_FAILED', error instanceof Error ? error.message : 'Phoenix rejected the signed wallet challenge.', false);
    }
  }

  async onboardSigned(wallet: string, signedTransaction: string, expectedOnboarder: string) {
    try {
      const result = await this.publicClient.exchange().sendRegisterIxs({
        transaction: signedTransaction,
        traderAuthority: wallet,
        txFeePayer: wallet,
        maxPositions: 32,
        traderPdaIndex: 0,
        traderSubaccountIndex: 0,
      });
      const expectedTrader = PublicKey.findProgramAddressSync([
        Buffer.from('trader'), new PublicKey(wallet).toBuffer(), Buffer.from([0]), Buffer.from([0]),
      ], new PublicKey(String(PHOENIX_PROGRAM_ADDRESS)))[0].toBase58();
      if (result.txFeePayer !== wallet || result.traderPda !== expectedTrader || result.traderOnboarder !== expectedOnboarder || result.maxPositions !== 32) {
        throw new AppError(502, 'PHOENIX_ONBOARDING_RESPONSE_INVALID', 'Phoenix returned onboarding metadata that differs from the reviewed transaction.', true);
      }
      return result;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(409, 'PHOENIX_ONBOARDING_FAILED', 'Phoenix could not submit this signed public onboarding transaction. Prepare a fresh onboarding.', true);
    }
  }

  private validateOnboardingBuild(wallet: string, built: { traderPda: string; traderOnboarder: string; txFeePayer: string; maxPositions: number }) {
    const expectedTrader = PublicKey.findProgramAddressSync([
      Buffer.from('trader'), new PublicKey(wallet).toBuffer(), Buffer.from([0]), Buffer.from([0]),
    ], new PublicKey(String(PHOENIX_PROGRAM_ADDRESS)))[0].toBase58();
    if (built.txFeePayer !== wallet || built.traderPda !== expectedTrader || built.maxPositions !== 32) {
      throw new AppError(502, 'PHOENIX_ONBOARDING_BUILD_INVALID', 'Phoenix returned onboarding instructions for a different wallet or trader account.', true);
    }
    try {
      new PublicKey(built.traderOnboarder);
    } catch {
      throw new AppError(502, 'PHOENIX_ONBOARDING_BUILD_INVALID', 'Phoenix returned an invalid onboarding signer.', true);
    }
  }

  async build(request: FuturesPrepareRequest, quote?: FuturesRouteQuote, _lifetime?: PhoenixTransactionLifetime): Promise<PhoenixBuiltAction> {
    const client = request.action === 'activate' || request.action === 'register'
      ? this.publicClient
      : this.requireAuthenticated(request.wallet);
    let instructions: TransactionInstruction[];
    let transaction: string | undefined;
    let allowedAdditionalSigners: string[] = [];
    let expected: PhoenixExpectedSemantics;
    let marketAddress: string | null = quote?.nativeMarketAddress ?? null;
    const warnings: string[] = [];

    switch (request.action) {
      case 'activate': {
        const built = await client.exchange().buildRegisterIxs({ traderAuthority: request.wallet, txFeePayer: request.wallet, maxPositions: 32 });
        this.validateOnboardingBuild(request.wallet, built);
        instructions = built.instructions.map(apiInstructionToWeb3);
        allowedAdditionalSigners = [built.traderOnboarder];
        expected = { action: 'activate', includeRegister: built.includeRegisterTrader, maxPositions: '32', pdaIndex: 0, subaccountIndex: 0, onboarder: built.traderOnboarder };
        warnings.push('Phoenix public onboarding creates or updates your onchain trader account; your wallet pays account rent and the Solana network fee.');
        warnings.push('Phoenix adds only the reviewed onboarding signer after your wallet signs this exact transaction.');
        break;
      }
      case 'register': {
        const built = await client.exchange().buildRegisterIxs({ traderAuthority: request.wallet, txFeePayer: request.wallet, maxPositions: 32 });
        this.validateOnboardingBuild(request.wallet, built);
        instructions = built.instructions.map(apiInstructionToWeb3);
        allowedAdditionalSigners = [built.traderOnboarder];
        expected = { action: 'register', includeRegister: built.includeRegisterTrader, maxPositions: '32', pdaIndex: 0, subaccountIndex: 0, onboarder: built.traderOnboarder };
        warnings.push('Phoenix public onboarding creates or updates your onchain trader account; your wallet pays account rent and the Solana network fee.');
        warnings.push('Phoenix adds only the reviewed onboarding signer after your wallet signs this exact transaction.');
        break;
      }
      case 'deposit': {
        const amount = BigInt(request.amountAtomic ?? '0');
        if (amount <= 0n) throw new AppError(400, 'FUTURES_AMOUNT_REQUIRED', 'Enter a USDC deposit amount.');
        const built = await this.nativeClient.ixs.buildDepositIxs({ authority: request.wallet as never, amount });
        instructions = built.instructions.map(kitInstructionToWeb3);
        expected = { action: 'deposit', amountAtomic: amount.toString() };
        warnings.push('This moves USDC from your wallet into Phoenix collateral.');
        break;
      }
      case 'withdraw': {
        const amount = BigInt(request.amountAtomic ?? '0');
        if (amount <= 0n) throw new AppError(400, 'FUTURES_AMOUNT_REQUIRED', 'Enter a USDC withdrawal amount.');
        const built = await this.nativeClient.ixs.buildWithdrawIxs({ authority: request.wallet as never, amount });
        instructions = built.instructions.map(kitInstructionToWeb3);
        expected = { action: 'withdraw', amountAtomic: amount.toString() };
        warnings.push('Phoenix withdrawal cooldown and margin rules are checked again onchain.');
        break;
      }
      case 'open': {
        if (!quote) throw new AppError(410, 'FUTURES_QUOTE_REQUIRED', 'Refresh routes before building this order.', true);
        const symbol = quote.market.replace('-PERP', '');
        const market = await this.publicClient.exchange().getMarket(symbol);
        const priceTicks = asSafeNumber(priceUsdToTicks(
          atomicToDecimalString(quote.acceptablePriceMicroUsd ?? '0', 6),
          { baseLotsDecimals: market.baseLotsDecimals, tickSizeInQuoteLotsPerBaseLot: market.tickSize },
        ), 'Price ticks');
        const baseLots = asSafeNumber(quote.baseSizeAtomic, 'Base size');
        const transferAmount = asSafeNumber(quote.collateralAtomic, 'Collateral');
        const body = {
          authority: request.wallet,
          symbol,
          side: quote.side === 'long' ? 'bid' : 'ask',
          numBaseLots: baseLots,
          transferAmount,
          pdaIndex: 0,
          allowCrossAndIsolatedForAsset: false,
        };
        const built = quote.orderType === 'market'
          ? await client.orders().placeIsolatedMarketOrderEnhanced({ ...body, maxPriceInTicks: priceTicks })
          : await client.orders().placeIsolatedLimitOrderEnhanced({ ...body, priceInTicks: priceTicks, isPostOnly: false });
        const providerInstructions = built.instructions.map(kitInstructionToWeb3);
        const subaccountIndex = isolatedSubaccountForOrder(request.wallet, quote.orderType, providerInstructions);
        const includeRegister = providerInstructions.some((instruction) => {
          if (instruction.programId.toBase58() !== String(PHOENIX_PROGRAM_ADDRESS)) return false;
          try {
            const decoded = getRegisterTraderInstructionDecoder().decode(instruction.data);
            return decoded.traderPdaIndex === 0 && decoded.subaccountIndex === subaccountIndex;
          } catch { return false; }
        });
        const baseUnits = atomicToDecimalString(quote.baseSizeAtomic, market.baseLotsDecimals);
        const priceUsd = atomicToDecimalString(quote.acceptablePriceMicroUsd ?? '0', 6);
        const nativeInstructions: InstructionsWithAccountsAndData[] = [];
        if (includeRegister) {
          nativeInstructions.push(await this.nativeClient.ixs.buildRegisterTrader({
            authority: request.wallet as never,
            marginType: MarginType.Isolated,
            traderPdaIndex: 0,
            traderSubaccountIndex: subaccountIndex,
          }));
        }
        nativeInstructions.push(await this.nativeClient.ixs.buildSyncParentToChild({
          traderWallet: request.wallet as never,
          traderPdaIndex: 0,
          traderSubaccountIndex: subaccountIndex,
        }));
        nativeInstructions.push(await this.nativeClient.ixs.buildTransferCollateral({
          authority: request.wallet as never,
          traderPdaIndex: 0,
          srcSubaccountIndex: 0,
          dstSubaccountIndex: subaccountIndex,
          amount: BigInt(quote.collateralAtomic),
        }));
        const orderPacket = quote.orderType === 'market'
          ? await this.nativeClient.orderPackets.buildMarketOrderPacket({ symbol, side: quote.side === 'long' ? Side.Bid : Side.Ask, baseUnits, priceLimitUsd: priceUsd })
          : await this.nativeClient.orderPackets.buildLimitOrderPacket({ symbol, side: quote.side === 'long' ? Side.Bid : Side.Ask, baseUnits, priceUsd });
        nativeInstructions.push(quote.orderType === 'market'
          ? await this.nativeClient.ixs.buildPlaceMarketOrder({ authority: request.wallet as never, symbol: symbol as never, orderPacket: orderPacket as never, traderPdaIndex: 0, traderSubaccountIndex: subaccountIndex })
          : await this.nativeClient.ixs.buildPlaceLimitOrder({ authority: request.wallet as never, symbol: symbol as never, orderPacket: orderPacket as never, traderPdaIndex: 0, traderSubaccountIndex: subaccountIndex }));
        nativeInstructions.push(await this.nativeClient.ixs.buildTransferCollateralChildToParent({
          authority: request.wallet as never,
          traderPdaIndex: 0,
          childSubaccountIndex: subaccountIndex,
        }));
        instructions = nativeInstructions.map(kitInstructionToWeb3);
        expected = {
          action: 'open',
          orderType: quote.orderType,
          side: quote.side === 'long' ? 'bid' : 'ask',
          baseLots: String(baseLots),
          priceTicks: String(priceTicks),
          collateralAtomic: quote.collateralAtomic,
          pdaIndex: 0,
          subaccountIndex,
          includeRegister,
        };
        break;
      }
      case 'cancel': {
        const order = parseOrderId(request.nativeId);
        const instruction = await this.nativeClient.ixs.buildCancelOrdersById({
          authority: request.wallet as never,
          symbol: order.symbol as never,
          traderPdaIndex: order.pdaIndex,
          traderSubaccountIndex: order.subaccountIndex,
          orders: [{ priceInTicks: order.priceTicks, orderSequenceNumber: order.sequenceNumber }],
        });
        const cleanup = await this.nativeClient.ixs.buildTransferCollateralChildToParent({
          authority: request.wallet as never,
          traderPdaIndex: order.pdaIndex,
          childSubaccountIndex: order.subaccountIndex,
        });
        instructions = [instruction, cleanup].map(kitInstructionToWeb3);
        marketAddress = (await this.publicClient.exchange().getMarket(order.symbol)).marketPubkey;
        expected = { action: 'cancel', priceTicks: order.priceTicks, sequenceNumber: order.sequenceNumber, pdaIndex: order.pdaIndex, subaccountIndex: order.subaccountIndex };
        warnings.push('Any collateral released by cancellation is swept back to Phoenix portfolio 0.');
        break;
      }
      case 'close':
      case 'reduce': {
        const position = parsePositionId(request.nativeId);
        if (!position.side) throw new AppError(400, 'FUTURES_POSITION_SIDE_MISSING', 'Refresh the Phoenix position before reducing it.');
        const market = await this.publicClient.exchange().getMarket(position.symbol);
        const sizeLots = BigInt(request.sizeAtomic ?? '0');
        if (sizeLots <= 0n) throw new AppError(400, 'FUTURES_SIZE_REQUIRED', 'Enter a position size to reduce.');
        const current = await this.publicClient.orderbook().getOrderbook(position.symbol);
        const reference = position.side === 'long' ? current.bids[0]?.[0] : current.asks[0]?.[0];
        if (!reference) throw new AppError(503, 'PHOENIX_PRICE_UNAVAILABLE', 'Phoenix has no executable close price.', true);
        const referenceMicro = BigInt(Math.round(reference * 1_000_000));
        const priceLimitMicro = position.side === 'long' ? referenceMicro * 9_950n / 10_000n : referenceMicro * 10_050n / 10_000n;
        const baseUnits = atomicToDecimalString(sizeLots.toString(), market.baseLotsDecimals);
        const packet = await this.nativeClient.orderPackets.buildMarketOrderPacket({
          symbol: position.symbol,
          side: oppositeSide(position.side),
          baseUnits,
          priceLimitUsd: atomicToDecimalString(priceLimitMicro.toString(), 6),
          minBaseUnitsToFill: request.action === 'close' ? baseUnits : undefined,
          orderFlags: OrderFlags.ReduceOnly,
        });
        const instruction = await this.nativeClient.ixs.buildPlaceMarketOrder({
          authority: request.wallet as never,
          symbol: position.symbol as never,
          orderPacket: packet,
          traderPdaIndex: position.pdaIndex,
          traderSubaccountIndex: position.subaccountIndex,
        });
        const cleanup = await this.nativeClient.ixs.buildTransferCollateralChildToParent({
          authority: request.wallet as never,
          traderPdaIndex: position.pdaIndex,
          childSubaccountIndex: position.subaccountIndex,
        });
        instructions = [instruction, cleanup].map(kitInstructionToWeb3);
        marketAddress = market.marketPubkey;
        expected = {
          action: request.action,
          side: position.side === 'long' ? 'ask' : 'bid',
          baseLots: String(packet.numBaseLots),
          priceTicks: packet.priceInTicks === null ? null : String(packet.priceInTicks),
          fullClose: request.action === 'close',
          pdaIndex: position.pdaIndex,
          subaccountIndex: position.subaccountIndex,
        };
        warnings.push('This reduce-only action is bound to the original Phoenix isolated subaccount.');
        warnings.push('Collateral released by this action is swept back to Phoenix portfolio 0.');
        break;
      }
      case 'take-profit':
      case 'stop-loss': {
        const position = parsePositionId(request.nativeId);
        if (!position.side) throw new AppError(400, 'FUTURES_POSITION_SIDE_MISSING', 'Refresh the Phoenix position before adding TP/SL.');
        const triggerMicro = BigInt(request.triggerPriceMicroUsd ?? '0');
        const executionMicro = BigInt(request.executionPriceMicroUsd ?? '0');
        if (triggerMicro <= 0n || executionMicro <= 0n) throw new AppError(400, 'FUTURES_TRIGGER_REQUIRED', 'Enter valid trigger and execution prices.');
        const greater = (request.action === 'take-profit') === (position.side === 'long');
        const market = await this.publicClient.exchange().getMarket(position.symbol);
        const units = { baseLotsDecimals: market.baseLotsDecimals, tickSizeInQuoteLotsPerBaseLot: market.tickSize };
        const triggerPriceTicks = asSafeNumber(priceUsdToTicks(atomicToDecimalString(triggerMicro.toString(), 6), units), 'Trigger price ticks');
        const executionPriceTicks = asSafeNumber(priceUsdToTicks(atomicToDecimalString(executionMicro.toString(), 6), units), 'Execution price ticks');
        const triggerRequest = { side: position.side === 'long' ? 'ask' : 'bid', orderKind: 'ioc', triggerPriceInTicks: triggerPriceTicks, executionPriceInTicks: executionPriceTicks };
        const built = await client.orders().placePositionConditionalOrder({
          authority: request.wallet,
          traderPdaIndex: position.pdaIndex,
          traderSubaccountIndex: position.subaccountIndex,
          isIsolated: true,
          symbol: position.symbol,
          sizePercent: request.sizeAtomic ? undefined : 100,
          ...(request.sizeAtomic ? { numBaseLots: asSafeNumber(request.sizeAtomic, 'Conditional size') } : {}),
          ...(greater ? { greaterTrigger: triggerRequest } : { lessTrigger: triggerRequest }),
        });
        instructions = built.map(kitInstructionToWeb3);
        marketAddress = market.marketPubkey;
        expected = {
          action: request.action,
          tradeSide: position.side === 'long' ? 'ask' : 'bid',
          direction: greater ? 'greater_than' : 'less_than',
          sizeBaseLots: request.sizeAtomic ?? '0',
          triggerPriceTicks: String(triggerPriceTicks),
          executionPriceTicks: String(executionPriceTicks),
          pdaIndex: position.pdaIndex,
          subaccountIndex: position.subaccountIndex,
        };
        break;
      }
      case 'cancel-conditional': {
        const conditional = parseConditionalId(request.nativeId);
        const built = await client.orders().cancelConditionalOrder({
          authority: request.wallet,
          traderPdaIndex: conditional.pdaIndex,
          traderSubaccountIndex: conditional.subaccountIndex,
          isIsolated: true,
          symbol: conditional.symbol,
          conditionalOrderIndex: conditional.conditionalIndex,
          executionDirection: conditional.direction,
        });
        instructions = built.map(kitInstructionToWeb3);
        marketAddress = (await this.publicClient.exchange().getMarket(conditional.symbol)).marketPubkey;
        expected = { action: 'cancel-conditional', conditionalIndex: conditional.conditionalIndex, direction: conditional.direction, pdaIndex: conditional.pdaIndex, subaccountIndex: conditional.subaccountIndex };
        break;
      }
      default:
        throw new AppError(400, 'FUTURES_ACTION_UNSUPPORTED', 'Phoenix does not support this requested action.');
    }

    if (!instructions.length && !transaction) throw new AppError(502, 'PHOENIX_EMPTY_TRANSACTION', 'Phoenix returned no transaction instructions.', true);
    return {
      instructions,
      transaction,
      allowedPrograms: [String(PHOENIX_PROGRAM_ADDRESS), String(EMBER_PROGRAM_ADDRESS)],
      allowedAdditionalSigners,
      marketAddress,
      warnings,
      expected,
    };
  }

  private requireAuthenticated(wallet: string): PhoenixHttpClient {
    this.sweepSessions();
    const session = this.authenticated.get(wallet);
    if (!session || session.expiresAt <= Date.now()) {
      throw new AppError(401, 'PHOENIX_SESSION_REQUIRED', 'Connect Phoenix with your Privy session before preparing a transaction.', true);
    }
    return session.client;
  }

  private sweepSessions() {
    const now = Date.now();
    for (const [wallet, session] of this.authenticated) {
      if (session.expiresAt <= now) {
        session.client.dispose();
        this.authenticated.delete(wallet);
      }
    }
    this.challenges.sweep(now);
  }
}
