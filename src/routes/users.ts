import express, { type Request, type Response, type Router } from "express";
import bcrypt from "bcryptjs";

import { CONFIG } from "../config";
import { getCollections } from "../db/collections";
import { authenticate, requireAnyPermission } from "../middleware/auth";
import { normalizeRole } from "../rbac";
import { engineerMasterId, migrateEngineerIdentity, type EngineerRole } from "../services/engineerAssignments";
import type { User } from "../types";
import { fail, ok } from "../utils/http";
import { generateId } from "../utils/id";

const router: Router = express.Router();

function normalizeAssignedStates(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => String(item).trim()).filter(Boolean)));
}

/** Maps a login account's role to the engineer_master role it corresponds to, so deactivating or
 * deleting a user here can keep that registry in sync — without this, the Onsite Engineer / L1-L2
 * dropdowns (which read engineer_master directly) kept showing accounts long after they were
 * removed from User Profiles, since the two collections were never linked. */
const USER_ROLE_TO_ENGINEER_ROLE: Record<string, EngineerRole> = {
  "L1 Engineer": "L1",
  "L2 Technical Team": "L2",
  "L3 Advanced OEM Support": "L3",
};

async function syncEngineerMasterActive(
  user: { name: string; email?: string; mobile?: string; role: string },
  isActive: boolean
) {
  const engineerRole = USER_ROLE_TO_ENGINEER_ROLE[user.role];
  if (!engineerRole || !user.name) return;
  const c = await getCollections();
  const id = engineerMasterId(user.name, engineerRole);
  const now = new Date();
  // Upsert (not just update) so a renamed or newly created L1/L2/L3 account always gets a matching
  // engineer_master row — otherwise it silently never appears in the Onsite Engineer dropdown.
  await c.engineerMasters.updateOne(
    { id },
    {
      $set: { name: user.name, role: engineerRole, email: user.email ?? "", mobile: user.mobile ?? "", isActive, updatedAt: now },
      $setOnInsert: { id, createdAt: now },
    },
    { upsert: true }
  );
}

/**
 * POST /api/users
 * Admin only. Create a new user account.
 */
