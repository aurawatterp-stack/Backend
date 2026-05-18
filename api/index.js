// Vercel Node Function entrypoint (CommonJS).
//
// IMPORTANT:
// - Keep `require()` path static so Vercel's Node File Trace can include all deps (node_modules).
// - Load from compiled output (`dist/`) so runtime doesn't depend on TS.

let cachedApp;

function loadApp() {
  if (cachedApp) return cachedApp;
  // eslint-disable-next-line global-require
  const mod = require("../dist/src/app.js");
  cachedApp = mod.default || mod;
  return cachedApp;
}

module.exports = (req, res) => {
  try {
    const app = loadApp();
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
