const DECIMAL = /^(?:0|[1-9]\d*)(?:\.(\d+))?$/;

interface Fraction {
  numerator: bigint;
  denominator: bigint;
}

function fraction(value: string, label: string): Fraction {
  const normalized = value.trim();
  const match = DECIMAL.exec(normalized);
  if (!match) throw new Error(`${label} must be a plain positive decimal.`);
  const [whole, fractional = ''] = normalized.split('.');
  if (fractional.length > 18) throw new Error(`${label} supports at most 18 decimal places.`);
  const denominator = 10n ** BigInt(fractional.length);
  const numerator = BigInt(`${whole}${fractional}`);
  if (numerator <= 0n) throw new Error(`${label} must be greater than zero.`);
  return { numerator, denominator };
}

function decimalFromFraction(numerator: bigint, denominator: bigint, maximumDecimals = 12): string {
  const whole = numerator / denominator;
  let remainder = numerator % denominator;
  if (remainder === 0n || maximumDecimals === 0) return whole.toString();
  let decimals = '';
  for (let index = 0; index < maximumDecimals && remainder > 0n; index += 1) {
    remainder *= 10n;
    decimals += (remainder / denominator).toString();
    remainder %= denominator;
  }
  return `${whole}.${decimals.replace(/0+$/, '')}`;
}

export function normalizeMultiplier(value: string | number): string {
  const candidate = typeof value === 'number' ? value.toString() : value.trim();
  if (/e/i.test(candidate)) {
    const numeric = Number(candidate);
    if (!Number.isFinite(numeric) || numeric <= 0) throw new Error('The stock multiplier is invalid.');
    return numeric.toFixed(18).replace(/0+$/, '').replace(/\.$/, '');
  }
  fraction(candidate, 'The stock multiplier');
  return candidate.replace(/\.0+$/, '');
}

export function scaledAtomicToDecimal(
  atomic: string | bigint,
  tokenDecimals: number,
  multiplier: string,
  maximumDecimals = 12,
): string {
  if (!Number.isInteger(tokenDecimals) || tokenDecimals < 0 || tokenDecimals > 255) {
    throw new Error('Invalid stock token decimals.');
  }
  const raw = typeof atomic === 'bigint' ? atomic : BigInt(atomic);
  const negative = raw < 0n;
  const absolute = negative ? -raw : raw;
  const scale = fraction(normalizeMultiplier(multiplier), 'The stock multiplier');
  const result = decimalFromFraction(
    absolute * scale.numerator,
    (10n ** BigInt(tokenDecimals)) * scale.denominator,
    maximumDecimals,
  );
  return negative && result !== '0' ? `-${result}` : result;
}

export function scaledDecimalToAtomic(
  displayAmount: string,
  tokenDecimals: number,
  multiplier: string,
): { amountAtomic: string; normalizedDisplayAmount: string } {
  if (!Number.isInteger(tokenDecimals) || tokenDecimals < 0 || tokenDecimals > 255) {
    throw new Error('Invalid stock token decimals.');
  }
  const display = fraction(displayAmount, 'The stock amount');
  const scale = fraction(normalizeMultiplier(multiplier), 'The stock multiplier');
  const numerator = display.numerator * scale.denominator * 10n ** BigInt(tokenDecimals);
  const denominator = display.denominator * scale.numerator;
  const amountAtomic = numerator / denominator;
  if (amountAtomic <= 0n) throw new Error('The stock amount is below the smallest executable unit.');
  return {
    amountAtomic: amountAtomic.toString(),
    normalizedDisplayAmount: scaledAtomicToDecimal(amountAtomic, tokenDecimals, multiplier, 12),
  };
}