router.post("/", authenticate, requireAnyPermission("users:manage"), async (req: Request, res: Response) => {
  const { name, email, mobile, role, password, isActive = true, assignedStates = [] } = req.body;
  if (!name || !email || !mobile || !role || !password) {
    return fail(res, "Name, email, mobile, role and password are required");
  }

  const c = await getCollections();
  const normalizedEmail = String(email).trim().toLowerCase();
  const existing = await c.users.findOne({ email: normalizedEmail }, { projection: { id: 1 } });
  if (existing) return fail(res, "An account with this email already exists");

  const newUser: User = {
    id: generateId(),
    email: normalizedEmail,
    passwordHash: await bcrypt.hash(String(password), CONFIG.BCRYPT_ROUNDS),
    name: String(name).trim(),
    mobile: String(mobile).trim(),
    role: normalizeRole(role),
    isActive: Boolean(isActive),
    assignedStates: normalizeAssignedStates(assignedStates),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  await c.users.insertOne(newUser);
  const { passwordHash: _, ...safeUser } = newUser;
  return ok(res, safeUser, 201);
});

/**
 * GET /api/users
 * Admin only. Returns all users.
 */
router.get("/", authenticate, requireAnyPermission("users:manage"), async (_req: Request, res: Response) => {
  const c = await getCollections();
  const users = await c.users.find({}).toArray();
  const safe = users.map(({ passwordHash: _, ...u }) => u);
  return ok(res, safe);
});

/**
 * GET /api/users/pending-registrations
 * Admin only. Returns pending registration requests.
 */
router.get("/pending-registrations", authenticate, requireAnyPermission("users:manage"), async (_req: Request, res: Response) => {
  const c = await getCollections();
  const pending = await c.pendingRegistrations.find({}, { projection: { password: 0 } }).toArray();
  return ok(res, pending);
});

/**
 * POST /api/users/approve/:id
 * Admin only. Approves a pending registration by id.
 */
router.post("/approve/:id", authenticate, requireAnyPermission("users:manage"), async (req: Request, res: Response) => {
  const { id } = req.params;
  const c = await getCollections();
  const pending = await c.pendingRegistrations.findOne({ id });
  if (!pending) return fail(res, "Pending registration not found", 404);
  const passwordHash = await bcrypt.hash(pending.password, CONFIG.BCRYPT_ROUNDS);

  const newUser: User = {
    id: generateId(),
    email: pending.email.toLowerCase(),
    passwordHash,
    name: pending.name,
    mobile: pending.mobile,
    role: normalizeRole(pending.role),
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  await c.users.insertOne(newUser);
  await c.pendingRegistrations.deleteOne({ id });

  const { passwordHash: _, ...safeUser } = newUser;
  return ok(res, { message: "User approved successfully", user: safeUser }, 201);
});

/**
 * PUT /api/users/:id
 * Admin only. Update user details.
 */
router.put("/:id", authenticate, requireAnyPermission("users:manage"), async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, mobile, role, isActive, password, assignedStates } = req.body;
  const c = await getCollections();
  const existing = await c.users.findOne({ id });
  if (!existing) return fail(res, "User not found", 404);

  const update: Partial<User> = { updatedAt: new Date() };
  if (name) update.name = name;
  if (mobile) update.mobile = mobile;
  if (role) update.role = normalizeRole(role);
  if (isActive !== undefined) update.isActive = Boolean(isActive);
  if (password) update.passwordHash = await bcrypt.hash(password, CONFIG.BCRYPT_ROUNDS);
  if (assignedStates !== undefined) update.assignedStates = normalizeAssignedStates(assignedStates);

  await c.users.updateOne({ id }, { $set: update });
  const user = { ...existing, ...update };
  const { passwordHash: _, ...safeUser } = user as any;

  // Keep engineer_master in step: if this account's identity (name/role) changed, every reference
  // to the old identity — engineer_master row, district assignments, complaint tickets — must move
  // with it, because engineer ids are derived from the name. Otherwise the renamed engineer stops
  // receiving tickets and their dashboard goes empty. Then sync the (possibly new) identity's
  // active state to match this account's isActive.
  const nextName = update.name ?? existing.name;
  const nextRole = update.role ?? existing.role;
  const nextIsActive = update.isActive ?? existing.isActive;
  if (existing.name !== nextName || existing.role !== nextRole) {
    const oldEngineerRole = USER_ROLE_TO_ENGINEER_ROLE[existing.role];
    const newEngineerRole = USER_ROLE_TO_ENGINEER_ROLE[nextRole];
    if (oldEngineerRole && newEngineerRole) {
      await migrateEngineerIdentity({
        oldName: existing.name,
        newName: nextName,
        oldRole: oldEngineerRole,
        newRole: newEngineerRole,
        email: existing.email,
        mobile: update.mobile ?? existing.mobile,
      });
    } else {
      await syncEngineerMasterActive({ name: existing.name, role: existing.role }, false);
    }
  }
  await syncEngineerMasterActive(
    { name: nextName, role: nextRole, email: existing.email, mobile: update.mobile ?? existing.mobile },
    Boolean(nextIsActive)
  );

  return ok(res, safeUser);
});

/**
 * DELETE /api/users/:id
 * Admin only.
 */
router.delete("/:id", authenticate, requireAnyPermission("users:manage"), async (req: Request, res: Response) => {
  const { id } = req.params;
  const c = await getCollections();
  const existing = await c.users.findOne({ id });
  if (!existing) return fail(res, "User not found", 404);
  await c.users.deleteOne({ id });
  // Deleting the login account doesn't remove its engineer_master row on its own — deactivate it
  // here so it stops showing up in the Onsite Engineer / L1-L2 dropdowns immediately.
  await syncEngineerMasterActive({ name: existing.name, role: existing.role, email: existing.email, mobile: existing.mobile }, false);
  return ok(res, { message: "User deleted" });
});

export default router;
