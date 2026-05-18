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
/** GET /api/distributors */
router.get("/", auth_1.authenticate, async (req, res) => {
    const { q = "" } = req.query;
    const c = await (0, collections_1.getCollections)();
    const filter = {};
    if (q)
        filter.name = { $regex: q, $options: "i" };
    const results = await c.distributors.find(filter).toArray();
    return (0, http_1.ok)(res, results);
});
/** GET /api/distributors/:id */
router.get("/:id", auth_1.authenticate, async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const dist = await c.distributors.findOne({ id: req.params.id });
    if (!dist)
        return (0, http_1.fail)(res, "Distributor not found", 404);
    return (0, http_1.ok)(res, dist);
});
/** POST /api/distributors */
router.post("/", auth_1.authenticate, (0, auth_1.authorize)("Admin"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const { name, email, mobile, address } = req.body;
    if (!name || !email || !mobile || !address) {
        return (0, http_1.fail)(res, "name, email, mobile, address are required");
    }
    const distributor = {
        id: (0, id_1.generateId)(),
        name,
        email: String(email).trim().toLowerCase(),
        mobile,
        address,
        unitsSold: 0,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
    };
    await c.distributors.insertOne(distributor);
    return (0, http_1.ok)(res, distributor, 201);
});
/** PUT /api/distributors/:id */
router.put("/:id", auth_1.authenticate, (0, auth_1.authorize)("Admin"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const id = req.params.id;
    const existing = await c.distributors.findOne({ id });
    if (!existing)
        return (0, http_1.fail)(res, "Distributor not found", 404);
    const updatedAt = new Date();
    await c.distributors.updateOne({ id }, { $set: { ...req.body, updatedAt } });
    return (0, http_1.ok)(res, { ...existing, ...req.body, updatedAt });
});
/** DELETE /api/distributors/:id */
router.delete("/:id", auth_1.authenticate, (0, auth_1.authorize)("Admin"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const result = await c.distributors.deleteOne({ id: req.params.id });
    if (!result.deletedCount)
        return (0, http_1.fail)(res, "Distributor not found", 404);
    return (0, http_1.ok)(res, { message: "Distributor deleted" });
});
exports.default = router;
