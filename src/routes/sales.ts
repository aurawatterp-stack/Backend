import express, { type NextFunction, type Request, type Response, type Router } from "express";
import multer from "multer";

import { getCollections } from "../db/collections";
import { authenticate, authorize, requireAnyPermission } from "../middleware/auth";
import type { AuthUser, ManufacturedProduct, Notification, Sale } from "../types";
import { uploadBufferToCloudinary } from "../utils/cloudinary";
import { fail, ok } from "../utils/http";
import { generateId } from "../utils/id";
import { updateSerialStatus } from "../utils/serialLifecycle";

const router: Router = express.Router();
const MAX_DISPATCH_DOCKET_BYTES = 5 * 1024 * 1024;

const dispatchDocketUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DISPATCH_DOCKET_BYTES },
});

function parsePiItems(value: unknown): Sale["piItems"] {
  if (!Array.isArray(value)) return undefined;
  const parsed: NonNullable<Sale["piItems"]> = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const materialName = String(row.materialName ?? "").trim();
    const quantity = Number(row.quantity);
    const rate = Number(row.rate);
    const gstRate = Number(row.gstRate);
    const hsnSac = String(row.hsnSac ?? "8504").trim() || "8504";
    if (!materialName || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(rate) || rate < 0 || !Number.isFinite(gstRate) || gstRate < 0) {
      continue;
    }
    parsed.push({ materialName, hsnSac, quantity, rate, gstRate });
  }
  return parsed;
}

type SalesCollections = Awaited<ReturnType<typeof getCollections>>;
const PI_WORKFLOW_VERSION = "payment-dispatch-v2";
const PI_STATUS_SUBMITTED = "Dispatch Request Pending";
const REGISTERED_PRICE_CATEGORY = "Distributor Price";
const PI_STATUS_PAYMENT_VERIFIED = "Payment Verified";
const PI_STATUS_DISPATCH_READY = "Vehicle No. Shared";
const PI_STATUS_DISPATCHED = "Dispatched";

function piYearFromDate(value: unknown) {
  const parsed = value ? new Date(String(value)) : new Date();
  return Number.isFinite(parsed.getTime()) ? parsed.getFullYear() : new Date().getFullYear();
}

function isPlaceholderPiNumber(value: string) {
  return /^PI-\d{4}-X+$/i.test(value);
}

function normalizePriceCategoryForRegistration(isRegistered: boolean, priceCategory?: string) {
  if (isRegistered) return REGISTERED_PRICE_CATEGORY;
  if (priceCategory === "Dealer Price" || priceCategory === "Distributor Price" || priceCategory === "MSP" || priceCategory === "Manual") {
    return priceCategory;
  }
  return REGISTERED_PRICE_CATEGORY;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeSerialNumber(value: unknown) {
  return String(value ?? "").trim();
}

async function resolveManufacturedProductForSerial(
  c: SalesCollections,
  sale: Pick<Sale, "serialNumber" | "materialName" | "referenceNo" | "saleDate" | "customerId" | "paymentStatus">,
  serialNumber: unknown
) {
  const serial = normalizeSerialNumber(serialNumber);
  if (!serial) return null;

  const directMatch = await c.manufactured.findOne({ serialNumber: serial });
  if (directMatch) return directMatch;

  const caseInsensitiveMatch = await c.manufactured.findOne({
    serialNumber: { $regex: `^${escapeRegExp(serial)}$`, $options: "i" },
  });
  if (caseInsensitiveMatch) return caseInsensitiveMatch;

  const serialEntry = await c.serials.findOne({
    serialNumber: { $regex: `^${escapeRegExp(serial)}$`, $options: "i" },
  });
  if (!serialEntry) return null;

  const product = serialEntry.productSeriesId
    ? await c.products.findOne({ series: serialEntry.productSeriesId })
    : sale.materialName
      ? await c.products.findOne({ model: sale.materialName })
      : null;

  const fallbackManufactured: ManufacturedProduct = {
    id: generateId(),
    serialNumber: serial,
    productId: product?.id ?? "",
    mfgDate: sale.saleDate ? new Date(sale.saleDate) : new Date(),
    status: "Sold",
    invoiceNo: sale.referenceNo,
    paymentStatus: sale.paymentStatus === "Confirmed" ? "Verified" : "Pending",
    customerId: sale.customerId,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  await c.manufactured.insertOne(fallbackManufactured);
  return fallbackManufactured;
}

async function nextPiNumber(c: SalesCollections, year = new Date().getFullYear()) {
  const rows = await c.sales
    .find({ referenceNo: { $regex: `^PI-${year}-\\d+$`, $options: "i" } }, { projection: { referenceNo: 1 } })
    .toArray();
  const maxNumber = rows.reduce((max, row) => {
    const match = String(row.referenceNo ?? "").match(new RegExp(`^PI-${year}-(\\d+)$`, "i"));
    return match ? Math.max(max, Number(match[1]) || 0) : max;
  }, 0);
  return `PI-${year}-${String(maxNumber + 1).padStart(4, "0")}`;
}

async function resolveUniquePiNumber(c: SalesCollections, value: unknown, saleDate: unknown, excludeSaleId?: string) {
  const year = piYearFromDate(saleDate);
  let referenceNo = String(value ?? "").trim();
  if (!referenceNo || isPlaceholderPiNumber(referenceNo)) {
    referenceNo = await nextPiNumber(c, year);
  }

  const duplicate = await c.sales.findOne(
    { referenceNo, ...(excludeSaleId ? { id: { $ne: excludeSaleId } } : {}) },
    { projection: { id: 1 } }
  );
  if (duplicate) {
    throw new Error("This PI number already exists. Please generate a new PI number.");
  }
  return referenceNo;
}

function isNewPiWorkflow(sale: Sale) {
  return sale.piWorkflowVersion === PI_WORKFLOW_VERSION;
}

function workflowEvent(
  sale: Sale,
  user: AuthUser,
  action: string,
  toStatus: string,
  department: "Sales" | "Accounts" | "Dispatch",
  note?: string
): NonNullable<Sale["piWorkflowHistory"]>[number] {
  return {
    id: generateId(),
    action,
    fromStatus: sale.piWorkflowStatus,
    toStatus,
    department,
    by: user.userId,
    byName: user.name,
    byRole: user.role,
    at: new Date(),
    note,
  };
}

function runDispatchDocketUpload(req: Request, res: Response, next: NextFunction) {
  dispatchDocketUpload.single("docket")(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      return fail(res, "File size must be 5 MB or less", 413);
    }
    return next(err);
  });
}

