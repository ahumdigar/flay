import { describe, expect, it } from 'vitest';
import {
  isRecoverableBackgroundPhoenixRejection,
  isRecoverableBackgroundRpcRejection,
} from './process-safety.js';

describe('process safety', () => {
  it('contains Solana JSON-RPC rate limits raised by an orphaned provider promise', () => {
    expect(isRecoverableBackgroundRpcRejection(new Error('429: {"jsonrpc":"2.0","error":{"message":"Connection rate limits exceeded"}}'))).toBe(true);
    expect(isRecoverableBackgroundRpcRejection('Solana RPC: 429 Too many requests')).toBe(true);
    expect(isRecoverableBackgroundRpcRejection(new Error(
      '429 Too Many Requests: {"code":-32007,"message":"15/second request limit reached - reduce calls per second or upgrade your account at https://dashboard.quicknode.com/billing/plan"}',
    ))).toBe(true);
  });

  it('does not hide unknown unhandled failures', () => {
    expect(isRecoverableBackgroundRpcRejection(new Error('program invariant failed'))).toBe(false);
    expect(isRecoverableBackgroundRpcRejection('429 from an unrelated web page')).toBe(false);
  });

  it('contains only the official Phoenix HTTP connection-abort signature', () => {
    expect(isRecoverableBackgroundPhoenixRejection(new Error(
      'Failed to connect to the Phoenix HTTP API (GET https://perp-api.phoenix.trade/v1/exchange/snapshot): This operation was aborted',
    ))).toBe(true);
    expect(isRecoverableBackgroundPhoenixRejection(new DOMException('This operation was aborted', 'AbortError'))).toBe(false);
    expect(isRecoverableBackgroundPhoenixRejection(new Error(
      'Failed to connect to the Phoenix HTTP API (GET https://example.com/v1/exchange/snapshot): This operation was aborted',
    ))).toBe(false);
    expect(isRecoverableBackgroundPhoenixRejection(new Error(
      'Failed to connect to the Phoenix HTTP API (GET https://perp-api.phoenix.trade/v1/exchange/snapshot): Invalid response',
    ))).toBe(false);
  });
});
