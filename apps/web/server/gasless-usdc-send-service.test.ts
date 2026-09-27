import {
  AccountLayout,
  AccountState,
  TOKEN_PROGRAM_ID,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
  type AccountInfo,
  type SimulatedTransactionResponse,
} from '@solana/web3.js';
import { describe, expect, it, vi } from 'vitest';
import { USDC_MINT } from '../shared/constants.js';
import type { TokenService } from './tokens.js';
import {
  GaslessUsdcSendService,
  validateGaslessUsdcSendTransaction,
  type GaslessUsdcSendRpc,
} from './gasless-usdc-send-service.js';

function tokenAccount(owner: PublicKey, amount = 5_000_000n): AccountInfo<Buffer> {
  const data = Buffer.alloc(AccountLayout.span);
  AccountLayout.encode({
    mint: new PublicKey(USDC_MINT),
    owner,
    amount,
    delegateOption: 0,
    delegate: PublicKey.default,
    state: AccountState.Initialized,
    isNativeOption: 0,
    isNative: 0n,
    delegatedAmount: 0n,
    closeAuthorityOption: 0,
    closeAuthority: PublicKey.default,
  }, data);
  return { data, executable: false, lamports: 2_039_280, owner: TOKEN_PROGRAM_ID, rentEpoch: 0 };
}

function dependencies(wallet: PublicKey, recipient: PublicKey, simulationError: unknown = null) {
  const sourceAta = getAssociatedTokenAddressSync(new PublicKey(USDC_MINT), wallet).toBase58();
  const recipientAta = getAssociatedTokenAddressSync(new PublicKey(USDC_MINT), recipient).toBase58();
  let prepared: VersionedTransaction | null = null;
  const rpc: GaslessUsdcSendRpc = {
    accountInfo: vi.fn(async (address) => {
      if (address.toBase58() === sourceAta) return tokenAccount(wallet);
      if (address.toBase58() === recipientAta) return tokenAccount(recipient, 0n);
      return null;
    }),
    latestBlockhash: vi.fn(async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 123 })),
    simulate: vi.fn(async (transaction) => {
      prepared = transaction;
      return {
        err: simulationError,
        logs: [],
        accounts: null,
        unitsConsumed: 1_200,
        returnData: null,
        innerInstructions: null,
        replacementBlockhash: null,
      } as SimulatedTransactionResponse;
    }),
    transaction: vi.fn(async () => null),
    signatureStatus: vi.fn(async () => null),
  };
  return { rpc, sourceAta, recipientAta, getPrepared: () => prepared };
}

function tokens(wallet: PublicKey, amountAtomic = '5000000'): TokenService {
  return {
    balances: vi.fn(async () => ({
      wallet: wallet.toBase58(),
      slot: 1,
      fetchedAt: Date.now(),
      balances: [{
        token: {
          mint: USDC_MINT,
          symbol: 'USDC',
          name: 'USD Coin',
          decimals: 6,
          logoUri: null,
          tokenProgram: 'spl-token',
          verified: true,
          tags: [],
          extensions: [],
          tradable: true,
          blockedReason: null,
          usdPrice: 1,
        },
        amountAtomic,
        uiAmount: '5',
      }],
    })),
  } as unknown as TokenService;
}

