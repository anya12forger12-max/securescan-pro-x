declare const env: {
    DATABASE_URL: string;
    PORT: number;
    JWT_ACCESS_SECRET: string;
    REALTIME_URL: string;
    CORS_ORIGIN: string;
    LOG_LEVEL: string;
};
declare const pool: import("pg").Pool;
export { pool, env };
//# sourceMappingURL=index.d.ts.map