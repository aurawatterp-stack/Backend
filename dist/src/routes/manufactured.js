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
function normalizeBomUsage(input) {
    if (!Array.isArray(input))
        return [];
    return input
        .map((item) => ({
        rawMaterialId: item.rawMaterialId ? String(item.rawMaterialId) : undefined,
        materialName: String(item.materialName ?? ""),
        batch: item.batch ? String(item.batch) : undefined,
        invoiceNo: item.invoiceNo ? String(item.invoiceNo) : undefined,
        vendorName: item.vendorName ? String(item.vendorName) : undefined,
        quantityUsed: Number(item.quantityUsed) || 0,
    }))
        .filter((item) => item.rawMaterialId && item.materialName && item.quantityUsed > 0);
}
function usageByRawMaterial(usage) {
    const map = new Map();
    for (const item of usage ?? []) {
        if (!item.rawMaterialId)
            continue;
        map.set(item.rawMaterialId, (map.get(item.rawMaterialId) ?? 0) + (Number(item.quantityUsed) || 0));
    }
    return map;
}
/** GET /api/manufactured — filter by status, model, dateFrom, dateTo, customer */
router.get("/", auth_1.authenticate, (0, auth_1.requireAnyPermission)("inventory:manufactured", "sales:entry", "complaints:consumer"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const { q = "", status, model, page = "1", limit = "20" } = req.query;
    const filter = {};
    if (status)
        filter.status = status;
    if (model)
        filter.productId = model;
    if (q) {
        filter.$or = [{ serialNumber: { $regex: q, $options: "i" } }, { productId: { $regex: q, $options: "i" } }];
    }
    const p = Math.max(1, parseInt(page));
    const l = Math.min(100, parseInt(limit));
    const total = await c.manufactured.countDocuments(filter);
    const data = await c.manufactured.find(filter).skip((p - 1) * l).limit(l).toArray();
    return (0, http_1.ok)(res, { data, total, page: p, limit: l });
});
/** POST /api/manufactured — record new production */
router.post("/", auth_1.authenticate, (0, auth_1.requireAnyPermission)("inventory:manufactured"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const { productId, serialNumber, mfgDate, status, invoiceNo, paymentStatus, bomUsage } = req.body;
    if (!productId || !serialNumber || !mfgDate) {
        return (0, http_1.fail)(res, "productId, serialNumber, mfgDate are required");
    }
    const duplicate = await c.manufactured.findOne({ serialNumber }, { projection: { id: 1 } });
    if (duplicate)
        return (0, http_1.fail)(res, "This serial number already exists");
    const normalizedStatus = status === "Sold" || status === "Returned" || status === "In Stock" ? status : "In Stock";
    const normalizedPayment = paymentStatus === "Pending" || paymentStatus === "Verified" || paymentStatus === "N/A"
        ? paymentStatus
        : "N/A";
    const entry = {
        id: (0, id_1.generateId)(),
        productId,
        serialNumber,
        mfgDate: new Date(mfgDate),
        status: normalizedStatus,
        invoiceNo: invoiceNo ? String(invoiceNo) : undefined,
        paymentStatus: normalizedPayment,
        bomUsage: normalizeBomUsage(bomUsage),
        createdAt: new Date(),
        updatedAt: new Date(),
    };
    await c.manufactured.insertOne(entry);
    return (0, http_1.ok)(res, entry, 201);
});
/** PUT /api/manufactured/:id/bom — modify BOM and adjust raw material stock by delta only */
router.put("/:id/bom", auth_1.authenticate, (0, auth_1.requireAnyPermission)("inventory:manufactured"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const id = req.params.id;
    const existing = await c.manufactured.findOne({ id });
    if (!existing)
        return (0, http_1.fail)(res, "Record not found", 404);
    const nextBomUsage = normalizeBomUsage(req.body?.bomUsage);
    const previousUsage = usageByRawMaterial(existing.bomUsage);
    const nextUsage = usageByRawMaterial(nextBomUsage);
    const rawMaterialIds = [...new Set([...previousUsage.keys(), ...nextUsage.keys()])];
    const rawMaterials = await c.rawMaterials.find({ id: { $in: rawMaterialIds } }).toArray();
    const rawById = new Map(rawMaterials.map((entry) => [entry.id, entry]));
    for (const rawMaterialId of nextUsage.keys()) {
        if (!rawById.has(rawMaterialId))
            return (0, http_1.fail)(res, "Selected raw material entry not found", 404);
    }
    for (const rawMaterialId of rawMaterialIds) {
        const entry = rawById.get(rawMaterialId);
        if (!entry)
            continue;
        const delta = (nextUsage.get(rawMaterialId) ?? 0) - (previousUsage.get(rawMaterialId) ?? 0);
        if (delta > 0 && entry.quantityAvailable < delta) {
            return (0, http_1.fail)(res, `${entry.materialName} stock insufficient. Available ${entry.quantityAvailable}, additional required ${delta}.`);
        }
    }
    for (const rawMaterialId of rawMaterialIds) {
        const entry = rawById.get(rawMaterialId);
        if (!entry)
            continue;
        const delta = (nextUsage.get(rawMaterialId) ?? 0) - (previousUsage.get(rawMaterialId) ?? 0);
        if (delta === 0)
            continue;
        await c.rawMaterials.updateOne({ id: rawMaterialId }, { $set: { quantityAvailable: entry.quantityAvailable - delta, updatedAt: new Date() } });
    }
    const updatedAt = new Date();
    await c.manufactured.updateOne({ id }, { $set: { bomUsage: nextBomUsage, updatedAt } });
    return (0, http_1.ok)(res, { ...existing, bomUsage: nextBomUsage, updatedAt });
});
/** PUT /api/manufactured/:id */
router.put("/:id", auth_1.authenticate, (0, auth_1.requireAnyPermission)("inventory:manufactured", "sales:entry"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const id = req.params.id;
    const existing = await c.manufactured.findOne({ id });
    if (!existing)
        return (0, http_1.fail)(res, "Record not found", 404);
    const updatedAt = new Date();
    await c.manufactured.updateOne({ id }, { $set: { ...req.body, updatedAt } });
    return (0, http_1.ok)(res, { ...existing, ...req.body, updatedAt });
});
/** POST /api/manufactured/:id/return — mark product as returned */
router.post("/:id/return", auth_1.authenticate, (0, auth_1.requireAnyPermission)("inventory:manufactured"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const id = req.params.id;
    const existing = await c.manufactured.findOne({ id });
    if (!existing)
        return (0, http_1.fail)(res, "Record not found", 404);
    const { returnReason } = req.body;
    const updatedAt = new Date();
    await c.manufactured.updateOne({ id }, { $set: { status: "Returned", returnReason: returnReason || "", updatedAt } });
    return (0, http_1.ok)(res, { ...existing, status: "Returned", returnReason: returnReason || "", updatedAt });
});
exports.default = router;
