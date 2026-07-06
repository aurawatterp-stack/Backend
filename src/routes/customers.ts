import express, { type NextFunction, type Request, type Response, type Router } from "express";
import multer from "multer";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";

import { getCollections } from "../db/collections";
import { authenticate, requireAnyPermission } from "../middleware/auth";
import type { AuthUser, Customer, CustomerDocument, Notification, PendingCustomerRegistration } from "../types";
import { uploadBufferToCloudinary } from "../utils/cloudinary";
import { fail, ok } from "../utils/http";
import { generateId } from "../utils/id";

const router: Router = express.Router();
const MAX_CUSTOMER_DOCUMENT_BYTES = 5 * 1024 * 1024;
const MAX_CUSTOMER_BULK_UPLOAD_BYTES = 10 * 1024 * 1024;

const customerDocumentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_CUSTOMER_DOCUMENT_BYTES },
});

const customerBulkUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_CUSTOMER_BULK_UPLOAD_BYTES },
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

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  for (const key of Object.keys(value)) {
    if (value[key] === undefined) delete value[key];
  }
  return value;
}

function normalizeKey(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function columnIndexFromRef(cellRef: string) {
  const letters = cellRef.replace(/\d+/g, "");
  let index = 0;
  for (const char of letters) {
    index = index * 26 + (char.charCodeAt(0) - 64);
  }
  return Math.max(0, index - 1);
}

function readXmlFromXlsx(filePath: string, entryPath: string) {
  try {
    const zip = new AdmZip(filePath);
    const entry = zip.getEntry(entryPath);
    if (!entry) return "";
    return entry.getData().toString("utf8");
  } catch (err) {
    console.warn(`Failed to read ${entryPath} from ${filePath}`, err);
    return "";
  }
}

function parseSharedStrings(xml: string) {
  if (!xml) return [] as string[];
  const entries: string[] = [];
  const sharedStringRegex = /<si\b[\s\S]*?<\/si>/g;
  let match: RegExpExecArray | null;
  while ((match = sharedStringRegex.exec(xml))) {
    const block = match[0];
    const parts: string[] = [];
    const textRegex = /<t[^>]*>([\s\S]*?)<\/t>/g;
    let textMatch: RegExpExecArray | null;
    while ((textMatch = textRegex.exec(block))) {
      parts.push(textMatch[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'"));
    }
    entries.push(parts.join(""));
  }
  return entries;
}

function parseWorksheetRows(xml: string, sharedStrings: string[]) {
  const rows: Array<Array<string>> = [];
  if (!xml) return rows;

  const rowRegex = /<row\b[\s\S]*?<\/row>/g;
  const cellRegex = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
  const valueRegex = /<v>([\s\S]*?)<\/v>/;

  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRegex.exec(xml))) {
    const rowXml = rowMatch[0];
    const rowCells: string[] = [];
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRegex.exec(rowXml))) {
      const attrs = cellMatch[1];
      const body = cellMatch[2];
      const refMatch = attrs.match(/\br="([A-Z]+\d+)"/);
      const typeMatch = attrs.match(/\bt="([^"]+)"/);
      const ref = refMatch?.[1] ?? "";
      const index = ref ? columnIndexFromRef(ref) : rowCells.length;
      const type = typeMatch?.[1] ?? "";
      let value = "";
      if (type === "s") {
        const vMatch = valueRegex.exec(body);
        const sharedIndex = vMatch ? Number(vMatch[1]) : NaN;
        value = Number.isFinite(sharedIndex) ? (sharedStrings[sharedIndex] ?? "") : "";
      } else if (type === "inlineStr") {
        const inlineParts: string[] = [];
        const inlineRegex = /<t[^>]*>([\s\S]*?)<\/t>/g;
        let inlineMatch: RegExpExecArray | null;
        while ((inlineMatch = inlineRegex.exec(body))) {
          inlineParts.push(inlineMatch[1]);
        }
        value = inlineParts.join("");
      } else {
        const vMatch = valueRegex.exec(body);
        value = vMatch?.[1] ?? "";
      }
      value = value
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
      rowCells[index] = value;
    }
    rows.push(rowCells);
  }
  return rows;
}