function runPiUpload(req: Request, res: Response, next: NextFunction) {
  dispatchDocketUpload.single("pi")(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      return fail(res, "File size must be 5 MB or less", 413);
    }
    return next(err);
  });
}

/** GET /api/sales */
router.get("/", authenticate, requireAnyPermission("sales:entry", "dispatch:manage", "accounts:manage"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const { page = "1", limit = "20", sort = "" } = req.query as Record<string, string>;
  const p = Math.max(1, parseInt(page));
  const l = Math.min(100, parseInt(limit));
  const sortSpec: Record<string, 1 | -1> = sort === "accountsQueue"
    ? { accountsRequestAt: -1 as const, createdAt: -1 as const, saleDate: -1 as const }
    : { saleDate: -1 as const };
  const total = await c.sales.countDocuments({});
  const data = await c.sales
    .find({})
    .sort(sortSpec)
    .skip((p - 1) * l)
    .limit(l)
    .toArray();
  return ok(res, { data, total, page: p, limit: l });
});

router.get("/next-pi-number", authenticate, requireAnyPermission("sales:entry"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const yearParam = Number((req.query as Record<string, string>).year);
  const year = Number.isInteger(yearParam) && yearParam >= 2000 && yearParam <= 9999 ? yearParam : new Date().getFullYear();
  return ok(res, { referenceNo: await nextPiNumber(c, year) });
});

router.put("/:id/force-pi", authenticate, authorize("Admin"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const { id } = req.params;
  const {
    documentType,
    referenceNo,
    saleDate,
    customerId,
    unregisteredCustomerName,
    unregisteredCustomerAddress,
    unregisteredCustomerGst,
    shipToAddressKey,
    registrationCode,
    materialName,
    quantity,
    piItems,
    stateRegion,
    dealerRegistered,
    priceCategory,
    availableQuantity,
    inventoryStatus,
    expectedDispatchDate,
    dispatchStatus,
    paymentStatus,
  } = req.body;

  const sale = await c.sales.findOne({ id });
  if (!sale) return fail(res, "PI record not found", 404);
  if (sale.forcePiApprovalStatus !== "Pending") return fail(res, "Only pending PI can be edited before approval");

  const update: Partial<Sale> = {};
  const effectiveRegisteredCustomer = typeof dealerRegistered === "boolean" ? dealerRegistered : sale.dealerRegistered !== false;
  if (documentType !== undefined) update.documentType = String(documentType);
  if (saleDate) update.saleDate = new Date(saleDate);
  if (referenceNo !== undefined) {
    try {
      update.referenceNo = await resolveUniquePiNumber(c, referenceNo, saleDate ?? sale.saleDate, String(id));
    } catch (err) {
      return fail(res, err instanceof Error ? err.message : "Invalid PI number");
    }
  }
  if (customerId !== undefined) {
    const customer = await c.customers.findOne({ id: String(customerId) }, { projection: { id: 1 } });
    if (!customer) return fail(res, "Customer not found", 404);
    update.customerId = String(customerId);
  }
  if (unregisteredCustomerName !== undefined) update.unregisteredCustomerName = String(unregisteredCustomerName);
  if (unregisteredCustomerAddress !== undefined) update.unregisteredCustomerAddress = String(unregisteredCustomerAddress);
  if (unregisteredCustomerGst !== undefined) update.unregisteredCustomerGst = String(unregisteredCustomerGst);
  if (shipToAddressKey !== undefined) update.shipToAddressKey = shipToAddressKey;
  if (registrationCode !== undefined) update.registrationCode = String(registrationCode);
  if (materialName !== undefined) update.materialName = String(materialName);
  if (quantity !== undefined && quantity !== null) update.quantity = Number(quantity);
  if (piItems !== undefined) {
    const parsedPiItems = parsePiItems(piItems);
    if (!parsedPiItems?.length) return fail(res, "At least one valid PI item is required");
    update.piItems = parsedPiItems;
    update.materialName = parsedPiItems[0].materialName;
    update.quantity = parsedPiItems.reduce((sum, item) => sum + item.quantity, 0);
  }
  if (stateRegion !== undefined) update.stateRegion = String(stateRegion);
  if (typeof dealerRegistered === "boolean") update.dealerRegistered = dealerRegistered;
  if (priceCategory !== undefined) {
    if (effectiveRegisteredCustomer && priceCategory !== REGISTERED_PRICE_CATEGORY) {
      return fail(res, "Registered PI supports only Distributor Price");
    }
    update.priceCategory = normalizePriceCategoryForRegistration(effectiveRegisteredCustomer, String(priceCategory));
  }
  if (availableQuantity !== undefined && availableQuantity !== null) update.availableQuantity = Number(availableQuantity);
  if (inventoryStatus !== undefined) update.inventoryStatus = inventoryStatus;
  if (expectedDispatchDate) update.expectedDispatchDate = new Date(expectedDispatchDate);
  if (dispatchStatus !== undefined) update.dispatchStatus = dispatchStatus;
  if (paymentStatus !== undefined) update.paymentStatus = paymentStatus;

  if (Object.keys(update).length === 0) return fail(res, "No PI updates provided");

  await c.sales.updateOne({ id }, { $set: update });
  const updated = await c.sales.findOne({ id });
  return ok(res, updated);
});

