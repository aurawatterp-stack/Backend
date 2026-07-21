"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDirectUploadTicket = createDirectUploadTicket;
exports.uploadBufferToCloudinary = uploadBufferToCloudinary;
exports.destroyCloudinaryAsset = destroyCloudinaryAsset;
const crypto_1 = require("crypto");
const config_1 = require("../config");
function signature(params) {
    const sorted = Object.keys(params)
        .sort()
        .map((key) => `${key}=${params[key]}`)
        .join("&");
    return (0, crypto_1.createHash)("sha1")
        .update(`${sorted}${config_1.CONFIG.CLOUDINARY_API_SECRET}`)
        .digest("hex");
}
/**
 * Build signed params so the browser can upload straight to Cloudinary.
 *
 * Videos are far larger than the 4.5 MB request body cap on our serverless
 * host, so they must bypass this API entirely instead of being proxied
 * through `uploadBufferToCloudinary`.
 */
function createDirectUploadTicket(folder, resourceType = "auto") {
    assertCloudinaryConfigured();
    const timestamp = Math.floor(Date.now() / 1000).toString();
    return {
        uploadUrl: `https://api.cloudinary.com/v1_1/${config_1.CONFIG.CLOUDINARY_CLOUD_NAME}/${resourceType}/upload`,
        cloudName: config_1.CONFIG.CLOUDINARY_CLOUD_NAME,
        apiKey: config_1.CONFIG.CLOUDINARY_API_KEY,
        timestamp,
        folder,
        signature: signature({ folder, timestamp }),
    };
}
function assertCloudinaryConfigured() {
    if (!config_1.CONFIG.CLOUDINARY_CLOUD_NAME || !config_1.CONFIG.CLOUDINARY_API_KEY || !config_1.CONFIG.CLOUDINARY_API_SECRET) {
        throw new Error("Cloudinary is not configured. Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET.");
    }
}
async function uploadBufferToCloudinary(file, folder) {
    assertCloudinaryConfigured();
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const form = new FormData();
    form.set("file", new Blob([new Uint8Array(file.buffer)], { type: file.mimetype || "application/octet-stream" }), file.originalname);
    form.set("api_key", config_1.CONFIG.CLOUDINARY_API_KEY);
    form.set("timestamp", timestamp);
    form.set("folder", folder);
    form.set("signature", signature({ folder, timestamp }));
    const response = await fetch(`https://api.cloudinary.com/v1_1/${config_1.CONFIG.CLOUDINARY_CLOUD_NAME}/auto/upload`, {
        method: "POST",
        body: form,
    });
    const payload = (await response.json().catch(() => null));
    if (!response.ok) {
        const cloudinaryMessage = payload && typeof payload.error === "object" && payload.error && "message" in payload.error
            ? String(payload.error.message)
            : `Cloudinary upload failed (${response.status})`;
        const message = cloudinaryMessage.toLowerCase().includes("invalid signature")
            ? "Cloudinary credentials mismatch. Please verify CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET in backend/.env, then restart backend."
            : cloudinaryMessage;
        throw new Error(message);
    }
    return {
        url: String(payload?.secure_url ?? payload?.url ?? ""),
        publicId: payload?.public_id ? String(payload.public_id) : undefined,
        resourceType: payload?.resource_type ? String(payload.resource_type) : undefined,
        format: payload?.format ? String(payload.format) : undefined,
    };
}
/** Best-effort removal of a replaced asset so old uploads don't accumulate. */
async function destroyCloudinaryAsset(publicId, resourceType = "video") {
    assertCloudinaryConfigured();
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const form = new FormData();
    form.set("public_id", publicId);
    form.set("api_key", config_1.CONFIG.CLOUDINARY_API_KEY);
    form.set("timestamp", timestamp);
    form.set("signature", signature({ public_id: publicId, timestamp }));
    const response = await fetch(`https://api.cloudinary.com/v1_1/${config_1.CONFIG.CLOUDINARY_CLOUD_NAME}/${resourceType}/destroy`, { method: "POST", body: form });
    if (!response.ok) {
        throw new Error(`Cloudinary destroy failed (${response.status})`);
    }
}
