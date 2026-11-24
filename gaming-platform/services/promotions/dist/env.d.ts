import { z } from "zod";
/**
 * Promotions env.
 *
 * DATABASE_URL is required: claims and the catalogue are durable records in
 * Postgres, not an in-memory map. Failing at startup when the DB is missing is
 * deliberate -- starting a promotional service that silently loses claims (and
 * then credits wallets for them) is far worse than refusing to boot.
 *
 * Port 3022 is used because 3014 belongs to tournaments and 3016 to chat; the
 * openapi.yaml server URL and the compose healthcheck must match this value.
 *
 * This service receives only the bonus-scoped wallet credential. The full
 * wallet token is an optional local-run fallback and never reaches a deployed
 * promotions container, so a compromised process cannot mint other credit
 * types. Events are published to realtime over its capability-authenticated
 * internal endpoint; the old Redis EventBus had no subscriber.
 */
export declare const promotionsEnvSchema: z.ZodObject<{
    NODE_ENV: z.ZodDefault<z.ZodEnum<["development", "test", "production"]>>;
    WALLET_SERVICE_TOKEN: z.ZodOptional<z.ZodString>;
    WALLET_BONUS_SERVICE_TOKEN: z.ZodOptional<z.ZodString>;
    PORT: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    DATABASE_URL: z.ZodString;
    JWT_ACCESS_SECRET: z.ZodString;
    REDIS_URL: z.ZodOptional<z.ZodString>;
    CORS_ORIGIN: z.ZodDefault<z.ZodString>;
    LOG_LEVEL: z.ZodDefault<z.ZodEnum<{
        error: "error";
        fatal: "fatal";
        warn: "warn";
        info: "info";
        debug: "debug";
        trace: "trace";
        silent: "silent";
    }>>;
    REALTIME_URL: z.ZodDefault<z.ZodString>;
    RESPONSIBLE_GAMING_URL: z.ZodString;
    WALLET_URL: z.ZodString;
    SERVICE_TOKEN: z.ZodString;
    REALTIME_SERVICE_TOKEN: z.ZodString;
    PROMOTIONS_SERVICE_TOKEN: z.ZodString;
}, z.core.$strip>;
export type PromotionsEnv = z.infer<typeof promotionsEnvSchema>;
export declare const loadEnv: (data: unknown, params?: z.core.ParseContext<z.core.$ZodIssue>) => {
    NODE_ENV: 3 | "development" | "test" | "production" | (() => ArrayIterator<"development" | "test" | "production">) | {
        [x: number]: boolean | undefined;
        length?: boolean | undefined;
        toString?: boolean | undefined;
        toLocaleString?: boolean | undefined;
        pop?: boolean | undefined;
        push?: boolean | undefined;
        concat?: boolean | undefined;
        join?: boolean | undefined;
        reverse?: boolean | undefined;
        shift?: boolean | undefined;
        slice?: boolean | undefined;
        sort?: boolean | undefined;
        splice?: boolean | undefined;
        unshift?: boolean | undefined;
        indexOf?: boolean | undefined;
        lastIndexOf?: boolean | undefined;
        every?: boolean | undefined;
        some?: boolean | undefined;
        forEach?: boolean | undefined;
        map?: boolean | undefined;
        filter?: boolean | undefined;
        reduce?: boolean | undefined;
        reduceRight?: boolean | undefined;
        find?: boolean | undefined;
        findIndex?: boolean | undefined;
        fill?: boolean | undefined;
        copyWithin?: boolean | undefined;
        entries?: boolean | undefined;
        keys?: boolean | undefined;
        values?: boolean | undefined;
        includes?: boolean | undefined;
        flatMap?: boolean | undefined;
        flat?: boolean | undefined;
        at?: boolean | undefined;
        [Symbol.iterator]?: boolean | undefined;
        readonly [Symbol.unscopables]?: boolean | undefined;
    } | (() => string) | {
        (): string;
        (locales: string | string[], options?: Intl.NumberFormatOptions & Intl.DateTimeFormatOptions): string;
    } | (() => "development" | "test" | "production" | undefined) | ((...items: ("development" | "test" | "production")[]) => number) | {
        (...items: ConcatArray<"development" | "test" | "production">[]): ("development" | "test" | "production")[];
        (...items: ("development" | "test" | "production" | ConcatArray<"development" | "test" | "production">)[]): ("development" | "test" | "production")[];
    } | ((separator?: string) => string) | (() => ("development" | "test" | "production")[]) | (() => "development" | "test" | "production" | undefined) | ((start?: number, end?: number) => ("development" | "test" | "production")[]) | ((compareFn?: ((a: "development" | "test" | "production", b: "development" | "test" | "production") => number) | undefined) => ["development", "test", "production"]) | {
        (start: number, deleteCount?: number): ("development" | "test" | "production")[];
        (start: number, deleteCount: number, ...items: ("development" | "test" | "production")[]): ("development" | "test" | "production")[];
    } | ((...items: ("development" | "test" | "production")[]) => number) | ((searchElement: "development" | "test" | "production", fromIndex?: number) => number) | ((searchElement: "development" | "test" | "production", fromIndex?: number) => number) | {
        <S extends "development" | "test" | "production">(predicate: (value: "development" | "test" | "production", index: number, array: ("development" | "test" | "production")[]) => value is S, thisArg?: any): this is S[];
        (predicate: (value: "development" | "test" | "production", index: number, array: ("development" | "test" | "production")[]) => unknown, thisArg?: any): boolean;
    } | ((predicate: (value: "development" | "test" | "production", index: number, array: ("development" | "test" | "production")[]) => unknown, thisArg?: any) => boolean) | ((callbackfn: (value: "development" | "test" | "production", index: number, array: ("development" | "test" | "production")[]) => void, thisArg?: any) => void) | (<U>(callbackfn: (value: "development" | "test" | "production", index: number, array: ("development" | "test" | "production")[]) => U, thisArg?: any) => U[]) | {
        <S extends "development" | "test" | "production">(predicate: (value: "development" | "test" | "production", index: number, array: ("development" | "test" | "production")[]) => value is S, thisArg?: any): S[];
        (predicate: (value: "development" | "test" | "production", index: number, array: ("development" | "test" | "production")[]) => unknown, thisArg?: any): ("development" | "test" | "production")[];
    } | {
        (callbackfn: (previousValue: "development" | "test" | "production", currentValue: "development" | "test" | "production", currentIndex: number, array: ("development" | "test" | "production")[]) => "development" | "test" | "production"): "development" | "test" | "production";
        (callbackfn: (previousValue: "development" | "test" | "production", currentValue: "development" | "test" | "production", currentIndex: number, array: ("development" | "test" | "production")[]) => "development" | "test" | "production", initialValue: "development" | "test" | "production"): "development" | "test" | "production";
        <U>(callbackfn: (previousValue: U, currentValue: "development" | "test" | "production", currentIndex: number, array: ("development" | "test" | "production")[]) => U, initialValue: U): U;
    } | {
        (callbackfn: (previousValue: "development" | "test" | "production", currentValue: "development" | "test" | "production", currentIndex: number, array: ("development" | "test" | "production")[]) => "development" | "test" | "production"): "development" | "test" | "production";
        (callbackfn: (previousValue: "development" | "test" | "production", currentValue: "development" | "test" | "production", currentIndex: number, array: ("development" | "test" | "production")[]) => "development" | "test" | "production", initialValue: "development" | "test" | "production"): "development" | "test" | "production";
        <U>(callbackfn: (previousValue: U, currentValue: "development" | "test" | "production", currentIndex: number, array: ("development" | "test" | "production")[]) => U, initialValue: U): U;
    } | {
        <S extends "development" | "test" | "production">(predicate: (value: "development" | "test" | "production", index: number, obj: ("development" | "test" | "production")[]) => value is S, thisArg?: any): S | undefined;
        (predicate: (value: "development" | "test" | "production", index: number, obj: ("development" | "test" | "production")[]) => unknown, thisArg?: any): "development" | "test" | "production" | undefined;
    } | ((predicate: (value: "development" | "test" | "production", index: number, obj: ("development" | "test" | "production")[]) => unknown, thisArg?: any) => number) | ((value: "development" | "test" | "production", start?: number, end?: number) => ["development", "test", "production"]) | ((target: number, start: number, end?: number) => ["development", "test", "production"]) | (() => ArrayIterator<[number, "development" | "test" | "production"]>) | (() => ArrayIterator<number>) | (() => ArrayIterator<"development" | "test" | "production">) | ((searchElement: "development" | "test" | "production", fromIndex?: number) => boolean) | (<U, This = undefined>(callback: (this: This, value: "development" | "test" | "production", index: number, array: ("development" | "test" | "production")[]) => U | readonly U[], thisArg?: This | undefined) => U[]) | (<A, D extends number = 1>(this: A, depth?: D | undefined) => FlatArray<A, D>[]) | ((index: number) => "development" | "test" | "production" | undefined);
    PORT: number;
    DATABASE_URL: string;
    JWT_ACCESS_SECRET: string;
    CORS_ORIGIN: string;
    LOG_LEVEL: "error" | "fatal" | "warn" | "info" | "debug" | "trace" | "silent";
    REALTIME_URL: string;
    RESPONSIBLE_GAMING_URL: string;
    WALLET_URL: string;
    SERVICE_TOKEN: string;
    REALTIME_SERVICE_TOKEN: string;
    PROMOTIONS_SERVICE_TOKEN: string;
    WALLET_SERVICE_TOKEN?: string | undefined;
    WALLET_BONUS_SERVICE_TOKEN?: string | undefined;
    REDIS_URL?: string | undefined;
};
//# sourceMappingURL=env.d.ts.map