router.post("/:id/approve-force-pi", authenticate, authorize("Admin"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const { id } = req.params;
  const {
    documentType,
    referenceNo,
    saleDate,
    customerId,
    dealerRegistered,
    registrationCode,
    unregisteredCustomerName,
    unregisteredCustomerAddress,
    unregisteredCustomerGst,
    shipToAddressKey,
    materialName,
    quantity,
    piItems,
    stateRegion,
    priceCategory,
    availableQuantity,
    inventoryStatus,
    expectedDispatchDate,
    dispatchStatus,
    paymentStatus,
  } = req.body;

  const sale = await c.sales.findOne({ id });
  if (!sale) return fail(res, "PI record not found", 404);
  if (sale.forcePiApprovalStatus === "Approved") return fail(res, "Force PI is already approved");

  const user = (req as any).user as AuthUser;
  const update: Partial<Sale> = {
    forcePiPermission: true,
    forcePiApprovalStatus: "Approved",
    forcePiApprovedBy: user.userId,
    forcePiApprovedAt: new Date(),
  };
  const effectiveRegisteredCustomer = typeof dealerRegistered === "boolean" ? dealerRegistered : sale.dealerRegistered !== false;

  if (documentType !== undefined) update.documentType = String(documentType);
  if (saleDate) update.saleDate = new Date(saleDate);
  if (referenceNo !== undefined) {
    try {
      update.referenceNo = await resolveUniquePiNumber(c, referenceNo, saleDate ?? sale.saleDate, String(id));
    } catch (err) {
      return fail(res, err instanceof Error ? err.message : "Invalid PI number");
    }
  }
  if (customerId !== undefined) {
    const customer = await c.customers.findOne({ id: String(customerId) }, { projection: { id: 1 } });
    if (!customer) return fail(res, "Customer not found", 404);
    update.customerId = String(customerId);
  }
  if (typeof dealerRegistered === "boolean") update.dealerRegistered = dealerRegistered;
  if (registrationCode !== undefined) update.registrationCode = String(registrationCode);
  if (unregisteredCustomerName !== undefined) update.unregisteredCustomerName = String(unregisteredCustomerName);
  if (unregisteredCustomerAddress !== undefined) update.unregisteredCustomerAddress = String(unregisteredCustomerAddress);
  if (unregisteredCustomerGst !== undefined) update.unregisteredCustomerGst = String(unregisteredCustomerGst);
  if (shipToAddressKey !== undefined) update.shipToAddressKey = shipToAddressKey;
  if (materialName !== undefined) update.materialName = String(materialName);
  if (quantity !== undefined && quantity !== null) update.quantity = Number(quantity);
  if (piItems !== undefined) {
    const parsedPiItems = parsePiItems(piItems);
    if (!parsedPiItems?.length) return fail(res, "At least one valid PI item is required");
    update.piItems = parsedPiItems;
    update.materialName = parsedPiItems[0].materialName;
    update.quantity = parsedPiItems.reduce((sum, item) => sum + item.quantity, 0);
  }
  if (stateRegion !== undefined) update.stateRegion = String(stateRegion);
  if (priceCategory !== undefined) {
    if (effectiveRegisteredCustomer && priceCategory !== REGISTERED_PRICE_CATEGORY) {
      return fail(res, "Registered PI supports only Distributor Price");
    }
    update.priceCategory = normalizePriceCategoryForRegistration(effectiveRegisteredCustomer, String(priceCategory));
  }
  if (availableQuantity !== undefined && availableQuantity !== null) update.availableQuantity = Number(availableQuantity);
  if (inventoryStatus !== undefined) update.inventoryStatus = inventoryStatus;
  if (expectedDispatchDate) update.expectedDispatchDate = new Date(expectedDispatchDate);
  if (dispatchStatus !== undefined) update.dispatchStatus = dispatchStatus;
  if (paymentStatus !== undefined) update.paymentStatus = paymentStatus;

  await c.sales.updateOne({ id }, { $set: update });
  const approved = await c.sales.findOne({ id });
  return ok(res, approved);
});

