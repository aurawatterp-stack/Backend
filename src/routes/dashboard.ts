import express, { type Request, type Response, type Router } from "express";

import { getCollections } from "../db/collections";
import { authenticate, requireAnyPermission } from "../middleware/auth";
import type { AuthUser, Complaint } from "../types";
import { fail } from "../utils/http";
import { ok } from "../utils/http";

const router: Router = express.Router();

const ENGINEER_ROLES = new Set(["L1 Engineer", "L2 Technical Team", "L3 Advanced OEM Support"]);

function normalizeText(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function complaintAssignedToEngineer(complaint: Complaint, user: AuthUser) {
  const userName = normalizeText(user.name);
  return (
    complaint.assignedEngineerId === user.userId ||
    (userName && normalizeText(complaint.assignedEngineerName) === userName) ||
    complaint.siteVisitEngineerId === user.userId ||
    (userName && normalizeText(complaint.siteVisitEngineerName) === userName) ||
    (userName && normalizeText(complaint.engineerName) === userName) ||
    complaint.replacementEngineerId === user.userId ||
    (userName && normalizeText(complaint.replacementEngineerName) === userName)
  );
}

function isClosedStatus(status?: string) {
  return status === "Resolved by Aurawatt" || status === "Resolved by Suppliers";
}

function startOfDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function formatDayLabel(date: Date) {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function formatMonthLabel(date: Date) {
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

function buildTrendSeries(rows: Complaint[], buckets: Array<{ key: string; label: string; start: Date; end: Date }>) {
  const created = buckets.map((bucket) => rows.filter((complaint) => {
    const createdAt = new Date(complaint.createdAt);
    return createdAt >= bucket.start && createdAt < bucket.end;
  }).length);
  const completed = buckets.map((bucket) => rows.filter((complaint) => {
    const closedAt = complaint.closedAt ?? complaint.updatedAt;
    if (!isClosedStatus(complaint.status) || !closedAt) return false;
    const date = new Date(closedAt);
    return date >= bucket.start && date < bucket.end;
  }).length);
  return { labels: buckets.map((bucket) => bucket.label), created, completed };
}

function buildWeeklyBuckets(now = new Date()) {
  const end = startOfDay(addDays(now, 1));
  return Array.from({ length: 7 }, (_, index) => {
    const start = addDays(end, -(7 - index));
    return {
      key: start.toISOString(),
      label: formatDayLabel(start),
      start,
      end: addDays(start, 1),
    };
  });
}

function buildMonthlyBuckets(now = new Date()) {
  const end = startOfDay(addDays(now, 1));
  return Array.from({ length: 30 }, (_, index) => {
    const start = addDays(end, -(30 - index));
    return {
      key: start.toISOString(),
      label: formatDayLabel(start),
      start,
      end: addDays(start, 1),
    };
  });
}

function buildYearlyBuckets(now = new Date()) {
  const buckets = Array.from({ length: 12 }, (_, index) => {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (11 - index), 1));
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    return {
      key: `${start.getUTCFullYear()}-${start.getUTCMonth()}`,
      label: formatMonthLabel(start),
      start,
      end,
    };
  });
  return buckets;
}

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

/** GET /api/dashboard/engineer */
router.get("/engineer", authenticate, requireAnyPermission("dashboard:view", "complaints:consumer"), async (req: Request, res: Response) => {
  const user = (req as any).user as AuthUser;
  if (!ENGINEER_ROLES.has(user.role)) {
    return fail(res, "Access denied: engineer dashboard only", 403);
  }

  const c = await getCollections();
  const all = await c.complaints.find({ type: "Consumer" }).toArray();
  const own = all.filter((complaint) => complaintAssignedToEngineer(complaint, user));
  const now = new Date();
  const runningTickets = own.filter((complaint) => !isClosedStatus(complaint.status));
  const closedTickets = own.filter((complaint) => isClosedStatus(complaint.status));
  const onsiteTickets = own.filter((complaint) => complaint.status === "Assigned for Onsite" || complaint.siteVisitRequired === true);
  const delayedTickets = runningTickets.filter((complaint) => complaint.slaDueAt && new Date(complaint.slaDueAt).getTime() < now.getTime());
  const approachingTickets = runningTickets.filter((complaint) => {
    if (!complaint.slaDueAt) return false;
    const diff = new Date(complaint.slaDueAt).getTime() - now.getTime();
    return diff >= 0 && diff <= 4 * 60 * 60 * 1000;
  });

  const sortedByRecent = (rows: Complaint[]) => [...rows].sort((a, b) => new Date(b.updatedAt ?? b.createdAt).getTime() - new Date(a.updatedAt ?? a.createdAt).getTime());
  const weeklyBuckets = buildWeeklyBuckets(now);
  const monthlyBuckets = buildMonthlyBuckets(now);
  const yearlyBuckets = buildYearlyBuckets(now);

  return ok(res, {
    counts: {
      runningTickets: runningTickets.length,
      closedTickets: closedTickets.length,
      slaMonitoring: approachingTickets.length + delayedTickets.length,
      onsiteTickets: onsiteTickets.length,
    },
    runningTickets: sortedByRecent(runningTickets).slice(0, 50),
    closedTickets: sortedByRecent(closedTickets).slice(0, 50),
    onsiteTickets: sortedByRecent(onsiteTickets).slice(0, 50),
    slaMonitoring: {
      approaching: sortedByRecent(approachingTickets),
      delayed: sortedByRecent(delayedTickets),
    },
    trends: {
      weekly: buildTrendSeries(own, weeklyBuckets),
      monthly: buildTrendSeries(own, monthlyBuckets),
      yearly: buildTrendSeries(own, yearlyBuckets),
    },
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
