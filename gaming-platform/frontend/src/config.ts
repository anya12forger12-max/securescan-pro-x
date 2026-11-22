/** Build-time configuration. The Aviator client used one env var for both its
 * REST and socket origins; this client uses the same variable for the gateway
 * origin, which is the only public entry point of the platform. */
const gatewayOrigin = (process.env.REACT_APP_API_URL ?? "").replace(/\/+$/, "");

export const config = {
  development: process.env.NODE_ENV !== "production",
  debug: process.env.REACT_APP_DEBUG === "true",
  appKey: "gp-web-0.1.0",
  gateway: gatewayOrigin,
  api: `${gatewayOrigin}/v1`,
  events: `${gatewayOrigin}/v1/events/stream`,
  tokenKey: "gp.access.token",
  refreshKey: "gp.refresh.token",
} as const;
