import express, { type Request, type Response, type Router } from "express";

import { getCollections } from "../db/collections";
import { authenticate, authorize } from "../middleware/auth";
import type { Complaint, JwtPayload } from "../types";
import { fail, ok } from "../utils/http";
import { generateId } from "../utils/id";

const router: Router = express.Router();

/** GET /api/complaints — filter by type, status */
router.get("/", authenticate, async (req: Request, res: Response) => {
  const c = await getCollections();
  const { type, status, page = "1", limit = "20" } = req.query as Record<string, string>;
  const filter: Record<string, unknown> = {};
  if (type) filter.type = type;
  if (status) filter.status = status;

  const p = Math.max(1, parseInt(page));
  const l = Math.min(100, parseInt(limit));
  const total = await c.complaints.countDocuments(filter);
  const data = await c.complaints.find(filter).skip((p - 1) * l).limit(l).toArray();
  return ok(res, { data, total, page: p, limit: l });
});

/** GET /api/complaints/stats — for donut chart */
router.get("/stats", authenticate, async (_req: Request, res: Response) => {
  const c = await getCollections();
  const statuses: Complaint["status"][] = [
    "Open at Aurawatt",
    "In Progress at Aurawatt",
    "Resolved by Aurawatt",
    "Pending with Suppliers",
    "Resolved by Suppliers",
  ];
  const stats = await Promise.all(
    statuses.map(async (s) => ({ status: s, count: await c.complaints.countDocuments({ status: s }) }))
  );
  return ok(res, stats);
});

/** POST /api/complaints — raise a consumer or supplier complaint */
router.post("/", authenticate, async (req: Request, res: Response) => {
  const c = await getCollections();
  const { type, productSerialNo, rawMaterialId, rawMaterialName, vendorName, dateOfSale, dateOfComplaint, issueDescription } = req.body;

  if (!type || !dateOfComplaint || !issueDescription) {
    return fail(res, "type, dateOfComplaint, issueDescription are required");
  }

  const user = (req as any).user as JwtPayload;

  const complaint: Complaint = {
    id: generateId(),
    type,
    productSerialNo,
    rawMaterialId,
    rawMaterialName,
    vendorName,
    dateOfSale: dateOfSale ? new Date(dateOfSale) : undefined,
    dateOfComplaint: new Date(dateOfComplaint),
    issueDescription,
    status: "Open at Aurawatt",
    raisedBy: user.userId,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await c.complaints.insertOne(complaint);
  return ok(res, complaint, 201);
});

/** PUT /api/complaints/:id/status — update complaint status */
router.put("/:id/status", authenticate, authorize("Admin", "Inventory Manager"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const id = req.params.id;
  const existing = await c.complaints.findOne({ id });
  if (!existing) return fail(res, "Complaint not found", 404);
  const { status } = req.body;
  if (!status) return fail(res, "status is required");
  const updatedAt = new Date();
  await c.complaints.updateOne({ id }, { $set: { status, updatedAt } });
  return ok(res, { ...existing, status, updatedAt });
});

export default router;
