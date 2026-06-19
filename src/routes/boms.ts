import express, { type Request, type Response, type Router } from "express";

import { getCollections } from "../db/collections";
import { authenticate, requireAnyPermission } from "../middleware/auth";
import type { SeriesBOM } from "../types";
import { fail, ok } from "../utils/http";
import { generateId } from "../utils/id";

const router: Router = express.Router();

/** GET /api/boms — list all boms or filter by series */
router.get("/", authenticate, requireAnyPermission("inventory:manufactured", "inventory:raw-materials", "dashboard:view"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const series = req.query.series as string | undefined;
  const filter = series ? { series } : {};
  const boms = await c.boms.find(filter).toArray();
  return ok(res, boms);
});

/** POST /api/boms — create a new BOM */
router.post("/", authenticate, requireAnyPermission("inventory:manufactured"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const { series, items } = req.body;
  if (!series) return fail(res, "Series is required");
  
  const existing = await c.boms.findOne({ series });
  if (existing) return fail(res, `BOM for series ${series} already exists`);
  
  const now = new Date();
  const bom: SeriesBOM = {
    id: generateId(),
    series,
    items: Array.isArray(items) ? items : [],
    createdAt: now,
    updatedAt: now,
  };
  await c.boms.insertOne(bom);
  return ok(res, bom, 201);
});

/** PUT /api/boms/:id — update a BOM */
router.put("/:id", authenticate, requireAnyPermission("inventory:manufactured"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const id = req.params.id;
  const existing = await c.boms.findOne({ id });
  if (!existing) return fail(res, "BOM not found", 404);
  
  const { items } = req.body;
  const updatedAt = new Date();
  await c.boms.updateOne({ id }, { $set: { items: Array.isArray(items) ? items : [], updatedAt } });
  
  return ok(res, { ...existing, items: Array.isArray(items) ? items : [], updatedAt });
});

/** DELETE /api/boms/:id — delete a BOM */
router.delete("/:id", authenticate, requireAnyPermission("inventory:manufactured"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const id = req.params.id;
  await c.boms.deleteOne({ id });
  return ok(res, { message: "BOM deleted successfully" });
});

export default router;
