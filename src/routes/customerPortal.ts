import express, { type NextFunction, type Request, type Response, type Router } from "express";
import multer from "multer";

import { getCollections } from "../db/collections";
import type { Complaint, Customer, ManufacturedProduct, Notification, Product, Sale } from "../types";
import { uploadBufferToCloudinary } from "../utils/cloudinary";
import { fail, ok } from "../utils/http";
import { generateId } from "../utils/id";
import { generateTicketNumber } from "../utils/ticketNumber";
import { recordTicketAssignmentLog, routeCustomerTicketByStateDistrict, refreshTicketLoadForAssignment } from "../services/ticketRouting";
import {
  ACTIVE_COMPLAINT_DUPLICATE_MESSAGE,
  CLOSED_COMPLAINT_STATUSES,
  normalizeComplaintSerialKey,
} from "../utils/complaintRules";
import { isValidEmailAddress, normalizeEmailAddress } from "../utils/validation";

const router: Router = express.Router();
const STANDARD_WARRANTY_MONTHS = 60;
const PORTAL_SERVICE_REGIONS = [
  { name: "NCR", keywords: ["delhi", "noida", "gurgaon", "gurugram", "faridabad", "ghaziabad"], engineerEmail: "l1.piyush@avavbusiness.com", engineerName: "Piyush", backupEngineerName: "Prashant Noida" },
  { name: "UP", keywords: ["lucknow", "kanpur", "uttar pradesh", "varanasi", "prayagraj"], engineerEmail: "l1.neeraj@avavbusiness.com", engineerName: "Neeraj", backupEngineerName: "Naveen Maurya" },
  { name: "Rajasthan", keywords: ["jaipur", "ajmer", "rajasthan", "udaipur", "jodhpur"], engineerEmail: "l1.prashant.singh@avavbusiness.com", engineerName: "Prashant Singh", backupEngineerName: "Pradeep" },
  { name: "Punjab", keywords: ["ludhiana", "amritsar", "punjab", "jalandhar", "patiala"], engineerEmail: "l1.nitin@avavbusiness.com", engineerName: "Nitin", backupEngineerName: "Swastik" },
] as const;
const PORTAL_DISTRICT_L1_ENGINEER_MAPPING = [
  { state: "Uttar Pradesh", district: "Ghaziabad", engineerEmail: "l1.piyush@avavbusiness.com", engineerName: "Piyush" },
  { state: "Uttar Pradesh", district: "Noida", engineerEmail: "l1.piyush@avavbusiness.com", engineerName: "Piyush" },
  { state: "Rajasthan", district: "Jaipur", engineerEmail: "l1.prashant.singh@avavbusiness.com", engineerName: "Prashant Singh" },
] as const;
const PORTAL_ACTIVE_STATUSES = ["Assigned to Engineer", "In Progress at Aurawatt", "Escalated to L2", "Escalated to L3", "Spare Requested", "Dispatch in Progress"];
const MAX_CUSTOMER_PICTURE_BYTES = 5 * 1024 * 1024;
const STATE_HINTS = [
  { state: "Uttar Pradesh", aliases: ["uttar pradesh", " up ", "lucknow", "kanpur", "varanasi", "prayagraj", "ghaziabad", "noida", "saharanpur", "mathura", "mirzapur"] },
  { state: "Delhi", aliases: ["delhi", "ncr"] },
  { state: "Haryana", aliases: ["haryana", "gurgaon", "gurugram", "faridabad"] },
  { state: "Rajasthan", aliases: ["rajasthan", "jaipur", "ajmer", "udaipur", "jodhpur"] },
  { state: "Punjab", aliases: ["punjab", "ludhiana", "amritsar", "jalandhar", "patiala"] },
  { state: "Bihar", aliases: ["bihar", "patna"] },
] as const;
const DISTRICT_HINTS = [
  "Ghaziabad",
  "Noida",
  "Gurugram",
  "Faridabad",
  "Lucknow",
  "Kanpur",
  "Varanasi",
  "Prayagraj",
  "Jaipur",
  "Ajmer",
  "Udaipur",
  "Jodhpur",
  "Ludhiana",
  "Amritsar",
  "Jalandhar",
  "Patiala",
  "Saharanpur",
  "Mathura",
  "Mirzapur",
  "Patna",
] as const;

function normalizeSerial(value: unknown): string {
  return String(value ?? "").trim();
}

const customerPortalPictureUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_CUSTOMER_PICTURE_BYTES },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) return cb(null, true);
    return cb(new multer.MulterError("LIMIT_UNEXPECTED_FILE", "picture"));
  },
});

function runCustomerPortalPictureUpload(req: Request, res: Response, next: NextFunction) {
  customerPortalPictureUpload.single("picture")(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      return fail(res, "Picture size must be 5 MB or less", 413);
    }
    if (err instanceof multer.MulterError && err.code === "LIMIT_UNEXPECTED_FILE") {
      return fail(res, "Only image files are allowed", 400);
    }
    return next(err);
  });
}

function normalizePhone(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

function mergePhones(...values: unknown[]): string[] {
  const seen = new Set<string>();
  const phones: string[] = [];
  for (const value of values) {
    const items = Array.isArray(value) ? value : [value];
    for (const item of items) {
      const phone = normalizePhone(item);
      if (!phone || seen.has(phone)) continue;
      seen.add(phone);
      phones.push(phone);
    }
  }
  return phones;
}

function derivePriority(issueDescription: string): Complaint["priority"] {
  const issue = issueDescription.toLowerCase();
  if (/(fire|burn|smell|commercial plant down|plant down|smoke)/.test(issue)) return "Emergency";
  if (/(shutdown|system down|not starting|dead|trip)/.test(issue)) return "High";
  if (/(export|battery|charging|hardware|spare)/.test(issue)) return "Medium";
  return "Low";
}

function mapPortalRegion(location?: string) {
  const text = String(location ?? "").trim().toLowerCase();
  return PORTAL_SERVICE_REGIONS.find((region) => region.name.toLowerCase() === text || region.keywords.some((keyword) => text.includes(keyword))) ?? PORTAL_SERVICE_REGIONS[0];
}

function normalizeForLookup(value: unknown) {
  return ` ${String(value ?? "").trim().toLowerCase()} `;
}

function normalizeExactLookup(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function mappedPortalL1EngineerForDistrict(state: unknown, district: unknown) {
  const normalizedState = normalizeExactLookup(state);
  const normalizedDistrict = normalizeExactLookup(district);
  if (!normalizedState || !normalizedDistrict) return undefined;
  return PORTAL_DISTRICT_L1_ENGINEER_MAPPING.find((mapping) => (
    normalizeExactLookup(mapping.state) === normalizedState &&
    normalizeExactLookup(mapping.district) === normalizedDistrict
  ));
}

function firstText(...values: unknown[]) {
  return values.map((value) => String(value ?? "").trim()).find(Boolean);
}

function inferState(...values: unknown[]) {
  const text = normalizeForLookup(values.filter(Boolean).join(" "));
  return STATE_HINTS.find((entry) => entry.aliases.some((alias) => text.includes(alias)))?.state;
}

function inferDistrict(...values: unknown[]) {
  const text = normalizeForLookup(values.filter(Boolean).join(" "));
  return DISTRICT_HINTS.find((district) => text.includes(district.toLowerCase()));
}

function addMonths(date: Date, months: number) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function calculateWarrantyStatus(soldDate?: Date | string) {
  if (!soldDate) return "Unknown";
  const parsed = new Date(soldDate);
  if (!Number.isFinite(parsed.getTime())) return "Unknown";
  return addMonths(parsed, STANDARD_WARRANTY_MONTHS).getTime() >= Date.now() ? "In Warranty" : "Out of Warranty";
}

async function assignPortalTicket(input: {
  state?: string;
  district?: string;
}) {
  return routeCustomerTicketByStateDistrict({
    state: String(input.state ?? ""),
    district: String(input.district ?? ""),
  });
}

async function findManufacturedBySerial(serialNumber: string) {
  const c = await getCollections();
  return c.manufactured.findOne({ serialNumber });
}

async function findLatestSaleForSerial(serialNumber: string, manufactured?: ManufacturedProduct | null) {
  const c = await getCollections();
  const invoiceNo = manufactured?.invoiceNo ? String(manufactured.invoiceNo) : "";
  const saleByInvoice = invoiceNo
    ? await c.sales.findOne({ referenceNo: invoiceNo })
    : null;
  if (saleByInvoice) return saleByInvoice;

  return c.sales.find({ serialNumber }).sort({ saleDate: -1 }).limit(1).next();
}

function invoiceAddressFor(sale?: Sale | null, customer?: Customer | null) {
  return firstText(
    sale?.unregisteredCustomerAddress,
    customer?.deliveryAddress1,
    customer?.deliveryAddress2,
    customer?.deliveryAddress3,
    customer?.billingAddress,
    customer?.address
  );
}

async function resolveInvoiceServiceDetails(serialNumber: string, manufactured: ManufacturedProduct) {
  const c = await getCollections();
  const sale = await findLatestSaleForSerial(serialNumber, manufactured);
  const customerId = sale?.customerId ?? manufactured.customerId;
  const customer = customerId ? await c.customers.findOne({ id: customerId }) : null;
  const product = manufactured.productId ? await c.products.findOne({ id: manufactured.productId }) : null;
  const invoiceAddress = invoiceAddressFor(sale, customer);
  const regionSource = firstText(sale?.stateRegion, customer?.stateRegion, customer?.areaAllotted, invoiceAddress);
  const state = inferState(sale?.stateRegion, customer?.stateRegion, invoiceAddress);
  const district = inferDistrict(invoiceAddress, sale?.stateRegion, customer?.stateRegion);
  const warrantyStatus = calculateWarrantyStatus(manufactured.soldDate ?? sale?.saleDate);

  return {
    productName: product?.series ?? product?.model ?? manufactured.productId,
    productModel: product?.model ?? manufactured.productId,
    state,
    district,
    region: mapPortalRegion(regionSource).name,
    warrantyStatus,
    customer,
    sale,
    invoiceAddress,
  };
}

/**
 * POST /api/customer-portal/login
 * Lightweight customer verification for QR/link support flow.
 */
router.post("/login", async (req: Request, res: Response) => {
  const c = await getCollections();
  const serialNumber = normalizeSerial(req.body.serialNumber);
  const mobile = normalizePhone(req.body.mobile);

  if (!mobile) return fail(res, "Mobile number is required");

  if (!serialNumber) {
    return ok(res, {
      session: {
        serialNumber: "",
        productId: "",
        productName: undefined,
        productModel: undefined,
        soldDate: undefined,
        customerId: undefined,
      },
      product: {
        name: undefined,
        model: undefined,
      },
      customer: null,
      activeComplaint: null,
    });
  }

  const activeComplaint = await c.complaints.findOne(
    {
      productSerialNoKey: normalizeComplaintSerialKey(serialNumber),
      status: { $nin: [...CLOSED_COMPLAINT_STATUSES] },
    },
    { projection: { id: 1, status: 1 } }
  );
  const activeComplaintPayload = activeComplaint
    ? {
        id: activeComplaint.id,
        status: activeComplaint.status,
        message: ACTIVE_COMPLAINT_DUPLICATE_MESSAGE,
      }
    : null;

  const manufactured = await findManufacturedBySerial(serialNumber);
  if (!manufactured) {
    // The serial may exist in the serials master (imported / allocated inventory)
    // without a linked manufactured or sold record yet. It is still a genuine
    // Aurawatt serial, so accept it and let the customer proceed to raise a
    // complaint instead of blocking them with "Serial number not found".
    const serialEntry = await c.serials.findOne({ serialNumber });
    if (!serialEntry) return fail(res, "Serial number not found", 404);
    const seriesProduct = await c.products.findOne({ series: serialEntry.productSeriesId });
    return ok(res, {
      session: {
        serialNumber: serialEntry.serialNumber,
        productId: seriesProduct?.id ?? "",
        productName: seriesProduct?.series ?? serialEntry.productSeriesId,
        productModel: seriesProduct?.model,
        soldDate: undefined,
        customerId: undefined,
      },
      customer: null,
      activeComplaint: activeComplaintPayload,
    });
  }
  const invoiceDetails = await resolveInvoiceServiceDetails(serialNumber, manufactured);

  const customer = manufactured.customerId
    ? await c.customers.findOne({ id: manufactured.customerId }, { projection: { id: 1, name: 1, phone: 1, email: 1 } })
    : null;

  return ok(res, {
    session: {
      serialNumber: manufactured.serialNumber,
      productId: manufactured.productId,
      productName: invoiceDetails.productName,
      productModel: invoiceDetails.productModel,
      soldDate: manufactured.soldDate,
      customerId: manufactured.customerId,
    },
    customer: customer
      ? {
          id: customer.id,
          name: customer.name,
          phone: customer.phone,
          email: customer.email,
        }
      : null,
    activeComplaint: activeComplaintPayload,
  });
});

/**
 * POST /api/customer-portal/complaints
 * Public customer complaint intake from mobile web / QR link.
 */
router.post("/complaints", runCustomerPortalPictureUpload, async (req: Request, res: Response) => {
  const c = await getCollections();
  const serialNumber = normalizeSerial(req.body.serialNumber);
  const mobile = normalizePhone(req.body.mobile);
  const customerName = String(req.body.customerName ?? "").trim();
  const customerEmail = normalizeEmailAddress(req.body.customerEmail);
  const issueDescription = String(req.body.issueDescription ?? "").trim();
  const state = String(req.body.state ?? "").trim();
  const district = String(req.body.district ?? "").trim();

  if (!mobile || !issueDescription) {
    return fail(res, "Mobile number and issue description are required");
  }
  if (!state || !district) {
    return fail(res, "State and district are required");
  }
  if (!customerName) {
    return fail(res, "Customer name is required");
  }
  if (customerEmail && !isValidEmailAddress(customerEmail)) {
    return fail(res, "Please enter a valid email address");
  }

  const manufactured = serialNumber ? await findManufacturedBySerial(serialNumber) : null;
  let serialSeriesProduct: Product | null = null;
  if (serialNumber && !manufactured) {
    // Accept serials present in the serials master but not yet linked to a
    // manufactured / sold record (mirrors the /login fallback).
    const serialEntry = await c.serials.findOne({ serialNumber });
    if (!serialEntry) return fail(res, "Serial number not found", 404);
    serialSeriesProduct = await c.products.findOne({ series: serialEntry.productSeriesId });
  }
  const invoiceDetails = serialNumber && manufactured ? await resolveInvoiceServiceDetails(serialNumber, manufactured) : null;
  const activeDuplicate = serialNumber
    ? await c.complaints.findOne({
      productSerialNoKey: normalizeComplaintSerialKey(serialNumber),
      status: { $nin: [...CLOSED_COMPLAINT_STATUSES] },
    })
    : null;
  if (activeDuplicate) {
    return fail(res, ACTIVE_COMPLAINT_DUPLICATE_MESSAGE, 409);
  }

  const linkedCustomer = invoiceDetails?.customer ?? null;
  const siteLocation = String(req.body.siteLocation ?? invoiceDetails?.invoiceAddress ?? linkedCustomer?.address ?? "").trim();

  const now = new Date();
  const customerReportedPictures = req.file
    ? [
        {
          fileName: req.file.originalname,
          fileType: req.file.mimetype || undefined,
          fileSize: req.file.size,
          ...(await uploadBufferToCloudinary(req.file, "complaints/customer-portal")),
          uploadedAt: now,
        },
      ]
    : undefined;

  let assignmentDecision: Awaited<ReturnType<typeof assignPortalTicket>> | null = null;
  try {
    const assignment = await assignPortalTicket({ state, district });
    assignmentDecision = assignment && !("blockedMessage" in assignment) ? assignment : null;
  } catch (err) {
    console.warn("Customer portal assignment fallback:", err instanceof Error ? err.message : String(err));
    assignmentDecision = null;
  }
  const customerPhones = mergePhones(mobile, linkedCustomer?.phone, manufactured?.customerPhones);
  const ticketNumber = await generateTicketNumber(now);
  const complaint: Complaint = {
    id: generateId(),
    ticketNumber,
    type: "Consumer",
    ...(serialNumber
      ? {
          productSerialNo: serialNumber,
          productSerialNoKey: normalizeComplaintSerialKey(serialNumber),
        }
      : {}),
    customerReportedPictures,
    customerId: linkedCustomer?.id ?? manufactured?.customerId,
    customerName,
    customerPhone: mobile,
    customerPhones,
    customerEmail: customerEmail || undefined,
    dateOfSale: manufactured?.soldDate
      ? new Date(manufactured.soldDate)
      : invoiceDetails?.sale?.saleDate
        ? new Date(invoiceDetails.sale.saleDate)
        : undefined,
    dateOfComplaint: now,
    issueDescription,
    ticketSource: "Link",
    l1Sla: "4 Hours",
    siteLocation: siteLocation || undefined,
    state,
    district,
    region: mapPortalRegion(`${state} ${district} ${siteLocation}`).name,
    priority: derivePriority(issueDescription),
    warrantyStatus: invoiceDetails?.warrantyStatus,
    productModel: invoiceDetails?.productModel ?? serialSeriesProduct?.model,
    assignmentStatus: assignmentDecision?.assignmentStatus,
    assignedEngineerId: assignmentDecision?.assignedEngineerId,
    assignedEngineerName: assignmentDecision?.assignedEngineerName,
    backupEngineerName: assignmentDecision?.backupEngineerName,
    activeTicketCountAtAssignment: assignmentDecision?.activeTicketCountAtAssignment,
    slaStartedAt: assignmentDecision?.slaStartedAt,
    slaDueAt: assignmentDecision?.slaDueAt,
    slaPaused: assignmentDecision?.slaPaused,
    initialAction: "Customer portal intake. Service team to triage and assign engineer.",
    escalationLevel: "L1",
    spareRequired: false,
    spareInventoryStatus: "Not Required",
    siteVisitRequired: false,
    l3SupportRequired: false,
    status: assignmentDecision?.status ?? "Open at Aurawatt",
    raisedBy: "customer-portal",
    createdAt: now,
    updatedAt: now,
  };

  await c.complaints.insertOne(complaint);
  if (manufactured) {
    await c.manufactured.updateOne(
      { serialNumber },
      { $set: { customerPhones, updatedAt: now } }
    );
  }
  if (assignmentDecision && complaint.assignedEngineerId) {
    try {
      await recordTicketAssignmentLog({
        ticketId: complaint.id,
        customerName: complaint.customerName ?? customerName,
        mobileNumber: complaint.customerPhone ?? mobile,
        email: complaint.customerEmail,
        state: complaint.state ?? state,
        district: complaint.district ?? district,
        assignedEngineerId: complaint.assignedEngineerId ?? "",
        assignedEngineerName: complaint.assignedEngineerName ?? "",
        assignmentType: assignmentDecision.assignmentType,
        assignmentReason: assignmentDecision.assignmentReason,
        activeTicketCountAtAssignment: assignmentDecision.activeTicketCountAtAssignment,
        lobbyTicketCountAtAssignment: assignmentDecision.lobbyTicketCountAtAssignment,
        totalTicketCountAtAssignment: assignmentDecision.totalTicketCountAtAssignment,
        assignmentStatus: assignmentDecision.assignmentStatus,
        status: assignmentDecision.status,
        createdBy: "customer-portal",
        lastUpdatedBy: "customer-portal",
        backupEngineerName: assignmentDecision.backupEngineerName,
        slaStartedAt: assignmentDecision.slaStartedAt,
        slaDueAt: assignmentDecision.slaDueAt,
        slaPaused: assignmentDecision.slaPaused,
      });
    } catch (err) {
      console.warn("Failed to record customer portal assignment log:", err instanceof Error ? err.message : String(err));
    }
  }
  if (complaint.assignedEngineerId) {
    try {
      await refreshTicketLoadForAssignment(complaint.assignedEngineerId, complaint.assignedEngineerName);
    } catch (err) {
      console.warn("Failed to refresh assigned engineer load:", err instanceof Error ? err.message : String(err));
    }
  }

  try {
    const notification: Notification = {
      id: generateId(),
      type: "complaint_created",
      title: "QR complaint received",
      body: `${complaint.productSerialNo} • ${complaint.customerName || "Customer"} • ${complaint.customerPhone || "No mobile"} • Sales/Admin review required`,
      entityType: "complaint",
      entityId: complaint.id,
      meta: {
        serialNumber,
        customerName: complaint.customerName,
        customerPhone: complaint.customerPhone,
        customerEmail: complaint.customerEmail,
        issueDescription: complaint.issueDescription,
        siteLocation: complaint.siteLocation,
        state: complaint.state,
        district: complaint.district,
        region: complaint.region,
        dealerName: complaint.dealerName,
        warrantyStatus: complaint.warrantyStatus,
        assignedEngineerName: complaint.assignedEngineerName,
        ticketSource: "Link",
      },
      audienceRoles: ["Admin", "Sales", "L1 Engineer"],
      readBy: [],
      createdBy: "customer-portal",
      createdAt: now,
    };
    await c.notifications.insertOne(notification);
  } catch (err) {
    console.warn("Failed to insert complaint notification:", err instanceof Error ? err.message : String(err));
  }

  return ok(res, {
    id: complaint.id,
    ticketNumber: complaint.ticketNumber,
    status: complaint.status,
    productSerialNo: complaint.productSerialNo || "",
    dateOfComplaint: complaint.dateOfComplaint,
  }, 201);
});

export default router;
