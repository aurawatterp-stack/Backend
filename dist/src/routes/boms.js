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
/** GET /api/boms — list all boms or filter by series */
router.get("/", auth_1.authenticate, (0, auth_1.requireAnyPermission)("inventory:bom", "inventory:manufactured", "inventory:raw-materials", "dashboard:view"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const series = req.query.series;
    const filter = series ? { series } : {};
    const boms = await c.boms.find(filter).toArray();
    return (0, http_1.ok)(res, boms);
});
/** POST /api/boms — create a new BOM */
router.post("/", auth_1.authenticate, (0, auth_1.requireAnyPermission)("inventory:bom", "inventory:manufactured"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const { series, items } = req.body;
    if (!series)
        return (0, http_1.fail)(res, "Series is required");
    const existing = await c.boms.findOne({ series });
    if (existing)
        return (0, http_1.fail)(res, `BOM for series ${series} already exists`);
    const now = new Date();
    const bom = {
        id: (0, id_1.generateId)(),
        series,
        items: Array.isArray(items) ? items : [],
        createdAt: now,
        updatedAt: now,
    };
    await c.boms.insertOne(bom);
    return (0, http_1.ok)(res, bom, 201);
});
/** PUT /api/boms/:id — update a BOM */
router.put("/:id", auth_1.authenticate, (0, auth_1.requireAnyPermission)("inventory:bom", "inventory:manufactured"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const id = req.params.id;
    const existing = await c.boms.findOne({ id });
    if (!existing)
        return (0, http_1.fail)(res, "BOM not found", 404);
    const { items } = req.body;
    const updatedAt = new Date();
    await c.boms.updateOne({ id }, { $set: { items: Array.isArray(items) ? items : [], updatedAt } });
    return (0, http_1.ok)(res, { ...existing, items: Array.isArray(items) ? items : [], updatedAt });
});
/** DELETE /api/boms/:id — delete a BOM */
router.delete("/:id", auth_1.authenticate, (0, auth_1.requireAnyPermission)("inventory:bom", "inventory:manufactured"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const id = req.params.id;
    await c.boms.deleteOne({ id });
    return (0, http_1.ok)(res, { message: "BOM deleted successfully" });
});
exports.default = router;
