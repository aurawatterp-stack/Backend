"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const multer_1 = __importDefault(require("multer"));
const collections_1 = require("../db/collections");
const auth_1 = require("../middleware/auth");
const cloudinary_1 = require("../utils/cloudinary");
const http_1 = require("../utils/http");
const id_1 = require("../utils/id");
const router = express_1.default.Router();
const MAX_SERIAL_CSV_BYTES = 5 * 1024 * 1024;
const serialCsvUpload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: MAX_SERIAL_CSV_BYTES },
    fileFilter: (_req, file, cb) => {
        if (file.mimetype === "text/csv" || file.originalname.toLowerCase().endsWith(".csv")) {
            cb(null, true);
        }
        else {
            cb(new Error("Only CSV files are allowed"));
        }
    },
});
function runSerialCsvUpload(req, res, next) {
    serialCsvUpload.single("serials")(req, res, (err) => {
        if (!err)
            return next();
        if (err instanceof multer_1.default.MulterError && err.code === "LIMIT_FILE_SIZE") {
            return (0, http_1.fail)(res, "CSV file size must be 5 MB or less", 413);
        }
        return (0, http_1.fail)(res, err instanceof Error ? err.message : "CSV upload failed", 400);
    });
}
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
router.post("/import", auth_1.authenticate, (0, auth_1.requireAnyPermission)("inventory:serials"), runSerialCsvUpload, async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    if (!req.file)
        return (0, http_1.fail)(res, "CSV file is required");
    const { productSeriesId } = req.body;
    if (!productSeriesId)
        return (0, http_1.fail)(res, "productSeriesId is required");
    let uploaded;
    try {
        uploaded = await (0, cloudinary_1.uploadBufferToCloudinary)(req.file, "aurawatt/serial-imports");
    }
    catch (err) {
        return (0, http_1.fail)(res, err instanceof Error ? err.message : "Failed to upload CSV to Cloudinary", 502);
    }
    if (!uploaded.url)
        return (0, http_1.fail)(res, "Cloudinary did not return a file URL", 502);
    const content = req.file.buffer.toString("utf-8");
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
        importFileName: req.file?.originalname,
        importFileUrl: uploaded.url,
        importFilePublicId: uploaded.publicId,
        uploadedAt: new Date(),
    }));
    if (docs.length)
        await c.serials.insertMany(docs);
    return (0, http_1.ok)(res, {
        imported: docs.length,
        duplicatesSkipped: duplicates.length,
        duplicates,
        file: {
            fileName: req.file.originalname,
            fileType: req.file.mimetype || undefined,
            fileSize: req.file.size,
            url: uploaded.url,
            publicId: uploaded.publicId,
            resourceType: uploaded.resourceType,
            format: uploaded.format,
            uploadedAt: new Date(),
        },
    });
});
exports.default = router;
