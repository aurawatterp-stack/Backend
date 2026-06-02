"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMongoClient = getMongoClient;
exports.getMongoDb = getMongoDb;
const mongodb_1 = require("mongodb");
const config_1 = require("../config");
let clientPromise = null;
let dbPromise = null;
function stripUnsupportedTlsQueryParams(uri) {
    // Users sometimes try adding `maxVersion` / `minVersion` to the connection string
    // after reading Node TLS docs. The MongoDB Node driver rejects these options.
    //
    // Also: MongoDB URI options (query params) generally must not be specified with
    // an empty value (e.g. `?appName` or `?appName=`). If present, drop them so a
    // typo in `.env` doesn't hard-crash the server.
    try {
        const parsed = new URL(uri);
        const uniqueKeys = Array.from(new Set(parsed.searchParams.keys()));
        const nextParams = new URLSearchParams();
        for (const key of uniqueKeys) {
            const k = key.toLowerCase();
            const values = parsed.searchParams.getAll(key);
            // Strip unsupported TLS query params.
            if (k === "maxversion" || k === "minversion")
                continue;
            // `readPreferenceTags` is the one option where empty values can be meaningful.
            if (k === "readpreferencetags") {
                for (const v of values)
                    nextParams.append(key, v);
                continue;
            }
            for (const v of values) {
                if (v === "")
                    continue;
                nextParams.append(key, v);
            }
        }
        parsed.search = nextParams.toString();
        return parsed.toString();
    }
    catch {
        return uri;
    }
}
function looksLikeTlsInternalError(err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Seen in some environments where TLS 1.3 handshakes trigger server-side alert 80.
    return msg.includes("tlsv1 alert internal error") || msg.includes("SSL alert number 80");
}
function dbNameFromUrl(url) {
    const pathname = url.pathname || "";
    const name = pathname.startsWith("/") ? pathname.slice(1) : pathname;
    return name ? decodeURIComponent(name) : null;
}
async function getMongoClient() {
    if (clientPromise)
        return clientPromise;
    const uri = stripUnsupportedTlsQueryParams(config_1.CONFIG.DATABASE_URL);
    if (!uri) {
        throw new Error("DATABASE_URL/MONGODB_URI is not set");
    }
    const baseOptions = {
        serverSelectionTimeoutMS: config_1.CONFIG.DB_CONNECT_TIMEOUT_MS,
    };
    const envTlsOptions = {
        ...(config_1.CONFIG.MONGODB_TLS_SECURE_PROTOCOL ? { secureProtocol: config_1.CONFIG.MONGODB_TLS_SECURE_PROTOCOL } : null),
        ...(config_1.CONFIG.MONGODB_TLS_INSECURE ? { tlsInsecure: true } : null),
        ...(config_1.CONFIG.MONGODB_TLS_ALLOW_INVALID_CERTS ? { tlsAllowInvalidCertificates: true } : null),
        ...(config_1.CONFIG.MONGODB_TLS_ALLOW_INVALID_HOSTNAMES ? { tlsAllowInvalidHostnames: true } : null),
        ...(config_1.CONFIG.MONGODB_TLS_CA_FILE ? { tlsCAFile: config_1.CONFIG.MONGODB_TLS_CA_FILE } : null),
    };
    clientPromise = (async () => {
        try {
            const client = new mongodb_1.MongoClient(uri, { ...baseOptions, ...envTlsOptions });
            await client.connect();
            return client;
        }
        catch (err) {
            // If not explicitly pinned and hit the common alert-80 failure, retry by forcing TLS 1.2 via secureProtocol.
            if (!config_1.CONFIG.MONGODB_TLS_SECURE_PROTOCOL && looksLikeTlsInternalError(err)) {
                const client = new mongodb_1.MongoClient(uri, { ...baseOptions, secureProtocol: "TLSv1_2_method" });
                await client.connect();
                return client;
            }
            throw err;
        }
    })().catch((err) => {
        clientPromise = null;
        dbPromise = null;
        throw err;
    });
    return clientPromise;
}
async function getMongoDb() {
    if (dbPromise)
        return dbPromise;
    dbPromise = (async () => {
        const uri = config_1.CONFIG.DATABASE_URL;
        const client = await getMongoClient();
        let name = "aurawatt_ims";
        try {
            const parsed = new URL(uri);
            name = dbNameFromUrl(parsed) || name;
        }
        catch {
            // ignore
        }
        // Explicit override wins.
        if (config_1.CONFIG.MONGODB_DB_NAME)
            name = config_1.CONFIG.MONGODB_DB_NAME;
        return client.db(name);
    })();
    return dbPromise;
}
