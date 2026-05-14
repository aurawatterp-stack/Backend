import { MongoClient, type Db, type MongoClientOptions } from "mongodb";

import { CONFIG } from "../config";

let clientPromise: Promise<MongoClient> | null = null;
let dbPromise: Promise<Db> | null = null;

function stripUnsupportedTlsQueryParams(uri: string): string {
  // Users sometimes try adding `maxVersion` / `minVersion` to the connection string
  // after reading Node TLS docs. The MongoDB Node driver rejects these options.
  try {
    const parsed = new URL(uri);
    const keys = Array.from(parsed.searchParams.keys());
    for (const key of keys) {
      const k = key.toLowerCase();
      if (k === "maxversion" || k === "minversion") {
        parsed.searchParams.delete(key);
      }
    }
    return parsed.toString();
  } catch {
    return uri;
  }
}

function looksLikeTlsInternalError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  // Seen in some environments where TLS 1.3 handshakes trigger server-side alert 80.
  return msg.includes("tlsv1 alert internal error") || msg.includes("SSL alert number 80");
}

function dbNameFromUrl(url: URL): string | null {
  const pathname = url.pathname || "";
  const name = pathname.startsWith("/") ? pathname.slice(1) : pathname;
  return name ? decodeURIComponent(name) : null;
}

export async function getMongoClient(): Promise<MongoClient> {
  if (clientPromise) return clientPromise;

  const uri = stripUnsupportedTlsQueryParams(CONFIG.DATABASE_URL);
  if (!uri) {
    throw new Error("DATABASE_URL/MONGODB_URI is not set");
  }

  const baseOptions: MongoClientOptions = {
    serverSelectionTimeoutMS: CONFIG.DB_CONNECT_TIMEOUT_MS,
  };

  const envTlsOptions: MongoClientOptions = {
    ...(CONFIG.MONGODB_TLS_SECURE_PROTOCOL ? { secureProtocol: CONFIG.MONGODB_TLS_SECURE_PROTOCOL } : null),
    ...(CONFIG.MONGODB_TLS_INSECURE ? { tlsInsecure: true } : null),
    ...(CONFIG.MONGODB_TLS_ALLOW_INVALID_CERTS ? { tlsAllowInvalidCertificates: true } : null),
    ...(CONFIG.MONGODB_TLS_ALLOW_INVALID_HOSTNAMES ? { tlsAllowInvalidHostnames: true } : null),
    ...(CONFIG.MONGODB_TLS_CA_FILE ? { tlsCAFile: CONFIG.MONGODB_TLS_CA_FILE } : null),
  };

  clientPromise = (async () => {
    try {
      const client = new MongoClient(uri, { ...baseOptions, ...envTlsOptions });
      await client.connect();
      return client;
    } catch (err) {
      // If not explicitly pinned and hit the common alert-80 failure, retry by forcing TLS 1.2 via secureProtocol.
      if (!CONFIG.MONGODB_TLS_SECURE_PROTOCOL && looksLikeTlsInternalError(err)) {
        const client = new MongoClient(uri, { ...baseOptions, secureProtocol: "TLSv1_2_method" });
        await client.connect();
        return client;
      }
      throw err;
    }
  })();

  return clientPromise;
}

export async function getMongoDb(): Promise<Db> {
  if (dbPromise) return dbPromise;

  dbPromise = (async () => {
    const uri = CONFIG.DATABASE_URL;
    const client = await getMongoClient();

    let name = "aurawatt_ims";
    try {
      const parsed = new URL(uri);
      name = dbNameFromUrl(parsed) || name;
    } catch {
      // ignore
    }

    // Explicit override wins.
    if (CONFIG.MONGODB_DB_NAME) name = CONFIG.MONGODB_DB_NAME;
    return client.db(name);
  })();

  return dbPromise;
}
