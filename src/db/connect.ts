import net from "node:net";

import { CONFIG } from "../config";
import { getMongoDb } from "./mongo";

type DbConnectResult =
  | { connected: true; message: string }
  | { connected: false; message: string };

function inferPort(protocol: string): number | undefined {
  switch (protocol) {
    case "postgres:":
    case "postgresql:":
      return 5432;
    case "mysql:":
      return 3306;
    case "mongodb:":
    case "mongodb+srv:":
      return 27017;
    case "redis:":
    case "rediss:":
      return 6379;
    default:
      return undefined;
  }
}

async function tcpPing(host: string, port: number, timeoutMs: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const timer = setTimeout(() => {
      socket.destroy(new Error("timeout"));
    }, timeoutMs);

    socket.once("connect", () => {
      clearTimeout(timer);
      socket.end();
      resolve();
    });
    socket.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Best-effort database connectivity check.
 *
 * For Mongo URLs it performs a real `ping` using the MongoDB driver.
 * For other DB URLs it only verifies host:port reachability (TCP).
 */
export async function connectDatabase(): Promise<DbConnectResult> {
  const raw = CONFIG.DATABASE_URL;
  if (!raw) {
    return { connected: false, message: "DATABASE_URL/MONGODB_URI not set (using in-memory mock DB)" };
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { connected: false, message: "Invalid DATABASE_URL (must be a valid URL)" };
  }

  // Prefer a real driver ping when using Mongo URLs.
  if (url.protocol === "mongodb:" || url.protocol === "mongodb+srv:") {
    try {
      const db = await getMongoDb();
      await db.command({ ping: 1 });
      return { connected: true, message: "database is connected" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const lower = msg.toLowerCase();
      if (lower.includes("querysrv") || lower.includes("_mongodb._tcp")) {
        return {
          connected: false,
          message:
            `Database connection failed: ${msg}\n` +
            "Hint: `mongodb+srv://` requires DNS SRV lookups. If your network blocks SRV queries, use a non-SRV connection string (mongodb://host1,host2/?tls=true...) or run a local MongoDB and set `MONGODB_URI=mongodb://localhost:27017/<db>`.",
        };
      }
      if (lower.includes("option maxversion is not supported") || lower.includes("option minversion is not supported")) {
        return {
          connected: false,
          message:
            `Database connection failed: ${msg}\n` +
            "Hint: remove `maxVersion`/`minVersion` from your MongoDB connection string. Use `MONGODB_TLS_SECURE_PROTOCOL=TLSv1_2_method` instead if you need to force TLS 1.2.",
        };
      }
      if (lower.includes("tlsv1 alert internal error") || lower.includes("ssl alert number 80")) {
        return {
          connected: false,
          message:
            `Database connection failed: ${msg}\n` +
            "Hint: if this is a managed MongoDB/proxy, try forcing TLS 1.2 via `MONGODB_TLS_SECURE_PROTOCOL=TLSv1_2_method`.",
        };
      }
      return { connected: false, message: `Database connection failed: ${msg}` };
    }
  }

  const host = url.hostname;
  const port = url.port ? Number(url.port) : inferPort(url.protocol);
  if (!host) return { connected: false, message: "DATABASE_URL missing hostname (cannot verify reachability)" };

  try {
    if (!port || !Number.isFinite(port)) {
      return { connected: false, message: "DATABASE_URL missing port (cannot verify reachability)" };
    }

    await tcpPing(host, port, CONFIG.DB_CONNECT_TIMEOUT_MS);
    return { connected: true, message: "database is connected" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { connected: false, message: `Database connection failed: ${msg}` };
  }
}