/** POST /api/sales/upload-docket â€” upload courier docket file to Cloudinary */
router.post(
  "/upload-docket",
  authenticate,
  requireAnyPermission("dispatch:manage"),
  runDispatchDocketUpload,
  async (req: Request, res: Response) => {
    const file = req.file;
    if (!file) return fail(res, "Courier docket file is required");

    try {
      const uploaded = await uploadBufferToCloudinary(file, "aurawatt/dispatch-dockets");
      if (!uploaded.url) return fail(res, "Cloudinary did not return a file URL", 502);
      return ok(
        res,
        {
          fileName: file.originalname,
          fileType: file.mimetype || undefined,
          fileSize: file.size,
          url: uploaded.url,
          publicId: uploaded.publicId,
          resourceType: uploaded.resourceType,
          format: uploaded.format,
          uploadedAt: new Date(),
        },
        201
      );
    } catch (err) {
      return fail(res, err instanceof Error ? err.message : "Failed to upload courier docket", 502);
    }
  }
);

/** POST /api/sales/upload-pi â€” upload PI file to Cloudinary */
router.post(
  "/upload-pi",
  authenticate,
  requireAnyPermission("sales:entry", "accounts:manage"),
  runPiUpload,
  async (req: Request, res: Response) => {
    const file = req.file;
    if (!file) return fail(res, "PI file is required");

    try {
      const uploaded = await uploadBufferToCloudinary(file, "aurawatt/pi-attachments");
      if (!uploaded.url) return fail(res, "Cloudinary did not return a file URL", 502);
      return ok(
        res,
        {
          fileName: file.originalname,
          fileType: file.mimetype || undefined,
          fileSize: file.size,
          url: uploaded.url,
          publicId: uploaded.publicId,
          resourceType: uploaded.resourceType,
          format: uploaded.format,
          uploadedAt: new Date(),
        },
        201
      );
    } catch (err) {
      return fail(res, err instanceof Error ? err.message : "Failed to upload PI file", 502);
    }
  }
);

router.put("/:id/accounts", authenticate, requireAnyPermission("accounts:manage"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const { id } = req.params;
  const {
    taxInvoiceAttachmentName,
    taxInvoiceAttachmentUrl,
    ewayBillAttachmentName,
    ewayBillAttachmentUrl,
    paymentStatus,
  } = req.body;

  const sale = await c.sales.findOne({ id });
  if (!sale) return fail(res, "PI record not found", 404);
  if (!sale.referenceNo) return fail(res, "PI must be generated before payment verification");

  const user = (req as any).user as AuthUser;
  const update: Partial<Sale> = {};
  const hasDocumentUpload =
    taxInvoiceAttachmentName !== undefined ||
    taxInvoiceAttachmentUrl !== undefined ||
    ewayBillAttachmentName !== undefined ||
    ewayBillAttachmentUrl !== undefined;
  const wantsPaymentVerification = paymentStatus === "Confirmed";

  if (isNewPiWorkflow(sale)) {
    if (hasDocumentUpload) {
      if (sale.paymentStatus !== "Confirmed") {
        return fail(res, "Accounts cannot upload Tax Invoice or E-Way Bill before payment verification");
      }
      if (sale.piWorkflowStatus !== PI_STATUS_DISPATCH_READY) {
        return fail(res, "Accounts can upload Tax Invoice and E-Way Bill only after vehicle no. is shared");
      }
    } else if (wantsPaymentVerification) {
      if (!sale.accountsRequestAt) {
        return fail(res, "Dispatch Team must forward the PI to Accounts before payment verification");
      }
      if (sale.piWorkflowStatus !== PI_STATUS_SUBMITTED) {
        return fail(res, "Payment verification can only be completed from the Accounts payment queue");
      }
    } else {
      return fail(res, "Use Mark as Payment Verified, or upload Tax Invoice and E-Way Bill after vehicle no. is shared");
    }
  }

  if (taxInvoiceAttachmentName !== undefined) update.taxInvoiceAttachmentName = String(taxInvoiceAttachmentName);
  if (taxInvoiceAttachmentUrl !== undefined) update.taxInvoiceAttachmentUrl = String(taxInvoiceAttachmentUrl);
  if (ewayBillAttachmentName !== undefined) update.ewayBillAttachmentName = String(ewayBillAttachmentName);
  if (ewayBillAttachmentUrl !== undefined) update.ewayBillAttachmentUrl = String(ewayBillAttachmentUrl);
  if (paymentStatus !== undefined) update.paymentStatus = paymentStatus === "Confirmed" ? "Confirmed" : "Pending";

  if (
    (taxInvoiceAttachmentName !== undefined || taxInvoiceAttachmentUrl !== undefined || ewayBillAttachmentName !== undefined || ewayBillAttachmentUrl !== undefined) &&
    (
      (!update.taxInvoiceAttachmentName && !sale.taxInvoiceAttachmentName) ||
      (!update.ewayBillAttachmentName && !sale.ewayBillAttachmentName)
    )
  ) {
    return fail(res, "Tax Invoice and E-Way Bill upload required before accounts documents can be shared");
  }

  if (
    isNewPiWorkflow(sale) &&
    hasDocumentUpload &&
    (
      !(update.taxInvoiceAttachmentName || sale.taxInvoiceAttachmentName) ||
      !(update.taxInvoiceAttachmentUrl || sale.taxInvoiceAttachmentUrl) ||
      !(update.ewayBillAttachmentName || sale.ewayBillAttachmentName) ||
      !(update.ewayBillAttachmentUrl || sale.ewayBillAttachmentUrl)
    )
  ) {
    return fail(res, "Tax Invoice and E-Way Bill files are both required before final dispatch");
  }

  if (!isNewPiWorkflow(sale) && (update.taxInvoiceAttachmentName || update.taxInvoiceAttachmentUrl || update.ewayBillAttachmentName || update.ewayBillAttachmentUrl) && sale.dispatchStatus === "Planned") {
    return fail(res, "Dispatch request must be generated before Tax Invoice and E-Way Bill upload");
  }
  if (!isNewPiWorkflow(sale) && (update.taxInvoiceAttachmentName || update.taxInvoiceAttachmentUrl || update.ewayBillAttachmentName || update.ewayBillAttachmentUrl) && !sale.accountsRequestAt) {
    return fail(res, "Sales dispatch request must be generated before sharing with Dispatch Team");
  }

  let event: ReturnType<typeof workflowEvent> | undefined;
  if (isNewPiWorkflow(sale) && wantsPaymentVerification && !hasDocumentUpload) {
    update.paymentStatus = "Confirmed";
    update.paymentVerifiedAt = new Date();
    update.paymentVerifiedBy = user.userId;
    update.piWorkflowStatus = PI_STATUS_PAYMENT_VERIFIED;
    event = workflowEvent(
      sale,
      user,
      "Mark as Payment Verified",
      PI_STATUS_PAYMENT_VERIFIED,
      "Accounts",
      "Payment verified and request moved to Dispatch Team"
    );
  }

  if (update.taxInvoiceAttachmentName || update.taxInvoiceAttachmentUrl || update.ewayBillAttachmentName || update.ewayBillAttachmentUrl) {
    update.accountsSharedAt = new Date();
    update.accountsSharedBy = user.userId;
  }
  if (isNewPiWorkflow(sale) && hasDocumentUpload) {
    update.paymentStatus = "Confirmed";
    update.piWorkflowStatus = PI_STATUS_DISPATCH_READY;
    event = workflowEvent(
      sale,
      user,
      "Upload Tax Invoice and E-Way Bill",
      PI_STATUS_DISPATCH_READY,
      "Accounts",
      "Accounts documents uploaded and request returned to Dispatch Team"
    );
  }

  await c.sales.updateOne({ id }, event ? { $set: update, $push: { piWorkflowHistory: event } } : { $set: update });
  const updated = await c.sales.findOne({ id });
  return ok(res, updated);
});

