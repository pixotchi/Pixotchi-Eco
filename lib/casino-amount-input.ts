import { formatUnits, parseUnits } from "viem";

const COMPACT_SUFFIX_DECIMALS: Record<string, number> = {
  k: 3,
  m: 6,
  b: 9,
};

const stripLeadingZeros = (value: string) => value.replace(/^0+(?=\d)/, "") || "0";

export function isPotentialCasinoAmountInput(value: string): boolean {
  const compact = value.replace(/\s+/g, "");
  if (compact === "" || compact === ".") return true;
  return /^[0-9,]*\.?[0-9,]*[kKmMbB]?$/.test(compact);
}

export function expandCasinoAmountInput(value: string): string | null {
  const compact = value.trim().replace(/,/g, "").replace(/\s+/g, "");
  if (!compact || compact === ".") return null;

  const match = compact.match(/^(\d+(?:\.\d*)?|\.\d+)([kKmMbB])?$/);
  if (!match) return null;

  const numberPart = match[1];
  const suffix = match[2]?.toLowerCase();
  const [wholeRaw, fractionRaw = ""] = numberPart.split(".");
  const whole = wholeRaw || "0";
  const fraction = fractionRaw;

  if (!suffix) {
    const normalizedWhole = stripLeadingZeros(whole);
    return fraction.length > 0
      ? `${normalizedWhole}.${fraction}`
      : normalizedWhole;
  }

  const multiplierDecimals = COMPACT_SUFFIX_DECIMALS[suffix];
  const digits = `${whole}${fraction}`.replace(/^0+/, "") || "0";

  if (fraction.length <= multiplierDecimals) {
    return stripLeadingZeros(`${digits}${"0".repeat(multiplierDecimals - fraction.length)}`);
  }

  const decimalsAfterExpansion = fraction.length - multiplierDecimals;
  const splitIndex = digits.length - decimalsAfterExpansion;
  const expandedWhole = stripLeadingZeros(digits.slice(0, splitIndex) || "0");
  const expandedFraction = digits.slice(splitIndex).replace(/0+$/, "");

  return expandedFraction ? `${expandedWhole}.${expandedFraction}` : expandedWhole;
}

export function parseCasinoAmountInput(value: string, decimals: number): bigint {
  const expanded = expandCasinoAmountInput(value);
  if (!expanded) throw new Error("Invalid casino amount");
  return parseUnits(expanded, decimals);
}

export function formatCasinoLimit(amount: bigint, decimals: number): string {
  const tokenUnit = BigInt(10) ** BigInt(decimals);
  const units = [
    { suffix: "B", multiplier: BigInt(1_000_000_000) },
    { suffix: "M", multiplier: BigInt(1_000_000) },
    { suffix: "K", multiplier: BigInt(1_000) },
  ];

  for (const unit of units) {
    const unitAmount = tokenUnit * unit.multiplier;
    if (amount < unitAmount) continue;

    const whole = amount / unitAmount;
    const remainder = amount % unitAmount;
    if (remainder === BigInt(0)) return `${whole.toString()}${unit.suffix}`;

    const fractional = ((remainder * BigInt(100)) / unitAmount)
      .toString()
      .padStart(2, "0")
      .replace(/0+$/, "");

    return fractional
      ? `${whole.toString()}.${fractional}${unit.suffix}`
      : `${whole.toString()}${unit.suffix}`;
  }

  return formatUnits(amount, decimals);
}
