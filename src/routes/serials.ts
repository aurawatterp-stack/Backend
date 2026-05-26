import express, { type Request, type Response, type Router } from "express";
import * as fs from "fs";

import { getCollections } from "../db/collections";
import { authenticate, requireAnyPermission } from "../middleware/auth";
import { upload } from "../middleware/upload";
import type { SerialEntry } from "../types";
import { fail, ok } from "../utils/http";
import { generateId } from "../utils/id";

const router: Router = express.Router();

/** GET /api/serials — filter by series, status */
router.get("/", authenticate, requireAnyPermission("inventory:serials"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const { q = "", series, status, page = "1", limit = "20" } = req.query as Record<string, string>;
  const filter: Record<string, unknown> = {};
  if (q) filter.serialNumber = { $regex: q, $options: "i" };
  if (series) filter.productSeriesId = series;
  if (status) filter.status = status;

  const p = Math.max(1, parseInt(page));
  const l = Math.min(200, parseInt(limit));
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
  upload.single("serials"),
  async (req: Request, res: Response) => {
    const c = await getCollections();
    if (!req.file) return fail(res, "CSV file is required");
    const { productSeriesId } = req.body;
    if (!productSeriesId) return fail(res, "productSeriesId is required");

    const content = fs.readFileSync(req.file.path, "utf-8");
    fs.unlinkSync(req.file.path);

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
      uploadedAt: new Date(),
    }));

    if (docs.length) await c.serials.insertMany(docs);
    return ok(res, { imported: docs.length, duplicatesSkipped: duplicates.length, duplicates });
  }
);

export default router;
