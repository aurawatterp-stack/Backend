"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.upload = void 0;
const multer_1 = __importDefault(require("multer"));
const config_1 = require("../config");
// CSV upload middleware (used by serial import).
exports.upload = (0, multer_1.default)({
    dest: config_1.CONFIG.UPLOAD_DIR,
    fileFilter: (_req, file, cb) => {
        if (file.mimetype === "text/csv" || file.originalname.endsWith(".csv")) {
            cb(null, true);
        }
        else {
            cb(new Error("Only CSV files are allowed"));
        }
    },
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});
