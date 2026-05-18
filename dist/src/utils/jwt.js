"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.signToken = signToken;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const config_1 = require("../config");
function signToken(payload) {
    return jsonwebtoken_1.default.sign(payload, config_1.CONFIG.JWT_SECRET, { expiresIn: config_1.CONFIG.JWT_EXPIRES_IN });
}
