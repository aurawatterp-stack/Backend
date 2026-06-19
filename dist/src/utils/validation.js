"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isValidEmailAddress = isValidEmailAddress;
exports.normalizeEmailAddress = normalizeEmailAddress;
function isValidEmailAddress(value) {
    const email = String(value ?? "").trim();
    if (!email)
        return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function normalizeEmailAddress(value) {
    const email = String(value ?? "").trim().toLowerCase();
    return email || "";
}
