import express, { type Request, type Response, type Router } from "express";

import { getCollections } from "../db/collections";
import { authenticate, authorize } from "../middleware/auth";
import type { ManufacturedProduct } from "../types";
import { fail, ok } from "../utils/http";
import { generateId } from "../utils/id";

const router: Router = express.Router();

/** GET /api/manufactured — filter by status, model, dateFrom, dateTo, customer */
router.get("/", authenticate, async (req: Request, res: Response) => {
  const c = await getCollections();
  const { q = "", status, model, page = "1", limit = "20" } = req.query as Record<string, string>;
  const filter: Record<string, unknown> = {};
  if (status) filter.status = status;
  if (model) filter.productId = model;
  if (q) {
    filter.$or = [{ serialNumber: { $regex: q, $options: "i" } }, { productId: { $regex: q, $options: "i" } }];
  }

  const p = Math.max(1, parseInt(page));
  const l = Math.min(100, parseInt(limit));
  const total = await c.manufactured.countDocuments(filter);
  const data = await c.manufactured.find(filter).skip((p - 1) * l).limit(l).toArray();
  return ok(res, { data, total, page: p, limit: l });
});

/** POST /api/manufactured — record new production */
router.post("/", authenticate, authorize("Admin", "Inventory Manager"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const { productId, serialNumber, mfgDate, status, invoiceNo, paymentStatus } = req.body;
  if (!productId || !serialNumber || !mfgDate) {
    return fail(res, "productId, serialNumber, mfgDate are required");
  }

  const duplicate = await c.manufactured.findOne({ serialNumber }, { projection: { id: 1 } });
  if (duplicate) return fail(res, "This serial number already exists");

  const normalizedStatus =
    status === "Sold" || status === "Returned" || status === "In Stock" ? status : "In Stock";
  const normalizedPayment =
    paymentStatus === "Pending" || paymentStatus === "Verified" || paymentStatus === "N/A"
      ? paymentStatus
      : "N/A";

  const entry: ManufacturedProduct = {
    id: generateId(),
    productId,
    serialNumber,
    mfgDate: new Date(mfgDate),
    status: normalizedStatus,
    invoiceNo: invoiceNo ? String(invoiceNo) : undefined,
    paymentStatus: normalizedPayment,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await c.manufactured.insertOne(entry);
  return ok(res, entry, 201);
});

/** PUT /api/manufactured/:id */
router.put("/:id", authenticate, authorize("Admin", "Inventory Manager", "Sales Manager"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const id = req.params.id;
  const existing = await c.manufactured.findOne({ id });
  if (!existing) return fail(res, "Record not found", 404);
  const updatedAt = new Date();
  await c.manufactured.updateOne({ id }, { $set: { ...req.body, updatedAt } });
  return ok(res, { ...existing, ...req.body, updatedAt });
});

/** POST /api/manufactured/:id/return — mark product as returned */
router.post("/:id/return", authenticate, authorize("Admin", "Inventory Manager"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const id = req.params.id;
  const existing = await c.manufactured.findOne({ id });
  if (!existing) return fail(res, "Record not found", 404);
  const { returnReason } = req.body;
  const updatedAt = new Date();
  await c.manufactured.updateOne(
    { id },
    { $set: { status: "Returned", returnReason: returnReason || "", updatedAt } }
  );
  return ok(res, { ...existing, status: "Returned", returnReason: returnReason || "", updatedAt });
});

export default router;
