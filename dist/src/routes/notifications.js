"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const collections_1 = require("../db/collections");
const auth_1 = require("../middleware/auth");
const rbac_1 = require("../rbac");
const http_1 = require("../utils/http");
const router = express_1.default.Router();
function parseBool(v) {
    if (typeof v !== "string")
        return false;
    const s = v.trim().toLowerCase();
    return s === "1" || s === "true" || s === "yes";
}
function visibleToUserFilter(user) {
    return {
        $or: [
            // Targeted notifications.
            { audienceUserIds: user.userId },
            // Role-targeted notifications.
            { audienceRoles: { $in: (0, rbac_1.roleMatchSet)(user.role) } },
            // Global notifications (no explicit audience fields).
            { $and: [{ audienceUserIds: { $exists: false } }, { audienceRoles: { $exists: false } }] },
        ],
    };
}
/** GET /api/notifications */
router.get("/", auth_1.authenticate, async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const user = req.user;
    const { page = "1", limit = "20", unreadOnly } = req.query;
    const p = Math.max(1, parseInt(page));
    const l = Math.min(50, Math.max(1, parseInt(limit)));
    const filter = visibleToUserFilter(user);
    if (parseBool(unreadOnly)) {
        filter.readBy = { $ne: user.userId };
    }
    const total = await c.notifications.countDocuments(filter);
    const data = await c.notifications
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((p - 1) * l)
        .limit(l)
        .toArray();
    const view = data.map((n) => {
        const { readBy, ...rest } = n;
        return { ...rest, isRead: Array.isArray(readBy) ? readBy.includes(user.userId) : false };
    });
    return (0, http_1.ok)(res, { data: view, total, page: p, limit: l });
});
/** GET /api/notifications/unread-count */
router.get("/unread-count", auth_1.authenticate, async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const user = req.user;
    const filter = { ...visibleToUserFilter(user), readBy: { $ne: user.userId } };
    const count = await c.notifications.countDocuments(filter);
    return (0, http_1.ok)(res, { count });
});
/** POST /api/notifications/:id/read */
router.post("/:id/read", auth_1.authenticate, async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const user = req.user;
    const id = req.params.id;
    const filter = { id, ...visibleToUserFilter(user) };
    const updated = await c.notifications.updateOne(filter, { $addToSet: { readBy: user.userId } });
    if (!updated.matchedCount)
        return (0, http_1.fail)(res, "Notification not found", 404);
    return (0, http_1.ok)(res, { message: "marked as read" });
});
/** POST /api/notifications/read-all */
router.post("/read-all", auth_1.authenticate, async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const user = req.user;
    const filter = { ...visibleToUserFilter(user), readBy: { $ne: user.userId } };
    const result = await c.notifications.updateMany(filter, { $addToSet: { readBy: user.userId } });
    return (0, http_1.ok)(res, { updated: result.modifiedCount });
});
exports.default = router;
