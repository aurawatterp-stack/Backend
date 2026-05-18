// Vercel Node Function entrypoint (CommonJS).
// Loads the compiled Express app from `dist/`, which we include via `includeFiles`.

const path = require("path");

let cachedApp;

function getApp() {
  if (cachedApp) return cachedApp;

  // In Vercel Functions, `process.cwd()` is the function bundle root.
  const appPath = path.join(process.cwd(), "dist", "src", "app.js");
  // eslint-disable-next-line global-require, import/no-dynamic-require
  const mod = require(appPath);
  cachedApp = mod.default || mod;
  return cachedApp;
}

module.exports = (req, res) => {
  const app = getApp();
  return app(req, res);
};

