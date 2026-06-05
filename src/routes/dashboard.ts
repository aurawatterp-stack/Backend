import express, { type Request, type Response, type Router } from "express";

import { getCollections } from "../db/collections";
import { authenticate, requireAnyPermission } from "../middleware/auth";
import { ok } from "../utils/http";

const router: Router = express.Router();

/** GET /api/dashboard/stats */
router.get("/stats", authenticate, requireAnyPermission("dashboard:view"), async (_req: Request, res: Response) => {
  const c = await getCollections();

  const rawAgg = await c.rawMaterials
    .aggregate<{ total: number }>([{ $group: { _id: null, total: { $sum: "$quantityAvailable" } } }])
    .toArray();
  const totalRawMaterialQty = rawAgg[0]?.total ?? 0;

  const totalManufactured = await c.manufactured.countDocuments({});
  const inStock = await c.manufactured.countDocuments({ status: "In Stock" });
  const totalSold = await c.manufactured.countDocuments({ status: "Sold" });

  const activeDistributors = await c.customers.countDocuments({ type: "Distributor", status: "Active" });
  const totalCustomers = await c.customers.countDocuments({});

  const totalComplaints = await c.complaints.countDocuments({});
  const openComplaints = await c.complaints.countDocuments({ status: "Open at Aurawatt" });

  return ok(res, {
    rawMaterials: { totalAvailable: totalRawMaterialQty },
    manufactured: { total: totalManufactured, inStock, sold: totalSold },
    distributors: { total: activeDistributors },
    customers: { total: totalCustomers },
    complaints: { total: totalComplaints, open: openComplaints },
  });
});

/** GET /api/dashboard/timeline?months=6 */
router.get("/timeline", authenticate, requireAnyPermission("dashboard:view"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const monthsParam = (req.query.months as string | undefined) ?? "6";
  const months = Math.min(24, Math.max(1, parseInt(monthsParam)));

  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1, 0, 0, 0));

  const monthKeys: string[] = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    monthKeys.push(key);
  }

  const fmt = (key: string) => {
    const [y, m] = key.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, 1));
    const month = date.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
    const yy = String(y).slice(-2);
    return `${month} '${yy}`;
  };

  const labels = monthKeys.map(fmt);

  const [rawAgg, mfgAgg, salesAgg] = await Promise.all([
    c.rawMaterials
      .aggregate<{ key: string; value: number }>([
        { $match: { dateReceived: { $gte: start } } },
        {
          $group: {
            _id: { y: { $year: "$dateReceived" }, m: { $month: "$dateReceived" } },
            value: { $sum: "$quantityReceived" },
          },
        },
        { $project: { _id: 0, key: { $concat: [{ $toString: "$_id.y" }, "-", { $toString: "$_id.m" }] }, value: 1 } },
      ])
      .toArray(),
    c.manufactured
      .aggregate<{ key: string; value: number }>([
        { $match: { mfgDate: { $gte: start } } },
        { $group: { _id: { y: { $year: "$mfgDate" }, m: { $month: "$mfgDate" } }, value: { $sum: 1 } } },
        { $project: { _id: 0, key: { $concat: [{ $toString: "$_id.y" }, "-", { $toString: "$_id.m" }] }, value: 1 } },
      ])
      .toArray(),
    c.sales
      .aggregate<{ key: string; value: number }>([
        { $match: { saleDate: { $gte: start } } },
        { $group: { _id: { y: { $year: "$saleDate" }, m: { $month: "$saleDate" } }, value: { $sum: 1 } } },
        { $project: { _id: 0, key: { $concat: [{ $toString: "$_id.y" }, "-", { $toString: "$_id.m" }] }, value: 1 } },
      ])
      .toArray(),
  ]);

  const normalize = (arr: Array<{ key: string; value: number }>) => {
    const map = new Map<string, number>();
    for (const { key, value } of arr) {
      const [y, m] = key.split("-").map(Number);
      const normalizedKey = `${y}-${String(m).padStart(2, "0")}`;
      map.set(normalizedKey, value);
    }
    return monthKeys.map((k) => map.get(k) ?? 0);
  };

  return ok(res, { months: labels, raw: normalize(rawAgg), manufactured: normalize(mfgAgg), sales: normalize(salesAgg) });
});

export default router;
