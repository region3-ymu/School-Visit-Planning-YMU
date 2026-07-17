/**
 * Prisma's Decimal (decimal.js) isn't a plain object, so it can't cross the
 * Server Component → Client Component boundary. Convert via toString() —
 * decimal.js deliberately doesn't implement valueOf(), so Number(decimal)
 * is not reliable.
 */
export function decimalToNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return value;
  return Number(String(value));
}
