import express, { type Request, type Response, type Router } from "express";
import bcrypt from "bcryptjs";

import { getCollections } from "../db/collections";
import { authenticate } from "../middleware/auth";
import type { LoginRequest, RegisterRequest, JwtPayload } from "../types";
import { fail, ok } from "../utils/http";
import { generateId } from "../utils/id";
import { signToken } from "../utils/jwt";

const router: Router = express.Router();

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
  const user = await c.users.findOne({ email: normalizedEmail });
  if (!user || !user.isActive) {
    return fail(res, "Invalid credentials", 401);
  }

  const isValid = await bcrypt.compare(password, user.passwordHash);
  if (!isValid) {
    return fail(res, "Invalid credentials", 401);
  }

  const token = signToken({ userId: user.id, email: user.email, role: user.role });

  return ok(res, {
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
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

  const alreadyExists = await c.users.findOne({ email: normalizedEmail }, { projection: { id: 1 } });
  if (alreadyExists) return fail(res, "An account with this email already exists");

  const pending = await c.pendingRegistrations.findOne({ email: normalizedEmail }, { projection: { id: 1 } });
  if (pending) return fail(res, "A registration request for this email is already pending");

  await c.pendingRegistrations.insertOne({
    id: generateId(),
    name,
    email: normalizedEmail,
    mobile,
    role,
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
  const { passwordHash: _, ...safeUser } = user as any;
  return ok(res, safeUser);
});

export default router;
