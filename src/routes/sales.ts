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
router.get("/", authenticate, requireAnyPermission("sales:entry"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const { page = "1", limit = "20" } = req.query as Record<string, string>;
  const p = Math.max(1, parseInt(page));
  const l = Math.min(100, parseInt(limit));
  const total = await c.sales.countDocuments({});
  const data = await c.sales
    .find({})
    .sort({ saleDate: -1 })
    .skip((p - 1) * l)
    .limit(l)
    .toArray();
  return ok(res, { data, total, page: p, limit: l });
});

router.put("/:id/force-pi", authenticate, authorize("Admin"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const { id } = req.params;
  const {
    documentType,
    referenceNo,
    saleDate,
    customerId,
    registrationCode,
    materialName,
    quantity,
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
  if (referenceNo !== undefined) update.referenceNo = String(referenceNo);
  if (saleDate) update.saleDate = new Date(saleDate);
  if (customerId !== undefined) {
    const customer = await c.customers.findOne({ id: String(customerId) }, { projection: { id: 1 } });
    if (!customer) return fail(res, "Customer not found", 404);
    update.customerId = String(customerId);
  }
  if (registrationCode !== undefined) update.registrationCode = String(registrationCode);
  if (materialName !== undefined) update.materialName = String(materialName);
  if (quantity !== undefined && quantity !== null) update.quantity = Number(quantity);
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
    registrationCode,
    materialName,
    quantity,
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

  if (registrationCode !== undefined) update.registrationCode = String(registrationCode);
  if (materialName !== undefined) update.materialName = String(materialName);
  if (quantity !== undefined && quantity !== null) update.quantity = Number(quantity);
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
  requireAnyPermission("sales:entry"),
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
  requireAnyPermission("sales:entry"),
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
    registrationCode,
    materialName,
    quantity,
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

  if (!documentType || !referenceNo || !saleDate || !customerId) {
    return fail(res, "documentType, referenceNo, saleDate, customerId are required");
  }

  const isWorkflowEntry = Boolean(materialName || quantity || stateRegion);
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
  if (isWorkflowEntry && (!materialName || !quantity || !stateRegion)) {
    return fail(res, "materialName, quantity and stateRegion are required");
  }

  const customer = await c.customers.findOne({ id: customerId }, { projection: { id: 1 } });
  if (!customer) return fail(res, "Customer not found", 404);

  const user = (req as any).user as AuthUser;
  const requestedForcePi =
    Boolean(forcePiPermission) ||
    forcePiApprovalStatus === "Pending" ||
    forcePiApprovalStatus === "Approved" ||
    dealerRegistered === false ||
    inventoryStatus === "Insufficient";

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
          invoiceNo: referenceNo,
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
    referenceNo,
    saleDate: new Date(saleDate),
    customerId,
    createdBy: user.userId,
    createdAt: new Date(),
  };
  if (serialNumber) sale.serialNumber = String(serialNumber);
  if (registrationCode) sale.registrationCode = String(registrationCode);
  if (materialName) sale.materialName = String(materialName);
  if (quantity) sale.quantity = Number(quantity);
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
      body: `${referenceNo} • ${materialName || serialNumber || dispatchStatus || "Sales workflow"}`,
      entityType: "sale",
      entityId: sale.id,
      meta: {
        serialNumber,
        referenceNo,
        customerId,
        materialName,
        quantity,
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