router.put("/:id/sales-dispatch", authenticate, requireAnyPermission("sales:entry"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const { id } = req.params;
  const { saleDate, piAttachmentName, piAttachmentUrl, expectedDispatchDate, confirmedDispatchDate, dispatchStatus } = req.body;
  const user = (req as any).user as AuthUser;

  const sale = await c.sales.findOne({ id });
  if (!sale) return fail(res, "PI record not found", 404);
  if (isNewPiWorkflow(sale) && dispatchStatus !== undefined) {
    return fail(res, "Dispatch status for new PI workflow is controlled by Accounts and Dispatch Team actions");
  }
  if (dispatchStatus === "Ready" && sale.paymentStatus !== "Confirmed") {
    return fail(res, "Payment must be verified before Sales Order and dispatch request");
  }

  const update: Partial<Sale> = {};
  if (saleDate) update.saleDate = new Date(saleDate);
  if (piAttachmentName !== undefined) update.piAttachmentName = String(piAttachmentName);
  if (piAttachmentUrl !== undefined) update.piAttachmentUrl = String(piAttachmentUrl);
  if (expectedDispatchDate) update.expectedDispatchDate = new Date(expectedDispatchDate);
  if (confirmedDispatchDate) update.confirmedDispatchDate = new Date(confirmedDispatchDate);
  if (dispatchStatus !== undefined) update.dispatchStatus = dispatchStatus;

  const hasSalesDispatchUpdate =
    Boolean(saleDate) ||
    piAttachmentName !== undefined ||
    piAttachmentUrl !== undefined ||
    Boolean(expectedDispatchDate) ||
    Boolean(confirmedDispatchDate) ||
    dispatchStatus !== undefined;
  if (!hasSalesDispatchUpdate) {
    return fail(res, "PI attachment or dispatch date is required");
  }

  if (!isNewPiWorkflow(sale)) {
    update.accountsRequestAt = new Date();
    update.accountsRequestBy = user.userId;
  }

  await c.sales.updateOne({ id }, { $set: update });
  const updated = await c.sales.findOne({ id });
  return ok(res, updated);
});

