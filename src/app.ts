import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";

import { CONFIG } from "./config";
import { errorHandler } from "./middleware/error";
import authRouter from "./routes/auth";
import usersRouter from "./routes/users";
import customersRouter from "./routes/customers";
import productsRouter from "./routes/products";
import rawMaterialsRouter from "./routes/rawMaterials";
import manufacturedRouter from "./routes/manufactured";
import serialsRouter from "./routes/serials";
import salesRouter from "./routes/sales";
import complaintsRouter from "./routes/complaints";
import distributorsRouter from "./routes/distributors";
import dashboardRouter from "./routes/dashboard";

const app = express();

// Global middleware
app.use(helmet());
app.use(cors({ origin: CONFIG.CORS_ORIGIN, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan("dev"));

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
app.use("/api/auth", authRouter);
app.use("/api/users", usersRouter);
app.use("/api/customers", customersRouter);
app.use("/api/products", productsRouter);
app.use("/api/raw-materials", rawMaterialsRouter);
app.use("/api/manufactured", manufacturedRouter);
app.use("/api/serials", serialsRouter);
app.use("/api/sales", salesRouter);
app.use("/api/complaints", complaintsRouter);
app.use("/api/distributors", distributorsRouter);
app.use("/api/dashboard", dashboardRouter);

// 404 fallback
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
    path: (req as any).originalUrl || req.url,
    method: req.method,
  });
});

// Global error handler (must be last)
app.use(errorHandler);

export default app;
