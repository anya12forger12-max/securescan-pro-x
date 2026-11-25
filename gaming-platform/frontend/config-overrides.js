/* react-app-rewired override kept from the Aviator client so browser builds
 * keep working when a transitive dependency expects Node core modules. */
const fs = require("fs");
const path = require("path");
const paths = require("react-scripts/config/paths");
const createEvalSourceMapMiddleware = require("react-dev-utils/evalSourceMapMiddleware");
const createRedirectServedPathMiddleware = require("react-dev-utils/redirectServedPathMiddleware");
const createNoopServiceWorkerMiddleware = require("react-dev-utils/noopServiceWorkerMiddleware");
const WebpackDevServer = require("webpack-dev-server");

// react-scripts 5 shuts the dev server down with `devServer.close()`, but
// webpack-dev-server 6 renamed that method to `stop()`. Without this alias a
// normal Ctrl-C or CI timeout ends in a TypeError.
if (!WebpackDevServer.prototype.close && typeof WebpackDevServer.prototype.stop === "function") {
  WebpackDevServer.prototype.close = WebpackDevServer.prototype.stop;
}

// CRA's `startCallback` ignores its error argument and still prints
// "Starting the development server..." after a failed startup. Forward the
// error to the console so compatibility problems are actually visible.
const originalStartCallback = WebpackDevServer.prototype.startCallback;
WebpackDevServer.prototype.startCallback = function (callback) {
  return originalStartCallback.call(this, (error) => {
    if (error) console.error("Development server failed to start", error);
    return callback(error);
  });
};

/** react-scripts 5 still emits the webpack-dev-server v3 lifecycle hooks.
 * webpack-dev-server v4 rejects them outright, so translate the two CRA hooks
 * into the supported `setupMiddlewares` array without losing their behaviour. */
function migrateDevServer(devServer) {
  if (!devServer || typeof devServer.setupMiddlewares === "function") return devServer;

  const {
    onBeforeSetupMiddleware,
    onAfterSetupMiddleware,
    https,
    ...rest
  } = devServer;
  const proxySetup = path.resolve(paths.appSrc, "setupProxy.js");
  const servedPath = paths.publicUrlOrPath;

  // webpack-dev-server v4 replaced the boolean/object `https` option with
  // `server`. CRA's config still emits `https`, so translate it too.
  if (https) {
    rest.server = {
      type: "https",
      options: typeof https === "object" ? https : {},
    };
  }

  return {
    ...rest,
    setupMiddlewares: (middlewares, server) => {
      const early = [];
      const late = [];

      if (typeof onBeforeSetupMiddleware === "function") {
        early.push({
          name: "eval-source-map",
          middleware: createEvalSourceMapMiddleware(server),
        });
        if (fs.existsSync(proxySetup)) {
          // Keep proxy middleware ahead of the dev server's static/rewrite
          // stack, matching CRA's old "before setup" hook ordering.
          early.push({
            name: "setup-proxy",
            middleware: require(proxySetup)(server.app),
          });
        }
      }

      if (typeof onAfterSetupMiddleware === "function") {
        late.push(
          {
            name: "redirect-served-path",
            middleware: createRedirectServedPathMiddleware(servedPath),
          },
          {
            name: "noop-service-worker",
            middleware: createNoopServiceWorkerMiddleware(servedPath),
          },
        );
      }

      return [...early, ...middlewares, ...late];
    },
  };
}

module.exports = function override(config) {
  // CRA's catch-all "file" rule excludes the usual JS extensions but not
  // `.cjs`. webpack-dev-middleware's browser client imports CommonJS logger
  // helpers with that extension, so they were emitted as asset URLs and broke
  // the dev-server compilation with "only default export is available".
  const assetRule = config.module.rules
    .find((rule) => Array.isArray(rule.oneOf))
    ?.oneOf.find((rule) => rule.type === "asset/resource" && Array.isArray(rule.exclude));
  if (assetRule) {
    assetRule.exclude = [/^$/, /\.(js|mjs|cjs|jsx|ts|tsx)$/, /\.html$/, /\.json$/];
  }

  config.resolve.fallback = {
    ...(config.resolve.fallback || {}),
    assert: require.resolve("assert/"),
    crypto: require.resolve("crypto-browserify"),
    http: require.resolve("stream-http"),
    https: require.resolve("https-browserify"),
    os: require.resolve("os-browserify/browser"),
    path: require.resolve("path-browserify"),
    process: require.resolve("process/browser.js"),
    stream: require.resolve("stream-browserify"),
    url: require.resolve("url/"),
    util: require.resolve("util/"),
    zlib: require.resolve("browserify-zlib"),
  };

  return config;
};

module.exports.devServer = (createDevServerConfig) => (...args) =>
  migrateDevServer(createDevServerConfig(...args));
