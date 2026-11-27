declare const env: {
    JWT_PUBLIC_KEY: string;
    JWT_ISSUER: string;
    JWT_AUDIENCE: string;
    DATABASE_URL: string;
    PORT: number;
    CORS_ORIGIN: string;
    LOG_LEVEL: string;
};
declare const pool: import("pg").Pool;
export { pool, env };
//# sourceMappingURL=index.d.ts.map