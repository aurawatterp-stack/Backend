import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { errorHandler } from "./middleware/error";
import authRouter from "./routes/auth";
import usersRouter from "./routes/users";
import customersRouter from "./routes/customers";
import productsRouter from "./routes/products";
import priceEntriesRouter from "./routes/priceEntries";
import rawMaterialsRouter from "./routes/rawMaterials";
import inwardsRouter from "./routes/inwards";
import manufacturedRouter from "./routes/manufactured";
import serialsRouter from "./routes/serials";
import salesRouter from "./routes/sales";
import complaintsRouter from "./routes/complaints";
import customerPortalRouter from "./routes/customerPortal";
import distributorsRouter from "./routes/distributors";
import bomsRouter from "./routes/boms";
import dashboardRouter from "./routes/dashboard";
import notificationsRouter from "./routes/notifications";
import rolesRouter from "./routes/roles";
import engineerAssignmentsRouter from "./routes/engineerAssignments";
import geoRouter from "./routes/geo";
import supportVideosRouter from "./routes/supportVideos";

const app = express();

function isAllowedOrigin(origin: string): boolean {
  if (!origin) return true;
  const clean = origin.trim().replace(/\/+$/, "").toLowerCase();

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
  } catch {
    // Fallback if URL parsing fails
  }

  if (
    clean.endsWith(".aurawatt.in") ||
    clean === "https://aurawatt.in" ||
    clean.includes("vercel.app") ||
    clean.includes("localhost") ||
    clean.includes("127.0.0.1")
  ) {
    return true;
  }

  if (process.env.CORS_ORIGIN) {
    const customOrigins = process.env.CORS_ORIGIN.split(",").map((s) => s.trim().toLowerCase());
    if (customOrigins.includes(clean) || customOrigins.includes("*")) return true;
  }

  return true;
}

function createCorsOptions(): cors.CorsOptions {
  return {
    origin: (requestOrigin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      if (!requestOrigin) return callback(null, true);
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
app.use(helmet({ crossOriginResourcePolicy: false }));
const corsOptions = createCorsOptions();
app.use(cors(corsOptions));

// Prevent browser/CDN caching on API routes to avoid stale data and cached CORS errors
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
  next();
});

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
app.use("/api/price-entries", priceEntriesRouter);
app.use("/api/raw-materials", rawMaterialsRouter);
app.use("/api/inwards", inwardsRouter);
app.use("/api/manufactured", manufacturedRouter);
app.use("/api/serials", serialsRouter);
app.use("/api/sales", salesRouter);
app.use("/api/complaints", complaintsRouter);
app.use("/api/customer-portal", customerPortalRouter);
app.use("/api/distributors", distributorsRouter);
app.use("/api/boms", bomsRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/roles", rolesRouter);
app.use("/api/engineer-assignments", engineerAssignmentsRouter);
app.use("/api/geo", geoRouter);
app.use("/api/support-videos", supportVideosRouter);

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
