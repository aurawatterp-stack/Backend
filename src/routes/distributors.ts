import express, { type Request, type Response, type Router } from "express";

import { getCollections } from "../db/collections";
import { authenticate, requireAnyPermission } from "../middleware/auth";
import type { Distributor } from "../types";
import { fail, ok } from "../utils/http";
import { generateId } from "../utils/id";

const router: Router = express.Router();

/** GET /api/distributors */
router.get("/", authenticate, requireAnyPermission("distributors:manage"), async (req: Request, res: Response) => {
  const { q = "" } = req.query as Record<string, string>;
  const c = await getCollections();
  const filter: Record<string, unknown> = {};
  if (q) filter.name = { $regex: q, $options: "i" };
  const results = await c.distributors.find(filter).toArray();
  return ok(res, results);
});

/** GET /api/distributors/:id */
router.get("/:id", authenticate, requireAnyPermission("distributors:manage"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const dist = await c.distributors.findOne({ id: req.params.id });
  if (!dist) return fail(res, "Distributor not found", 404);
  return ok(res, dist);
});

/** POST /api/distributors */
router.post("/", authenticate, requireAnyPermission("distributors:manage"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const { name, email, mobile, address } = req.body;
  if (!name || !email || !mobile || !address) {
    return fail(res, "name, email, mobile, address are required");
  }
  const distributor: Distributor = {
    id: generateId(),
    name,
    email: String(email).trim().toLowerCase(),
    mobile,
    address,
    unitsSold: 0,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await c.distributors.insertOne(distributor);
  return ok(res, distributor, 201);
});

/** PUT /api/distributors/:id */
router.put("/:id", authenticate, requireAnyPermission("distributors:manage"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const id = req.params.id;
  const existing = await c.distributors.findOne({ id });
  if (!existing) return fail(res, "Distributor not found", 404);
  const updatedAt = new Date();
  await c.distributors.updateOne({ id }, { $set: { ...req.body, updatedAt } });
  return ok(res, { ...existing, ...req.body, updatedAt });
});

/** DELETE /api/distributors/:id */
router.delete("/:id", authenticate, requireAnyPermission("distributors:manage"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const result = await c.distributors.deleteOne({ id: req.params.id });
  if (!result.deletedCount) return fail(res, "Distributor not found", 404);
  return ok(res, { message: "Distributor deleted" });
});

export default router;
