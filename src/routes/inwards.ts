import express, { type Request, type Response, type Router } from "express";

import { getCollections } from "../db/collections";
import { authenticate, requireAnyPermission } from "../middleware/auth";
import type { JwtPayload, Notification, RawMaterial, InwardMaster, InwardItemDetail, InwardMode } from "../types";
import { fail, ok } from "../utils/http";
import { generateId } from "../utils/id";

const router: Router = express.Router();

async function getNextSequenceValue(sequenceName: string): Promise<number> {
  const c = await getCollections();
  const sequenceDocument = await c.counters.findOneAndUpdate(
    { id: sequenceName },
    { $inc: { seq: 1 } },
    { returnDocument: "after", upsert: true }
  );
  return sequenceDocument!.seq;
}

function normalizeInwardMode(value: unknown): InwardMode {
  const text = String(value ?? "").trim().toLowerCase();
  if (text === "local") return "Local";
  return "International";
}

/** POST /api/inwards */
router.post("/", authenticate, requireAnyPermission("inventory:raw-materials"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const { inwardMode, vendorName, dateReceived, billType, referenceNo, notes, items } = req.body;

  if (!vendorName || !dateReceived || !billType || !referenceNo || !Array.isArray(items) || items.length === 0) {
    return fail(res, "Missing required header fields or items array is empty");
  }

  const mode = normalizeInwardMode(inwardMode);
  
  // Generate Counters
  const prefix = mode === "Local" ? "LOC" : "INT";
  const inwardSeq = await getNextSequenceValue(`inward_${mode.toLowerCase()}`);
  const batchSeq = await getNextSequenceValue(`batch_${mode.toLowerCase()}`);

  const inwardNo = `INW-${prefix}-${String(inwardSeq).padStart(4, "0")}`;
  const batch = `${prefix}-BATCH-${String(batchSeq).padStart(3, "0")}`;

  const user = (req as any).user as JwtPayload;

  const inwardMaster: InwardMaster = {
    id: generateId(),
    inwardNo,
    inwardMode: mode,
    batch,
    vendorName,
    dateReceived: new Date(dateReceived),
    billType,
    referenceNo,
    notes,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: user.userId,
  };

  const itemDetails: InwardItemDetail[] = [];
  const rawMaterials: RawMaterial[] = [];

  for (const item of items) {
    if (!item.productSeriesId || !item.materialName || !item.quantityReceived) {
      return fail(res, "Invalid item data provided", 400);
    }

    const itemDetail: InwardItemDetail = {
      id: generateId(),
      inwardId: inwardMaster.id,
      productSeriesId: item.productSeriesId,
      materialName: item.materialName,
      quantityReceived: Number(item.quantityReceived),
      createdAt: new Date(),
    };
    itemDetails.push(itemDetail);

    // Repurpose raw_materials as inventory ledger
    const rawMaterial: RawMaterial = {
      id: generateId(),
      productSeriesId: item.productSeriesId,
      inwardMode: mode,
      materialName: item.materialName,
      dateReceived: new Date(dateReceived),
      billType,
      referenceNo,
      quantityReceived: Number(item.quantityReceived),
      quantityAvailable: Number(item.quantityReceived),
      vendorName,
      batch,
      notes,
      inwardId: inwardMaster.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    rawMaterials.push(rawMaterial);
  }

  await c.inwardMaster.insertOne(inwardMaster);
  await c.inwardItemDetails.insertMany(itemDetails);
  await c.rawMaterials.insertMany(rawMaterials);

  // Add Notification
  try {
    const notification: Notification = {
      id: generateId(),
      type: "raw_material_received",
      title: "Inward Received",
      body: `${inwardNo} • ${batch} • ${items.length} items • ${mode}`,
      entityType: "inward",
      entityId: inwardMaster.id,
      meta: { inwardNo, batch, inwardMode: mode, referenceNo },
      audienceRoles: ["Admin", "Inventory"],
      readBy: [],
      createdBy: user.userId,
      createdAt: new Date(),
    };
    await c.notifications.insertOne(notification);
  } catch (err) {
    console.warn("Failed to insert notification:", err instanceof Error ? err.message : String(err));
  }

  return ok(res, { ...inwardMaster, items: itemDetails }, 201);
});

/** GET /api/inwards */
router.get("/", authenticate, requireAnyPermission("inventory:raw-materials", "complaints:supplier"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const { q = "", inwardMode, page = "1", limit = "20" } = req.query as Record<string, string>;
  const filter: Record<string, unknown> = {};
  if (inwardMode) filter.inwardMode = normalizeInwardMode(inwardMode);
  if (q) {
    filter.$or = [
      { vendorName: { $regex: q, $options: "i" } },
      { referenceNo: { $regex: q, $options: "i" } },
      { inwardNo: { $regex: q, $options: "i" } },
      { batch: { $regex: q, $options: "i" } }
    ];
  }

  const p = Math.max(1, parseInt(page));
  const l = Math.min(100, parseInt(limit));
  const total = await c.inwardMaster.countDocuments(filter);
  const data = await c.inwardMaster.find(filter).sort({ createdAt: -1 }).skip((p - 1) * l).limit(l).toArray();
  
  // Aggregate items
  const dataWithItems = await Promise.all(data.map(async (inward) => {
    const items = await c.inwardItemDetails.find({ inwardId: inward.id }).toArray();
    return { ...inward, items };
  }));

  return ok(res, { data: dataWithItems, total, page: p, limit: l });
});

export default router;
