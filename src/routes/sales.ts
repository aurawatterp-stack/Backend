import express, { type NextFunction, type Request, type Response, type Router } from "express";
import multer from "multer";

import { getCollections } from "../db/collections";
import { authenticate, authorize, requireAnyPermission } from "../middleware/auth";
import type { AuthUser, Notification, Sale } from "../types";
import { uploadBufferToCloudinary } from "../utils/cloudinary";
import { fail, ok } from "../utils/http";
import { generateId } from "../utils/id";

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

function piYearFromDate(value: unknown) {
  const parsed = value ? new Date(String(value)) : new Date();
  return Number.isFinite(parsed.getTime()) ? parsed.getFullYear() : new Date().getFullYear();
}

function isPlaceholderPiNumber(value: string) {
  return /^PI-\d{4}-X+$/i.test(value);
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
  if (priceCategory !== undefined) update.priceCategory = priceCategory;
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
  if (priceCategory !== undefined) update.priceCategory = priceCategory;
  if (availableQuantity !== undefined && availableQuantity !== null) update.availableQuantity = Number(availableQuantity);
  if (inventoryStatus !== undefined) update.inventoryStatus = inventoryStatus;
  if (expectedDispatchDate) update.expectedDispatchDate = new Date(expectedDispatchDate);
  if (dispatchStatus !== undefined) update.dispatchStatus = dispatchStatus;
  if (paymentStatus !== undefined) update.paymentStatus = paymentStatus;

  await c.sales.updateOne({ id }, { $set: update });
  const approved = await c.sales.findOne({ id });
  return ok(res, approved);
});

/** POST /api/sales/upload-docket — upload courier docket file to Cloudinary */
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

/** POST /api/sales/upload-pi — upload PI file to Cloudinary */
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

  if ((update.taxInvoiceAttachmentName || update.taxInvoiceAttachmentUrl || update.ewayBillAttachmentName || update.ewayBillAttachmentUrl) && sale.dispatchStatus === "Planned") {
    return fail(res, "Dispatch request must be generated before Tax Invoice and E-Way Bill upload");
  }
  if ((update.taxInvoiceAttachmentName || update.taxInvoiceAttachmentUrl || update.ewayBillAttachmentName || update.ewayBillAttachmentUrl) && !sale.accountsRequestAt) {
    return fail(res, "Sales dispatch request must be generated before sharing with Dispatch Team");
  }

  if (update.taxInvoiceAttachmentName || update.taxInvoiceAttachmentUrl || update.ewayBillAttachmentName || update.ewayBillAttachmentUrl) {
    update.accountsSharedAt = new Date();
    update.accountsSharedBy = user.userId;
  }

  await c.sales.updateOne({ id }, { $set: update });
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

  update.accountsRequestAt = new Date();
  update.accountsRequestBy = user.userId;

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
  } = req.body;

  const sale = await c.sales.findOne({ id });
  if (!sale) return fail(res, "PI record not found", 404);

  const update: Partial<Sale> = {};
  if (serialNumber) {
    const mfg = await c.manufactured.findOne({ serialNumber: String(serialNumber) });
    if (!mfg) return fail(res, "Serial number not found in manufactured products");
    if (mfg.status === "Sold" && mfg.invoiceNo !== sale.referenceNo) return fail(res, "This product is already sold");
    update.serialNumber = String(serialNumber);

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
  }
  if (confirmedDispatchDate) update.confirmedDispatchDate = new Date(confirmedDispatchDate);
  if (dispatchStatus !== undefined) update.dispatchStatus = dispatchStatus;
  if (courierDocketNo !== undefined) update.courierDocketNo = String(courierDocketNo);
  if (courierDocketAttachmentName !== undefined) update.courierDocketAttachmentName = String(courierDocketAttachmentName);
  if (courierDocketAttachmentUrl !== undefined) update.courierDocketAttachmentUrl = String(courierDocketAttachmentUrl);

  const isDeliveryStatus = dispatchStatus === "Final Dispatch" || dispatchStatus === "Delivered";
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

  if (Object.keys(update).length === 0) return fail(res, "No dispatch updates provided");

  await c.sales.updateOne({ id }, { $set: update });
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
    const mfg = await c.manufactured.findOne({ serialNumber });
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
  if (priceCategory) sale.priceCategory = priceCategory;
  if (availableQuantity !== undefined && availableQuantity !== null) sale.availableQuantity = Number(availableQuantity);
  if (inventoryStatus) sale.inventoryStatus = inventoryStatus;
  if (!requestedForcePi && forcePiApprovalStatus) sale.forcePiApprovalStatus = forcePiApprovalStatus;
  if (piAttachmentName) sale.piAttachmentName = String(piAttachmentName);
  if (piAttachmentUrl) sale.piAttachmentUrl = String(piAttachmentUrl);
  if (expectedDispatchDate) sale.expectedDispatchDate = new Date(expectedDispatchDate);
  if (confirmedDispatchDate) sale.confirmedDispatchDate = new Date(confirmedDispatchDate);
  if (dispatchStatus) sale.dispatchStatus = dispatchStatus;
  if (courierDocketNo) sale.courierDocketNo = String(courierDocketNo);
  if (courierDocketAttachmentName) sale.courierDocketAttachmentName = String(courierDocketAttachmentName);
  if (courierDocketAttachmentUrl) sale.courierDocketAttachmentUrl = String(courierDocketAttachmentUrl);
  if (paymentStatus) sale.paymentStatus = paymentStatus;
  await c.sales.insertOne(sale);

  // Best-effort notification (never fail the main operation).
  try {
    const notification: Notification = {
      id: generateId(),
      type: "sale_recorded",
      title: isWorkflowEntry ? "New Sales Workflow PI" : isDispatchEntry ? "Dispatch Planning Updated" : "New Sale Recorded",
      body: `${finalReferenceNo} • ${materialName || serialNumber || dispatchStatus || "Sales workflow"}`,
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
      audienceRoles: ["Admin", "Sales", "Inventory"],
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
