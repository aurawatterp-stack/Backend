import express, { type Request, type Response, type Router } from "express";

import { getCollections } from "../db/collections";
import { authenticate, requireAnyPermission } from "../middleware/auth";
import type { AuthUser, Customer, Notification, PendingCustomerRegistration } from "../types";
import { fail, ok } from "../utils/http";
import { generateId } from "../utils/id";

const router: Router = express.Router();

/** GET /api/customers — paginated, filterable by name/type */
router.get("/", authenticate, requireAnyPermission("customers:manage", "sales:entry"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const { q = "", type, page = "1", limit = "20" } = req.query as Record<string, string>;
  const filter: Record<string, unknown> = {};
  if (q) filter.name = { $regex: q, $options: "i" };
  if (type) filter.type = type;

  const total = await c.customers.countDocuments(filter);
  const p = Math.max(1, parseInt(page));
  const l = Math.min(100, parseInt(limit));
  const data = await c.customers.find(filter).skip((p - 1) * l).limit(l).toArray();

  return ok(res, { data, total, page: p, limit: l });
});

/** GET /api/customers/pending-registrations — Admin customer approval queue */
router.get("/pending-registrations", authenticate, requireAnyPermission("customers:manage"), async (_req: Request, res: Response) => {
  const c = await getCollections();
  const pending = await c.pendingCustomerRegistrations.find({}).sort({ submittedAt: -1 }).toArray();
  return ok(res, pending);
});

/** POST /api/customers/request-registration — Sales submits distributor/customer for admin approval */
router.post("/request-registration", authenticate, requireAnyPermission("sales:entry"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const user = (req as any).user as AuthUser;
  const { name, type, email, phone, address, registrationCode } = req.body;
  const normalizedEmail = String(email ?? "").trim().toLowerCase();
  const normalizedType = type === "Individual" ? "Individual" : type === "Distributor" ? "Distributor" : "";

  if (!name || !normalizedType || !normalizedEmail || !phone) {
    return fail(res, "name, type, email and phone are required");
  }

  const existingCustomer = await c.customers.findOne({ email: normalizedEmail }, { projection: { id: 1 } });
  if (existingCustomer) return fail(res, "A customer/distributor with this email already exists");

  const existingPending = await c.pendingCustomerRegistrations.findOne({ email: normalizedEmail }, { projection: { id: 1 } });
  if (existingPending) return fail(res, "A distributor registration request for this email is already pending");

  const pending: PendingCustomerRegistration = {
    id: generateId(),
    name: String(name).trim(),
    type: normalizedType,
    email: normalizedEmail,
    phone: String(phone).trim(),
    address: address ? String(address).trim() : undefined,
    registrationCode: registrationCode ? String(registrationCode).trim() : undefined,
    requestedBy: user.userId,
    submittedAt: new Date(),
  };

  await c.pendingCustomerRegistrations.insertOne(pending);
  try {
    const notification: Notification = {
      id: generateId(),
      type: "customer_registration_requested",
      title: "Distributor Approval Request",
      body: `${pending.name} • ${pending.registrationCode ?? pending.email}`,
      entityType: "customer_registration",
      entityId: pending.id,
      meta: {
        name: pending.name,
        type: pending.type,
        email: pending.email,
        phone: pending.phone,
        registrationCode: pending.registrationCode,
      },
      audienceRoles: ["Admin"],
      readBy: [],
      createdBy: user.userId,
      createdAt: new Date(),
    };
    await c.notifications.insertOne(notification);
  } catch (err) {
    console.warn("Failed to insert customer registration notification:", err instanceof Error ? err.message : String(err));
  }
  return ok(res, { message: "Distributor registration request sent to Admin for approval.", request: pending }, 201);
});

/** POST /api/customers/approve/:id — Admin approves pending customer/distributor */
router.post("/approve/:id", authenticate, requireAnyPermission("customers:manage"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const pending = await c.pendingCustomerRegistrations.findOne({ id: req.params.id });
  if (!pending) return fail(res, "Pending distributor registration not found", 404);

  const duplicate = await c.customers.findOne({ email: pending.email }, { projection: { id: 1 } });
  if (duplicate) {
    await c.pendingCustomerRegistrations.deleteOne({ id: pending.id });
    return fail(res, "A customer/distributor with this email already exists");
  }

  const now = new Date();
  const customer: Customer = {
    id: generateId(),
    name: pending.name,
    type: pending.type,
    email: pending.email,
    phone: pending.phone,
    address: pending.address,
    status: "Active",
    createdAt: now,
    updatedAt: now,
  };

  await c.customers.insertOne(customer);
  await c.pendingCustomerRegistrations.deleteOne({ id: pending.id });
  return ok(res, { message: "Distributor/customer approved successfully", customer }, 201);
});

/** GET /api/customers/:id */
router.get("/:id", authenticate, requireAnyPermission("customers:manage", "sales:entry"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const customer = await c.customers.findOne({ id: req.params.id });
  if (!customer) return fail(res, "Customer not found", 404);
  return ok(res, customer);
});

/** POST /api/customers */
router.post("/", authenticate, requireAnyPermission("customers:manage", "sales:entry"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const { name, type, email, phone, address } = req.body;
  if (!name || !type || !email || !phone) {
    return fail(res, "name, type, email, phone are required");
  }
  const newCustomer: Customer = {
    id: generateId(),
    name,
    type,
    email,
    phone,
    address,
    status: "Active",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await c.customers.insertOne(newCustomer);
  return ok(res, newCustomer, 201);
});

/** PUT /api/customers/:id */
router.put("/:id", authenticate, requireAnyPermission("customers:manage"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const id = req.params.id;
  const existing = await c.customers.findOne({ id });
  if (!existing) return fail(res, "Customer not found", 404);
  const updatedAt = new Date();
  await c.customers.updateOne({ id }, { $set: { ...req.body, updatedAt } });
  const updated = { ...existing, ...req.body, updatedAt };
  return ok(res, updated);
});

/** DELETE /api/customers/:id */
router.delete("/:id", authenticate, requireAnyPermission("customers:manage"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const result = await c.customers.deleteOne({ id: req.params.id });
  if (!result.deletedCount) return fail(res, "Customer not found", 404);
  return ok(res, { message: "Customer deleted" });
});

export default router;