router.put("/:id/dispatch-team", authenticate, requireAnyPermission("dispatch:manage"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const { id } = req.params;
  const {
    serialNumber,
    confirmedDispatchDate,
    dispatchStatus,
    courierDocketNo,
    courierDocketAttachmentName,
    courierDocketAttachmentUrl,
    forwardToAccounts,
  } = req.body;

  const sale = await c.sales.findOne({ id });
  if (!sale) return fail(res, "PI record not found", 404);
  const user = (req as any).user as AuthUser;
  const isDeliveryStatus = dispatchStatus === "Final Dispatch" || dispatchStatus === "Delivered" || dispatchStatus === "Dispatched";

  if (isNewPiWorkflow(sale)) {
    if (forwardToAccounts) {
      if (sale.piWorkflowStatus !== PI_STATUS_SUBMITTED) {
        return fail(res, "Only a new dispatch request can be forwarded to Accounts");
      }
    } else if (sale.paymentStatus !== "Confirmed") {
      return fail(res, "Payment must be verified by Accounts before Dispatch Team can prepare this PI");
    }
    if (dispatchStatus === "Ready" && sale.piWorkflowStatus !== PI_STATUS_PAYMENT_VERIFIED) {
      return fail(res, "Vehicle no. can only be shared after Accounts verifies payment");
    }
    if (dispatchStatus === "Ready" && !serialNumber && !sale.serialNumber) {
      return fail(res, "Vehicle no. is required before sharing the request with Accounts");
    }
    if (isDeliveryStatus && sale.piWorkflowStatus !== PI_STATUS_DISPATCH_READY) {
      return fail(res, "Final dispatch can happen only after Accounts uploads Tax Invoice and E-Way Bill");
    }
    if (
      isDeliveryStatus &&
      (!sale.taxInvoiceAttachmentName || !sale.taxInvoiceAttachmentUrl || !sale.ewayBillAttachmentName || !sale.ewayBillAttachmentUrl)
    ) {
      return fail(res, "Tax Invoice and E-Way Bill are required before final dispatch");
    }
    if (dispatchStatus !== undefined && dispatchStatus !== "Ready" && !isDeliveryStatus) {
      return fail(res, "New PI workflow supports only vehicle no. sharing or final dispatch actions from Dispatch Team");
    }
  }

  const update: Partial<Sale> = {};
  const normalizedSerialNumber = normalizeSerialNumber(serialNumber);
  if (serialNumber) {
    update.serialNumber = normalizedSerialNumber;

    if (isDeliveryStatus) {
      const mfg = await resolveManufacturedProductForSerial(c, sale, normalizedSerialNumber);
      if (mfg) {
        if (mfg.status === "Sold" && mfg.invoiceNo !== sale.referenceNo) return fail(res, "This product is already sold");

        await c.manufactured.updateOne(
          { id: mfg.id },
          {
            $set: {
              status: "Sold",
              invoiceNo: sale.referenceNo,
              customerId: sale.customerId,
              soldDate: confirmedDispatchDate ? new Date(confirmedDispatchDate) : new Date(),
              paymentStatus: sale.paymentStatus === "Confirmed" ? "Verified" : "Pending",
              updatedAt: new Date(),
            },
          }
        );
        await updateSerialStatus(c, {
          serialNumber: normalizedSerialNumber,
          status: "Dispatched",
        });
      } else {
        console.warn("Dispatch finalization skipped manufactured lookup for unmapped serial", {
          saleId: sale.id,
          referenceNo: sale.referenceNo,
          serialNumber: normalizedSerialNumber,
        });
      }
    }
  }
  if (confirmedDispatchDate) update.confirmedDispatchDate = new Date(confirmedDispatchDate);
  if (dispatchStatus !== undefined) update.dispatchStatus = dispatchStatus;
  if (courierDocketNo !== undefined) update.courierDocketNo = String(courierDocketNo);
  if (courierDocketAttachmentName !== undefined) update.courierDocketAttachmentName = String(courierDocketAttachmentName);
  if (courierDocketAttachmentUrl !== undefined) update.courierDocketAttachmentUrl = String(courierDocketAttachmentUrl);

  if (isDeliveryStatus && sale.paymentStatus !== "Confirmed") {
    return fail(res, "Payment must be confirmed by Accounts before delivery");
  }
  if (isDeliveryStatus && !update.serialNumber && !sale.serialNumber) {
    return fail(res, "Serial allocation is required before material dispatch");
  }
  if (isDeliveryStatus && (!sale.taxInvoiceAttachmentName || !sale.ewayBillAttachmentName)) {
    return fail(res, "Tax Invoice and E-Way Bill are required before delivery");
  }
  if (isDeliveryStatus && !update.confirmedDispatchDate && !sale.confirmedDispatchDate) {
    return fail(res, "Confirm date of dispatch is required for delivery");
  }
  if (
    isDeliveryStatus &&
    !update.courierDocketNo &&
    !update.courierDocketAttachmentName &&
    !sale.courierDocketNo &&
    !sale.courierDocketAttachmentName
  ) {
    return fail(res, "Courier docket no. or docket attachment is required for delivery");
  }

  let event: ReturnType<typeof workflowEvent> | undefined;
  if (isNewPiWorkflow(sale) && forwardToAccounts) {
    update.accountsRequestAt = new Date();
    update.accountsRequestBy = user.userId;
    event = workflowEvent(
      sale,
      user,
      "Forward to Accounts",
      PI_STATUS_SUBMITTED,
      "Dispatch",
      "Dispatch Team forwarded the request to Accounts for payment verification"
    );
  }
  if (isNewPiWorkflow(sale) && dispatchStatus === "Ready") {
    const now = new Date();
    update.dispatchStatus = "Ready";
    update.piWorkflowStatus = PI_STATUS_DISPATCH_READY;
    update.dispatchReadyAt = now;
    update.dispatchReadyBy = user.userId;
    update.accountsRequestAt = now;
    update.accountsRequestBy = user.userId;
    event = workflowEvent(
      sale,
      user,
      "Share Vehicle No.",
      PI_STATUS_DISPATCH_READY,
      "Dispatch",
      "Vehicle no. shared and request returned to Accounts Team for documents"
    );
  }
  if (isNewPiWorkflow(sale) && isDeliveryStatus) {
    update.dispatchStatus = "Dispatched";
    update.piWorkflowStatus = PI_STATUS_DISPATCHED;
    update.finalDispatchAt = new Date();
    update.finalDispatchBy = user.userId;
    event = workflowEvent(sale, user, "Mark as Dispatched", PI_STATUS_DISPATCHED, "Dispatch", "Final dispatch completed");
  }

  if (Object.keys(update).length === 0) return fail(res, "No dispatch updates provided");

  await c.sales.updateOne({ id }, event ? { $set: update, $push: { piWorkflowHistory: event } } : { $set: update });
  const updated = await c.sales.findOne({ id });
  return ok(res, updated);
});

