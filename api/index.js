// Vercel Node Function entrypoint (CommonJS).
//
// IMPORTANT:
// - Keep `require()` path static so Vercel's Node File Trace can include all deps (node_modules).
// - Load from compiled output (`dist/`) so runtime doesn't depend on TS.

let cachedApp;
let bootError;

function loadApp() {
  if (bootError) throw bootError;
  if (cachedApp) return cachedApp;
  // eslint-disable-next-line global-require
  try {
    const mod = require("../dist/src/app.js");
    cachedApp = mod.default || mod;
    return cachedApp;
  } catch (err) {
    bootError = err instanceof Error ? err : new Error(String(err));
    throw bootError;
  }
}

module.exports = (req, res) => {
  try {
    const app = loadApp();
    // When routed via `vercel.json` we attach the original path as a query param.
    // Use it to restore the original URL so Express routing works.
    if (req.query && typeof req.query.__path === "string") {
      const restored = `/${req.query.__path}`.replace(/\/{2,}/g, "/");
      req.url = restored;
      delete req.query.__path;
    }
    // If Vercel rewrote the request to this function, preserve the original pathname.
    // Vercel provides the original URL in `x-vercel-rewrite` or `x-matched-path` (varies by runtime).
    const original =
      req.headers["x-vercel-rewrite"] ||
      req.headers["x-forwarded-uri"] ||
      req.headers["x-original-uri"] ||
      req.headers["x-vercel-original-url"] ||
      req.headers["x-matched-path"];
    if (typeof original === "string" && original.startsWith("/")) {
      req.url = original;
    }
    return app(req, res);
  } catch (err) {
    // Avoid FUNCTION_INVOCATION_FAILED with empty body; return a deterministic 500 instead.
    console.error("[BOOT_ERROR]", err);
    // Ensure browser can read the response for debugging even during CORS preflight.
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    res.setHeader("access-control-allow-headers", "authorization,content-type");
    res.statusCode = 500;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    const details =
      err && typeof err === "object" && "stack" in err
        ? String(err.stack)
        : err instanceof Error
          ? err.message
          : String(err);
    res.end(`Backend boot failed:\n${details}`);
  }
};
