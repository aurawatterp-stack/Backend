import express, { type Request, type Response, type Router } from "express";

import { getCollections } from "../db/collections";
import { authenticate, authorize } from "../middleware/auth";
import type { AuthUser, SupportVideo, SupportVideoLanguage } from "../types";
import { createDirectUploadTicket, destroyCloudinaryAsset } from "../utils/cloudinary";
import { fail, ok } from "../utils/http";
import { generateId } from "../utils/id";

const router: Router = express.Router();

const SUPPORT_VIDEO_FOLDER = "support/how-to-complain";
const SUPPORT_VIDEO_LANGUAGES: SupportVideoLanguage[] = ["hindi", "english"];

function normalizeLanguage(value: unknown): SupportVideoLanguage | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  return SUPPORT_VIDEO_LANGUAGES.find((language) => language === normalized) ?? null;
}

/**
 * Ask Cloudinary to serve the smallest format the viewer's browser accepts.
 * Without this the raw upload (often a large .mov/.mp4) is streamed as-is.
 */
function toDeliveryUrl(url: string) {
  if (!url.includes("/video/upload/")) return url;
  return url.replace("/video/upload/", "/video/upload/f_auto,q_auto/");
}

function toPublicVideo(video: SupportVideo) {
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
router.get("/", async (_req: Request, res: Response) => {
  const c = await getCollections();
  const videos = await c.supportVideos.find({}).toArray();

  const byLanguage: Record<string, ReturnType<typeof toPublicVideo> | null> = { hindi: null, english: null };
  for (const video of videos) {
    if (video.url) byLanguage[video.language] = toPublicVideo(video);
  }
  return ok(res, byLanguage);
});

/**
 * POST /api/support-videos/upload-ticket
 * Admin only. Returns signed params so the browser uploads the video straight
 * to Cloudinary — video files exceed the request body limit of our host, so
 * they cannot be proxied through this API.
 */
router.post("/upload-ticket", authenticate, authorize("Admin"), async (_req: Request, res: Response) => {
  try {
    return ok(res, createDirectUploadTicket(SUPPORT_VIDEO_FOLDER, "video"));
  } catch (err) {
    return fail(res, err instanceof Error ? err.message : "Cloudinary is not configured", 500);
  }
});

/**
 * PUT /api/support-videos/:language
 * Admin only. Records the Cloudinary asset the browser just uploaded.
 */
router.put("/:language", authenticate, authorize("Admin"), async (req: Request, res: Response) => {
  const language = normalizeLanguage(req.params.language);
  if (!language) return fail(res, "Language must be 'hindi' or 'english'");

  const url = String(req.body?.url ?? "").trim();
  if (!/^https:\/\/res\.cloudinary\.com\//.test(url)) {
    return fail(res, "A Cloudinary video URL is required");
  }

  const c = await getCollections();
  const user = (req as any).user as AuthUser | undefined;
  const now = new Date();
  const existing = await c.supportVideos.findOne({ language });

  const publicId = req.body?.publicId ? String(req.body.publicId) : undefined;
  const bytes = Number(req.body?.bytes);
  const durationSeconds = Number(req.body?.durationSeconds);
  const video: SupportVideo = {
    id: existing?.id ?? generateId(),
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
      await destroyCloudinaryAsset(existing.publicId, "video");
    } catch (err) {
      console.warn("Failed to remove replaced support video:", err instanceof Error ? err.message : String(err));
    }
  }

  return ok(res, toPublicVideo(video));
});

/**
 * DELETE /api/support-videos/:language
 * Admin only. Removes the video so the support page hides that tab.
 */
router.delete("/:language", authenticate, authorize("Admin"), async (req: Request, res: Response) => {
  const language = normalizeLanguage(req.params.language);
  if (!language) return fail(res, "Language must be 'hindi' or 'english'");

  const c = await getCollections();
  const existing = await c.supportVideos.findOne({ language });
  if (!existing) return fail(res, "No video uploaded for this language", 404);

  await c.supportVideos.deleteOne({ language });

  if (existing.publicId) {
    try {
      await destroyCloudinaryAsset(existing.publicId, "video");
    } catch (err) {
      console.warn("Failed to remove support video asset:", err instanceof Error ? err.message : String(err));
    }
  }

  return ok(res, { language, removed: true });
});

export default router;
