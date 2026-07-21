"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const collections_1 = require("../db/collections");
const auth_1 = require("../middleware/auth");
const cloudinary_1 = require("../utils/cloudinary");
const http_1 = require("../utils/http");
const id_1 = require("../utils/id");
const router = express_1.default.Router();
const SUPPORT_VIDEO_FOLDER = "support/how-to-complain";
const SUPPORT_VIDEO_LANGUAGES = ["hindi", "english"];
function normalizeLanguage(value) {
    const normalized = String(value ?? "").trim().toLowerCase();
    return SUPPORT_VIDEO_LANGUAGES.find((language) => language === normalized) ?? null;
}
/**
 * Ask Cloudinary to serve the smallest format the viewer's browser accepts.
 * Without this the raw upload (often a large .mov/.mp4) is streamed as-is.
 */
function toDeliveryUrl(url) {
    if (!url.includes("/video/upload/"))
        return url;
    return url.replace("/video/upload/", "/video/upload/f_auto,q_auto/");
}
function toPublicVideo(video) {
    return {
        language: video.language,
        url: toDeliveryUrl(video.url),
        title: video.title,
        durationSeconds: video.durationSeconds,
        updatedAt: video.updatedAt,
    };
}
/**
 * GET /api/support-videos
 * Public: the customer support page plays these next to the complaint form.
 */
router.get("/", async (_req, res) => {
    const c = await (0, collections_1.getCollections)();
    const videos = await c.supportVideos.find({}).toArray();
    const byLanguage = { hindi: null, english: null };
    for (const video of videos) {
        if (video.url)
            byLanguage[video.language] = toPublicVideo(video);
    }
    return (0, http_1.ok)(res, byLanguage);
});
/**
 * POST /api/support-videos/upload-ticket
 * Admin only. Returns signed params so the browser uploads the video straight
 * to Cloudinary — video files exceed the request body limit of our host, so
 * they cannot be proxied through this API.
 */
router.post("/upload-ticket", auth_1.authenticate, (0, auth_1.authorize)("Admin"), async (_req, res) => {
    try {
        return (0, http_1.ok)(res, (0, cloudinary_1.createDirectUploadTicket)(SUPPORT_VIDEO_FOLDER, "video"));
    }
    catch (err) {
        return (0, http_1.fail)(res, err instanceof Error ? err.message : "Cloudinary is not configured", 500);
    }
});
/**
 * PUT /api/support-videos/:language
 * Admin only. Records the Cloudinary asset the browser just uploaded.
 */
router.put("/:language", auth_1.authenticate, (0, auth_1.authorize)("Admin"), async (req, res) => {
    const language = normalizeLanguage(req.params.language);
    if (!language)
        return (0, http_1.fail)(res, "Language must be 'hindi' or 'english'");
    const url = String(req.body?.url ?? "").trim();
    if (!/^https:\/\/res\.cloudinary\.com\//.test(url)) {
        return (0, http_1.fail)(res, "A Cloudinary video URL is required");
    }
    const c = await (0, collections_1.getCollections)();
    const user = req.user;
    const now = new Date();
    const existing = await c.supportVideos.findOne({ language });
    const publicId = req.body?.publicId ? String(req.body.publicId) : undefined;
    const bytes = Number(req.body?.bytes);
    const durationSeconds = Number(req.body?.durationSeconds);
    const video = {
        id: existing?.id ?? (0, id_1.generateId)(),
        language,
        url,
        publicId,
        format: req.body?.format ? String(req.body.format) : undefined,
        durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : undefined,
        bytes: Number.isFinite(bytes) ? bytes : undefined,
        originalFileName: req.body?.originalFileName ? String(req.body.originalFileName) : undefined,
        title: req.body?.title ? String(req.body.title).trim() : undefined,
        updatedBy: user?.name || user?.email,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
    };
    await c.supportVideos.updateOne({ language }, { $set: video }, { upsert: true });
    if (existing?.publicId && existing.publicId !== publicId) {
        try {
            await (0, cloudinary_1.destroyCloudinaryAsset)(existing.publicId, "video");
        }
        catch (err) {
            console.warn("Failed to remove replaced support video:", err instanceof Error ? err.message : String(err));
        }
    }
    return (0, http_1.ok)(res, toPublicVideo(video));
});
/**
 * DELETE /api/support-videos/:language
 * Admin only. Removes the video so the support page hides that tab.
 */
router.delete("/:language", auth_1.authenticate, (0, auth_1.authorize)("Admin"), async (req, res) => {
    const language = normalizeLanguage(req.params.language);
    if (!language)
        return (0, http_1.fail)(res, "Language must be 'hindi' or 'english'");
    const c = await (0, collections_1.getCollections)();
    const existing = await c.supportVideos.findOne({ language });
    if (!existing)
        return (0, http_1.fail)(res, "No video uploaded for this language", 404);
    await c.supportVideos.deleteOne({ language });
    if (existing.publicId) {
        try {
            await (0, cloudinary_1.destroyCloudinaryAsset)(existing.publicId, "video");
        }
        catch (err) {
            console.warn("Failed to remove support video asset:", err instanceof Error ? err.message : String(err));
        }
    }
    return (0, http_1.ok)(res, { language, removed: true });
});
exports.default = router;
