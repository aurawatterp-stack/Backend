"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const morgan_1 = __importDefault(require("morgan"));
const config_1 = require("./config");
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
const distributors_1 = __importDefault(require("./routes/distributors"));
const dashboard_1 = __importDefault(require("./routes/dashboard"));
const app = (0, express_1.default)();
// Global middleware
app.use((0, helmet_1.default)());
app.use((0, cors_1.default)({ origin: config_1.CONFIG.CORS_ORIGIN, credentials: true }));
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: true }));
app.use((0, morgan_1.default)("dev"));
// Health check
app.get("/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString(), service: "Aurawatt IMS API" });
});
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
app.use("/api/distributors", distributors_1.default);
app.use("/api/dashboard", dashboard_1.default);
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
