"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticate = authenticate;
exports.authorize = authorize;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const config_1 = require("../config");
const http_1 = require("../utils/http");
/**
 * Attach decoded JWT to `req.user`.
 * Protected routes call this before their handler.
 */
function authenticate(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
        return (0, http_1.fail)(res, "No token provided", 401);
    }
    const token = authHeader.split(" ")[1];
    try {
        const decoded = jsonwebtoken_1.default.verify(token, config_1.CONFIG.JWT_SECRET);
        req.user = decoded;
        next();
    }
    catch {
        return (0, http_1.fail)(res, "Invalid or expired token", 401);
    }
}
/**
 * Allow only the specified roles to proceed.
 * Usage: authorize("Admin", "Inventory Manager")
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
