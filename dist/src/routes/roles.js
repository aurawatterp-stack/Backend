"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const collections_1 = require("../db/collections");
const rbac_1 = require("../rbac");
const auth_1 = require("../middleware/auth");
const http_1 = require("../utils/http");
const id_1 = require("../utils/id");
const router = express_1.default.Router();
/** GET /api/roles — list roles and permissions (Admin only) */
router.get("/", auth_1.authenticate, (0, auth_1.authorize)("Admin"), async (_req, res) => {
    const c = await (0, collections_1.getCollections)();
    const roles = await c.roles.find({}).sort({ name: 1 }).toArray();
    return (0, http_1.ok)(res, roles);
});
/** POST /api/roles — create a custom role (Admin only) */
router.post("/", auth_1.authenticate, (0, auth_1.authorize)("Admin"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const name = (0, rbac_1.normalizeRole)(req.body?.name);
    if (!name)
        return (0, http_1.fail)(res, "name is required");
    if (name === "Admin")
        return (0, http_1.fail)(res, "Admin role cannot be created/modified");
    const exists = await c.roles.findOne({ name }, { projection: { id: 1 } });
    if (exists)
        return (0, http_1.fail)(res, "Role already exists");
    const now = new Date();
    const permissions = (0, rbac_1.sanitizePermissions)(req.body?.permissions);
    const role = {
        id: (0, id_1.generateId)(),
        name,
        permissions,
        isSystem: false,
        createdAt: now,
        updatedAt: now,
    };
    await c.roles.insertOne(role);
    (0, auth_1.invalidateRolePermissionCache)(name);
    return (0, http_1.ok)(res, role, 201);
});
/** PUT /api/roles/:id — update role permissions (Admin only) */
router.put("/:id", auth_1.authenticate, (0, auth_1.authorize)("Admin"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const id = String(req.params.id || "").trim();
    if (!id)
        return (0, http_1.fail)(res, "id is required");
    const existing = await c.roles.findOne({ id });
    if (!existing)
        return (0, http_1.fail)(res, "Role not found", 404);
    const requested = (0, rbac_1.sanitizePermissions)(req.body?.permissions);
    const requiredForAdmin = existing.name === "Admin" ? ["users:manage", "roles:manage", "dashboard:view"] : [];
    const permissions = [...new Set([...requested, ...requiredForAdmin])];
    const updatedAt = new Date();
    await c.roles.updateOne({ id }, { $set: { permissions, updatedAt } });
    const updated = { ...existing, permissions, updatedAt };
    (0, auth_1.invalidateRolePermissionCache)(existing.name);
    return (0, http_1.ok)(res, updated);
});
/** DELETE /api/roles/:id — delete a custom role (Admin only) */
router.delete("/:id", auth_1.authenticate, (0, auth_1.authorize)("Admin"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const id = String(req.params.id || "").trim();
    if (!id)
        return (0, http_1.fail)(res, "id is required");
    const existing = await c.roles.findOne({ id });
    if (!existing)
        return (0, http_1.fail)(res, "Role not found", 404);
    if (existing.isSystem)
        return (0, http_1.fail)(res, "System roles cannot be deleted");
    if (existing.name === "Admin")
        return (0, http_1.fail)(res, "Admin role cannot be deleted");
    await c.roles.deleteOne({ id });
    (0, auth_1.invalidateRolePermissionCache)(existing.name);
    return (0, http_1.ok)(res, { message: "Role deleted" });
});
exports.default = router;
