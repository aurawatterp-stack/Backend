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
/** GET /api/raw-materials — filter by series, batch, vendor, dateFrom, dateTo */
router.get("/", auth_1.authenticate, async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const { q = "", series, batch, vendor, page = "1", limit = "20" } = req.query;
    const filter = {};
    if (series)
        filter.productSeriesId = series;
    if (batch)
        filter.batch = batch;
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
router.post("/", auth_1.authenticate, (0, auth_1.authorize)("Admin", "Inventory Manager"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const { productSeriesId, materialName, dateReceived, billType, referenceNo, quantityReceived, vendorName, batch, notes } = req.body;
    if (!productSeriesId || !materialName || !dateReceived || !billType || !referenceNo || !quantityReceived || !vendorName || !batch) {
        return (0, http_1.fail)(res, "All required fields must be provided");
    }
    const entry = {
        id: (0, id_1.generateId)(),
        productSeriesId,
        materialName,
        dateReceived: new Date(dateReceived),
        billType,
        referenceNo,
        quantityReceived: Number(quantityReceived),
        quantityAvailable: Number(quantityReceived),
        vendorName,
        batch,
        notes,
        createdAt: new Date(),
        updatedAt: new Date(),
    };
    await c.rawMaterials.insertOne(entry);
    return (0, http_1.ok)(res, entry, 201);
});
/** PUT /api/raw-materials/:id */
router.put("/:id", auth_1.authenticate, (0, auth_1.authorize)("Admin", "Inventory Manager"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const id = req.params.id;
    const existing = await c.rawMaterials.findOne({ id });
    if (!existing)
        return (0, http_1.fail)(res, "Raw material entry not found", 404);
    const updatedAt = new Date();
    await c.rawMaterials.updateOne({ id }, { $set: { ...req.body, updatedAt } });
    return (0, http_1.ok)(res, { ...existing, ...req.body, updatedAt });
});
/** DELETE /api/raw-materials/:id */
router.delete("/:id", auth_1.authenticate, (0, auth_1.authorize)("Admin", "Inventory Manager"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const result = await c.rawMaterials.deleteOne({ id: req.params.id });
    if (!result.deletedCount)
        return (0, http_1.fail)(res, "Raw material entry not found", 404);
    return (0, http_1.ok)(res, { message: "Raw material entry deleted" });
});
exports.default = router;
