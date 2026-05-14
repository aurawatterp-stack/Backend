import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

import { CONFIG } from "../config";
import type { JwtPayload, UserRole } from "../types";
import { fail } from "../utils/http";

/**
 * Attach decoded JWT to `req.user`.
 * Protected routes call this before their handler.
 */
export function authenticate(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return fail(res, "No token provided", 401);
  }

  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, CONFIG.JWT_SECRET) as JwtPayload;
    (req as any).user = decoded;
    next();
  } catch {
    return fail(res, "Invalid or expired token", 401);
  }
}

/**
 * Allow only the specified roles to proceed.
 * Usage: authorize("Admin", "Inventory Manager")
 */
export function authorize(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user as JwtPayload;
    if (!user || !roles.includes(user.role)) {
      return fail(res, "Access denied: insufficient permissions", 403);
    }
    next();
  };
}

