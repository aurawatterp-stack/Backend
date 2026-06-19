import type { NextFunction, Request, Response } from "express";

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction) {
  console.error("Unhandled error:", err);
  return res.status(500).json({ success: false, message: "Internal server error", error: err.message, stack: err.stack });
};
