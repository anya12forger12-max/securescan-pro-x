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
  // No token is persisted any more. These old keys exist only so the client
  // can delete credentials written by earlier builds during session bootstrap.
  legacyTokenKey: "gp.access.token",
  legacyRefreshKey: "gp.refresh.token",
  // Non-sensitive UI bookkeeping only: the last session/game a user opened.
  // Tokens and refresh cookies are never written to web storage.
  lastGameKey: "gp.last.game",
} as const;
