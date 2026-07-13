import express, { type NextFunction, type Request, type Response, type Router } from "express";
import multer from "multer";

import { getCollections } from "../db/collections";
import { authenticate, requireAnyPermission } from "../middleware/auth";
import type { SerialEntry } from "../types";
import { uploadBufferToCloudinary } from "../utils/cloudinary";
import { fail, ok } from "../utils/http";
import { generateId } from "../utils/id";

const router: Router = express.Router();
const MAX_SERIAL_CSV_BYTES = 5 * 1024 * 1024;

const serialCsvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SERIAL_CSV_BYTES },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "text/csv" || file.originalname.toLowerCase().endsWith(".csv")) {
      cb(null, true);
    } else {
      cb(new Error("Only CSV files are allowed"));
    }
  },
});

function runSerialCsvUpload(req: Request, res: Response, next: NextFunction) {
  serialCsvUpload.single("serials")(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      return fail(res, "CSV file size must be 5 MB or less", 413);
    }
    return fail(res, err instanceof Error ? err.message : "CSV upload failed", 400);
  });
}

/** GET /api/serials — filter by series, status */
router.get("/", authenticate, requireAnyPermission("inventory:serials", "complaints:consumer"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const { q = "", series, status, page = "1", limit = "20" } = req.query as Record<string, string>;
  const filter: Record<string, unknown> = {};
  if (q) filter.serialNumber = { $regex: q, $options: "i" };
  if (series) filter.productSeriesId = series;
  if (status) filter.status = status;

  const p = Math.max(1, parseInt(page));
  const l = Math.min(10000, parseInt(limit));
  const total = await c.serials.countDocuments(filter);
  const data = await c.serials.find(filter).skip((p - 1) * l).limit(l).toArray();
  return ok(res, { data, total, page: p, limit: l });
});

/**
 * POST /api/serials/import
 * Multipart form: field "serials" = CSV file, field "productSeriesId" = series id
 * CSV format: one serial per line (first column used)
 */
router.post(
  "/import",
  authenticate,
  requireAnyPermission("inventory:serials"),
  runSerialCsvUpload,
  async (req: Request, res: Response) => {
    const c = await getCollections();
    if (!req.file) return fail(res, "CSV file is required");
    const { productSeriesId } = req.body;
    if (!productSeriesId) return fail(res, "productSeriesId is required");

    let uploaded: Awaited<ReturnType<typeof uploadBufferToCloudinary>>;
    try {
      uploaded = await uploadBufferToCloudinary(req.file, "aurawatt/serial-imports");
    } catch (err) {
      return fail(res, err instanceof Error ? err.message : "Failed to upload CSV to Cloudinary", 502);
    }
    if (!uploaded.url) return fail(res, "Cloudinary did not return a file URL", 502);

    const content = req.file.buffer.toString("utf-8");

    const lines = content
      .split("\n")
      .map((l) => l.split(",")[0].trim())
      .filter(Boolean)
      .filter((l) => !l.toLowerCase().startsWith("serial"));

    const unique = [...new Set(lines)];
    if (unique.length === 0) return ok(res, { imported: 0, duplicatesSkipped: 0, duplicates: [] });

    const existing = await c.serials
      .find({ serialNumber: { $in: unique } }, { projection: { serialNumber: 1 } })
      .toArray();
    const dupSet = new Set(existing.map((e) => e.serialNumber));

    const toInsert = unique.filter((s) => !dupSet.has(s));
    const duplicates = unique.filter((s) => dupSet.has(s));

    const docs: SerialEntry[] = toInsert.map((serial) => ({
      id: generateId(),
      serialNumber: serial,
      productSeriesId,
      status: "Available",
      importFileName: req.file?.originalname,
      importFileUrl: uploaded.url,
      importFilePublicId: uploaded.publicId,
      uploadedAt: new Date(),
    }));

    if (docs.length) await c.serials.insertMany(docs);
    return ok(res, {
      imported: docs.length,
      duplicatesSkipped: duplicates.length,
      duplicates,
      file: {
        fileName: req.file.originalname,
        fileType: req.file.mimetype || undefined,
        fileSize: req.file.size,
        url: uploaded.url,
        publicId: uploaded.publicId,
        resourceType: uploaded.resourceType,
        format: uploaded.format,
        uploadedAt: new Date(),
      },
    });
  }
);

export default router;
