'use strict';

function assertBuffer(value) {
  if (!Buffer.isBuffer(value)) throw new TypeError('Expected a Buffer.');
}

function assertWidth(width) {
  if (!Number.isSafeInteger(width) || width < 0) throw new RangeError('Width must be a non-negative safe integer.');
}

function assertUnsigned(value) {
  if (typeof value !== 'bigint' || value < 0n) throw new RangeError('Value must be a non-negative bigint.');
}

function toBigIntBE(buffer) {
  assertBuffer(buffer);
  const hex = buffer.toString('hex');
  return hex ? BigInt(`0x${hex}`) : 0n;
}

function toBigIntLE(buffer) {
  assertBuffer(buffer);
  return toBigIntBE(Buffer.from(buffer).reverse());
}

function toBufferBE(value, width) {
  assertUnsigned(value);
  assertWidth(width);
  if (width === 0) {
    if (value !== 0n) throw new RangeError('Value does not fit in the requested width.');
    return Buffer.alloc(0);
  }
  const hex = value.toString(16);
  if (hex.length > width * 2) throw new RangeError('Value does not fit in the requested width.');
  return Buffer.from(hex.padStart(width * 2, '0'), 'hex');
}

function toBufferLE(value, width) {
  return Buffer.from(toBufferBE(value, width)).reverse();
}

module.exports = { toBigIntBE, toBigIntLE, toBufferBE, toBufferLE };
