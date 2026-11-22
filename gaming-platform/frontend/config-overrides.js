/* react-app-rewired override kept from the Aviator client so browser builds
 * keep working when a transitive dependency expects Node core modules. */
module.exports = function override(config) {
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

  config.plugins = (config.plugins || []).map((plugin) => plugin);
  return config;
};
