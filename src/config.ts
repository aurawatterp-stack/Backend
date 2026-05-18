import * as fs from "fs";
import * as path from "path";

type EnvMap = Record<string, string>;

function parseDotEnv(contents: string): EnvMap {
  const out: EnvMap = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;

    const key = line.slice(0, eqIdx).trim();
    let value = line.slice(eqIdx + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key) out[key] = value;
  }
  return out;
}

function loadEnvFileIfPresent(filePath: string) {
  try {
    if (!fs.existsSync(filePath)) return;
    const parsed = parseDotEnv(fs.readFileSync(filePath, "utf8"));
    for (const [k, v] of Object.entries(parsed)) {
      if (process.env[k] === undefined) process.env[k] = v;
    }
  } catch {
    // Best-effort: if env can't be loaded, fall back to process.env defaults.
  }
}

const backendRoot = path.resolve(__dirname, "..");
loadEnvFileIfPresent(path.resolve(process.cwd(), ".env"));
loadEnvFileIfPresent(path.resolve(backendRoot, ".env"));

function str(name: string, fallback?: string): string {
  const value = process.env[name];
  if (value !== undefined && value !== "") return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required env var: ${name}`);
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  switch (raw.trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "y":
    case "on":
      return true;
    case "0":
    case "false":
    case "no":
    case "n":
    case "off":
      return false;
    default:
      return fallback;
  }
}

function corsOriginsFromEnv(raw: string | undefined): string | string[] | boolean {
  const value = (raw ?? "").trim();
  // If not configured, be permissive on Vercel to avoid "Failed to fetch" due to CORS.
  // For local dev, keep localhost-only by default.
  if (!value) return process.env.VERCEL ? true : "http://localhost:3000";
  if (value === "*") return true;
  if (value.includes(",")) return value.split(",").map((v) => v.trim()).filter(Boolean);
  return value;
}

const isServerless = Boolean(process.env.VERCEL);

// Vercel (and most serverless platforms) has a read-only filesystem, except `/tmp`.
// Any disk uploads must go to `/tmp` or an external object store.
const uploadDirRaw = process.env.UPLOAD_DIR?.trim() || (isServerless ? "/tmp/uploads" : "uploads");
const uploadDirAbs = path.isAbsolute(uploadDirRaw)
  ? uploadDirRaw
  : isServerless
    ? path.resolve("/tmp", uploadDirRaw)
    : path.resolve(backendRoot, uploadDirRaw);
try {
  fs.mkdirSync(uploadDirAbs, { recursive: true });
} catch {
  // ignore
}

export const CONFIG = {
  PORT: num("PORT", 5000),
  // Use either DATABASE_URL (generic) or MONGODB_URI (common name for Mongo).
  DATABASE_URL: (process.env.DATABASE_URL?.trim() || process.env.MONGODB_URI?.trim() || ""),
  MONGODB_URI: process.env.MONGODB_URI?.trim() || "",
  MONGODB_DB_NAME: process.env.MONGODB_DB_NAME?.trim() || "",
  DB_CONNECT_TIMEOUT_MS: num("DB_CONNECT_TIMEOUT_MS", 5000),
  SEED_DB: bool("SEED_DB", false),
  // Optional Mongo TLS knobs (useful for finicky managed DBs / proxies).
  // `secureProtocol` is supported by the MongoDB Node driver (unlike min/max TLS version).
  // Example: TLSv1_2_method
  MONGODB_TLS_SECURE_PROTOCOL: process.env.MONGODB_TLS_SECURE_PROTOCOL?.trim() || "",
  MONGODB_TLS_INSECURE: bool("MONGODB_TLS_INSECURE", false),
  MONGODB_TLS_ALLOW_INVALID_CERTS: bool("MONGODB_TLS_ALLOW_INVALID_CERTS", false),
  MONGODB_TLS_ALLOW_INVALID_HOSTNAMES: bool("MONGODB_TLS_ALLOW_INVALID_HOSTNAMES", false),
  MONGODB_TLS_CA_FILE: process.env.MONGODB_TLS_CA_FILE?.trim() || "",
  JWT_SECRET: str("JWT_SECRET", "your_secret_key"),
  JWT_EXPIRES_IN: str("JWT_EXPIRES_IN", "7d"),
  BCRYPT_ROUNDS: num("BCRYPT_ROUNDS", 10),
  CORS_ORIGIN: corsOriginsFromEnv(process.env.CORS_ORIGIN),
  UPLOAD_DIR: uploadDirAbs,
} as const;
