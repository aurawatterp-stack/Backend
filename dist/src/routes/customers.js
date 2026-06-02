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
/** GET /api/customers/pending-registrations — Admin customer approval queue */
router.get("/pending-registrations", auth_1.authenticate, (0, auth_1.requireAnyPermission)("customers:manage"), async (_req, res) => {
    const c = await (0, collections_1.getCollections)();
    const pending = await c.pendingCustomerRegistrations.find({}).sort({ submittedAt: -1 }).toArray();
    return (0, http_1.ok)(res, pending);
});
/** POST /api/customers/request-registration — Sales submits distributor/customer for admin approval */
router.post("/request-registration", auth_1.authenticate, (0, auth_1.requireAnyPermission)("sales:entry"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const user = req.user;
    const { name, type, email, phone, address, registrationCode } = req.body;
    const normalizedEmail = String(email ?? "").trim().toLowerCase();
    const normalizedType = type === "Individual" ? "Individual" : type === "Distributor" ? "Distributor" : "";
    if (!name || !normalizedType || !normalizedEmail || !phone) {
        return (0, http_1.fail)(res, "name, type, email and phone are required");
    }
    const existingCustomer = await c.customers.findOne({ email: normalizedEmail }, { projection: { id: 1 } });
    if (existingCustomer)
        return (0, http_1.fail)(res, "A customer/distributor with this email already exists");
    const existingPending = await c.pendingCustomerRegistrations.findOne({ email: normalizedEmail }, { projection: { id: 1 } });
    if (existingPending)
        return (0, http_1.fail)(res, "A distributor registration request for this email is already pending");
    const pending = {
        id: (0, id_1.generateId)(),
        name: String(name).trim(),
        type: normalizedType,
        email: normalizedEmail,
        phone: String(phone).trim(),
        address: address ? String(address).trim() : undefined,
        registrationCode: registrationCode ? String(registrationCode).trim() : undefined,
        requestedBy: user.userId,
        submittedAt: new Date(),
    };
    await c.pendingCustomerRegistrations.insertOne(pending);
    try {
        const notification = {
            id: (0, id_1.generateId)(),
            type: "customer_registration_requested",
            title: "Distributor Approval Request",
            body: `${pending.name} • ${pending.registrationCode ?? pending.email}`,
            entityType: "customer_registration",
            entityId: pending.id,
            meta: {
                name: pending.name,
                type: pending.type,
                email: pending.email,
                phone: pending.phone,
                registrationCode: pending.registrationCode,
            },
            audienceRoles: ["Admin"],
            readBy: [],
            createdBy: user.userId,
            createdAt: new Date(),
        };
        await c.notifications.insertOne(notification);
    }
    catch (err) {
        console.warn("Failed to insert customer registration notification:", err instanceof Error ? err.message : String(err));
    }
    return (0, http_1.ok)(res, { message: "Distributor registration request sent to Admin for approval.", request: pending }, 201);
});
/** POST /api/customers/approve/:id — Admin approves pending customer/distributor */
router.post("/approve/:id", auth_1.authenticate, (0, auth_1.requireAnyPermission)("customers:manage"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const pending = await c.pendingCustomerRegistrations.findOne({ id: req.params.id });
    if (!pending)
        return (0, http_1.fail)(res, "Pending distributor registration not found", 404);
    const duplicate = await c.customers.findOne({ email: pending.email }, { projection: { id: 1 } });
    if (duplicate) {
        await c.pendingCustomerRegistrations.deleteOne({ id: pending.id });
        return (0, http_1.fail)(res, "A customer/distributor with this email already exists");
    }
    const now = new Date();
    const customer = {
        id: (0, id_1.generateId)(),
        name: pending.name,
        type: pending.type,
        email: pending.email,
        phone: pending.phone,
        address: pending.address,
        status: "Active",
        createdAt: now,
        updatedAt: now,
    };
    await c.customers.insertOne(customer);
    await c.pendingCustomerRegistrations.deleteOne({ id: pending.id });
    return (0, http_1.ok)(res, { message: "Distributor/customer approved successfully", customer }, 201);
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
