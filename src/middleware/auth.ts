import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

import { CONFIG } from "../config";
import { DEFAULT_ROLE_PERMISSIONS, normalizeRole } from "../rbac";
import { getCollections } from "../db/collections";
import type { AuthUser, JwtPayload, Permission, RoleName } from "../types";
import { fail } from "../utils/http";

/**
 * Attach decoded JWT to `req.user`.
 * Protected routes call this before their handler.
 */
const rolePermCache = new Map<string, { perms: Permission[]; expiresAt: number }>();
async function permissionsForRole(role: RoleName): Promise<Permission[]> {
  const now = Date.now();
  const cached = rolePermCache.get(role);
  if (cached && cached.expiresAt > now) return cached.perms;

  const c = await getCollections();
  const doc = await c.roles.findOne({ name: role }, { projection: { permissions: 1 } });
  const defaults = DEFAULT_ROLE_PERMISSIONS[role as keyof typeof DEFAULT_ROLE_PERMISSIONS] ?? [];
  const perms = Array.from(new Set([...(doc?.permissions ?? []), ...defaults])) as Permission[];
  rolePermCache.set(role, { perms, expiresAt: now + 30_000 });
  return perms;
}

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return fail(res, "No token provided", 401);
  }

  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, CONFIG.JWT_SECRET) as JwtPayload;
    const role = normalizeRole((decoded as any).role);
    const permissions = await permissionsForRole(role);
    const c = await getCollections();
    const user = await c.users.findOne({ id: decoded.userId }, { projection: { name: 1 } });
    (req as any).user = { ...decoded, role, permissions, name: user?.name } satisfies AuthUser;
    next();
  } catch {
    return fail(res, "Invalid or expired token", 401);
  }
}

/**
 * Allow only the specified roles to proceed (canonical role names).
 * Prefer `requireAnyPermission` for feature-level RBAC.
 */
export function authorize(...roles: RoleName[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user as AuthUser | JwtPayload;
    if (!user || !roles.includes(user.role)) {
      return fail(res, "Access denied: insufficient permissions", 403);
    }
    next();
  };
}

/**
 * Allow if user has at least one of the specified permissions.
 */
export function requireAnyPermission(...permissions: Permission[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user as AuthUser | undefined;
    if (!user) return fail(res, "No user context", 401);
    const userPerms = Array.isArray(user.permissions) ? user.permissions : [];
    const ok = permissions.some((p) => userPerms.includes(p));
    if (!ok) return fail(res, "Access denied: insufficient permissions", 403);
    next();
  };
}

export function invalidateRolePermissionCache(role?: string) {
  if (role) rolePermCache.delete(role);
  else rolePermCache.clear();
}
