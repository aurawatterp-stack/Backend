import express, { type Request, type Response, type Router } from "express";

import { getCollections } from "../db/collections";
import { authenticate, requireAnyPermission } from "../middleware/auth";
import type { PriceEntry, PriceStateName, PriceStatePoint } from "../types";
import { fail, ok } from "../utils/http";
import { generateId } from "../utils/id";

const router: Router = express.Router();

const PRICE_STATES: PriceStateName[] = ["UP", "Bihar", "MP", "Haryana", "Rajasthan", "Punjab"];

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function parsePricePoint(value: unknown): PriceStatePoint {
  const v = (value ?? {}) as Record<string, unknown>;
  return {
    distributor: toNumber(v.distributor),
    dealer: toNumber(v.dealer),
    msp: toNumber(v.msp),
  };
}

function parsePrices(value: unknown): Record<PriceStateName, PriceStatePoint> {
  const v = (value ?? {}) as Record<string, unknown>;
  const result = {} as Record<PriceStateName, PriceStatePoint>;
  for (const state of PRICE_STATES) {
    result[state] = parsePricePoint(v[state]);
  }
  return result;
}

/** Only includes states actually present in `value`, so a partial update doesn't zero out the rest. */
function parsePartialPrices(value: unknown): Partial<Record<PriceStateName, PriceStatePoint>> {
  const v = (value ?? {}) as Record<string, unknown>;
  const result: Partial<Record<PriceStateName, PriceStatePoint>> = {};
  for (const state of PRICE_STATES) {
    if (v[state] !== undefined) {
      result[state] = parsePricePoint(v[state]);
    }
  }
  return result;
}

/** GET /api/price-entries — readable by anyone who manages pricing or generates PIs */
router.get(
  "/",
  authenticate,
  requireAnyPermission("pricing:manage", "sales:entry", "distributors:manage"),
  async (_req: Request, res: Response) => {
    const c = await getCollections();
    const entries = await c.priceEntries.find({}).sort({ srNo: 1, createdAt: 1 }).toArray();
    return ok(res, entries);
  }
);

/** POST /api/price-entries — Admin only */
router.post("/", authenticate, requireAnyPermission("pricing:manage"), async (req: Request, res: Response) => {
  const { description, modelNo, modelKey, srNo, prices } = req.body;
  if (!description || !modelNo || !modelKey) {
    return fail(res, "description, modelNo and modelKey are required");
  }

  const c = await getCollections();
  const normalizedKey = String(modelKey).trim();
  const exists = await c.priceEntries.findOne({ modelKey: normalizedKey }, { projection: { id: 1 } });
  if (exists) return fail(res, "A price entry with this model key already exists");

  const now = new Date();
  const entry: PriceEntry = {
    id: generateId(),
    srNo: srNo !== undefined && srNo !== null && srNo !== "" ? Number(srNo) : undefined,
    description: String(description).trim(),
    modelNo: String(modelNo).trim(),
    modelKey: normalizedKey,
    prices: parsePrices(prices),
    createdAt: now,
    updatedAt: now,
  };
  await c.priceEntries.insertOne(entry);
  return ok(res, entry, 201);
});

/** PUT /api/price-entries/:id — Admin only */
router.put("/:id", authenticate, requireAnyPermission("pricing:manage"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const id = req.params.id;
  const existing = await c.priceEntries.findOne({ id });
  if (!existing) return fail(res, "Price entry not found", 404);

  const update: Partial<PriceEntry> = { updatedAt: new Date() };
  if (req.body.description !== undefined) update.description = String(req.body.description).trim();
  if (req.body.modelNo !== undefined) update.modelNo = String(req.body.modelNo).trim();
  if (req.body.srNo !== undefined) update.srNo = req.body.srNo !== "" && req.body.srNo !== null ? Number(req.body.srNo) : undefined;
  if (req.body.prices !== undefined) {
    update.prices = { ...existing.prices, ...parsePartialPrices(req.body.prices) } as Record<PriceStateName, PriceStatePoint>;
  }

  await c.priceEntries.updateOne({ id }, { $set: update });
  const updated = { ...existing, ...update };
  return ok(res, updated);
});

/** DELETE /api/price-entries/:id — Admin only */
router.delete("/:id", authenticate, requireAnyPermission("pricing:manage"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const result = await c.priceEntries.deleteOne({ id: req.params.id });
  if (!result.deletedCount) return fail(res, "Price entry not found", 404);
  return ok(res, { message: "Price entry deleted" });
});

export default router;