function workbookRows(filePath: string) {
  let sharedStringsXml = "";
  let sheetXml = "";
  try {
    const zip = new AdmZip(filePath);
    const entries = zip.getEntries();
    const sharedStringsEntry = entries.find((e) => e.entryName.toLowerCase().includes("sharedstrings.xml"));
    if (sharedStringsEntry) {
      sharedStringsXml = sharedStringsEntry.getData().toString("utf8");
    }
    const sheetEntry = entries.find((e) => e.entryName.toLowerCase().startsWith("xl/worksheets/") && e.entryName.toLowerCase().endsWith(".xml"));
    if (sheetEntry) {
      sheetXml = sheetEntry.getData().toString("utf8");
    }
  } catch (err) {
    console.warn(`Failed to read XLSX entries from ${filePath}`, err);
  }
  const sharedStrings = parseSharedStrings(sharedStringsXml);
  return parseWorksheetRows(sheetXml, sharedStrings);
}

function pickField(row: Record<string, string>, keys: string[]) {
  for (const key of keys) {
    const value = String(row[normalizeKey(key)] ?? "").trim();
    if (value) return value;
  }
  for (const rowKey of Object.keys(row)) {
    for (const searchKey of keys) {
      const normalizedSearchKey = normalizeKey(searchKey);
      if (normalizedSearchKey && rowKey.includes(normalizedSearchKey)) {
        const value = String(row[rowKey] ?? "").trim();
        if (value) return value;
      }
    }
  }
  return "";
}

function parseDistributorWorkbookRows(filePath: string) {
  const rows = workbookRows(filePath);
  if (!rows.length) throw new Error("Workbook is empty");

  const headers = rows[0].map((cell) => normalizeKey(cell));
  const parsed: Record<string, string>[] = [];
  for (const row of rows.slice(1)) {
    const mapped: Record<string, string> = {};
    headers.forEach((header, index) => {
      if (header) mapped[header] = String(row[index] ?? "").trim();
    });
    if (Object.values(mapped).every((value) => !value)) continue;
    parsed.push(mapped);
  }
  return parsed;
}

function normalizeCustomerType(value: unknown) {
  return String(value ?? "").trim() === "Individual" ? "Individual" : "Distributor";
}

