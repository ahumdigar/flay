const DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.(\d*))?$/;

export function decimalToAtomic(value: string, decimals: number): string {
  const normalized = value.trim();
  const match = DECIMAL_PATTERN.exec(normalized);
  if (!match) throw new Error('Enter a positive number without commas or scientific notation.');
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new Error('Invalid token decimals.');

  const [whole, fraction = ''] = normalized.split('.');
  if (fraction.length > decimals) throw new Error(`This token supports at most ${decimals} decimal places.`);
  const atomic = `${whole}${fraction.padEnd(decimals, '0')}`.replace(/^0+(?=\d)/, '');
  return BigInt(atomic || '0').toString();
}

export function atomicToDecimal(value: string | bigint, decimals: number, trim = true): string {
  const atomic = typeof value === 'bigint' ? value : BigInt(value);
  const negative = atomic < 0n;
  const absolute = negative ? -atomic : atomic;
  const padded = absolute.toString().padStart(decimals + 1, '0');
  const whole = decimals === 0 ? padded : padded.slice(0, -decimals);
  let fraction = decimals === 0 ? '' : padded.slice(-decimals);
  if (trim) fraction = fraction.replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

export function compareAtomic(a: string, b: string): number {
  const left = BigInt(a);
  const right = BigInt(b);
  return left === right ? 0 : left > right ? 1 : -1;
}

export function formatTokenAmount(value: string | bigint, decimals: number, maximumFractionDigits = 6): string {
  const raw = atomicToDecimal(value, decimals, false);
  const number = Number(raw);
  if (!Number.isFinite(number)) return atomicToDecimal(value, decimals);
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits,
    minimumFractionDigits: 0,
  }).format(number);
}
