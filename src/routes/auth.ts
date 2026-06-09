import express, { type Request, type Response, type Router } from "express";
import bcrypt from "bcryptjs";

import { getCollections } from "../db/collections";
import { db as mockDb } from "../db/mockDb";
import { authenticate } from "../middleware/auth";
import { DEFAULT_ROLE_PERMISSIONS, normalizeRole } from "../rbac";
import type { LoginRequest, Permission, RegisterRequest, JwtPayload, RoleName, User } from "../types";
import { fail, ok } from "../utils/http";
import { generateId } from "../utils/id";
import { signToken } from "../utils/jwt";

const router: Router = express.Router();

async function permissionsForRole(role: RoleName): Promise<Permission[]> {
  if (role === "Admin") return [];
  const c = await getCollections();
  const doc = await c.roles.findOne({ name: role }, { projection: { permissions: 1 } });
  const defaults = DEFAULT_ROLE_PERMISSIONS[role as keyof typeof DEFAULT_ROLE_PERMISSIONS] ?? [];
  return Array.from(new Set([...(doc?.permissions ?? []), ...defaults])) as Permission[];
}

async function resolveLoginUser(email: string, password: string): Promise<User | null> {
  const c = await getCollections();
  const user = await c.users.findOne({ email });
  const demoUser = mockDb.users.find((item) => item.email.toLowerCase() === email);

  if (!user) {
    if (!demoUser) return null;
    const demoPasswordValid = await bcrypt.compare(password, demoUser.passwordHash);
    if (!demoPasswordValid) return null;
    const now = new Date();
    const nextUser = { ...demoUser, email, role: normalizeRole(demoUser.role), isActive: true, updatedAt: now } as User;
    await c.users.insertOne(nextUser);
    return nextUser;
  }

  if (!demoUser) return user;

  const validCurrent = await bcrypt.compare(password, user.passwordHash);
  if (validCurrent) return user;

  const validDemo = await bcrypt.compare(password, demoUser.passwordHash);
  if (!validDemo) return user;

  const update: Partial<User> = {
    passwordHash: demoUser.passwordHash,
    name: user.name || demoUser.name,
    mobile: user.mobile || demoUser.mobile,
    role: normalizeRole(demoUser.role),
    isActive: true,
    updatedAt: new Date(),
  };
  await c.users.updateOne({ id: user.id }, { $set: update });
  return { ...user, ...update } as User;
}

/**
 * POST /api/auth/login
 * Body: { email, password }
 * Returns: { token, user: { id, name, email, role } }
 */
router.post("/login", async (req: Request, res: Response) => {
  const { email, password } = req.body as LoginRequest;

  if (!email || !password) {
    return fail(res, "Email and password are required");
  }

  const c = await getCollections();
  const normalizedEmail = email.trim().toLowerCase();
  const user = await resolveLoginUser(normalizedEmail, password);
  if (!user || !user.isActive) {
    return fail(res, "Invalid credentials", 401);
  }

  const isValid = await bcrypt.compare(password, user.passwordHash);
  if (!isValid) {
    return fail(res, "Invalid credentials", 401);
  }

  const role = normalizedEmail === "accountsdept@avavbusiness.com" ? "Accounts" : normalizeRole(user.role);
  if (role !== user.role) {
    await c.users.updateOne({ id: user.id }, { $set: { role, updatedAt: new Date() } });
  }

  const permissions = await permissionsForRole(role);
  const token = signToken({ userId: user.id, email: user.email, role });

  return ok(res, {
    token,
    user: { id: user.id, name: user.name, email: user.email, role, permissions },
  });
});

// Helpful guard for accidental GET hits (e.g. opening the URL in a browser).
router.all("/login", (req: Request, res: Response) => {
  res.setHeader("Allow", "POST, OPTIONS");
  return fail(res, `Method ${req.method} not allowed. Use POST /api/auth/login.`, 405);
});

/**
 * POST /api/auth/register
 * Body: { name, email, mobile, role, password }
 * Submits a registration request; Admin must approve.
 */
router.post("/register", async (req: Request, res: Response) => {
  const { name, email, mobile, role, password } = req.body as RegisterRequest;

  if (!name || !email || !mobile || !role || !password) {
    return fail(res, "All fields are required");
  }
  if (password.length < 8) {
    return fail(res, "Password must be at least 8 characters");
  }

  const c = await getCollections();
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedRole = normalizeRole(role);
  const allowedRoles: RoleName[] = [
    "Admin",
    "Inventory",
    "Sales",
    "Dispatch",
    "Accounts",
    "Distributor",
    "L1 Engineer",
    "L2 Technical Team",
    "L3 Advanced OEM Support",
    "Warehouse Team",
    "Accounts Team",
    "Dealer",
  ];
  if (!allowedRoles.includes(normalizedRole)) {
    return fail(res, "Invalid role");
  }

  const alreadyExists = await c.users.findOne({ email: normalizedEmail }, { projection: { id: 1 } });
  if (alreadyExists) return fail(res, "An account with this email already exists");

  const pending = await c.pendingRegistrations.findOne({ email: normalizedEmail }, { projection: { id: 1 } });
  if (pending) return fail(res, "A registration request for this email is already pending");

  await c.pendingRegistrations.insertOne({
    id: generateId(),
    name,
    email: normalizedEmail,
    mobile,
    role: normalizedRole,
    password,
    submittedAt: new Date(),
  });

  return ok(res, { message: "Registration request submitted. Awaiting admin approval." }, 201);
});

/**
 * GET /api/auth/me
 * Returns the current logged-in user's profile.
 */
router.get("/me", authenticate, async (req: Request, res: Response) => {
  const { userId } = (req as any).user as JwtPayload;
  const c = await getCollections();
  const user = await c.users.findOne({ id: userId });
  if (!user) return fail(res, "User not found", 404);
  const role = user.email?.toLowerCase() === "accountsdept@avavbusiness.com" ? "Accounts" : normalizeRole(user.role);
  if (role !== user.role) {
    await c.users.updateOne({ id: user.id }, { $set: { role, updatedAt: new Date() } });
  }
  const permissions = await permissionsForRole(role);
  const { passwordHash: _, ...safeUser } = user as any;
  return ok(res, { ...safeUser, role, permissions });
});

export default router;
