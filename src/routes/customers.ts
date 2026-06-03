import express, { type NextFunction, type Request, type Response, type Router } from "express";
import multer from "multer";

import { getCollections } from "../db/collections";
import { authenticate, requireAnyPermission } from "../middleware/auth";
import type { AuthUser, Customer, CustomerDocument, Notification, PendingCustomerRegistration } from "../types";
import { uploadBufferToCloudinary } from "../utils/cloudinary";
import { fail, ok } from "../utils/http";
import { generateId } from "../utils/id";

const router: Router = express.Router();
const MAX_CUSTOMER_DOCUMENT_BYTES = 5 * 1024 * 1024;

const customerDocumentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_CUSTOMER_DOCUMENT_BYTES },
});

function runCustomerDocumentUpload(req: Request, res: Response, next: NextFunction) {
  customerDocumentUpload.single("document")(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      return fail(res, "File size must be 5 MB or less", 413);
    }
    return next(err);
  });
}

function normalizeCustomerDocuments(documentsUploaded: unknown): CustomerDocument[] | undefined {
  if (!Array.isArray(documentsUploaded)) return undefined;
  const docs = documentsUploaded.flatMap((item): CustomerDocument[] => {
    if (!item || typeof item !== "object") return [];
    const raw = item as Record<string, unknown>;
    const url = String(raw.url ?? "").trim();
    const fileName = String(raw.fileName ?? "").trim();
    if (!url || !fileName) return [];
    const uploadedAt = raw.uploadedAt ? new Date(String(raw.uploadedAt)) : new Date();
    return [
      {
        id: String(raw.id ?? generateId()),
        label: String(raw.label ?? fileName).trim(),
        fileName,
        fileType: raw.fileType ? String(raw.fileType).trim() : undefined,
        fileSize: typeof raw.fileSize === "number" && Number.isFinite(raw.fileSize) ? raw.fileSize : undefined,
        url,
        publicId: raw.publicId ? String(raw.publicId).trim() : undefined,
        resourceType: raw.resourceType ? String(raw.resourceType).trim() : undefined,
        format: raw.format ? String(raw.format).trim() : undefined,
        uploadedAt: Number.isNaN(uploadedAt.getTime()) ? new Date() : uploadedAt,
      },
    ];
  });
  return docs.length ? docs : undefined;
}

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

/** GET /api/customers/pending-registrations — Admin queue, or Sales user's own submitted requests */
router.get("/pending-registrations", authenticate, requireAnyPermission("customers:manage", "sales:entry"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const user = (req as any).user as AuthUser;
  const canManageCustomers = user.permissions.includes("customers:manage") || user.role === "Admin";
  const filter = canManageCustomers ? {} : { requestedBy: user.userId };
  const pending = await c.pendingCustomerRegistrations.find(filter).sort({ submittedAt: -1 }).toArray();
  return ok(res, pending);
});

/** POST /api/customers/upload-document — upload distributor KYC document to Cloudinary */
router.post(
  "/upload-document",
  authenticate,
  requireAnyPermission("customers:manage", "sales:entry"),
  runCustomerDocumentUpload,
  async (req: Request, res: Response) => {
    const file = req.file;
    if (!file) return fail(res, "Document file is required");

    const label = String(req.body.label ?? "Distributor Document").trim() || "Distributor Document";
    try {
      const uploaded = await uploadBufferToCloudinary(file, "aurawatt/distributor-documents");
      if (!uploaded.url) return fail(res, "Cloudinary did not return a file URL", 502);

      const document: CustomerDocument = {
        id: generateId(),
        label,
        fileName: file.originalname,
        fileType: file.mimetype || undefined,
        fileSize: file.size,
        url: uploaded.url,
        publicId: uploaded.publicId,
        resourceType: uploaded.resourceType,
        format: uploaded.format,
        uploadedAt: new Date(),
      };
      return ok(res, document, 201);
    } catch (err) {
      return fail(res, err instanceof Error ? err.message : "Failed to upload document", 502);
    }
  }
);

