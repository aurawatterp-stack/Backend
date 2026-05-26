"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const collections_1 = require("../db/collections");
const auth_1 = require("../middleware/auth");
const http_1 = require("../utils/http");
const id_1 = require("../utils/id");
const router = express_1.default.Router();
function requireComplaintTypeAccess(user, type) {
    const t = (type || "").trim().toLowerCase();
    if (user.role === "Admin")
        return true;
    if (t === "consumer")
        return user.permissions.includes("complaints:consumer");
    if (t === "supplier")
        return user.permissions.includes("complaints:supplier");
    return user.permissions.includes("complaints:consumer") || user.permissions.includes("complaints:supplier");
}
/** GET /api/complaints — filter by type, status */
router.get("/", auth_1.authenticate, (0, auth_1.requireAnyPermission)("complaints:consumer", "complaints:supplier"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const { type, status, page = "1", limit = "20" } = req.query;
    const user = req.user;
    if (type && !requireComplaintTypeAccess(user, type)) {
        return (0, http_1.fail)(res, "Access denied: insufficient permissions", 403);
    }
    const filter = {};
    if (type)
        filter.type = type;
    if (status)
        filter.status = status;
    const p = Math.max(1, parseInt(page));
    const l = Math.min(100, parseInt(limit));
    const total = await c.complaints.countDocuments(filter);
    const data = await c.complaints.find(filter).skip((p - 1) * l).limit(l).toArray();
    return (0, http_1.ok)(res, { data, total, page: p, limit: l });
});
/** GET /api/complaints/stats — for donut chart */
router.get("/stats", auth_1.authenticate, (0, auth_1.requireAnyPermission)("complaints:consumer", "complaints:supplier"), async (_req, res) => {
    const c = await (0, collections_1.getCollections)();
    const statuses = [
        "Open at Aurawatt",
        "In Progress at Aurawatt",
        "Resolved by Aurawatt",
        "Pending with Suppliers",
        "Resolved by Suppliers",
    ];
    const stats = await Promise.all(statuses.map(async (s) => ({ status: s, count: await c.complaints.countDocuments({ status: s }) })));
    return (0, http_1.ok)(res, stats);
});
/** POST /api/complaints — raise a consumer or supplier complaint */
router.post("/", auth_1.authenticate, (0, auth_1.requireAnyPermission)("complaints:consumer", "complaints:supplier"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const { type, productSerialNo, rawMaterialId, rawMaterialName, vendorName, dateOfSale, dateOfComplaint, issueDescription } = req.body;
    if (!type || !dateOfComplaint || !issueDescription) {
        return (0, http_1.fail)(res, "type, dateOfComplaint, issueDescription are required");
    }
    const user = req.user;
    if (!requireComplaintTypeAccess(user, String(type))) {
        return (0, http_1.fail)(res, "Access denied: insufficient permissions", 403);
    }
    const complaint = {
        id: (0, id_1.generateId)(),
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
    return (0, http_1.ok)(res, complaint, 201);
});
/** PUT /api/complaints/:id/status — update complaint status */
router.put("/:id/status", auth_1.authenticate, (0, auth_1.requireAnyPermission)("complaints:consumer", "complaints:supplier"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const id = req.params.id;
    const existing = await c.complaints.findOne({ id });
    if (!existing)
        return (0, http_1.fail)(res, "Complaint not found", 404);
    const user = req.user;
    if (!requireComplaintTypeAccess(user, String(existing.type))) {
        return (0, http_1.fail)(res, "Access denied: insufficient permissions", 403);
    }
    const { status } = req.body;
    if (!status)
        return (0, http_1.fail)(res, "status is required");
    const updatedAt = new Date();
    await c.complaints.updateOne({ id }, { $set: { status, updatedAt } });
    return (0, http_1.ok)(res, { ...existing, status, updatedAt });
});
exports.default = router;
