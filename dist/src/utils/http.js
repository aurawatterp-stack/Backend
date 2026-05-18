"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ok = ok;
exports.fail = fail;
function ok(res, data, statusCode = 200) {
    return res.status(statusCode).json({ success: true, data });
}
function fail(res, message, statusCode = 400) {
    return res.status(statusCode).json({ success: false, message });
}
