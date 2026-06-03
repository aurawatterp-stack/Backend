"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const collections_1 = require("../db/collections");
const auth_1 = require("../middleware/auth");
const rbac_1 = require("../rbac");
const http_1 = require("../utils/http");
const id_1 = require("../utils/id");
const jwt_1 = require("../utils/jwt");
const router = express_1.default.Router();
async function permissionsForRole(role) {
    if (role === "Admin")
        return [];
    const c = await (0, collections_1.getCollections)();
    const doc = await c.roles.findOne({ name: role }, { projection: { permissions: 1 } });
    return (doc?.permissions ?? []);
}
/**
 * POST /api/auth/login
 * Body: { email, password }
 * Returns: { token, user: { id, name, email, role } }
 */
router.post("/login", async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return (0, http_1.fail)(res, "Email and password are required");
    }
    const c = await (0, collections_1.getCollections)();
    const normalizedEmail = email.trim().toLowerCase();
    const user = await c.users.findOne({ email: normalizedEmail });
    if (!user || !user.isActive) {
        return (0, http_1.fail)(res, "Invalid credentials", 401);
    }
    const isValid = await bcryptjs_1.default.compare(password, user.passwordHash);
    if (!isValid) {
        return (0, http_1.fail)(res, "Invalid credentials", 401);
    }
    const role = (0, rbac_1.normalizeRole)(user.role);
    if (role !== user.role) {
        await c.users.updateOne({ id: user.id }, { $set: { role, updatedAt: new Date() } });
    }
    const permissions = await permissionsForRole(role);
    const token = (0, jwt_1.signToken)({ userId: user.id, email: user.email, role });
    return (0, http_1.ok)(res, {
        token,
        user: { id: user.id, name: user.name, email: user.email, role, permissions },
    });
});
// Helpful guard for accidental GET hits (e.g. opening the URL in a browser).
router.all("/login", (req, res) => {
    res.setHeader("Allow", "POST, OPTIONS");
    return (0, http_1.fail)(res, `Method ${req.method} not allowed. Use POST /api/auth/login.`, 405);
});
/**
 * POST /api/auth/register
 * Body: { name, email, mobile, role, password }
 * Submits a registration request; Admin must approve.
 */
router.post("/register", async (req, res) => {
    const { name, email, mobile, role, password } = req.body;
    if (!name || !email || !mobile || !role || !password) {
        return (0, http_1.fail)(res, "All fields are required");
    }
    if (password.length < 8) {
        return (0, http_1.fail)(res, "Password must be at least 8 characters");
    }
    const c = await (0, collections_1.getCollections)();
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedRole = (0, rbac_1.normalizeRole)(role);
    const allowedRoles = ["Admin", "Inventory", "Sales", "Dispatch", "Service"];
    if (!allowedRoles.includes(normalizedRole)) {
        return (0, http_1.fail)(res, "Invalid role");
    }
    const alreadyExists = await c.users.findOne({ email: normalizedEmail }, { projection: { id: 1 } });
    if (alreadyExists)
        return (0, http_1.fail)(res, "An account with this email already exists");
    const pending = await c.pendingRegistrations.findOne({ email: normalizedEmail }, { projection: { id: 1 } });
    if (pending)
        return (0, http_1.fail)(res, "A registration request for this email is already pending");
    await c.pendingRegistrations.insertOne({
        id: (0, id_1.generateId)(),
        name,
        email: normalizedEmail,
        mobile,
        role: normalizedRole,
        password,
        submittedAt: new Date(),
    });
    return (0, http_1.ok)(res, { message: "Registration request submitted. Awaiting admin approval." }, 201);
});
/**
 * GET /api/auth/me
 * Returns the current logged-in user's profile.
 */
router.get("/me", auth_1.authenticate, async (req, res) => {
    const { userId } = req.user;
    const c = await (0, collections_1.getCollections)();
    const user = await c.users.findOne({ id: userId });
    if (!user)
        return (0, http_1.fail)(res, "User not found", 404);
    const role = (0, rbac_1.normalizeRole)(user.role);
    if (role !== user.role) {
        await c.users.updateOne({ id: user.id }, { $set: { role, updatedAt: new Date() } });
    }
    const permissions = await permissionsForRole(role);
    const { passwordHash: _, ...safeUser } = user;
    return (0, http_1.ok)(res, { ...safeUser, role, permissions });
});
exports.default = router;