function buildCustomerFromRow(row: Record<string, string>) {
  const name = pickField(row, ["name", "distributor name", "firm name", "company name", "name distributor firm name"]);
  const email = pickField(row, ["email", "email id"]);
  const phone = pickField(row, ["phone", "mobile", "contact number", "contact no", "contact number"]);
  const address = pickField(row, ["address", "registered office address", "registered office address bill to", "bill to", "billing address"]);
  if (!name) return null;
  const rawDateOfRegistration = pickField(row, ["date of registration", "registration date"]);
  const parsedDateOfRegistration = rawDateOfRegistration ? new Date(rawDateOfRegistration) : undefined;
  return stripUndefined({
    id: generateId(),
    name,
    type: normalizeCustomerType(pickField(row, ["type", "customer type", "distributorship type"])),
    email: email ? email.toLowerCase() : undefined,
    phone,
    address: address || undefined,
    stateRegion: pickField(row, ["state region", "state", "region"]) || undefined,
    registrationCode: pickField(row, ["registration code", "registration no", "registration number"]) || undefined,
    dateOfRegistration: parsedDateOfRegistration && !Number.isNaN(parsedDateOfRegistration.getTime()) ? parsedDateOfRegistration : undefined,
    gst: pickField(row, ["gst", "gstin", "gstin uin"]) || undefined,
    cinNo: pickField(row, ["cin no", "cin", "cinnumber"]) || undefined,
    pan: pickField(row, ["pan"]) || undefined,
    tan: pickField(row, ["tan"]) || undefined,
    contactPersonName: pickField(row, ["contact person name", "contact person"]) || undefined,
    billingAddress: pickField(row, ["registered office address bill to", "billing address", "bill to address"]) || undefined,
    deliveryAddress1: pickField(row, ["delivery address 1 ship to", "delivery address 1", "ship to 1"]) || undefined,
    deliveryAddress2: pickField(row, ["delivery address 2", "ship to 2"]) || undefined,
    deliveryAddress3: pickField(row, ["delivery address 3", "ship to 3"]) || undefined,
    areaAllotted: pickField(row, ["area allotted under distributorship", "area allotted", "area"]) || undefined,
    distributorshipType: pickField(row, ["type of distributorship", "distributorship type"]) || undefined,
    relevantSalesPerson: pickField(row, ["name of relevant sales person", "relevant sales person"]) || undefined,
    status: "Active",
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Customer);
}

function buildPendingCustomerFromRow(row: Record<string, string>, userId: string) {
  const customer = buildCustomerFromRow(row);
  if (!customer) return null;
  return stripUndefined({
    ...customer,
    status: "Pending",
    requestedBy: userId,
    submittedAt: new Date(),
  } as PendingCustomerRegistration);
}

/** GET /api/customers â€” paginated, filterable by name/type */
router.get("/", authenticate, requireAnyPermission("customers:manage", "sales:entry", "dispatch:manage", "accounts:manage"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const { q = "", type, page = "1", limit = "20" } = req.query as Record<string, string>;
  const filter: Record<string, unknown> = {};
  if (q) filter.name = { $regex: q, $options: "i" };
  if (type) filter.type = type;

  const total = await c.customers.countDocuments(filter);
  const p = Math.max(1, parseInt(page));
  const l = Math.min(1000, parseInt(limit));
  const data = await c.customers.find(filter).skip((p - 1) * l).limit(l).toArray();

  return ok(res, { data, total, page: p, limit: l });
});

/** GET /api/customers/pending-registrations â€” Admin queue, or Sales user's own submitted requests */
router.get("/pending-registrations", authenticate, requireAnyPermission("customers:manage", "sales:entry"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const user = (req as any).user as AuthUser;
  const canManageCustomers = user.permissions.includes("customers:manage") || user.role === "Admin";
  const filter = canManageCustomers ? {} : { requestedBy: user.userId };
  const pending = await c.pendingCustomerRegistrations.find(filter).sort({ submittedAt: -1 }).toArray();
  return ok(res, pending);
});

/** POST /api/customers/upload-document â€” upload distributor KYC document to Cloudinary */
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

/** POST /api/customers/request-registration â€” Sales submits distributor/customer for admin approval */
router.post("/request-registration", authenticate, requireAnyPermission("sales:entry"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const user = (req as any).user as AuthUser;
  const {
    name,
    type,
    email,
    phone,
    address,
    stateRegion,
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

  const pending: PendingCustomerRegistration = stripUndefined({
    id: generateId(),
    name: String(name).trim(),
    type: normalizedType,
    email: normalizedEmail || undefined,
    phone: normalizedPhone,
    address: address ? String(address).trim() : undefined,
    stateRegion: stateRegion ? String(stateRegion).trim() : undefined,
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
  } as PendingCustomerRegistration);

  await c.pendingCustomerRegistrations.insertOne(pending);
  try {
    const notification: Notification = {
      id: generateId(),
      type: "customer_registration_requested",
      title: "Distributor Approval Request",
      body: `${pending.name} â€¢ ${pending.phone}`,
      entityType: "customer_registration",
      entityId: pending.id,
      meta: {
        name: pending.name,
        type: pending.type,
        email: pending.email,
        phone: pending.phone,
        stateRegion: pending.stateRegion,
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

/** PUT /api/customers/pending-registrations/:id â€” Admin edits a pending customer/distributor */
router.put("/pending-registrations/:id", authenticate, requireAnyPermission("customers:manage", "sales:entry"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const pending = await c.pendingCustomerRegistrations.findOne({ id: req.params.id });
  if (!pending) return fail(res, "Pending distributor registration not found", 404);
  if (pending.status === "Approved") return fail(res, "Approved request cannot be edited");

  const {
    name,
    type,
    email,
    phone,
    address,
    stateRegion,
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

  const nextName = String(name ?? pending.name ?? "").trim();
  const nextPhone = String(phone ?? pending.phone ?? "").trim();
  const nextEmail = String(email ?? pending.email ?? "").trim().toLowerCase();
  const nextGst = String(gst ?? pending.gst ?? "").trim();
  const nextPan = String(pan ?? pending.pan ?? "").trim();
  if (!nextName || !nextPhone) return fail(res, "name and contact number are required");

  const duplicateChecks: Record<string, string>[] = [];
  if (nextEmail) duplicateChecks.push({ email: nextEmail });
  if (nextPhone) duplicateChecks.push({ phone: nextPhone });
  if (nextGst) duplicateChecks.push({ gst: nextGst });
  if (nextPan) duplicateChecks.push({ pan: nextPan });
  if (duplicateChecks.length) {
    const duplicateCustomer = await c.customers.findOne({ $or: duplicateChecks }, { projection: { id: 1 } });
    if (duplicateCustomer) return fail(res, "This distributor is already registered");
    const duplicatePending = await c.pendingCustomerRegistrations.findOne(
      { id: { $ne: pending.id }, $or: duplicateChecks },
      { projection: { id: 1 } }
    );
    if (duplicatePending) return fail(res, "A distributor registration request is already pending for these details");
  }

  const updated: PendingCustomerRegistration = stripUndefined({
    ...pending,
    name: nextName,
    type: String(type ?? pending.type ?? "Distributor").trim() === "Individual" ? "Individual" : "Distributor",
    email: nextEmail || undefined,
    phone: nextPhone,
    address: address !== undefined ? String(address).trim() : pending.address,
    stateRegion: stateRegion !== undefined ? String(stateRegion).trim() : pending.stateRegion,
    registrationCode: registrationCode !== undefined ? String(registrationCode).trim() : pending.registrationCode,
    dateOfRegistration: dateOfRegistration !== undefined ? (dateOfRegistration ? new Date(String(dateOfRegistration)) : undefined) : pending.dateOfRegistration,
    gst: nextGst || undefined,
    cinNo: cinNo !== undefined ? String(cinNo).trim() : pending.cinNo,
    pan: nextPan || undefined,
    tan: tan !== undefined ? String(tan).trim() : pending.tan,
    contactPersonName: contactPersonName !== undefined ? String(contactPersonName).trim() : pending.contactPersonName,
    billingAddress: billingAddress !== undefined ? String(billingAddress).trim() : pending.billingAddress,
    deliveryAddress1: deliveryAddress1 !== undefined ? String(deliveryAddress1).trim() : pending.deliveryAddress1,
    deliveryAddress2: deliveryAddress2 !== undefined ? String(deliveryAddress2).trim() : pending.deliveryAddress2,
    deliveryAddress3: deliveryAddress3 !== undefined ? String(deliveryAddress3).trim() : pending.deliveryAddress3,
    areaAllotted: areaAllotted !== undefined ? String(areaAllotted).trim() : pending.areaAllotted,
    distributorshipType: distributorshipType !== undefined ? String(distributorshipType).trim() : pending.distributorshipType,
    documentsUploaded: documentsUploaded !== undefined ? normalizeCustomerDocuments(documentsUploaded) : pending.documentsUploaded,
    relevantSalesPerson: relevantSalesPerson !== undefined ? String(relevantSalesPerson).trim() : pending.relevantSalesPerson,
  } as PendingCustomerRegistration);

  await c.pendingCustomerRegistrations.updateOne({ id: pending.id }, { $set: { ...updated, updatedAt: new Date() } });
  return ok(res, updated);
});

/** POST /api/customers/import-distributors â€” Bulk import workbook */
router.post(
  "/import-distributors",
  authenticate,
  requireAnyPermission("customers:manage", "sales:entry"),
  customerBulkUpload.single("file"),
  async (req: Request, res: Response) => {
    const file = req.file;
    if (!file) return fail(res, "Excel file is required");
    const ext = path.extname(file.originalname || "").toLowerCase();
    if (ext !== ".xlsx") return fail(res, "Only .xlsx files are supported");
    const target = String(req.body.target ?? "pending").trim().toLowerCase() === "active" ? "active" : "pending";
    const tempPath = path.join(os.tmpdir(), `distributor-import-${Date.now()}-${Math.random().toString(16).slice(2)}.xlsx`);
    fs.writeFileSync(tempPath, file.buffer);
    const c = await getCollections();
    const user = (req as any).user as AuthUser;
    const warnings: string[] = [];
    let inserted = 0;
    let skipped = 0;

    try {
      const rows = parseDistributorWorkbookRows(tempPath);
      for (const row of rows) {
        const customer = buildCustomerFromRow(row);
        if (!customer) {
          skipped += 1;
          warnings.push("Skipped a row because the name was missing.");
          continue;
        }

        const duplicateChecks: Record<string, string>[] = [];
        if (customer.email) duplicateChecks.push({ email: customer.email });
        if (customer.phone) duplicateChecks.push({ phone: customer.phone });
        if (customer.gst) duplicateChecks.push({ gst: customer.gst });
        if (customer.pan) duplicateChecks.push({ pan: customer.pan });
        const duplicateFilter = duplicateChecks.length ? { $or: duplicateChecks } : null;

        if (target === "active") {
          if (duplicateFilter) {
            const existingCustomer = await c.customers.findOne(duplicateFilter, { projection: { id: 1 } });
            if (existingCustomer) {
              skipped += 1;
              warnings.push(`${customer.name} skipped because it already exists.`);
              continue;
            }
          }
          await c.customers.insertOne(customer);
          inserted += 1;
          continue;
        }

        if (duplicateFilter) {
          const existingCustomer = await c.customers.findOne(duplicateFilter, { projection: { id: 1 } });
          if (existingCustomer) {
            skipped += 1;
            warnings.push(`${customer.name} skipped because it already exists.`);
            continue;
          }
          const existingPending = await c.pendingCustomerRegistrations.findOne(
            { $and: [{ $or: duplicateChecks }, { $or: [{ status: "Pending" }, { status: { $exists: false } }] }] },
            { projection: { id: 1 } }
          );
          if (existingPending) {
            skipped += 1;
            warnings.push(`${customer.name} skipped because a pending request already exists.`);
            continue;
          }
        }

        const pending = buildPendingCustomerFromRow(row, user.userId);
        if (!pending) {
          skipped += 1;
          warnings.push(`${customer.name} skipped because the row could not be mapped.`);
          continue;
        }

        await c.pendingCustomerRegistrations.insertOne(pending);
        try {
          await c.notifications.insertOne({
            id: generateId(),
            type: "customer_registration_requested",
            title: "Distributor Approval Request",
            body: `${pending.name} Ã¢â‚¬Â¢ ${pending.phone}`,
            entityType: "customer_registration",
            entityId: pending.id,
            meta: {
              name: pending.name,
              type: pending.type,
              email: pending.email,
              phone: pending.phone,
              stateRegion: pending.stateRegion,
              gst: pending.gst,
              pan: pending.pan,
              distributorshipType: pending.distributorshipType,
              relevantSalesPerson: pending.relevantSalesPerson,
            },
            audienceRoles: ["Admin"],
            readBy: [],
            createdBy: user.userId,
            createdAt: new Date(),
          });
        } catch (err) {
          console.warn("Failed to insert bulk distributor notification:", err instanceof Error ? err.message : String(err));
        }
        inserted += 1;
      }

      return ok(
        res,
        {
          message: target === "active" ? "Distributor workbook imported successfully." : "Distributor workbook submitted for admin approval.",
          inserted,
          skipped,
          warnings,
        },
        201
      );
    } catch (err) {
      return fail(res, err instanceof Error ? err.message : "Failed to import workbook", 400);
    } finally {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        // ignore
      }
    }
  }
);

/** POST /api/customers/approve/:id â€” Admin approves pending customer/distributor */
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
  const customer: Customer = stripUndefined({
    id: generateId(),
    name: pending.name,
    type: pending.type,
    email: pending.email,
    phone: pending.phone,
    address: pending.address || pending.billingAddress,
    stateRegion: pending.stateRegion,
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
  } as Customer);

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
router.post("/", authenticate, requireAnyPermission("customers:manage", "sales:entry", "dispatch:manage"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const {
    name,
    type,
    email,
    phone,
    address,
    stateRegion,
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
  const nextName = String(name ?? "").trim();
  const nextType = String(type ?? "Distributor").trim();
  const nextEmail = String(email ?? "").trim().toLowerCase();
  const nextPhone = String(phone ?? "").trim();
  const nextAddress = String(address ?? "").trim();
  if (!nextName || !nextType || !nextEmail || !nextPhone || !nextAddress) {
    return fail(res, "name, type, email, phone, address are required");
  }
  const newCustomer: Customer = stripUndefined({
    id: generateId(),
    name: nextName,
    type: nextType === "Individual" ? "Individual" : "Distributor",
    email: nextEmail,
    phone: nextPhone,
    address: nextAddress,
    stateRegion: stateRegion ? String(stateRegion).trim() : undefined,
    registrationCode: registrationCode ? String(registrationCode).trim() : undefined,
    dateOfRegistration: dateOfRegistration ? new Date(String(dateOfRegistration)) : undefined,
    gst: gst ? String(gst).trim() : undefined,
    cinNo: cinNo ? String(cinNo).trim() : undefined,
    pan: pan ? String(pan).trim() : undefined,
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
    status: "Active",
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Customer);
  await c.customers.insertOne(newCustomer);
  return ok(res, newCustomer, 201);
});

/** PUT /api/customers/:id */
router.put("/:id", authenticate, requireAnyPermission("customers:manage"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const id = req.params.id;
  const existing = await c.customers.findOne({ id });
  if (!existing) return fail(res, "Customer not found", 404);
  const nextUpdate = stripUndefined({
    name: req.body.name !== undefined ? String(req.body.name).trim() : undefined,
    type: req.body.type !== undefined ? (String(req.body.type).trim() === "Individual" ? "Individual" : "Distributor") : undefined,
    email: req.body.email !== undefined ? String(req.body.email).trim().toLowerCase() : undefined,
    phone: req.body.phone !== undefined ? String(req.body.phone).trim() : undefined,
    address: req.body.address !== undefined ? String(req.body.address).trim() : undefined,
    stateRegion: req.body.stateRegion !== undefined ? String(req.body.stateRegion).trim() : undefined,
    registrationCode: req.body.registrationCode !== undefined ? String(req.body.registrationCode).trim() : undefined,
    dateOfRegistration: req.body.dateOfRegistration !== undefined ? (req.body.dateOfRegistration ? new Date(String(req.body.dateOfRegistration)) : undefined) : undefined,
    gst: req.body.gst !== undefined ? String(req.body.gst).trim() : undefined,
    cinNo: req.body.cinNo !== undefined ? String(req.body.cinNo).trim() : undefined,
    pan: req.body.pan !== undefined ? String(req.body.pan).trim() : undefined,
    tan: req.body.tan !== undefined ? String(req.body.tan).trim() : undefined,
    contactPersonName: req.body.contactPersonName !== undefined ? String(req.body.contactPersonName).trim() : undefined,
    billingAddress: req.body.billingAddress !== undefined ? String(req.body.billingAddress).trim() : undefined,
    deliveryAddress1: req.body.deliveryAddress1 !== undefined ? String(req.body.deliveryAddress1).trim() : undefined,
    deliveryAddress2: req.body.deliveryAddress2 !== undefined ? String(req.body.deliveryAddress2).trim() : undefined,
    deliveryAddress3: req.body.deliveryAddress3 !== undefined ? String(req.body.deliveryAddress3).trim() : undefined,
    areaAllotted: req.body.areaAllotted !== undefined ? String(req.body.areaAllotted).trim() : undefined,
    distributorshipType: req.body.distributorshipType !== undefined ? String(req.body.distributorshipType).trim() : undefined,
    documentsUploaded: req.body.documentsUploaded !== undefined ? normalizeCustomerDocuments(req.body.documentsUploaded) : undefined,
    relevantSalesPerson: req.body.relevantSalesPerson !== undefined ? String(req.body.relevantSalesPerson).trim() : undefined,
    status: req.body.status !== undefined ? (String(req.body.status).trim() === "Inactive" ? "Inactive" : "Active") : undefined,
    updatedAt: new Date(),
  } as Partial<Customer>);
  await c.customers.updateOne({ id }, { $set: nextUpdate });
  const updated = { ...existing, ...nextUpdate };
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



