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
/** GET /api/customers — paginated, filterable by name/type */
router.get("/", auth_1.authenticate, (0, auth_1.requireAnyPermission)("customers:manage", "sales:entry"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const { q = "", type, page = "1", limit = "20" } = req.query;
    const filter = {};
    if (q)
        filter.name = { $regex: q, $options: "i" };
    if (type)
        filter.type = type;
    const total = await c.customers.countDocuments(filter);
    const p = Math.max(1, parseInt(page));
    const l = Math.min(100, parseInt(limit));
    const data = await c.customers.find(filter).skip((p - 1) * l).limit(l).toArray();
    return (0, http_1.ok)(res, { data, total, page: p, limit: l });
});
/** GET /api/customers/:id */
router.get("/:id", auth_1.authenticate, (0, auth_1.requireAnyPermission)("customers:manage", "sales:entry"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const customer = await c.customers.findOne({ id: req.params.id });
    if (!customer)
        return (0, http_1.fail)(res, "Customer not found", 404);
    return (0, http_1.ok)(res, customer);
});
/** POST /api/customers */
router.post("/", auth_1.authenticate, (0, auth_1.requireAnyPermission)("customers:manage", "sales:entry"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const { name, type, email, phone, address } = req.body;
    if (!name || !type || !email || !phone) {
        return (0, http_1.fail)(res, "name, type, email, phone are required");
    }
    const newCustomer = {
        id: (0, id_1.generateId)(),
        name,
        type,
        email,
        phone,
        address,
        status: "Active",
        createdAt: new Date(),
        updatedAt: new Date(),
    };
    await c.customers.insertOne(newCustomer);
    return (0, http_1.ok)(res, newCustomer, 201);
});
/** PUT /api/customers/:id */
router.put("/:id", auth_1.authenticate, (0, auth_1.requireAnyPermission)("customers:manage"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const id = req.params.id;
    const existing = await c.customers.findOne({ id });
    if (!existing)
        return (0, http_1.fail)(res, "Customer not found", 404);
    const updatedAt = new Date();
    await c.customers.updateOne({ id }, { $set: { ...req.body, updatedAt } });
    const updated = { ...existing, ...req.body, updatedAt };
    return (0, http_1.ok)(res, updated);
});
/** DELETE /api/customers/:id */
router.delete("/:id", auth_1.authenticate, (0, auth_1.requireAnyPermission)("customers:manage"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const result = await c.customers.deleteOne({ id: req.params.id });
    if (!result.deletedCount)
        return (0, http_1.fail)(res, "Customer not found", 404);
    return (0, http_1.ok)(res, { message: "Customer deleted" });
});
exports.default = router;
