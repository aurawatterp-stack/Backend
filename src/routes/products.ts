import express, { type Request, type Response, type Router } from "express";

import { getCollections } from "../db/collections";
import { authenticate, requireAnyPermission } from "../middleware/auth";
import type { Product } from "../types";
import { fail, ok } from "../utils/http";
import { generateId } from "../utils/id";

const router: Router = express.Router();

/** GET /api/products */
router.get("/", authenticate, requireAnyPermission("inventory:products", "sales:entry", "complaints:consumer"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const { q = "", series } = req.query as Record<string, string>;
  const filter: Record<string, unknown> = {};
  if (series) filter.series = series;
  if (q) {
    filter.$or = [{ model: { $regex: q, $options: "i" } }, { series: { $regex: q, $options: "i" } }];
  }
  const results = await c.products.find(filter).toArray();
  return ok(res, results);
});

/** GET /api/products/series — unique series list */
router.get("/series", authenticate, requireAnyPermission("inventory:products"), async (_req: Request, res: Response) => {
  const c = await getCollections();
  const series = await c.products.distinct("series");
  return ok(res, series);
});

/** POST /api/products */
router.post("/", authenticate, requireAnyPermission("inventory:products"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const { series, model, description } = req.body;
  if (!series || !model) return fail(res, "series and model are required");

  const exists = await c.products.findOne({ model }, { projection: { id: 1 } });
  if (exists) return fail(res, "A product with this model already exists");

  const product: Product = { id: generateId(), series, model, description, createdAt: new Date() };
  await c.products.insertOne(product);
  return ok(res, product, 201);
});

/** PUT /api/products/:id */
router.put("/:id", authenticate, requireAnyPermission("inventory:products"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const id = req.params.id;
  const existing = await c.products.findOne({ id });
  if (!existing) return fail(res, "Product not found", 404);
  await c.products.updateOne({ id }, { $set: { ...req.body } });
  const updated = { ...existing, ...req.body };
  return ok(res, updated);
});

/** DELETE /api/products/:id */
router.delete("/:id", authenticate, requireAnyPermission("inventory:products"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const result = await c.products.deleteOne({ id: req.params.id });
  if (!result.deletedCount) return fail(res, "Product not found", 404);
  return ok(res, { message: "Product deleted" });
});

export default router;
