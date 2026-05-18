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
/** GET /api/products */
router.get("/", auth_1.authenticate, async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const { q = "", series } = req.query;
    const filter = {};
    if (series)
        filter.series = series;
    if (q) {
        filter.$or = [{ model: { $regex: q, $options: "i" } }, { series: { $regex: q, $options: "i" } }];
    }
    const results = await c.products.find(filter).toArray();
    return (0, http_1.ok)(res, results);
});
/** GET /api/products/series — unique series list */
router.get("/series", auth_1.authenticate, async (_req, res) => {
    const c = await (0, collections_1.getCollections)();
    const series = await c.products.distinct("series");
    return (0, http_1.ok)(res, series);
});
/** POST /api/products */
router.post("/", auth_1.authenticate, (0, auth_1.authorize)("Admin", "Inventory Manager"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const { series, model, description } = req.body;
    if (!series || !model)
        return (0, http_1.fail)(res, "series and model are required");
    const exists = await c.products.findOne({ model }, { projection: { id: 1 } });
    if (exists)
        return (0, http_1.fail)(res, "A product with this model already exists");
    const product = { id: (0, id_1.generateId)(), series, model, description, createdAt: new Date() };
    await c.products.insertOne(product);
    return (0, http_1.ok)(res, product, 201);
});
/** PUT /api/products/:id */
router.put("/:id", auth_1.authenticate, (0, auth_1.authorize)("Admin", "Inventory Manager"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const id = req.params.id;
    const existing = await c.products.findOne({ id });
    if (!existing)
        return (0, http_1.fail)(res, "Product not found", 404);
    await c.products.updateOne({ id }, { $set: { ...req.body } });
    const updated = { ...existing, ...req.body };
    return (0, http_1.ok)(res, updated);
});
/** DELETE /api/products/:id */
router.delete("/:id", auth_1.authenticate, (0, auth_1.authorize)("Admin"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const result = await c.products.deleteOne({ id: req.params.id });
    if (!result.deletedCount)
        return (0, http_1.fail)(res, "Product not found", 404);
    return (0, http_1.ok)(res, { message: "Product deleted" });
});
exports.default = router;
