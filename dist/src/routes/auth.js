"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const collections_1 = require("../db/collections");
const mockDb_1 = require("../db/mockDb");
const auth_1 = require("../middleware/auth");
const rbac_1 = require("../rbac");
const http_1 = require("../utils/http");
const id_1 = require("../utils/id");
const jwt_1 = require("../utils/jwt");
const router = express_1.default.Router();
async function tryGetCollections() {
    try {
        return await (0, collections_1.getCollections)();
    }
    catch {
        return null;
    }
}
async function permissionsForRole(role, c) {
    if (!c) {
        return (rbac_1.DEFAULT_ROLE_PERMISSIONS[role] ?? []);
    }
    const doc = await c.roles.findOne({ name: role }, { projection: { permissions: 1 } });
    if (!doc) {
        return (rbac_1.DEFAULT_ROLE_PERMISSIONS[role] ?? []);
    }
    return Array.from(new Set([...(doc.permissions ?? [])]));
}
async function resolveLoginUser(email, password, c) {
    const demoUser = mockDb_1.db.users.find((item) => item.email.toLowerCase() === email);
    const now = new Date();
    if (demoUser) {
        const demoPasswordValid = await bcryptjs_1.default.compare(password, demoUser.passwordHash);
        if (demoPasswordValid) {
            const canonicalRole = (0, rbac_1.normalizeRole)(demoUser.role);
            if (!c) {
                return { ...demoUser, email, role: canonicalRole, isActive: true, updatedAt: now };
            }
            const existingUser = await c.users.findOne({ email });
            const nextUser = {
                ...(existingUser ?? demoUser),
                email,
                passwordHash: demoUser.passwordHash,
                name: existingUser?.name || demoUser.name,
                mobile: existingUser?.mobile || demoUser.mobile,
                role: canonicalRole,
                isActive: true,
                updatedAt: now,
            };
            if (existingUser) {
                await c.users.updateOne({ id: existingUser.id }, {
                    $set: {
                        passwordHash: nextUser.passwordHash,
                        name: nextUser.name,
                        mobile: nextUser.mobile,
                        role: nextUser.role,
                        isActive: true,
                        updatedAt: now,
                    },
                });
            }
            else {
                await c.users.insertOne({
                    ...demoUser,
                    email,
                    role: canonicalRole,
                    isActive: true,
                    updatedAt: now,
                });
            }
            return nextUser;
        }
    }
    if (!c) {
        if (!demoUser)
            return null;
        const demoPasswordValid = await bcryptjs_1.default.compare(password, demoUser.passwordHash);
        if (!demoPasswordValid)
            return null;
        const now = new Date();
        return { ...demoUser, email, role: (0, rbac_1.normalizeRole)(demoUser.role), isActive: true, updatedAt: now };
    }
    const user = await c.users.findOne({ email });
    if (!user) {
        if (!demoUser)
            return null;
        const demoPasswordValid = await bcryptjs_1.default.compare(password, demoUser.passwordHash);
        if (!demoPasswordValid)
            return null;
        const nextUser = { ...demoUser, email, role: (0, rbac_1.normalizeRole)(demoUser.role), isActive: true, updatedAt: now };
        await c.users.insertOne(nextUser);
        return nextUser;
    }
    if (!demoUser)
        return user;
    const validCurrent = await bcryptjs_1.default.compare(password, user.passwordHash);
    if (validCurrent)
        return user;
    const validDemo = await bcryptjs_1.default.compare(password, demoUser.passwordHash);
    if (!validDemo)
        return user;
    const update = {
        passwordHash: demoUser.passwordHash,
        name: user.name || demoUser.name,
        mobile: user.mobile || demoUser.mobile,
        role: (0, rbac_1.normalizeRole)(demoUser.role),
        isActive: true,
        updatedAt: new Date(),
    };
    await c.users.updateOne({ id: user.id }, { $set: update });
    return { ...user, ...update };
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
    const c = await tryGetCollections();
    const normalizedEmail = email.trim().toLowerCase();
    const user = await resolveLoginUser(normalizedEmail, password, c);
    if (!user || !user.isActive) {
        return (0, http_1.fail)(res, "Invalid credentials", 401);
    }
    const isValid = await bcryptjs_1.default.compare(password, user.passwordHash);
    if (!isValid) {
        return (0, http_1.fail)(res, "Invalid credentials", 401);
    }
    const role = normalizedEmail === "accountsdept@avavbusiness.com" ? "Accounts" : (0, rbac_1.normalizeRole)(user.role);
    if (c && role !== user.role) {
        await c.users.updateOne({ id: user.id }, { $set: { role, updatedAt: new Date() } });
    }
    const permissions = await permissionsForRole(role, c);
    const token = (0, jwt_1.signToken)({ userId: user.id, email: user.email, role });
    return (0, http_1.ok)(res, {
        token,
        user: { id: user.id, name: user.name, email: user.email, role, permissions, mobile: user.mobile, assignedStates: user.assignedStates ?? [] },
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
    const allowedRoles = [
        "Admin",
        "Inventory",
        "Sales",
        "Dispatch",
        "Accounts",
        "Distributor",
        "L1 Engineer",
        "L2 Technical Team",
        "L3 Advanced OEM Support",
        "Warehouse Team",
        "Accounts Team",
        "Dealer",
    ];
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
    const c = await tryGetCollections();
    const user = c ? await c.users.findOne({ id: userId }) : mockDb_1.db.users.find((item) => item.id === userId);
    if (!user)
        return (0, http_1.fail)(res, "User not found", 404);
    const role = user.email?.toLowerCase() === "accountsdept@avavbusiness.com" ? "Accounts" : (0, rbac_1.normalizeRole)(user.role);
    if (c && role !== user.role) {
        await c.users.updateOne({ id: user.id }, { $set: { role, updatedAt: new Date() } });
    }
    const permissions = await permissionsForRole(role, c);
    const { passwordHash: _, ...safeUser } = user;
    return (0, http_1.ok)(res, { ...safeUser, role, permissions, assignedStates: safeUser.assignedStates ?? [] });
});
exports.default = router;
