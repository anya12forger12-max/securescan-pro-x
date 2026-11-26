/** Error codes shared by the gateway-facing services. */
export declare const ERROR_CODES: Readonly<Record<string, string>>;

/** Normalise a money-like value to a two-decimal string (never a JS float). */
export declare function toMoney(value: unknown): string;

/** Decimal-safe multiplication for wagering targets. */
export declare function moneyMul(value: unknown, multiplier: unknown): string;

/** Coerce an untrusted query value to a bounded, bigint-safe integer. */
export declare function boundedInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number;

/** Constant-time comparison for the gateway service token. */
export declare function serviceTokenOk(
  headers: Record<string, unknown> | undefined,
  expected: string,
): boolean;
