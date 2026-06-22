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
async function getNextSequenceValue(sequenceName) {
    const c = await (0, collections_1.getCollections)();
    const sequenceDocument = await c.counters.findOneAndUpdate({ id: sequenceName }, { $inc: { seq: 1 } }, { returnDocument: "after", upsert: true });
    return sequenceDocument.seq;
}
function normalizeInwardMode(value) {
    const text = String(value ?? "").trim().toLowerCase();
    if (text === "local")
        return "Local";
    return "International";
}
/** POST /api/inwards */
router.post("/", auth_1.authenticate, (0, auth_1.requireAnyPermission)("inventory:raw-materials"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const { inwardMode, vendorName, dateReceived, billType, referenceNo, notes, items } = req.body;
    if (!vendorName || !dateReceived || !billType || !referenceNo || !Array.isArray(items) || items.length === 0) {
        return (0, http_1.fail)(res, "Missing required header fields or items array is empty");
    }
    const mode = normalizeInwardMode(inwardMode);
    // Generate Counters
    const prefix = mode === "Local" ? "LOC" : "INT";
    const inwardSeq = await getNextSequenceValue(`inward_${mode.toLowerCase()}`);
    const batchSeq = await getNextSequenceValue(`batch_${mode.toLowerCase()}`);
    const inwardNo = `INW-${prefix}-${String(inwardSeq).padStart(4, "0")}`;
    const batch = `${prefix}-BATCH-${String(batchSeq).padStart(3, "0")}`;
    const user = req.user;
    const inwardMaster = {
        id: (0, id_1.generateId)(),
        inwardNo,
        inwardMode: mode,
        batch,
        vendorName,
        dateReceived: new Date(dateReceived),
        billType,
        referenceNo,
        notes,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: user.userId,
    };
    const itemDetails = [];
    const rawMaterials = [];
    for (const item of items) {
        if (!item.productSeriesId || !item.materialName || !item.quantityReceived) {
            return (0, http_1.fail)(res, "Invalid item data provided", 400);
        }
        const itemDetail = {
            id: (0, id_1.generateId)(),
            inwardId: inwardMaster.id,
            productSeriesId: item.productSeriesId,
            materialName: item.materialName,
            quantityReceived: Number(item.quantityReceived),
            createdAt: new Date(),
        };
        itemDetails.push(itemDetail);
        // Repurpose raw_materials as inventory ledger
        const rawMaterial = {
            id: (0, id_1.generateId)(),
            productSeriesId: item.productSeriesId,
            inwardMode: mode,
            materialName: item.materialName,
            dateReceived: new Date(dateReceived),
            billType,
            referenceNo,
            quantityReceived: Number(item.quantityReceived),
            quantityAvailable: Number(item.quantityReceived),
            vendorName,
            batch,
            notes,
            inwardId: inwardMaster.id,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        rawMaterials.push(rawMaterial);
    }
    await c.inwardMaster.insertOne(inwardMaster);
    await c.inwardItemDetails.insertMany(itemDetails);
    await c.rawMaterials.insertMany(rawMaterials);
    // Add Notification
    try {
        const notification = {
            id: (0, id_1.generateId)(),
            type: "raw_material_received",
            title: "Inward Received",
            body: `${inwardNo} • ${batch} • ${items.length} items • ${mode}`,
            entityType: "inward",
            entityId: inwardMaster.id,
            meta: { inwardNo, batch, inwardMode: mode, referenceNo },
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
    return (0, http_1.ok)(res, { ...inwardMaster, items: itemDetails }, 201);
});
/** GET /api/inwards */
router.get("/", auth_1.authenticate, (0, auth_1.requireAnyPermission)("inventory:raw-materials", "complaints:supplier"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const { q = "", inwardMode, page = "1", limit = "20" } = req.query;
    const filter = {};
    if (inwardMode)
        filter.inwardMode = normalizeInwardMode(inwardMode);
    if (q) {
        filter.$or = [
            { vendorName: { $regex: q, $options: "i" } },
            { referenceNo: { $regex: q, $options: "i" } },
            { inwardNo: { $regex: q, $options: "i" } },
            { batch: { $regex: q, $options: "i" } }
        ];
    }
    const p = Math.max(1, parseInt(page));
    const l = Math.min(100, parseInt(limit));
    const total = await c.inwardMaster.countDocuments(filter);
    const data = await c.inwardMaster.find(filter).sort({ createdAt: -1 }).skip((p - 1) * l).limit(l).toArray();
    // Aggregate items
    const dataWithItems = await Promise.all(data.map(async (inward) => {
        const items = await c.inwardItemDetails.find({ inwardId: inward.id }).toArray();
        return { ...inward, items };
    }));
    return (0, http_1.ok)(res, { data: dataWithItems, total, page: p, limit: l });
});
exports.default = router;
