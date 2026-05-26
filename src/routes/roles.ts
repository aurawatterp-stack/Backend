import express, { type Request, type Response, type Router } from "express";

import { getCollections } from "../db/collections";
import { sanitizePermissions, normalizeRole } from "../rbac";
import { authenticate, authorize, invalidateRolePermissionCache } from "../middleware/auth";
import type { Role } from "../types";
import { fail, ok } from "../utils/http";
import { generateId } from "../utils/id";

const router: Router = express.Router();

/** GET /api/roles — list roles and permissions (Admin only) */
router.get("/", authenticate, authorize("Admin"), async (_req: Request, res: Response) => {
  const c = await getCollections();
  const roles = await c.roles.find({}).sort({ name: 1 }).toArray();
  return ok(res, roles);
});

/** POST /api/roles — create a custom role (Admin only) */
router.post("/", authenticate, authorize("Admin"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const name = normalizeRole(req.body?.name);
  if (!name) return fail(res, "name is required");
  if (name === "Admin") return fail(res, "Admin role cannot be created/modified");

  const exists = await c.roles.findOne({ name }, { projection: { id: 1 } });
  if (exists) return fail(res, "Role already exists");

  const now = new Date();
  const permissions = sanitizePermissions(req.body?.permissions);
  const role: Role = {
    id: generateId(),
    name,
    permissions,
    isSystem: false,
    createdAt: now,
    updatedAt: now,
  };
  await c.roles.insertOne(role);
  invalidateRolePermissionCache(name);
  return ok(res, role, 201);
});

/** PUT /api/roles/:id — update role permissions (Admin only) */
router.put("/:id", authenticate, authorize("Admin"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const id = String(req.params.id || "").trim();
  if (!id) return fail(res, "id is required");

  const existing = await c.roles.findOne({ id });
  if (!existing) return fail(res, "Role not found", 404);
  const requested = sanitizePermissions(req.body?.permissions);
  const requiredForAdmin =
    existing.name === "Admin" ? (["users:manage", "roles:manage", "dashboard:view"] as const) : [];
  const permissions = [...new Set([...requested, ...requiredForAdmin])];
  const updatedAt = new Date();
  await c.roles.updateOne({ id }, { $set: { permissions, updatedAt } });
  const updated: Role = { ...(existing as Role), permissions, updatedAt };
  invalidateRolePermissionCache(existing.name);
  return ok(res, updated);
});

/** DELETE /api/roles/:id — delete a custom role (Admin only) */
router.delete("/:id", authenticate, authorize("Admin"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const id = String(req.params.id || "").trim();
  if (!id) return fail(res, "id is required");

  const existing = await c.roles.findOne({ id });
  if (!existing) return fail(res, "Role not found", 404);
  if (existing.isSystem) return fail(res, "System roles cannot be deleted");
  if (existing.name === "Admin") return fail(res, "Admin role cannot be deleted");

  await c.roles.deleteOne({ id });
  invalidateRolePermissionCache(existing.name);
  return ok(res, { message: "Role deleted" });
});

export default router;
