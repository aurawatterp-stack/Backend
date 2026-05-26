"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const fs = __importStar(require("fs"));
const collections_1 = require("../db/collections");
const auth_1 = require("../middleware/auth");
const upload_1 = require("../middleware/upload");
const http_1 = require("../utils/http");
const id_1 = require("../utils/id");
const router = express_1.default.Router();
/** GET /api/serials — filter by series, status */
router.get("/", auth_1.authenticate, (0, auth_1.requireAnyPermission)("inventory:serials"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const { q = "", series, status, page = "1", limit = "20" } = req.query;
    const filter = {};
    if (q)
        filter.serialNumber = { $regex: q, $options: "i" };
    if (series)
        filter.productSeriesId = series;
    if (status)
        filter.status = status;
    const p = Math.max(1, parseInt(page));
    const l = Math.min(200, parseInt(limit));
    const total = await c.serials.countDocuments(filter);
    const data = await c.serials.find(filter).skip((p - 1) * l).limit(l).toArray();
    return (0, http_1.ok)(res, { data, total, page: p, limit: l });
});
/**
 * POST /api/serials/import
 * Multipart form: field "serials" = CSV file, field "productSeriesId" = series id
 * CSV format: one serial per line (first column used)
 */
router.post("/import", auth_1.authenticate, (0, auth_1.requireAnyPermission)("inventory:serials"), upload_1.upload.single("serials"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    if (!req.file)
        return (0, http_1.fail)(res, "CSV file is required");
    const { productSeriesId } = req.body;
    if (!productSeriesId)
        return (0, http_1.fail)(res, "productSeriesId is required");
    const content = fs.readFileSync(req.file.path, "utf-8");
    fs.unlinkSync(req.file.path);
    const lines = content
        .split("\n")
        .map((l) => l.split(",")[0].trim())
        .filter(Boolean)
        .filter((l) => !l.toLowerCase().startsWith("serial"));
    const unique = [...new Set(lines)];
    if (unique.length === 0)
        return (0, http_1.ok)(res, { imported: 0, duplicatesSkipped: 0, duplicates: [] });
    const existing = await c.serials
        .find({ serialNumber: { $in: unique } }, { projection: { serialNumber: 1 } })
        .toArray();
    const dupSet = new Set(existing.map((e) => e.serialNumber));
    const toInsert = unique.filter((s) => !dupSet.has(s));
    const duplicates = unique.filter((s) => dupSet.has(s));
    const docs = toInsert.map((serial) => ({
        id: (0, id_1.generateId)(),
        serialNumber: serial,
        productSeriesId,
        status: "Available",
        uploadedAt: new Date(),
    }));
    if (docs.length)
        await c.serials.insertMany(docs);
    return (0, http_1.ok)(res, { imported: docs.length, duplicatesSkipped: duplicates.length, duplicates });
});
exports.default = router;
