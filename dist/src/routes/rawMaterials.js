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
function normalizeInwardMode(value) {
    const text = String(value ?? "").trim().toLowerCase();
    if (text === "local")
        return "Local";
    if (text === "international" || text === "intl" || text === "import")
        return "International";
    return undefined;
}
function parseBatchNumber(batch) {
    const match = String(batch ?? "").trim().match(/^BATCH-(\d+)$/i);
    if (!match)
        return null;
    return Number(match[1]);
}
async function suggestBatchForReceipt(productSeriesId, referenceNo) {
    const c = await (0, collections_1.getCollections)();
    const existingSameReceipt = await c.rawMaterials.findOne({ productSeriesId, referenceNo, batch: { $ne: "" } }, { projection: { batch: 1 } });
    if (existingSameReceipt?.batch)
        return existingSameReceipt.batch;
    const seriesRows = await c.rawMaterials
        .find({ productSeriesId }, { projection: { batch: 1 } })
        .sort({ createdAt: 1 })
        .toArray();
    const highest = seriesRows.reduce((max, row) => Math.max(max, parseBatchNumber(row.batch) ?? 0), 0);
    return `BATCH-${highest + 1}`;
}
/** GET /api/raw-materials - filter by series, batch, vendor, inwardMode */
router.get("/", auth_1.authenticate, (0, auth_1.requireAnyPermission)("inventory:raw-materials", "complaints:supplier"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const { q = "", series, batch, vendor, inwardMode, page = "1", limit = "20" } = req.query;
    const filter = {};
    if (series)
        filter.productSeriesId = series;
    if (batch)
        filter.batch = batch;
    if (inwardMode)
        filter.inwardMode = normalizeInwardMode(inwardMode) ?? inwardMode;
    if (vendor)
        filter.vendorName = { $regex: vendor, $options: "i" };
    if (q) {
        filter.$or = [{ materialName: { $regex: q, $options: "i" } }, { referenceNo: { $regex: q, $options: "i" } }];
    }
    const p = Math.max(1, parseInt(page));
    const l = Math.min(100, parseInt(limit));
    const total = await c.rawMaterials.countDocuments(filter);
    const data = await c.rawMaterials.find(filter).skip((p - 1) * l).limit(l).toArray();
    return (0, http_1.ok)(res, { data, total, page: p, limit: l });
});
/** POST /api/raw-materials */
router.post("/", auth_1.authenticate, (0, auth_1.requireAnyPermission)("inventory:raw-materials"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const { productSeriesId, materialName, dateReceived, billType, referenceNo, quantityReceived, vendorName, batch, inwardMode, notes } = req.body;
    if (!productSeriesId || !materialName || !dateReceived || !billType || !referenceNo || !quantityReceived || !vendorName) {
        return (0, http_1.fail)(res, "All required fields must be provided");
    }
    const normalizedInwardMode = normalizeInwardMode(inwardMode) ?? "International";
    const trimmedBatch = String(batch ?? "").trim();
    const resolvedBatch = trimmedBatch || await suggestBatchForReceipt(String(productSeriesId), String(referenceNo));
    const entry = {
        id: (0, id_1.generateId)(),
        productSeriesId,
        inwardMode: normalizedInwardMode,
        materialName,
        dateReceived: new Date(dateReceived),
        billType,
        referenceNo,
        quantityReceived: Number(quantityReceived),
        quantityAvailable: Number(quantityReceived),
        vendorName,
        batch: resolvedBatch,
        notes,
        createdAt: new Date(),
        updatedAt: new Date(),
    };
    await c.rawMaterials.insertOne(entry);
    try {
        const user = req.user;
        const notification = {
            id: (0, id_1.generateId)(),
            type: "raw_material_received",
            title: "Raw Material Received",
            body: `${materialName} • ${resolvedBatch} • ${normalizedInwardMode}`,
            entityType: "raw_material",
            entityId: entry.id,
            meta: { materialName, batch: resolvedBatch, inwardMode: normalizedInwardMode, referenceNo, productSeriesId },
            audienceRoles: ["Admin", "Inventory"],
            readBy: [],
            createdBy: user.userId,
            createdAt: new Date(),
        };
        await c.notifications.insertOne(notification);
    }
    catch (err) {
        console.warn("Failed to insert notification:", err instanceof Error ? err.message : String(err));
    }
    return (0, http_1.ok)(res, entry, 201);
});
/** PUT /api/raw-materials/:id */
router.put("/:id", auth_1.authenticate, (0, auth_1.requireAnyPermission)("inventory:raw-materials"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const id = req.params.id;
    const existing = await c.rawMaterials.findOne({ id });
    if (!existing)
        return (0, http_1.fail)(res, "Raw material entry not found", 404);
    const updatedAt = new Date();
    const nextInwardMode = normalizeInwardMode(req.body?.inwardMode) ?? existing.inwardMode;
    const nextBatch = String(req.body?.batch ?? existing.batch ?? "").trim() || existing.batch;
    const update = { ...req.body, inwardMode: nextInwardMode, batch: nextBatch, updatedAt };
    await c.rawMaterials.updateOne({ id }, { $set: update });
    return (0, http_1.ok)(res, { ...existing, ...update });
});
/** DELETE /api/raw-materials/:id */
router.delete("/:id", auth_1.authenticate, (0, auth_1.requireAnyPermission)("inventory:raw-materials"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const result = await c.rawMaterials.deleteOne({ id: req.params.id });
    if (!result.deletedCount)
        return (0, http_1.fail)(res, "Raw material entry not found", 404);
    return (0, http_1.ok)(res, { message: "Raw material entry deleted" });
});
/** POST /api/raw-materials/:id/return */
router.post("/:id/return", auth_1.authenticate, (0, auth_1.requireAnyPermission)("inventory:raw-materials"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const id = req.params.id;
    const { returnReason, returnedQuantity, returnStatus, returnedAt } = req.body;
    if (typeof returnedQuantity !== "number" || returnedQuantity <= 0)
        return (0, http_1.fail)(res, "Invalid returned quantity");
    const existing = await c.rawMaterials.findOne({ id });
    if (!existing)
        return (0, http_1.fail)(res, "Raw material entry not found", 404);
    if (existing.quantityAvailable < returnedQuantity)
        return (0, http_1.fail)(res, "Not enough available quantity to return");
    const update = {
        quantityAvailable: existing.quantityAvailable - returnedQuantity,
        returnStatus: returnStatus || "Returned to Vendor",
        returnedQuantity: returnedQuantity + (existing.returnedQuantity || 0),
        returnReason: returnReason || existing.returnReason,
        returnedAt: returnedAt ? new Date(returnedAt) : new Date(),
        returnedBy: req.user?.id,
        returnedByName: req.user?.name,
        updatedAt: new Date(),
    };
    await c.rawMaterials.updateOne({ id }, { $set: update });
    return (0, http_1.ok)(res, { ...existing, ...update });
});
exports.default = router;
