import { createHash } from "crypto";

import { CONFIG } from "../config";

export type CloudinaryUploadResult = {
  url: string;
  publicId?: string;
  resourceType?: string;
  format?: string;
};

function signature(params: Record<string, string>) {
  const sorted = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
  return createHash("sha1")
    .update(`${sorted}${CONFIG.CLOUDINARY_API_SECRET}`)
    .digest("hex");
}

export async function uploadBufferToCloudinary(
  file: Express.Multer.File,
  folder: string
): Promise<CloudinaryUploadResult> {
  if (!CONFIG.CLOUDINARY_CLOUD_NAME || !CONFIG.CLOUDINARY_API_KEY || !CONFIG.CLOUDINARY_API_SECRET) {
    throw new Error("Cloudinary is not configured. Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET.");
  }

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const form = new FormData();
  form.set("file", new Blob([new Uint8Array(file.buffer)], { type: file.mimetype || "application/octet-stream" }), file.originalname);
  form.set("api_key", CONFIG.CLOUDINARY_API_KEY);
  form.set("timestamp", timestamp);
  form.set("folder", folder);
  form.set("signature", signature({ folder, timestamp }));

  const response = await fetch(`https://api.cloudinary.com/v1_1/${CONFIG.CLOUDINARY_CLOUD_NAME}/auto/upload`, {
    method: "POST",
    body: form,
  });
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    const message =
      payload && typeof payload.error === "object" && payload.error && "message" in payload.error
        ? String((payload.error as { message?: unknown }).message)
        : `Cloudinary upload failed (${response.status})`;
    throw new Error(message);
  }

  return {
    url: String(payload?.secure_url ?? payload?.url ?? ""),
    publicId: payload?.public_id ? String(payload.public_id) : undefined,
    resourceType: payload?.resource_type ? String(payload.resource_type) : undefined,
    format: payload?.format ? String(payload.format) : undefined,
  };
}