/**
 * POST /api/sales
 * Records a sales workflow entry. If serialNumber is supplied, also marks
 * the manufactured product as Sold for backward-compatible serial sales.
 */
router.post("/", authenticate, requireAnyPermission("sales:entry"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const {
    serialNumber,
    documentType,
    referenceNo,
    saleDate,
    customerId,
    unregisteredCustomerName,
    unregisteredCustomerAddress,
    unregisteredCustomerGst,
    shipToAddressKey,
    registrationCode,
    materialName,
    quantity,
    piItems,
    stateRegion,
    dealerRegistered,
    rjApprovalStatus,
    forcePiPermission,
    priceCategory,
    availableQuantity,
    inventoryStatus,
    forcePiApprovalStatus,
    piAttachmentName,
    piAttachmentUrl,
    expectedDispatchDate,
    confirmedDispatchDate,
    dispatchStatus,
    courierDocketNo,
    courierDocketAttachmentName,
    courierDocketAttachmentUrl,
    paymentStatus,
  } = req.body;

  const isRegisteredCustomer = dealerRegistered !== false;
  if (!documentType || !saleDate || (isRegisteredCustomer && !customerId)) {
    return fail(res, "documentType, saleDate and registered customer are required");
  }
  if (!isRegisteredCustomer && (!unregisteredCustomerName || !unregisteredCustomerAddress || !stateRegion)) {
    return fail(res, "Non-registered customer name, ship-to address and state/region are required");
  }

  const parsedPiItems = parsePiItems(piItems);
  const isWorkflowEntry = Boolean(materialName || quantity || parsedPiItems?.length || stateRegion);
  const isDispatchEntry = Boolean(
    piAttachmentName ||
      piAttachmentUrl ||
      expectedDispatchDate ||
      confirmedDispatchDate ||
      dispatchStatus ||
      courierDocketNo ||
      courierDocketAttachmentName ||
      courierDocketAttachmentUrl
  );
  if (!isWorkflowEntry && !isDispatchEntry && !serialNumber) {
    return fail(res, "serialNumber or dispatch details are required");
  }
  if (isWorkflowEntry && (!(materialName || parsedPiItems?.length) || !(quantity || parsedPiItems?.length) || !stateRegion)) {
    return fail(res, "PI item, quantity and stateRegion are required");
  }

  if (isRegisteredCustomer) {
    const customer = await c.customers.findOne({ id: customerId }, { projection: { id: 1 } });
    if (!customer) return fail(res, "Customer not found", 404);
  }

  const user = (req as any).user as AuthUser;
  let finalReferenceNo = "";
  try {
    finalReferenceNo = await resolveUniquePiNumber(c, referenceNo, saleDate);
  } catch (err) {
    return fail(res, err instanceof Error ? err.message : "Invalid PI number");
  }
  const requestedForcePi =
    Boolean(forcePiPermission) ||
    forcePiApprovalStatus === "Pending" ||
    forcePiApprovalStatus === "Approved" ||
    dealerRegistered === false;

  if (serialNumber) {
    const normalizedSerialNumber = normalizeSerialNumber(serialNumber);
    const mfg = await resolveManufacturedProductForSerial(c, { serialNumber, materialName, referenceNo: finalReferenceNo, saleDate, customerId, paymentStatus }, normalizedSerialNumber);
    if (!mfg) return fail(res, "Serial number not found in manufactured products");
    if (mfg.status === "Sold") return fail(res, "This product is already sold");

    const updatedAt = new Date();
    await c.manufactured.updateOne(
      { id: mfg.id },
      {
        $set: {
          status: "Sold",
          invoiceNo: finalReferenceNo,
          customerId,
          soldDate: new Date(saleDate),
          paymentStatus: paymentStatus === "Confirmed" ? "Verified" : "Pending",
          updatedAt,
        },
      }
    );
    await updateSerialStatus(c, {
      serialNumber: normalizedSerialNumber,
      status: "Sold",
    });
  }

  const sale: Sale = {
    id: generateId(),
    documentType,
    referenceNo: finalReferenceNo,
    saleDate: new Date(saleDate),
    customerId: customerId || undefined,
    createdBy: user.userId,
    createdAt: new Date(),
  };
  if (isWorkflowEntry) {
    sale.paymentStatus = "Pending";
    sale.dispatchStatus = "Planned";
    sale.piWorkflowVersion = PI_WORKFLOW_VERSION;
    sale.piWorkflowStatus = PI_STATUS_SUBMITTED;
    sale.piWorkflowHistory = [
      {
        id: generateId(),
        action: "Submit PI Request",
        toStatus: PI_STATUS_SUBMITTED,
        department: "Sales",
        by: user.userId,
        byName: user.name,
        byRole: user.role,
        at: sale.createdAt,
        note: "PI request submitted to Dispatch Team for review and forwarding",
      },
    ];
  }
  if (serialNumber) sale.serialNumber = String(serialNumber);
  if (unregisteredCustomerName) sale.unregisteredCustomerName = String(unregisteredCustomerName);
  if (unregisteredCustomerAddress) sale.unregisteredCustomerAddress = String(unregisteredCustomerAddress);
  if (unregisteredCustomerGst) sale.unregisteredCustomerGst = String(unregisteredCustomerGst);
  if (shipToAddressKey) sale.shipToAddressKey = shipToAddressKey;
  if (registrationCode) sale.registrationCode = String(registrationCode);
  if (parsedPiItems?.length) {
    sale.piItems = parsedPiItems;
    sale.materialName = parsedPiItems[0].materialName;
    sale.quantity = parsedPiItems.reduce((sum, item) => sum + item.quantity, 0);
  } else {
    if (materialName) sale.materialName = String(materialName);
    if (quantity) sale.quantity = Number(quantity);
  }
  if (stateRegion) sale.stateRegion = String(stateRegion);
  if (typeof dealerRegistered === "boolean") sale.dealerRegistered = dealerRegistered;
  if (rjApprovalStatus) sale.rjApprovalStatus = rjApprovalStatus;
  if (requestedForcePi) {
    sale.forcePiPermission = true;
    if (forcePiApprovalStatus === "Approved" && user.role === "Admin") {
      sale.forcePiApprovalStatus = "Approved";
      sale.forcePiApprovedBy = user.userId;
      sale.forcePiApprovedAt = new Date();
    } else {
      sale.forcePiApprovalStatus = "Pending";
    }
  } else if (typeof forcePiPermission === "boolean") {
    sale.forcePiPermission = false;
  }
  if (priceCategory !== undefined) {
    if (isRegisteredCustomer && priceCategory !== REGISTERED_PRICE_CATEGORY) {
      return fail(res, "Registered PI supports only Distributor Price");
    }
    sale.priceCategory = normalizePriceCategoryForRegistration(isRegisteredCustomer, String(priceCategory));
  }
  if (availableQuantity !== undefined && availableQuantity !== null) sale.availableQuantity = Number(availableQuantity);
  if (inventoryStatus) sale.inventoryStatus = inventoryStatus;
  if (!requestedForcePi && forcePiApprovalStatus) sale.forcePiApprovalStatus = forcePiApprovalStatus;
  if (piAttachmentName) sale.piAttachmentName = String(piAttachmentName);
  if (piAttachmentUrl) sale.piAttachmentUrl = String(piAttachmentUrl);
  if (expectedDispatchDate) sale.expectedDispatchDate = new Date(expectedDispatchDate);
  if (confirmedDispatchDate) sale.confirmedDispatchDate = new Date(confirmedDispatchDate);
  if (dispatchStatus && !isWorkflowEntry) sale.dispatchStatus = dispatchStatus;
  if (courierDocketNo) sale.courierDocketNo = String(courierDocketNo);
  if (courierDocketAttachmentName) sale.courierDocketAttachmentName = String(courierDocketAttachmentName);
  if (courierDocketAttachmentUrl) sale.courierDocketAttachmentUrl = String(courierDocketAttachmentUrl);
  if (paymentStatus && !isWorkflowEntry) sale.paymentStatus = paymentStatus;
  await c.sales.insertOne(sale);

  // Best-effort notification (never fail the main operation).
  try {
    const notification: Notification = {
      id: generateId(),
      type: "sale_recorded",
      title: isWorkflowEntry ? "New Sales Workflow PI" : isDispatchEntry ? "Dispatch Planning Updated" : "New Sale Recorded",
      body: `${finalReferenceNo} â€¢ ${materialName || serialNumber || dispatchStatus || "Sales workflow"}`,
      entityType: "sale",
      entityId: sale.id,
      meta: {
        serialNumber,
        referenceNo: finalReferenceNo,
        customerId,
        shipToAddressKey,
        materialName,
        quantity,
        piItems: parsedPiItems,
        stateRegion,
        piAttachmentName,
        piAttachmentUrl,
        expectedDispatchDate,
        confirmedDispatchDate,
        dispatchStatus,
        courierDocketNo,
        courierDocketAttachmentName,
        courierDocketAttachmentUrl,
      },
      audienceRoles: isWorkflowEntry ? ["Admin", "Accounts", "Accounts Team"] : ["Admin", "Sales", "Inventory"],
      readBy: [],
      createdBy: user.userId,
      createdAt: new Date(),
    };
    await c.notifications.insertOne(notification);
  } catch (err) {
    console.warn("Failed to insert notification:", err instanceof Error ? err.message : String(err));
  }

  return ok(res, sale, 201);
});

export default router;