describe('gasless USDC send preparation', () => {
  it('builds and simulates exactly one reviewed TransferChecked instruction', async () => {
    const wallet = Keypair.generate().publicKey;
    const recipient = Keypair.generate().publicKey;
    const deps = dependencies(wallet, recipient);
    const service = new GaslessUsdcSendService(tokens(wallet), deps.rpc);
    const prepared = await service.prepare({
      wallet: wallet.toBase58(),
      recipient: recipient.toBase58(),
      amountAtomic: '1250000',
    });

    expect(prepared).toMatchObject({
      wallet: wallet.toBase58(),
      recipient: recipient.toBase58(),
      recipientAta: deps.recipientAta,
      mint: USDC_MINT,
      amountAtomic: '1250000',
      amountUi: '1.25',
      gasPayment: { mode: 'provider-sponsored', provider: 'Privy' },
      review: { flayFeePercent: '0', recipientAccountExists: true },
    });
    expect(prepared.messageHash).toMatch(/^[a-f0-9]{64}$/);
    expect(Buffer.from(prepared.transaction, 'base64').length).toBeGreaterThan(100);
    expect(deps.rpc.simulate).toHaveBeenCalledTimes(1);
    validateGaslessUsdcSendTransaction(deps.getPrepared()!, {
      wallet: wallet.toBase58(),
      recipient: recipient.toBase58(),
      amountAtomic: '1250000',
    });
  });

  it('rejects missing recipient accounts, low balance, and failed simulation', async () => {
    const wallet = Keypair.generate().publicKey;
    const recipient = Keypair.generate().publicKey;
    const missing = dependencies(wallet, recipient);
    (missing.rpc.accountInfo as ReturnType<typeof vi.fn>).mockImplementation(async (address: PublicKey) => (
      address.toBase58() === missing.sourceAta ? tokenAccount(wallet) : null
    ));
    await expect(new GaslessUsdcSendService(tokens(wallet), missing.rpc).prepare({
      wallet: wallet.toBase58(), recipient: recipient.toBase58(), amountAtomic: '1',
    })).rejects.toMatchObject({ code: 'SEND_RECIPIENT_USDC_ACCOUNT_REQUIRED' });

    await expect(new GaslessUsdcSendService(tokens(wallet, '10'), dependencies(wallet, recipient).rpc).prepare({
      wallet: wallet.toBase58(), recipient: recipient.toBase58(), amountAtomic: '11',
    })).rejects.toMatchObject({ code: 'SEND_USDC_BALANCE_LOW' });

    await expect(new GaslessUsdcSendService(tokens(wallet), dependencies(wallet, recipient, { InstructionError: [0, 'Custom'] }).rpc).prepare({
      wallet: wallet.toBase58(), recipient: recipient.toBase58(), amountAtomic: '1',
    })).rejects.toMatchObject({ code: 'SEND_SIMULATION_FAILED' });

    const offCurve = PublicKey.findProgramAddressSync([Buffer.from('recipient')], SystemProgram.programId)[0];
    await expect(new GaslessUsdcSendService(tokens(wallet), dependencies(wallet, recipient).rpc).prepare({
      wallet: wallet.toBase58(), recipient: offCurve.toBase58(), amountAtomic: '1',
    })).rejects.toMatchObject({ code: 'SEND_RECIPIENT_OFF_CURVE' });
  });

  it('fails validation on extra programs and altered review values', () => {
    const wallet = Keypair.generate().publicKey;
    const recipient = Keypair.generate().publicKey;
    const mint = new PublicKey(USDC_MINT);
    const transfer = createTransferCheckedInstruction(
      getAssociatedTokenAddressSync(mint, wallet), mint, getAssociatedTokenAddressSync(mint, recipient), wallet, 1n, 6,
    );
    const message = new TransactionMessage({
      payerKey: wallet,
      recentBlockhash: Keypair.generate().publicKey.toBase58(),
      instructions: [transfer, SystemProgram.transfer({ fromPubkey: wallet, toPubkey: recipient, lamports: 1 })],
    }).compileToV0Message();
    const transaction = new VersionedTransaction(message);
    expect(() => validateGaslessUsdcSendTransaction(transaction, {
      wallet: wallet.toBase58(), recipient: recipient.toBase58(), amountAtomic: '1',
    })).toThrow(/only one SPL Token instruction/i);

    const exact = new VersionedTransaction(new TransactionMessage({
      payerKey: wallet,
      recentBlockhash: Keypair.generate().publicKey.toBase58(),
      instructions: [transfer],
    }).compileToV0Message());
    expect(() => validateGaslessUsdcSendTransaction(exact, {
      wallet: wallet.toBase58(), recipient: recipient.toBase58(), amountAtomic: '2',
    })).toThrow(/differs from the reviewed recipient or amount/i);
  });

  it('confirms only the exact transfer with an external fee payer and zero sender SOL delta', async () => {
    const wallet = Keypair.generate().publicKey;
    const recipient = Keypair.generate().publicKey;
    const sponsor = Keypair.generate().publicKey;
    const mint = new PublicKey(USDC_MINT);
    const source = getAssociatedTokenAddressSync(mint, wallet);
    const destination = getAssociatedTokenAddressSync(mint, recipient);
    const message = new TransactionMessage({
      payerKey: sponsor,
      recentBlockhash: Keypair.generate().publicKey.toBase58(),
      instructions: [createTransferCheckedInstruction(source, mint, destination, wallet, 1_250_000n, 6)],
    }).compileToV0Message();
    const sourceIndex = message.staticAccountKeys.findIndex((key) => key.equals(source));
    const destinationIndex = message.staticAccountKeys.findIndex((key) => key.equals(destination));
    const walletIndex = message.staticAccountKeys.findIndex((key) => key.equals(wallet));
    const sponsorIndex = 0;
    const preBalances = message.staticAccountKeys.map(() => 0);
    const postBalances = message.staticAccountKeys.map(() => 0);
    preBalances[walletIndex] = 123_456;
    postBalances[walletIndex] = 123_456;
    preBalances[sponsorIndex] = 100_000;
    postBalances[sponsorIndex] = 95_000;
    const chainTransaction = {
      slot: 1,
      blockTime: 1,
      version: 0,
      transaction: { signatures: ['signature'], message },
      meta: {
        err: null,
        fee: 5_000,
        preBalances,
        postBalances,
        innerInstructions: [],
        logMessages: [],
        preTokenBalances: [
          { accountIndex: sourceIndex, mint: USDC_MINT, uiTokenAmount: { amount: '5000000', decimals: 6, uiAmount: 5, uiAmountString: '5' } },
          { accountIndex: destinationIndex, mint: USDC_MINT, uiTokenAmount: { amount: '0', decimals: 6, uiAmount: 0, uiAmountString: '0' } },
        ],
        postTokenBalances: [
          { accountIndex: sourceIndex, mint: USDC_MINT, uiTokenAmount: { amount: '3750000', decimals: 6, uiAmount: 3.75, uiAmountString: '3.75' } },
          { accountIndex: destinationIndex, mint: USDC_MINT, uiTokenAmount: { amount: '1250000', decimals: 6, uiAmount: 1.25, uiAmountString: '1.25' } },
        ],
        rewards: [],
        loadedAddresses: { readonly: [], writable: [] },
        computeUnitsConsumed: 1_200,
      },
    };
    const deps = dependencies(wallet, recipient);
    deps.rpc.transaction = vi.fn(async () => chainTransaction as never);
    const service = new GaslessUsdcSendService(tokens(wallet), deps.rpc);
    const status = await service.status({
      wallet: wallet.toBase58(),
      recipient: recipient.toBase58(),
      amountAtomic: '1250000',
      signature: '2'.repeat(88),
    });
    expect(status).toMatchObject({
      status: 'confirmed',
      feePayer: sponsor.toBase58(),
      networkFeeLamports: '5000',
      senderNetworkFeeLamports: '0',
    });

    const walletPaid = new TransactionMessage({
      payerKey: wallet,
      recentBlockhash: Keypair.generate().publicKey.toBase58(),
      instructions: [createTransferCheckedInstruction(source, mint, destination, wallet, 1_250_000n, 6)],
    }).compileToV0Message();
    deps.rpc.transaction = vi.fn(async () => ({ ...chainTransaction, transaction: { signatures: ['signature'], message: walletPaid } }) as never);
    await expect(service.status({
      wallet: wallet.toBase58(), recipient: recipient.toBase58(), amountAtomic: '1250000', signature: '3'.repeat(88),
    })).rejects.toMatchObject({ code: 'SEND_SPONSORSHIP_NOT_PROVEN' });
  });
});
