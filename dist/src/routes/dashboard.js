"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const collections_1 = require("../db/collections");
const auth_1 = require("../middleware/auth");
const http_1 = require("../utils/http");
const router = express_1.default.Router();
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
    const activeDistributors = await c.distributors.countDocuments({ isActive: true });
    const totalCustomers = await c.customers.countDocuments({});
    const totalComplaints = await c.complaints.countDocuments({});
    const openComplaints = await c.complaints.countDocuments({ status: "Open at Aurawatt" });
    return (0, http_1.ok)(res, {
        rawMaterials: { totalAvailable: totalRawMaterialQty },
        manufactured: { total: totalManufactured, inStock, sold: totalSold },
        distributors: { total: activeDistributors },
        customers: { total: totalCustomers },
        complaints: { total: totalComplaints, open: openComplaints },
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
    return (0, http_1.ok)(res, { months: labels, raw: normalize(rawAgg), manufactured: normalize(mfgAgg), sales: normalize(salesAgg) });
});
exports.default = router;
