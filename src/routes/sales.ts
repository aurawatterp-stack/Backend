import express, { type Request, type Response, type Router } from "express";

import { getCollections } from "../db/collections";
import { authenticate, authorize } from "../middleware/auth";
import type { JwtPayload, Sale } from "../types";
import { fail, ok } from "../utils/http";
import { generateId } from "../utils/id";

const router: Router = express.Router();

/** GET /api/sales */
router.get("/", authenticate, async (req: Request, res: Response) => {
  const c = await getCollections();
  const { page = "1", limit = "20" } = req.query as Record<string, string>;
  const p = Math.max(1, parseInt(page));
  const l = Math.min(100, parseInt(limit));
  const total = await c.sales.countDocuments({});
  const data = await c.sales
    .find({})
    .sort({ saleDate: -1 })
    .skip((p - 1) * l)
    .limit(l)
    .toArray();
  return ok(res, { data, total, page: p, limit: l });
});

/**
 * POST /api/sales
 * Records a sale. Marks the manufactured product as Sold.
 * Body: { serialNumber, documentType, referenceNo, saleDate, customerId }
 */
router.post("/", authenticate, authorize("Admin", "Sales Manager", "Inventory Manager"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const { serialNumber, documentType, referenceNo, saleDate, customerId } = req.body;
  if (!serialNumber || !documentType || !referenceNo || !saleDate || !customerId) {
    return fail(res, "serialNumber, documentType, referenceNo, saleDate, customerId are required");
  }

  const mfg = await c.manufactured.findOne({ serialNumber });
  if (!mfg) return fail(res, "Serial number not found in manufactured products");
  if (mfg.status === "Sold") return fail(res, "This product is already sold");

  const customer = await c.customers.findOne({ id: customerId }, { projection: { id: 1 } });
  if (!customer) return fail(res, "Customer not found", 404);

  const user = (req as any).user as JwtPayload;

  const updatedAt = new Date();
  await c.manufactured.updateOne(
    { id: mfg.id },
    {
      $set: {
        status: "Sold",
        invoiceNo: referenceNo,
        customerId,
        soldDate: new Date(saleDate),
        paymentStatus: "Pending",
        updatedAt,
      },
    }
  );

  const sale: Sale = {
    id: generateId(),
    serialNumber,
    documentType,
    referenceNo,
    saleDate: new Date(saleDate),
    customerId,
    createdBy: user.userId,
    createdAt: new Date(),
  };
  await c.sales.insertOne(sale);

  return ok(res, sale, 201);
});

export default router;
