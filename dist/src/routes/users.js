"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const config_1 = require("../config");
const collections_1 = require("../db/collections");
const auth_1 = require("../middleware/auth");
const rbac_1 = require("../rbac");
const http_1 = require("../utils/http");
const id_1 = require("../utils/id");
const router = express_1.default.Router();
/**
 * GET /api/users
 * Admin only. Returns all users.
 */
router.get("/", auth_1.authenticate, (0, auth_1.requireAnyPermission)("users:manage"), async (_req, res) => {
    const c = await (0, collections_1.getCollections)();
    const users = await c.users.find({}).toArray();
    const safe = users.map(({ passwordHash: _, ...u }) => u);
    return (0, http_1.ok)(res, safe);
});
/**
 * GET /api/users/pending-registrations
 * Admin only. Returns pending registration requests.
 */
router.get("/pending-registrations", auth_1.authenticate, (0, auth_1.requireAnyPermission)("users:manage"), async (_req, res) => {
    const c = await (0, collections_1.getCollections)();
    const pending = await c.pendingRegistrations.find({}, { projection: { password: 0 } }).toArray();
    return (0, http_1.ok)(res, pending);
});
/**
 * POST /api/users/approve/:id
 * Admin only. Approves a pending registration by id.
 */
router.post("/approve/:id", auth_1.authenticate, (0, auth_1.requireAnyPermission)("users:manage"), async (req, res) => {
    const { id } = req.params;
    const c = await (0, collections_1.getCollections)();
    const pending = await c.pendingRegistrations.findOne({ id });
    if (!pending)
        return (0, http_1.fail)(res, "Pending registration not found", 404);
    const passwordHash = await bcryptjs_1.default.hash(pending.password, config_1.CONFIG.BCRYPT_ROUNDS);
    const newUser = {
        id: (0, id_1.generateId)(),
        email: pending.email.toLowerCase(),
        passwordHash,
        name: pending.name,
        mobile: pending.mobile,
        role: (0, rbac_1.normalizeRole)(pending.role),
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
    };
    await c.users.insertOne(newUser);
    await c.pendingRegistrations.deleteOne({ id });
    const { passwordHash: _, ...safeUser } = newUser;
    return (0, http_1.ok)(res, { message: "User approved successfully", user: safeUser }, 201);
});
/**
 * PUT /api/users/:id
 * Admin only. Update user details.
 */
router.put("/:id", auth_1.authenticate, (0, auth_1.requireAnyPermission)("users:manage"), async (req, res) => {
    const { id } = req.params;
    const { name, mobile, role, isActive, password } = req.body;
    const c = await (0, collections_1.getCollections)();
    const existing = await c.users.findOne({ id });
    if (!existing)
        return (0, http_1.fail)(res, "User not found", 404);
    const update = { updatedAt: new Date() };
    if (name)
        update.name = name;
    if (mobile)
        update.mobile = mobile;
    if (role)
        update.role = (0, rbac_1.normalizeRole)(role);
    if (isActive !== undefined)
        update.isActive = Boolean(isActive);
    if (password)
        update.passwordHash = await bcryptjs_1.default.hash(password, config_1.CONFIG.BCRYPT_ROUNDS);
    await c.users.updateOne({ id }, { $set: update });
    const user = { ...existing, ...update };
    const { passwordHash: _, ...safeUser } = user;
    return (0, http_1.ok)(res, safeUser);
});
/**
 * DELETE /api/users/:id
 * Admin only.
 */
router.delete("/:id", auth_1.authenticate, (0, auth_1.requireAnyPermission)("users:manage"), async (req, res) => {
    const { id } = req.params;
    const c = await (0, collections_1.getCollections)();
    const result = await c.users.deleteOne({ id });
    if (!result.deletedCount)
        return (0, http_1.fail)(res, "User not found", 404);
    return (0, http_1.ok)(res, { message: "User deleted" });
});
exports.default = router;
