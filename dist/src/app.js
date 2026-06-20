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
const rawMaterials_1 = __importDefault(require("./routes/rawMaterials"));
const manufactured_1 = __importDefault(require("./routes/manufactured"));
const serials_1 = __importDefault(require("./routes/serials"));
const sales_1 = __importDefault(require("./routes/sales"));
const complaints_1 = __importDefault(require("./routes/complaints"));
const customerPortal_1 = __importDefault(require("./routes/customerPortal"));
const distributors_1 = __importDefault(require("./routes/distributors"));
const dashboard_1 = __importDefault(require("./routes/dashboard"));
const notifications_1 = __importDefault(require("./routes/notifications"));
const roles_1 = __importDefault(require("./routes/roles"));
const engineerAssignments_1 = __importDefault(require("./routes/engineerAssignments"));
const geo_1 = __importDefault(require("./routes/geo"));
const app = (0, express_1.default)();
function createCorsOptions() {
    const allowedOrigins = [
        "https://frontend-six-alpha-iyg19kf2uq.vercel.app",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ];
    return {
        origin: (requestOrigin, callback) => {
            if (!requestOrigin)
                return callback(null, true);
            return callback(null, allowedOrigins.includes(requestOrigin));
        },
        credentials: true,
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: ["Authorization", "Content-Type", "Accept"],
        optionsSuccessStatus: 204,
    };
}
// Global middleware
app.use((0, helmet_1.default)());
const corsOptions = createCorsOptions();
app.use((0, cors_1.default)(corsOptions));
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
app.use("/api/raw-materials", rawMaterials_1.default);
app.use("/api/manufactured", manufactured_1.default);
app.use("/api/serials", serials_1.default);
app.use("/api/sales", sales_1.default);
app.use("/api/complaints", complaints_1.default);
app.use("/api/customer-portal", customerPortal_1.default);
app.use("/api/distributors", distributors_1.default);
app.use("/api/dashboard", dashboard_1.default);
app.use("/api/notifications", notifications_1.default);
app.use("/api/roles", roles_1.default);
app.use("/api/engineer-assignments", engineerAssignments_1.default);
app.use("/api/geo", geo_1.default);
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
