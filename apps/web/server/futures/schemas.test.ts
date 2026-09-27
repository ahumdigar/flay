import { describe, expect, it } from 'vitest';
import { futuresExecuteSchema, futuresPhoenixChallengeSchema, futuresPhoenixLoginSchema, futuresPrepareSchema, futuresQuoteSchema } from '../schemas.js';

const wallet = '11111111111111111111111111111111';
const idempotencyKey = '2fcb570f-434e-4ad4-9a98-37264d6e7a76';
describe('futures request contracts', () => {
  it('requires an exact pair for the optional Phoenix wallet proof', () => {
    const challengeId = crypto.randomUUID();
    const signedTransaction = 'A'.repeat(120);
    expect(futuresPhoenixLoginSchema.safeParse({ wallet }).success).toBe(true);
    expect(futuresPhoenixLoginSchema.safeParse({ wallet, challengeId, signedTransaction }).success).toBe(true);
    expect(futuresPhoenixLoginSchema.safeParse({ wallet, challengeId }).success).toBe(false);
    expect(futuresPhoenixLoginSchema.safeParse({ wallet, signedTransaction }).success).toBe(false);
  });

  it('uses wallet-only Phoenix authentication and rejects Privy tokens in request bodies', () => {
    expect(futuresPhoenixChallengeSchema.safeParse({ wallet }).success).toBe(true);
    expect(futuresPhoenixChallengeSchema.safeParse({}).success).toBe(false);
    expect(futuresPhoenixChallengeSchema.safeParse({ wallet, privyAccessToken: 'identity-token' }).success).toBe(false);
    expect(futuresPhoenixLoginSchema.safeParse({ wallet, privyAccessToken: 'access-token' }).success).toBe(false);
  });

  it('requires an exact market and quote for entry', () => {
    expect(futuresPrepareSchema.safeParse({
      wallet,
      action: 'open',
      venue: 'gmtrade',
      market: 'SOL-PERP',
      quoteId: '811ad33d-c22f-41f9-8bcd-bbb8b9a84551',
      idempotencyKey,
    }).success).toBe(true);
    expect(futuresPrepareSchema.safeParse({ wallet, action: 'open', venue: 'gmtrade', idempotencyKey }).success).toBe(false);
  });

  it('accepts Phoenix public onboarding without an access code', () => {
    expect(futuresPrepareSchema.safeParse({
      wallet,
      action: 'activate',
      venue: 'phoenix',
      idempotencyKey,
    }).success).toBe(true);
    expect(futuresPrepareSchema.safeParse({
      wallet,
      action: 'activate',
      venue: 'gmtrade',
      idempotencyKey,
    }).success).toBe(false);
    expect(futuresPrepareSchema.safeParse({
      wallet,
      action: 'activate',
      venue: 'phoenix',
      amountAtomic: '1',
      idempotencyKey,
    }).success).toBe(false);
  });

  it('rejects obsolete Phoenix access codes on signed execution', () => {
    const execution = {
      wallet,
      preparedId: idempotencyKey,
      signedTransaction: 'A'.repeat(120),
      idempotencyKey,
    };
    expect(futuresExecuteSchema.safeParse(execution).success).toBe(true);
    expect(futuresExecuteSchema.safeParse({ ...execution, accessCode: 'access-code' }).success).toBe(false);
    expect(futuresExecuteSchema.safeParse({ ...execution, accessCode: 'x' }).success).toBe(false);
  });

  it('rejects irrelevant fields and GMTrade collateral staging', () => {
    expect(futuresPrepareSchema.safeParse({
      wallet,
      action: 'cancel',
      venue: 'phoenix',
      market: 'SOL-PERP',
      nativeId: 'native-order',
      amountAtomic: '1000000',
      idempotencyKey,
    }).success).toBe(false);
    expect(futuresPrepareSchema.safeParse({
      wallet,
      action: 'deposit',
      venue: 'gmtrade',
      amountAtomic: '1000000',
      idempotencyKey,
    }).success).toBe(false);
  });

  it('requires explicit size and both conditional prices', () => {
    const base = {
      wallet,
      action: 'take-profit' as const,
      venue: 'phoenix' as const,
      market: 'SOL-PERP',
      nativeId: 'position',
      sizeAtomic: '100',
      triggerPriceMicroUsd: '110000000',
      executionPriceMicroUsd: '109500000',
      idempotencyKey,
    };
    expect(futuresPrepareSchema.safeParse(base).success).toBe(true);
    expect(futuresPrepareSchema.safeParse({ ...base, executionPriceMicroUsd: undefined }).success).toBe(false);
  });

  it('enforces launch leverage and limit-price semantics', () => {
    const base = {
      wallet,
      market: 'SOL-PERP' as const,
      side: 'long' as const,
      collateralAtomic: '1000000',
      leverageBps: 100_000,
      slippageBps: 50,
      routeChoice: 'auto' as const,
    };
    expect(futuresQuoteSchema.safeParse({ ...base, orderType: 'limit', limitPriceMicroUsd: '100000000' }).success).toBe(true);
    expect(futuresQuoteSchema.safeParse({ ...base, orderType: 'limit' }).success).toBe(false);
    expect(futuresQuoteSchema.safeParse({ ...base, orderType: 'market', limitPriceMicroUsd: '100000000' }).success).toBe(false);
    expect(futuresQuoteSchema.safeParse({ ...base, orderType: 'market', leverageBps: 100_001 }).success).toBe(false);
  });
});