/** POST /api/customers/request-registration — Sales submits distributor/customer for admin approval */
router.post("/request-registration", authenticate, requireAnyPermission("sales:entry"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const user = (req as any).user as AuthUser;
  const {
    name,
    type,
    email,
    phone,
    address,
    registrationCode,
    dateOfRegistration,
    gst,
    cinNo,
    pan,
    tan,
    contactPersonName,
    billingAddress,
    deliveryAddress1,
    deliveryAddress2,
    deliveryAddress3,
    areaAllotted,
    distributorshipType,
    documentsUploaded,
    relevantSalesPerson,
  } = req.body;
  const normalizedEmail = String(email ?? "").trim().toLowerCase();
  const normalizedType = type === "Individual" ? "Individual" : "Distributor";
  const normalizedPhone = String(phone ?? "").trim();
  const normalizedGst = String(gst ?? "").trim();
  const normalizedPan = String(pan ?? "").trim();

  if (!name || !normalizedPhone) {
    return fail(res, "name and contact number are required");
  }

  const duplicateChecks: Record<string, string>[] = [];
  if (normalizedEmail) duplicateChecks.push({ email: normalizedEmail });
  if (normalizedPhone) duplicateChecks.push({ phone: normalizedPhone });
  if (normalizedGst) duplicateChecks.push({ gst: normalizedGst });
  if (normalizedPan) duplicateChecks.push({ pan: normalizedPan });

  if (duplicateChecks.length) {
    const existingCustomer = await c.customers.findOne({ $or: duplicateChecks }, { projection: { id: 1 } });
    if (existingCustomer) return fail(res, "This distributor is already registered");

    const existingPending = await c.pendingCustomerRegistrations.findOne(
      { $and: [{ $or: duplicateChecks }, { $or: [{ status: "Pending" }, { status: { $exists: false } }] }] },
      { projection: { id: 1 } }
    );
    if (existingPending) return fail(res, "A distributor registration request is already pending for these details");
  }

  const pending: PendingCustomerRegistration = {
    id: generateId(),
    name: String(name).trim(),
    type: normalizedType,
    email: normalizedEmail || undefined,
    phone: normalizedPhone,
    address: address ? String(address).trim() : undefined,
    registrationCode: registrationCode ? String(registrationCode).trim() : undefined,
    dateOfRegistration: dateOfRegistration ? new Date(dateOfRegistration) : undefined,
    gst: normalizedGst || undefined,
    cinNo: cinNo ? String(cinNo).trim() : undefined,
    pan: normalizedPan || undefined,
    tan: tan ? String(tan).trim() : undefined,
    contactPersonName: contactPersonName ? String(contactPersonName).trim() : undefined,
    billingAddress: billingAddress ? String(billingAddress).trim() : undefined,
    deliveryAddress1: deliveryAddress1 ? String(deliveryAddress1).trim() : undefined,
    deliveryAddress2: deliveryAddress2 ? String(deliveryAddress2).trim() : undefined,
    deliveryAddress3: deliveryAddress3 ? String(deliveryAddress3).trim() : undefined,
    areaAllotted: areaAllotted ? String(areaAllotted).trim() : undefined,
    distributorshipType: distributorshipType ? String(distributorshipType).trim() : undefined,
    documentsUploaded: normalizeCustomerDocuments(documentsUploaded),
    relevantSalesPerson: relevantSalesPerson ? String(relevantSalesPerson).trim() : undefined,
    status: "Pending",
    requestedBy: user.userId,
    submittedAt: new Date(),
  };

  await c.pendingCustomerRegistrations.insertOne(pending);
  try {
    const notification: Notification = {
      id: generateId(),
      type: "customer_registration_requested",
      title: "Distributor Approval Request",
      body: `${pending.name} • ${pending.phone}`,
      entityType: "customer_registration",
      entityId: pending.id,
      meta: {
        name: pending.name,
        type: pending.type,
        email: pending.email,
        phone: pending.phone,
        gst: pending.gst,
        pan: pending.pan,
        distributorshipType: pending.distributorshipType,
        relevantSalesPerson: pending.relevantSalesPerson,
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
  const user = (req as any).user as AuthUser;
  const pending = await c.pendingCustomerRegistrations.findOne({ id: req.params.id });
  if (!pending) return fail(res, "Pending distributor registration not found", 404);
  if (pending.status === "Approved") return fail(res, "Distributor registration request is already approved");

  const duplicateChecks: Record<string, string>[] = [];
  if (pending.email) duplicateChecks.push({ email: pending.email });
  if (pending.phone) duplicateChecks.push({ phone: pending.phone });
  if (pending.gst) duplicateChecks.push({ gst: pending.gst });
  if (pending.pan) duplicateChecks.push({ pan: pending.pan });
  const duplicate = duplicateChecks.length ? await c.customers.findOne({ $or: duplicateChecks }, { projection: { id: 1 } }) : null;
  if (duplicate) {
    return fail(res, "This distributor is already registered");
  }

  const now = new Date();
  const customer: Customer = {
    id: generateId(),
    name: pending.name,
    type: pending.type,
    email: pending.email,
    phone: pending.phone,
    address: pending.address || pending.billingAddress,
    dateOfRegistration: pending.dateOfRegistration,
    gst: pending.gst,
    cinNo: pending.cinNo,
    pan: pending.pan,
    tan: pending.tan,
    contactPersonName: pending.contactPersonName,
    billingAddress: pending.billingAddress,
    deliveryAddress1: pending.deliveryAddress1,
    deliveryAddress2: pending.deliveryAddress2,
    deliveryAddress3: pending.deliveryAddress3,
    areaAllotted: pending.areaAllotted,
    distributorshipType: pending.distributorshipType,
    documentsUploaded: pending.documentsUploaded,
    relevantSalesPerson: pending.relevantSalesPerson,
    status: "Active",
    createdAt: now,
    updatedAt: now,
  };

  await c.customers.insertOne(customer);
  await c.pendingCustomerRegistrations.updateOne(
    { id: pending.id },
    {
      $set: {
        status: "Approved",
        approvedBy: user.userId,
        approvedAt: now,
        customerId: customer.id,
      },
    }
  );
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
  const { name, type, email, phone, address, distributorshipType } = req.body;
  if (!name || !type || !email || !phone) {
    return fail(res, "name, type, email, phone are required");
  }
  const newCustomer: Customer = {
    id: generateId(),
    name: String(name).trim(),
    type,
    email: String(email).trim().toLowerCase(),
    phone: String(phone).trim(),
    address: address ? String(address).trim() : undefined,
    distributorshipType: distributorshipType ? String(distributorshipType).trim() : undefined,
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
