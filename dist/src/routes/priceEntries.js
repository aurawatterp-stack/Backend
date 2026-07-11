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
function toNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}
function parsePricePoint(value) {
    const v = (value ?? {});
    return {
        distributor: toNumber(v.distributor),
        dealer: toNumber(v.dealer),
        msp: toNumber(v.msp),
    };
}
/** Only includes states actually present in `value`, so a partial update doesn't zero out the rest and a create doesn't need to know every state up front. */
function parsePrices(value) {
    const v = (value ?? {});
    const result = {};
    for (const key of Object.keys(v)) {
        const state = key.trim();
        if (!state)
            continue;
        result[state] = parsePricePoint(v[key]);
    }
    return result;
}
/** GET /api/price-entries — readable by anyone who manages pricing or generates PIs */
router.get("/", auth_1.authenticate, (0, auth_1.requireAnyPermission)("pricing:manage", "sales:entry", "distributors:manage"), async (_req, res) => {
    const c = await (0, collections_1.getCollections)();
    const entries = await c.priceEntries.find({}).sort({ srNo: 1, createdAt: 1 }).toArray();
    return (0, http_1.ok)(res, entries);
});
/** POST /api/price-entries — Admin only */
router.post("/", auth_1.authenticate, (0, auth_1.requireAnyPermission)("pricing:manage"), async (req, res) => {
    const { description, modelNo, modelKey, srNo, prices } = req.body;
    if (!description || !modelNo || !modelKey) {
        return (0, http_1.fail)(res, "description, modelNo and modelKey are required");
    }
    const c = await (0, collections_1.getCollections)();
    const normalizedKey = String(modelKey).trim();
    const exists = await c.priceEntries.findOne({ modelKey: normalizedKey }, { projection: { id: 1 } });
    if (exists)
        return (0, http_1.fail)(res, "A price entry with this model key already exists");
    const now = new Date();
    const entry = {
        id: (0, id_1.generateId)(),
        srNo: srNo !== undefined && srNo !== null && srNo !== "" ? Number(srNo) : undefined,
        description: String(description).trim(),
        modelNo: String(modelNo).trim(),
        modelKey: normalizedKey,
        prices: parsePrices(prices),
        createdAt: now,
        updatedAt: now,
    };
    await c.priceEntries.insertOne(entry);
    return (0, http_1.ok)(res, entry, 201);
});
/** PUT /api/price-entries/:id — Admin only */
router.put("/:id", auth_1.authenticate, (0, auth_1.requireAnyPermission)("pricing:manage"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const id = req.params.id;
    const existing = await c.priceEntries.findOne({ id });
    if (!existing)
        return (0, http_1.fail)(res, "Price entry not found", 404);
    const update = { updatedAt: new Date() };
    if (req.body.description !== undefined)
        update.description = String(req.body.description).trim();
    if (req.body.modelNo !== undefined)
        update.modelNo = String(req.body.modelNo).trim();
    if (req.body.srNo !== undefined)
        update.srNo = req.body.srNo !== "" && req.body.srNo !== null ? Number(req.body.srNo) : undefined;
    if (req.body.prices !== undefined) {
        update.prices = { ...existing.prices, ...parsePrices(req.body.prices) };
    }
    await c.priceEntries.updateOne({ id }, { $set: update });
    const updated = { ...existing, ...update };
    return (0, http_1.ok)(res, updated);
});
/** DELETE /api/price-entries/:id — Admin only */
router.delete("/:id", auth_1.authenticate, (0, auth_1.requireAnyPermission)("pricing:manage"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const result = await c.priceEntries.deleteOne({ id: req.params.id });
    if (!result.deletedCount)
        return (0, http_1.fail)(res, "Price entry not found", 404);
    return (0, http_1.ok)(res, { message: "Price entry deleted" });
});
exports.default = router;
