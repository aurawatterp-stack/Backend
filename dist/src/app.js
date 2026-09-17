"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const morgan_1 = __importDefault(require("morgan"));
const error_1 = require("./middleware/error");
const auth_1 = __importDefault(require("./routes/auth"));
const users_1 = __importDefault(require("./routes/users"));
const customers_1 = __importDefault(require("./routes/customers"));
const products_1 = __importDefault(require("./routes/products"));
const priceEntries_1 = __importDefault(require("./routes/priceEntries"));
const rawMaterials_1 = __importDefault(require("./routes/rawMaterials"));
const inwards_1 = __importDefault(require("./routes/inwards"));
const manufactured_1 = __importDefault(require("./routes/manufactured"));
const serials_1 = __importDefault(require("./routes/serials"));
const sales_1 = __importDefault(require("./routes/sales"));
const complaints_1 = __importDefault(require("./routes/complaints"));
const customerPortal_1 = __importDefault(require("./routes/customerPortal"));
const distributors_1 = __importDefault(require("./routes/distributors"));
const boms_1 = __importDefault(require("./routes/boms"));
const dashboard_1 = __importDefault(require("./routes/dashboard"));
const notifications_1 = __importDefault(require("./routes/notifications"));
const roles_1 = __importDefault(require("./routes/roles"));
const engineerAssignments_1 = __importDefault(require("./routes/engineerAssignments"));
const geo_1 = __importDefault(require("./routes/geo"));
const supportVideos_1 = __importDefault(require("./routes/supportVideos"));
const app = (0, express_1.default)();
function isAllowedOrigin(origin) {
    if (!origin)
        return true;
    const clean = origin.trim().replace(/\/+$/, "").toLowerCase();
    if (process.env.CORS_ORIGIN === "*")
        return true;
    try {
        const url = new URL(clean);
        const hostname = url.hostname;
        if (hostname === "aurawatt.in" ||
            hostname.endsWith(".aurawatt.in") ||
            hostname.endsWith(".vercel.app") ||
            hostname === "localhost" ||
            hostname === "127.0.0.1") {
            return true;
        }
    }
    catch {
        // Fallback if URL parsing fails
    }
    if (clean.endsWith(".aurawatt.in") ||
        clean === "https://aurawatt.in" ||
        clean.includes("vercel.app") ||
        clean.includes("localhost") ||
        clean.includes("127.0.0.1")) {
        return true;
    }
    if (process.env.CORS_ORIGIN) {
        const customOrigins = process.env.CORS_ORIGIN.split(",").map((s) => s.trim().toLowerCase());
        if (customOrigins.includes(clean) || customOrigins.includes("*"))
            return true;
    }
    return true;
}
function createCorsOptions() {
    return {
        origin: (requestOrigin, callback) => {
            if (!requestOrigin)
                return callback(null, true);
            if (isAllowedOrigin(requestOrigin)) {
                return callback(null, true);
            }
            return callback(null, true);
        },
        credentials: true,
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: [
            "Authorization",
            "Content-Type",
            "Accept",
            "X-Requested-With",
            "Origin",
            "Access-Control-Request-Method",
            "Access-Control-Request-Headers",
            "Cache-Control",
            "Pragma",
            "X-HTTP-Method-Override",
        ],
        exposedHeaders: ["Content-Length", "Content-Type", "Authorization"],
        maxAge: 600,
        optionsSuccessStatus: 204,
    };
}
// Global middleware
app.use((0, helmet_1.default)({ crossOriginResourcePolicy: false }));
const corsOptions = createCorsOptions();
app.use((0, cors_1.default)(corsOptions));
// Prevent browser/CDN caching on API routes to avoid stale data and cached CORS errors
app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Surrogate-Control", "no-store");
    next();
});
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: true }));
app.use((0, morgan_1.default)("dev"));
// Health check
app.get("/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString(), service: "Aurawatt IMS API" });
});
// Root route (avoid noisy 404s when opened in a browser / pinged by platforms)
app.get("/", (_req, res) => {
    res.json({
        service: "Aurawatt IMS API",
        status: "ok",
        health: "/health",
        apiBase: "/api",
    });
});
// Avoid favicon 404 noise for API-only service
app.get(["/favicon.ico", "/favicon.png"], (_req, res) => res.status(204).end());
// Mount routers
app.use("/api/auth", auth_1.default);
app.use("/api/users", users_1.default);
app.use("/api/customers", customers_1.default);
app.use("/api/products", products_1.default);
app.use("/api/price-entries", priceEntries_1.default);
app.use("/api/raw-materials", rawMaterials_1.default);
app.use("/api/inwards", inwards_1.default);
app.use("/api/manufactured", manufactured_1.default);
app.use("/api/serials", serials_1.default);
app.use("/api/sales", sales_1.default);
app.use("/api/complaints", complaints_1.default);
app.use("/api/customer-portal", customerPortal_1.default);
app.use("/api/distributors", distributors_1.default);
app.use("/api/boms", boms_1.default);
app.use("/api/dashboard", dashboard_1.default);
app.use("/api/notifications", notifications_1.default);
app.use("/api/roles", roles_1.default);
app.use("/api/engineer-assignments", engineerAssignments_1.default);
app.use("/api/geo", geo_1.default);
app.use("/api/support-videos", supportVideos_1.default);
// 404 fallback
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: "Route not found",
        path: req.originalUrl || req.url,
        method: req.method,
    });
});
// Global error handler (must be last)
app.use(error_1.errorHandler);
exports.default = app;
