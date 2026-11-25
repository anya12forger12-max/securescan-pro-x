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
        debug: "debug";
        error: "error";
        fatal: "fatal";
        info: "info";
        silent: "silent";
        trace: "trace";
        warn: "warn";
    }>>;
    REALTIME_URL: z.ZodDefault<z.ZodString>;
    RESPONSIBLE_GAMING_URL: z.ZodString;
    WALLET_URL: z.ZodString;
    PROMOTIONS_SERVICE_TOKEN: z.ZodString;
    REALTIME_SERVICE_TOKEN: z.ZodString;
    SERVICE_TOKEN: z.ZodString;
}, z.core.$strip>;
export type PromotionsEnv = z.infer<typeof promotionsEnvSchema>;
export declare const loadEnv: (data: unknown, params?: z.core.ParseContext<z.core.$ZodIssue>) => {
    NODE_ENV: "development" | "production" | "test" | 3 | (() => string) | {
        (): string;
        (locales: string | string[], options?: Intl.NumberFormatOptions & Intl.DateTimeFormatOptions): string;
    } | (() => "development" | "production" | "test" | undefined) | ((...items: ("development" | "production" | "test")[]) => number) | {
        (...items: ConcatArray<"development" | "production" | "test">[]): ("development" | "production" | "test")[];
        (...items: ("development" | "production" | "test" | ConcatArray<"development" | "production" | "test">)[]): ("development" | "production" | "test")[];
    } | ((separator?: string) => string) | (() => ("development" | "production" | "test")[]) | (() => "development" | "production" | "test" | undefined) | ((start?: number, end?: number) => ("development" | "production" | "test")[]) | ((compareFn?: ((a: "development" | "production" | "test", b: "development" | "production" | "test") => number) | undefined) => ["development", "test", "production"]) | {
        (start: number, deleteCount?: number): ("development" | "production" | "test")[];
        (start: number, deleteCount: number, ...items: ("development" | "production" | "test")[]): ("development" | "production" | "test")[];
    } | ((...items: ("development" | "production" | "test")[]) => number) | ((searchElement: "development" | "production" | "test", fromIndex?: number) => number) | ((searchElement: "development" | "production" | "test", fromIndex?: number) => number) | {
        <S extends "development" | "production" | "test">(predicate: (value: "development" | "production" | "test", index: number, array: ("development" | "production" | "test")[]) => value is S, thisArg?: any): this is S[];
        (predicate: (value: "development" | "production" | "test", index: number, array: ("development" | "production" | "test")[]) => unknown, thisArg?: any): boolean;
    } | ((predicate: (value: "development" | "production" | "test", index: number, array: ("development" | "production" | "test")[]) => unknown, thisArg?: any) => boolean) | ((callbackfn: (value: "development" | "production" | "test", index: number, array: ("development" | "production" | "test")[]) => void, thisArg?: any) => void) | (<U>(callbackfn: (value: "development" | "production" | "test", index: number, array: ("development" | "production" | "test")[]) => U, thisArg?: any) => U[]) | {
        <S extends "development" | "production" | "test">(predicate: (value: "development" | "production" | "test", index: number, array: ("development" | "production" | "test")[]) => value is S, thisArg?: any): S[];
        (predicate: (value: "development" | "production" | "test", index: number, array: ("development" | "production" | "test")[]) => unknown, thisArg?: any): ("development" | "production" | "test")[];
    } | {
        (callbackfn: (previousValue: "development" | "production" | "test", currentValue: "development" | "production" | "test", currentIndex: number, array: ("development" | "production" | "test")[]) => "development" | "production" | "test"): "development" | "production" | "test";
        (callbackfn: (previousValue: "development" | "production" | "test", currentValue: "development" | "production" | "test", currentIndex: number, array: ("development" | "production" | "test")[]) => "development" | "production" | "test", initialValue: "development" | "production" | "test"): "development" | "production" | "test";
        <U>(callbackfn: (previousValue: U, currentValue: "development" | "production" | "test", currentIndex: number, array: ("development" | "production" | "test")[]) => U, initialValue: U): U;
    } | {
        (callbackfn: (previousValue: "development" | "production" | "test", currentValue: "development" | "production" | "test", currentIndex: number, array: ("development" | "production" | "test")[]) => "development" | "production" | "test"): "development" | "production" | "test";
        (callbackfn: (previousValue: "development" | "production" | "test", currentValue: "development" | "production" | "test", currentIndex: number, array: ("development" | "production" | "test")[]) => "development" | "production" | "test", initialValue: "development" | "production" | "test"): "development" | "production" | "test";
        <U>(callbackfn: (previousValue: U, currentValue: "development" | "production" | "test", currentIndex: number, array: ("development" | "production" | "test")[]) => U, initialValue: U): U;
    } | {
        <S extends "development" | "production" | "test">(predicate: (value: "development" | "production" | "test", index: number, obj: ("development" | "production" | "test")[]) => value is S, thisArg?: any): S | undefined;
        (predicate: (value: "development" | "production" | "test", index: number, obj: ("development" | "production" | "test")[]) => unknown, thisArg?: any): "development" | "production" | "test" | undefined;
    } | ((predicate: (value: "development" | "production" | "test", index: number, obj: ("development" | "production" | "test")[]) => unknown, thisArg?: any) => number) | ((value: "development" | "production" | "test", start?: number, end?: number) => ["development", "test", "production"]) | ((target: number, start: number, end?: number) => ["development", "test", "production"]) | (() => ArrayIterator<"development" | "production" | "test">) | (() => ArrayIterator<[number, "development" | "production" | "test"]>) | (() => ArrayIterator<number>) | (() => ArrayIterator<"development" | "production" | "test">) | {
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
        [Symbol.iterator]?: boolean | undefined;
        entries?: boolean | undefined;
        keys?: boolean | undefined;
        values?: boolean | undefined;
        readonly [Symbol.unscopables]?: boolean | undefined;
        includes?: boolean | undefined;
        flatMap?: boolean | undefined;
        flat?: boolean | undefined;
        at?: boolean | undefined;
    } | ((searchElement: "development" | "production" | "test", fromIndex?: number) => boolean) | (<U, This = undefined>(callback: (this: This, value: "development" | "production" | "test", index: number, array: ("development" | "production" | "test")[]) => U | readonly U[], thisArg?: This | undefined) => U[]) | (<A, D extends number = 1>(this: A, depth?: D | undefined) => FlatArray<A, D>[]) | ((index: number) => "development" | "production" | "test" | undefined);
    WALLET_SERVICE_TOKEN?: string | undefined;
    WALLET_BONUS_SERVICE_TOKEN?: string | undefined;
    PORT: number;
    DATABASE_URL: string;
    JWT_ACCESS_SECRET: string;
    REDIS_URL?: string | undefined;
    CORS_ORIGIN: string;
    LOG_LEVEL: "debug" | "error" | "fatal" | "info" | "silent" | "trace" | "warn";
    REALTIME_URL: string;
    RESPONSIBLE_GAMING_URL: string;
    WALLET_URL: string;
    PROMOTIONS_SERVICE_TOKEN: string;
    REALTIME_SERVICE_TOKEN: string;
    SERVICE_TOKEN: string;
};
//# sourceMappingURL=env.d.ts.map