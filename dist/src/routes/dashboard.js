"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const collections_1 = require("../db/collections");
const auth_1 = require("../middleware/auth");
const http_1 = require("../utils/http");
const http_2 = require("../utils/http");
const router = express_1.default.Router();
const ENGINEER_ROLES = new Set(["L1 Engineer", "L2 Technical Team", "L3 Advanced OEM Support"]);
function normalizeText(value) {
    return String(value ?? "").trim().toLowerCase();
}
function complaintAssignedToEngineer(complaint, user) {
    const userName = normalizeText(user.name);
    return (complaint.assignedEngineerId === user.userId ||
        (userName && normalizeText(complaint.assignedEngineerName) === userName) ||
        complaint.siteVisitEngineerId === user.userId ||
        (userName && normalizeText(complaint.siteVisitEngineerName) === userName));
}
function isClosedStatus(status) {
    return status === "Resolved by Aurawatt" || status === "Resolved by Suppliers";
}
function startOfDay(date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
function addDays(date, days) {
    return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}
function formatDayLabel(date) {
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
function formatMonthLabel(date) {
    return date.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}
function buildTrendSeries(rows, buckets) {
    const created = buckets.map((bucket) => rows.filter((complaint) => {
        const createdAt = new Date(complaint.createdAt);
        return createdAt >= bucket.start && createdAt < bucket.end;
    }).length);
    const completed = buckets.map((bucket) => rows.filter((complaint) => {
        const closedAt = complaint.closedAt ?? complaint.updatedAt;
        if (!isClosedStatus(complaint.status) || !closedAt)
            return false;
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
router.get("/stats", auth_1.authenticate, (0, auth_1.requireAnyPermission)("dashboard:view"), async (_req, res) => {
    const c = await (0, collections_1.getCollections)();
    const rawAgg = await c.rawMaterials
        .aggregate([{ $group: { _id: null, total: { $sum: "$quantityAvailable" } } }])
        .toArray();
    const totalRawMaterialQty = rawAgg[0]?.total ?? 0;
    const totalManufactured = await c.manufactured.countDocuments({});
    const inStock = await c.manufactured.countDocuments({ status: "In Stock" });
    const totalSold = await c.manufactured.countDocuments({ status: "Sold" });
    const activeDistributors = await c.customers.countDocuments({ type: "Distributor", status: "Active" });
    const totalCustomers = await c.customers.countDocuments({});
    const totalComplaints = await c.complaints.countDocuments({});
    const openComplaints = await c.complaints.countDocuments({ status: "Open at Aurawatt" });
    return (0, http_2.ok)(res, {
        rawMaterials: { totalAvailable: totalRawMaterialQty },
        manufactured: { total: totalManufactured, inStock, sold: totalSold },
        distributors: { total: activeDistributors },
        customers: { total: totalCustomers },
        complaints: { total: totalComplaints, open: openComplaints },
    });
});
/** GET /api/dashboard/engineer */
router.get("/engineer", auth_1.authenticate, (0, auth_1.requireAnyPermission)("dashboard:view", "complaints:consumer"), async (req, res) => {
    const user = req.user;
    if (!ENGINEER_ROLES.has(user.role)) {
        return (0, http_1.fail)(res, "Access denied: engineer dashboard only", 403);
    }
    const c = await (0, collections_1.getCollections)();
    const all = await c.complaints.find({ type: "Consumer" }).toArray();
    const own = all.filter((complaint) => complaintAssignedToEngineer(complaint, user));
    const now = new Date();
    const runningTickets = own.filter((complaint) => !isClosedStatus(complaint.status));
    const closedTickets = own.filter((complaint) => isClosedStatus(complaint.status));
    const onsiteTickets = own.filter((complaint) => complaint.status === "Assigned for Onsite" || complaint.siteVisitRequired === true);
    const delayedTickets = runningTickets.filter((complaint) => complaint.slaDueAt && new Date(complaint.slaDueAt).getTime() < now.getTime());
    const approachingTickets = runningTickets.filter((complaint) => {
        if (!complaint.slaDueAt)
            return false;
        const diff = new Date(complaint.slaDueAt).getTime() - now.getTime();
        return diff >= 0 && diff <= 4 * 60 * 60 * 1000;
    });
    const sortedByRecent = (rows) => [...rows].sort((a, b) => new Date(b.updatedAt ?? b.createdAt).getTime() - new Date(a.updatedAt ?? a.createdAt).getTime());
    const weeklyBuckets = buildWeeklyBuckets(now);
    const monthlyBuckets = buildMonthlyBuckets(now);
    const yearlyBuckets = buildYearlyBuckets(now);
    return (0, http_2.ok)(res, {
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
router.get("/timeline", auth_1.authenticate, (0, auth_1.requireAnyPermission)("dashboard:view"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const monthsParam = req.query.months ?? "6";
    const months = Math.min(24, Math.max(1, parseInt(monthsParam)));
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1, 0, 0, 0));
    const monthKeys = [];
    for (let i = 0; i < months; i++) {
        const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
        const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
        monthKeys.push(key);
    }
    const fmt = (key) => {
        const [y, m] = key.split("-").map(Number);
        const date = new Date(Date.UTC(y, m - 1, 1));
        const month = date.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
        const yy = String(y).slice(-2);
        return `${month} '${yy}`;
    };
    const labels = monthKeys.map(fmt);
    const [rawAgg, mfgAgg, salesAgg] = await Promise.all([
        c.rawMaterials
            .aggregate([
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
            .aggregate([
            { $match: { mfgDate: { $gte: start } } },
            { $group: { _id: { y: { $year: "$mfgDate" }, m: { $month: "$mfgDate" } }, value: { $sum: 1 } } },
            { $project: { _id: 0, key: { $concat: [{ $toString: "$_id.y" }, "-", { $toString: "$_id.m" }] }, value: 1 } },
        ])
            .toArray(),
        c.sales
            .aggregate([
            { $match: { saleDate: { $gte: start } } },
            { $group: { _id: { y: { $year: "$saleDate" }, m: { $month: "$saleDate" } }, value: { $sum: 1 } } },
            { $project: { _id: 0, key: { $concat: [{ $toString: "$_id.y" }, "-", { $toString: "$_id.m" }] }, value: 1 } },
        ])
            .toArray(),
    ]);
    const normalize = (arr) => {
        const map = new Map();
        for (const { key, value } of arr) {
            const [y, m] = key.split("-").map(Number);
            const normalizedKey = `${y}-${String(m).padStart(2, "0")}`;
            map.set(normalizedKey, value);
        }
        return monthKeys.map((k) => map.get(k) ?? 0);
    };
    return (0, http_2.ok)(res, { months: labels, raw: normalize(rawAgg), manufactured: normalize(mfgAgg), sales: normalize(salesAgg) });
});
exports.default = router;
