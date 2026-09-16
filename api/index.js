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
  "https://erp.aurawatt.in",
  "https://support.aurawatt.in",
  "https://frontend-six-alpha-iyg19kf2uq.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

function normalizeOrigin(origin) {
  return typeof origin === "string" ? origin.trim().replace(/\/+$/, "") : "";
}

function isOriginAllowed(origin) {
  if (!origin) return true;
  const clean = normalizeOrigin(origin).toLowerCase();

  if (process.env.CORS_ORIGIN === "*") return true;

  try {
    const url = new URL(clean);
    const hostname = url.hostname;
    if (
      hostname === "aurawatt.in" ||
      hostname.endsWith(".aurawatt.in") ||
      hostname.endsWith(".vercel.app") ||
      hostname === "localhost" ||
      hostname === "127.0.0.1"
    ) {
      return true;
    }
  } catch (e) {
    // ignore
  }

  if (
    clean.endsWith(".aurawatt.in") ||
    clean === "https://aurawatt.in" ||
    clean.includes("vercel.app") ||
    clean.includes("localhost") ||
    clean.includes("127.0.0.1") ||
    ALLOWED_ORIGINS.has(clean)
  ) {
    return true;
  }

  if (process.env.CORS_ORIGIN) {
    const customOrigins = process.env.CORS_ORIGIN.split(",").map((s) => s.trim().toLowerCase());
    if (customOrigins.includes(clean) || customOrigins.includes("*")) return true;
  }

  return true;
}

function applyCorsHeaders(req, res) {
  const rawOrigin = req.headers && req.headers.origin;
  const requestOrigin = normalizeOrigin(rawOrigin);

  if (requestOrigin && isOriginAllowed(requestOrigin)) {
    res.setHeader("access-control-allow-origin", requestOrigin);
    res.setHeader("access-control-allow-credentials", "true");
  } else if (!requestOrigin) {
    // For requests without an Origin header, allow wildcard without setting credentials: true
    res.setHeader("access-control-allow-origin", "*");
  } else {
    res.setHeader("access-control-allow-origin", requestOrigin);
    res.setHeader("access-control-allow-credentials", "true");
  }

  res.setHeader("vary", "Origin");
  res.setHeader("access-control-allow-methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");

  const requestedHeaders = req.headers && req.headers["access-control-request-headers"];
  if (requestedHeaders) {
    res.setHeader("access-control-allow-headers", requestedHeaders);
  } else {
    res.setHeader(
      "access-control-allow-headers",
      "Authorization, Content-Type, Accept, X-Requested-With, Origin, Access-Control-Request-Method, Access-Control-Request-Headers, Cache-Control, Pragma, X-HTTP-Method-Override"
    );
  }

  res.setHeader("access-control-expose-headers", "Content-Length, Content-Type, Authorization");
  res.setHeader("access-control-max-age", "86400");
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
    applyCorsHeaders(req, res);

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      return res.end();
    }

    const app = loadApp();

    // When routed via `vercel.json`, `__path` contains the original request path.
    if (req.query && typeof req.query.__path === "string") {
      const restored = `/${req.query.__path}`.replace(/\/{2,}/g, "/");
      req.url = restored;
      delete req.query.__path;
    } else {
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
    console.error("[BOOT_ERROR]", err);
    const requestOrigin = req.headers && req.headers.origin;
    if (requestOrigin) {
      res.setHeader("access-control-allow-origin", requestOrigin);
      res.setHeader("access-control-allow-credentials", "true");
    } else {
      res.setHeader("access-control-allow-origin", "*");
    }
    res.setHeader("access-control-allow-methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    res.setHeader(
      "access-control-allow-headers",
      "Authorization, Content-Type, Accept, X-Requested-With, Origin, Access-Control-Request-Method, Access-Control-Request-Headers"
    );
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
