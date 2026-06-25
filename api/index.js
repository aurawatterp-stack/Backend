// Vercel Node Function entrypoint (CommonJS).
//
// IMPORTANT:
// - Keep `require()` path static so Vercel's Node File Trace can include all deps (node_modules).
// - Load from compiled output (`dist/`) so runtime doesn't depend on TS.

let cachedApp;
let bootError;

const ALLOWED_ORIGINS = new Set([
  "https://aurawatt.in",
  "https://www.aurawatt.in",
  "https://frontend-six-alpha-iyg19kf2uq.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  ...(process.env.CORS_ORIGIN || "")
    .split(",")
    .map((origin) => normalizeOrigin(origin))
    .filter(Boolean),
]);

function normalizeOrigin(origin) {
  return typeof origin === "string" ? origin.trim().replace(/\/+$/, "") : "";
}

function applyCorsHeaders(req, res) {
  const requestOrigin = normalizeOrigin(req.headers.origin);
  if (!requestOrigin || !ALLOWED_ORIGINS.has(requestOrigin)) return false;

  const originalSetHeader = res.setHeader.bind(res);
  res.setHeader = (name, value) => {
    const headerName = String(name).toLowerCase();
    if (headerName === "access-control-allow-origin") {
      return originalSetHeader(name, requestOrigin);
    }
    if (headerName === "access-control-allow-credentials") {
      return originalSetHeader(name, "true");
    }
    return originalSetHeader(name, value);
  };

  res.setHeader("access-control-allow-origin", requestOrigin);
  res.setHeader("vary", "Origin");
  res.setHeader("access-control-allow-methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("access-control-allow-headers", "Authorization,Content-Type,Accept");
  res.setHeader("access-control-allow-credentials", "true");
  return true;
}

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
    const corsApplied = applyCorsHeaders(req, res);

    if (corsApplied && req.method === "OPTIONS") {
      res.statusCode = 204;
      return res.end();
    }

    // When routed via `vercel.json`, `__path` contains the original request path.
    // Prefer that value because Vercel's internal rewrite headers can point back
    // at the function path itself (for example `/api/index.js`), which breaks
    // Express route matching.
    if (req.query && typeof req.query.__path === "string") {
      const restored = `/${req.query.__path}`.replace(/\/{2,}/g, "/");
      req.url = restored;
      delete req.query.__path;
    } else {
      // Fallback for runtimes that don't provide `__path`: preserve the original pathname.
      const original =
        req.headers["x-vercel-rewrite"] ||
        req.headers["x-forwarded-uri"] ||
        req.headers["x-original-uri"] ||
        req.headers["x-vercel-original-url"] ||
        req.headers["x-matched-path"];
      if (typeof original === "string" && original.startsWith("/")) {
        req.url = original;
      }
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
