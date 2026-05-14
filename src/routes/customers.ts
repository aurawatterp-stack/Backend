import express, { type Request, type Response, type Router } from "express";

import { getCollections } from "../db/collections";
import { authenticate, authorize } from "../middleware/auth";
import type { Customer } from "../types";
import { fail, ok } from "../utils/http";
import { generateId } from "../utils/id";

const router: Router = express.Router();

/** GET /api/customers — paginated, filterable by name/type */
router.get("/", authenticate, async (req: Request, res: Response) => {
  const c = await getCollections();
  const { q = "", type, page = "1", limit = "20" } = req.query as Record<string, string>;
  const filter: Record<string, unknown> = {};
  if (q) filter.name = { $regex: q, $options: "i" };
  if (type) filter.type = type;

  const total = await c.customers.countDocuments(filter);
  const p = Math.max(1, parseInt(page));
  const l = Math.min(100, parseInt(limit));
  const data = await c.customers.find(filter).skip((p - 1) * l).limit(l).toArray();

  return ok(res, { data, total, page: p, limit: l });
});

/** GET /api/customers/:id */
router.get("/:id", authenticate, async (req: Request, res: Response) => {
  const c = await getCollections();
  const customer = await c.customers.findOne({ id: req.params.id });
  if (!customer) return fail(res, "Customer not found", 404);
  return ok(res, customer);
});

/** POST /api/customers */
router.post("/", authenticate, authorize("Admin", "Sales Manager"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const { name, type, email, phone, address } = req.body;
  if (!name || !type || !email || !phone) {
    return fail(res, "name, type, email, phone are required");
  }
  const newCustomer: Customer = {
    id: generateId(),
    name,
    type,
    email,
    phone,
    address,
    status: "Active",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await c.customers.insertOne(newCustomer);
  return ok(res, newCustomer, 201);
});

/** PUT /api/customers/:id */
router.put("/:id", authenticate, authorize("Admin", "Sales Manager"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const id = req.params.id;
  const existing = await c.customers.findOne({ id });
  if (!existing) return fail(res, "Customer not found", 404);
  const updatedAt = new Date();
  await c.customers.updateOne({ id }, { $set: { ...req.body, updatedAt } });
  const updated = { ...existing, ...req.body, updatedAt };
  return ok(res, updated);
});

/** DELETE /api/customers/:id */
router.delete("/:id", authenticate, authorize("Admin"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const result = await c.customers.deleteOne({ id: req.params.id });
  if (!result.deletedCount) return fail(res, "Customer not found", 404);
  return ok(res, { message: "Customer deleted" });
});

export default router;
