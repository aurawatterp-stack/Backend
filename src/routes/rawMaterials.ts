import express, { type Request, type Response, type Router } from "express";

import { getCollections } from "../db/collections";
import { authenticate, requireAnyPermission } from "../middleware/auth";
import type { JwtPayload, Notification, RawMaterial } from "../types";
import { fail, ok } from "../utils/http";
import { generateId } from "../utils/id";

const router: Router = express.Router();

function normalizeInwardMode(value: unknown): RawMaterial["inwardMode"] {
  const text = String(value ?? "").trim().toLowerCase();
  if (text === "local") return "Local";
  if (text === "international" || text === "intl" || text === "import") return "International";
  return undefined;
}

function parseBatchNumber(batch?: string) {
  const match = String(batch ?? "").trim().match(/^BATCH-(\d+)$/i);
  if (!match) return null;
  return Number(match[1]);
}

async function suggestBatchForReceipt(productSeriesId: string, referenceNo: string) {
  const c = await getCollections();
  const existingSameReceipt = await c.rawMaterials.findOne(
    { productSeriesId, referenceNo, batch: { $ne: "" } },
    { projection: { batch: 1 } }
  );
  if (existingSameReceipt?.batch) return existingSameReceipt.batch;

  const seriesRows = await c.rawMaterials
    .find({ productSeriesId }, { projection: { batch: 1 } })
    .sort({ createdAt: 1 })
    .toArray();
  const highest = seriesRows.reduce((max, row) => Math.max(max, parseBatchNumber(row.batch) ?? 0), 0);
  return `BATCH-${highest + 1}`;
}

/** GET /api/raw-materials - filter by series, batch, vendor, inwardMode */
router.get("/", authenticate, requireAnyPermission("inventory:raw-materials", "complaints:supplier"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const { q = "", series, batch, vendor, inwardMode, page = "1", limit = "20" } = req.query as Record<string, string>;
  const filter: Record<string, unknown> = {};
  if (series) filter.productSeriesId = series;
  if (batch) filter.batch = batch;
  if (inwardMode) filter.inwardMode = normalizeInwardMode(inwardMode) ?? inwardMode;
  if (vendor) filter.vendorName = { $regex: vendor, $options: "i" };
  if (q) {
    filter.$or = [{ materialName: { $regex: q, $options: "i" } }, { referenceNo: { $regex: q, $options: "i" } }];
  }

  const p = Math.max(1, parseInt(page));
  const l = Math.min(100, parseInt(limit));
  const total = await c.rawMaterials.countDocuments(filter);
  const data = await c.rawMaterials.find(filter).skip((p - 1) * l).limit(l).toArray();
  return ok(res, { data, total, page: p, limit: l });
});

/** POST /api/raw-materials */
router.post("/", authenticate, requireAnyPermission("inventory:raw-materials"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const { productSeriesId, materialName, dateReceived, billType, referenceNo, quantityReceived, vendorName, batch, inwardMode, notes } = req.body;

  if (!productSeriesId || !materialName || !dateReceived || !billType || !referenceNo || !quantityReceived || !vendorName) {
    return fail(res, "All required fields must be provided");
  }

  const normalizedInwardMode = normalizeInwardMode(inwardMode) ?? "International";
  const trimmedBatch = String(batch ?? "").trim();
  const resolvedBatch = trimmedBatch || await suggestBatchForReceipt(String(productSeriesId), String(referenceNo));

  const entry: RawMaterial = {
    id: generateId(),
    productSeriesId,
    inwardMode: normalizedInwardMode,
    materialName,
    dateReceived: new Date(dateReceived),
    billType,
    referenceNo,
    quantityReceived: Number(quantityReceived),
    quantityAvailable: Number(quantityReceived),
    vendorName,
    batch: resolvedBatch,
    notes,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await c.rawMaterials.insertOne(entry);

  try {
    const user = (req as any).user as JwtPayload;
    const notification: Notification = {
      id: generateId(),
      type: "raw_material_received",
      title: "Raw Material Received",
      body: `${materialName} • ${resolvedBatch} • ${normalizedInwardMode}`,
      entityType: "raw_material",
      entityId: entry.id,
      meta: { materialName, batch: resolvedBatch, inwardMode: normalizedInwardMode, referenceNo, productSeriesId },
      audienceRoles: ["Admin", "Inventory"],
      readBy: [],
      createdBy: user.userId,
      createdAt: new Date(),
    };
    await c.notifications.insertOne(notification);
  } catch (err) {
    console.warn("Failed to insert notification:", err instanceof Error ? err.message : String(err));
  }

  return ok(res, entry, 201);
});

/** PUT /api/raw-materials/:id */
router.put("/:id", authenticate, requireAnyPermission("inventory:raw-materials"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const id = req.params.id;
  const existing = await c.rawMaterials.findOne({ id });
  if (!existing) return fail(res, "Raw material entry not found", 404);
  const updatedAt = new Date();
  const nextInwardMode = normalizeInwardMode(req.body?.inwardMode) ?? existing.inwardMode;
  const nextBatch = String(req.body?.batch ?? existing.batch ?? "").trim() || existing.batch;
  const update = { ...req.body, inwardMode: nextInwardMode, batch: nextBatch, updatedAt };
  await c.rawMaterials.updateOne({ id }, { $set: update });
  return ok(res, { ...existing, ...update });
});

/** DELETE /api/raw-materials/:id */
router.delete("/:id", authenticate, requireAnyPermission("inventory:raw-materials"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const result = await c.rawMaterials.deleteOne({ id: req.params.id });
  if (!result.deletedCount) return fail(res, "Raw material entry not found", 404);
  return ok(res, { message: "Raw material entry deleted" });
});

export default router;
