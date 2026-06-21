"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticate = authenticate;
exports.authorize = authorize;
exports.requireAnyPermission = requireAnyPermission;
exports.invalidateRolePermissionCache = invalidateRolePermissionCache;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const config_1 = require("../config");
const rbac_1 = require("../rbac");
const collections_1 = require("../db/collections");
const mockDb_1 = require("../db/mockDb");
const http_1 = require("../utils/http");
/**
 * Attach decoded JWT to `req.user`.
 * Protected routes call this before their handler.
 */
const rolePermCache = new Map();
async function tryGetCollections() {
    try {
        return await (0, collections_1.getCollections)();
    }
    catch {
        return null;
    }
}
async function permissionsForRole(role, c) {
    const now = Date.now();
    const cached = rolePermCache.get(role);
    if (cached && cached.expiresAt > now)
        return cached.perms;
    if (!c) {
        const perms = Array.from(new Set([...(rbac_1.DEFAULT_ROLE_PERMISSIONS[role] ?? [])]));
        rolePermCache.set(role, { perms, expiresAt: now + 30_000 });
        return perms;
    }
    const doc = await c.roles.findOne({ name: role }, { projection: { permissions: 1 } });
    const perms = doc
        ? Array.from(new Set([...(doc.permissions ?? [])]))
        : (rbac_1.DEFAULT_ROLE_PERMISSIONS[role] ?? []);
    rolePermCache.set(role, { perms, expiresAt: now + 30_000 });
    return perms;
}
async function authenticate(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
        return (0, http_1.fail)(res, "No token provided", 401);
    }
    const token = authHeader.split(" ")[1];
    try {
        const decoded = jsonwebtoken_1.default.verify(token, config_1.CONFIG.JWT_SECRET);
        const role = (0, rbac_1.normalizeRole)(decoded.role);
        const c = await tryGetCollections();
        const permissions = await permissionsForRole(role, c);
        const user = c
            ? await c.users.findOne({ id: decoded.userId }, { projection: { name: 1 } })
            : mockDb_1.db.users.find((item) => item.id === decoded.userId || item.email.toLowerCase() === decoded.email.toLowerCase());
        req.user = { ...decoded, role, permissions, name: user?.name };
        next();
    }
    catch {
        return (0, http_1.fail)(res, "Invalid or expired token", 401);
    }
}
/**
 * Allow only the specified roles to proceed (canonical role names).
 * Prefer `requireAnyPermission` for feature-level RBAC.
 */
function authorize(...roles) {
    return (req, res, next) => {
        const user = req.user;
        if (!user || !roles.includes(user.role)) {
            return (0, http_1.fail)(res, "Access denied: insufficient permissions", 403);
        }
        next();
    };
}
/**
 * Allow if user has at least one of the specified permissions.
 */
function requireAnyPermission(...permissions) {
    return (req, res, next) => {
        const user = req.user;
        if (!user)
            return (0, http_1.fail)(res, "No user context", 401);
        const userPerms = Array.isArray(user.permissions) ? user.permissions : [];
        const ok = permissions.some((p) => userPerms.includes(p));
        if (!ok)
            return (0, http_1.fail)(res, "Access denied: insufficient permissions", 403);
        next();
    };
}
function invalidateRolePermissionCache(role) {
    if (role)
        rolePermCache.delete(role);
    else
        rolePermCache.clear();
}
