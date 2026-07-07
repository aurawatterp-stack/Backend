import express, { type Request, type Response, type Router } from "express";

import { getCollections } from "../db/collections";
import { authenticate, requireAnyPermission } from "../middleware/auth";
import type { AuthUser, Complaint, ManufacturedProduct, Notification, RawMaterial } from "../types";
import { fail, ok } from "../utils/http";
import { generateId } from "../utils/id";
import { updateSerialStatus } from "../utils/serialLifecycle";

const router: Router = express.Router();

function normalizeBomUsage(input: unknown): NonNullable<ManufacturedProduct["bomUsage"]> {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => ({
      rawMaterialId: item.rawMaterialId ? String(item.rawMaterialId) : undefined,
      materialName: String(item.materialName ?? ""),
      batch: item.batch ? String(item.batch) : undefined,
      inwardMode:
        item.inwardMode === "Local" || item.inwardMode === "International"
          ? item.inwardMode
          : undefined,
      invoiceNo: item.invoiceNo ? String(item.invoiceNo) : undefined,
      vendorName: item.vendorName ? String(item.vendorName) : undefined,
      quantityUsed: Number(item.quantityUsed) || 0,
    }))
    .filter((item) => item.rawMaterialId && item.materialName && item.quantityUsed > 0);
}

function usageByRawMaterial(usage: ManufacturedProduct["bomUsage"] | undefined) {
  const map = new Map<string, number>();
  for (const item of usage ?? []) {
    if (!item.rawMaterialId) continue;
    map.set(item.rawMaterialId, (map.get(item.rawMaterialId) ?? 0) + (Number(item.quantityUsed) || 0));
  }
  return map;
}

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function complaintSpareParts(complaint: Complaint) {
  if (Array.isArray(complaint.spareParts) && complaint.spareParts.length) {
    return complaint.spareParts
      .map((part, index) => ({
        id: normalizeText(part.id) || `${complaint.id}-${index}`,
        series: normalizeText(part.series) || undefined,
        rawMaterialId: normalizeText(part.rawMaterialId) || undefined,
        materialName: normalizeText(part.materialName),
        quantity: Number(part.quantity) || 0,
        notes: normalizeText(part.notes) || undefined,
      }))
      .filter((part) => part.materialName && part.quantity > 0);
  }

  const materialName = normalizeText(complaint.spareName);
  const quantity = Number(complaint.spareQuantity) || 0;
  if (!materialName || quantity <= 0) return [];
  return [{
    id: `${complaint.id}-spare`,
    series: undefined,
    rawMaterialId: normalizeText(complaint.rawMaterialId) || undefined,
    materialName,
    quantity,
    notes: normalizeText(complaint.dispatchPlan) || undefined,
  }];
}

function replacementLabel(complaint: Complaint) {
  return [
    complaint.replacementSeriesName || complaint.replacementProductName,
    complaint.replacementModelName || complaint.replacementProductNo,
  ].filter(Boolean).join(" ") || "Replacement inverter";
}

async function resolveComplaintReplacementSeries(
  c: Awaited<ReturnType<typeof getCollections>>,
  complaint: Complaint
) {
  const explicitSeries = normalizeText(complaint.replacementSeriesName || complaint.replacementProductName);
  if (explicitSeries) return explicitSeries;

  const explicitModel = normalizeText(complaint.replacementModelName || complaint.replacementProductNo || complaint.productModel);
  if (!explicitModel) return "";

  const product = await c.products.findOne({
    $or: [{ id: explicitModel }, { model: explicitModel }],
  });
  return product?.series ?? "";
}

async function insertDispatchApprovalNotification(
  c: Awaited<ReturnType<typeof getCollections>>,
  complaint: Complaint,
  user: AuthUser,
  title: string,
  body: string,
  meta: Record<string, unknown>
) {
  const notification: Notification = {
    id: generateId(),
    type: "complaint_workflow_updated",
    title,
    body,
    entityType: "complaint",
    entityId: complaint.id,
    meta,
    audienceRoles: ["Dispatch"],
    readBy: [],
    createdBy: user.userId,
    createdAt: new Date(),
  };
  await c.notifications.insertOne(notification);
}

async function resolveRawMaterialDeductions(
  c: Awaited<ReturnType<typeof getCollections>>,
  parts: ReturnType<typeof complaintSpareParts>
) {
  const deductions: Array<{ raw: RawMaterial; quantity: number; partName: string }> = [];

  for (const part of parts) {
    let remaining = part.quantity;
    const selectedRows: RawMaterial[] = [];

    if (part.rawMaterialId) {
      const raw = await c.rawMaterials.findOne({ id: part.rawMaterialId });
      if (!raw) return { error: `${part.materialName} raw material entry not found` as const };
      selectedRows.push(raw);
    } else {
      selectedRows.push(...await c.rawMaterials
        .find({
          materialName: part.materialName,
          ...(part.series ? { productSeriesId: part.series } : {}),
          quantityAvailable: { $gt: 0 },
        })
        .sort({ dateReceived: 1, createdAt: 1 })
        .toArray());
    }

    for (const raw of selectedRows) {
      if (remaining <= 0) break;
      const quantity = Math.min(Number(raw.quantityAvailable) || 0, remaining);
      if (quantity <= 0) continue;
      deductions.push({ raw, quantity, partName: part.materialName });
      remaining -= quantity;
    }

    if (remaining > 0) {
      return {
        error: `${part.materialName} stock insufficient. Required ${part.quantity}, available ${part.quantity - remaining}.` as const,
      };
    }
  }

  return { deductions };
}

async function resolveManufacturingSerial(
  c: Awaited<ReturnType<typeof getCollections>>,
  productSeriesId: string,
  requestedSerial?: string
) {
  const serial = String(requestedSerial ?? "").trim();
  if (serial) {
    const existing = await c.serials.findOne({ serialNumber: serial, productSeriesId });
    if (!existing) return { error: "Serial number not found for the selected series" as const };
    if (existing.status !== "Available") return { error: "Selected serial is not available for manufacturing" as const };
    return { serialNumber: serial };
  }

  const nextAvailable = await c.serials
    .find({ productSeriesId, status: "Available" }, { projection: { serialNumber: 1 } })
    .sort({ uploadedAt: 1 })
    .limit(1)
    .toArray();

  const autoSerial = nextAvailable[0]?.serialNumber?.trim();
  if (!autoSerial) return { error: "No available serials found for this product series" as const };
  return { serialNumber: autoSerial };
}

/** GET /api/manufactured — filter by status, model, dateFrom, dateTo, customer */
router.get(
  "/",
  authenticate,
  requireAnyPermission("inventory:manufactured", "sales:entry", "complaints:consumer", "dispatch:manage"),
  async (req: Request, res: Response) => {
  const c = await getCollections();
  const { q = "", status, model, page = "1", limit = "20" } = req.query as Record<string, string>;
  const filter: Record<string, unknown> = {};
  if (status && status !== "all") {
    filter.status = status;
  }
  if (model) filter.productId = model;
  if (q) {
    filter.$or = [{ serialNumber: { $regex: q, $options: "i" } }, { productId: { $regex: q, $options: "i" } }];
  }

  const p = Math.max(1, parseInt(page));
  const l = Math.min(5000, parseInt(limit));
  const total = await c.manufactured.countDocuments(filter);
  const data = await c.manufactured.find(filter).sort({ createdAt: -1 }).skip((p - 1) * l).limit(l).toArray();
  return ok(res, { data, total, page: p, limit: l });
  }
);

/** POST /api/manufactured — record new production */
router.post("/", authenticate, requireAnyPermission("inventory:manufactured"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const { productId, serialNumber, mfgDate, status, invoiceNo, paymentStatus } = req.body;
  if (!productId || !mfgDate) {
    return fail(res, "productId and mfgDate are required");
  }

  const product = await c.products.findOne({ id: productId });
  if (!product) return fail(res, "Product model not found", 404);
  const productSeries = String(product.series ?? "").trim();
  if (!productSeries) return fail(res, "Product series not found for the selected model", 404);

  const resolvedSerial = await resolveManufacturingSerial(c, productSeries, serialNumber);
  if ("error" in resolvedSerial) return fail(res, resolvedSerial.error ?? "Serial resolution failed");

  const duplicate = await c.manufactured.findOne({ serialNumber: resolvedSerial.serialNumber }, { projection: { id: 1 } });
  if (duplicate) return fail(res, "This serial number already exists");

  const seriesBom = await c.boms.findOne({ series: productSeries });
  const bomUsage: NonNullable<ManufacturedProduct["bomUsage"]> = [];

  if (seriesBom && Array.isArray(seriesBom.items)) {
    for (const item of seriesBom.items) {
      const requiredQty = Number(item.quantity) || 0;
      if (requiredQty <= 0) continue;
      
      const rawMaterials = await c.rawMaterials
        .find({ productSeriesId: productSeries, materialName: item.materialName, quantityAvailable: { $gt: 0 } })
        .sort({ dateReceived: 1, createdAt: 1 })
        .toArray();

      let remainingRequired = requiredQty;
      const deductions: { id: string; qty: number; materialName: string; batch?: string; inwardMode?: "Local" | "International" }[] = [];

      for (const rm of rawMaterials) {
        if (remainingRequired <= 0) break;
        const available = rm.quantityAvailable;
        const toDeduct = Math.min(available, remainingRequired);
        
        deductions.push({ id: rm.id, qty: toDeduct, materialName: rm.materialName, batch: rm.batch, inwardMode: rm.inwardMode });
        remainingRequired -= toDeduct;

        bomUsage.push({
          rawMaterialId: rm.id,
          materialName: rm.materialName,
          batch: rm.batch,
          inwardMode: rm.inwardMode,
          invoiceNo: rm.referenceNo,
          vendorName: rm.vendorName,
          quantityUsed: toDeduct,
        });
      }

      if (remainingRequired > 0) {
        return fail(res, `Insufficient stock for Raw Material: ${item.materialName}. Required: ${requiredQty}, Available: ${requiredQty - remainingRequired}`);
      }
      
      for (const d of deductions) {
        await c.rawMaterials.updateOne(
          { id: d.id },
          { $inc: { quantityAvailable: -d.qty }, $set: { updatedAt: new Date() } }
        );
        await c.inventoryLogs.insertOne({
          id: generateId(),
          type: "Manufacturing",
          itemId: d.id,
          itemName: `${d.materialName} (${d.batch ?? "No Batch"}${d.inwardMode ? `, ${d.inwardMode}` : ""})`,
          quantityChange: -d.qty,
          referenceId: serialNumber,
          notes: `Consumed for Manufacturing Serial: ${serialNumber}`,
          createdAt: new Date(),
          createdBy: (req as any).user?.email || "System",
        });
      }
    }
  }

  const normalizedStatus =
    status === "Sold" || status === "Returned" || status === "In Stock" || status === "Failed" ? status : "In Stock";
  const normalizedPayment =
    paymentStatus === "Pending" || paymentStatus === "Verified" || paymentStatus === "N/A"
      ? paymentStatus
      : "N/A";

  const entry: ManufacturedProduct = {
    id: generateId(),
    productId,
    serialNumber: resolvedSerial.serialNumber,
    mfgDate: new Date(mfgDate),
    status: normalizedStatus,
    invoiceNo: invoiceNo ? String(invoiceNo) : undefined,
    paymentStatus: normalizedPayment,
    bomUsage,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await c.manufactured.insertOne(entry);

  // Log the manufactured product addition
  await c.inventoryLogs.insertOne({
    id: generateId(),
    type: "Manufacturing",
    itemId: entry.id,
    itemName: `${productSeries} ${product.model} (${resolvedSerial.serialNumber})`,
    quantityChange: 1,
    referenceId: resolvedSerial.serialNumber,
    notes: `Produced new serial`,
    createdAt: new Date(),
    createdBy: (req as any).user?.email || "System",
  });

  await updateSerialStatus(c, {
    serialNumber: resolvedSerial.serialNumber,
    productSeriesId: productSeries,
    status: "Manufactured",
  });

  return ok(res, entry, 201);
});

/** GET /api/manufactured/approval-requests - service spares/replacements awaiting inventory approval */
router.get("/approval-requests", authenticate, requireAnyPermission("inventory:manufactured"), async (_req: Request, res: Response) => {
  const c = await getCollections();
  const filter = {
    type: "Consumer",
    $or: [
      {
        spareRequestStatus: "Requested",
        $or: [{ replacementRecommended: { $ne: true } }, { replacementRecommended: { $exists: false } }],
        $and: [{
        $or: [
          { spareRequired: true },
          { spareParts: { $exists: true, $ne: [] } },
          { spareName: { $exists: true, $ne: "" } },
        ],
        }],
      },
      {
        replacementRecommended: true,
        replacementApprovalStatus: "Pending",
      },
    ],
  };

  const data = await c.complaints.find(filter).sort({ updatedAt: -1, createdAt: -1 }).limit(200).toArray();
  return ok(res, { data, total: data.length, page: 1, limit: 200 });
});

/** POST /api/manufactured/approval-requests/:id/approve - approve stock release and notify Dispatch */
router.post("/approval-requests/:id/approve", authenticate, requireAnyPermission("inventory:manufactured"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const user = (req as any).user as AuthUser;
  const complaint = await c.complaints.findOne({ id: req.params.id });
  if (!complaint) return fail(res, "Approval request not found", 404);

  const now = new Date();
  const note = normalizeText(req.body?.note) || "Approved from Manufactured Products.";
  const serialFromRequest = normalizeText(req.body?.replacementSerialNo);
  const isReplacement = Boolean(complaint.replacementRecommended || complaint.replacementApprovalStatus === "Pending");
  const parts = complaintSpareParts(complaint);

  if (!isReplacement && !parts.length) {
    return fail(res, "No spare parts found for approval", 400);
  }

  const update: Partial<Complaint> = {
    updatedAt: now,
    spareInventoryStatus: "Available",
    spareRequestStatus: "Approved",
    status: "Awaiting Dispatch",
    trackingNotes: `${complaint.trackingNotes ? `${complaint.trackingNotes}\n` : ""}${note} at ${now.toLocaleString()}.`,
    workflowHistory: [
      ...(complaint.workflowHistory ?? []),
      {
        id: generateId(),
        action: isReplacement ? "Replacement inventory approved" : "Spare inventory approved",
        fromStatus: complaint.status,
        toStatus: "Awaiting Dispatch",
        by: user.userId,
        byName: user.name,
        byRole: user.role,
        at: now,
        note,
      },
    ],
  };

  if (isReplacement) {
    const replacementSerialNo = serialFromRequest;
    if (!replacementSerialNo) return fail(res, "New replacement stock serial number is required", 400);

    const manufactured = await c.manufactured.findOne({ serialNumber: replacementSerialNo });
    if (!manufactured) return fail(res, "Replacement serial not found in Manufactured Products", 404);
    if (manufactured.status !== "In Stock") return fail(res, "Replacement serial must be In Stock before approval", 400);

    const requestedSeries = await resolveComplaintReplacementSeries(c, complaint);
    if (requestedSeries) {
      const stockProduct = await c.products.findOne({
        $or: [{ id: manufactured.productId }, { model: manufactured.productId }],
      });
      const stockSeries = normalizeText(stockProduct?.series);
      if (!stockSeries || stockSeries !== requestedSeries) {
        return fail(res, `Replacement serial must belong to the requested series (${requestedSeries})`, 400);
      }
    }

    await c.manufactured.updateOne(
      { id: manufactured.id },
      {
        $set: {
          status: "Sold",
          invoiceNo: complaint.id,
          paymentStatus: "N/A",
          soldDate: now,
          updatedAt: now,
        },
      }
    );
    await updateSerialStatus(c, { serialNumber: replacementSerialNo, status: "Dispatched" });
    await c.inventoryLogs.insertOne({
      id: generateId(),
      type: "Replacement Dispatch",
      itemId: manufactured.id,
      itemName: `${replacementLabel(complaint)} (${replacementSerialNo})`,
      quantityChange: -1,
      referenceId: complaint.id,
      notes: `Approved replacement for service ticket ${complaint.id}`,
      createdAt: now,
      createdBy: user.email || user.name || "System",
    });

    update.replacementSerialNo = replacementSerialNo;
    update.replacementApprovalStatus = "Approved";
    update.replacementApprovedById = user.userId;
    update.replacementApprovedByName = user.name ?? user.email;
    update.replacementApprovedByRole = user.role;
    update.replacementApprovedAt = now;

    await c.complaints.updateOne({ id: complaint.id }, { $set: update });
    const updated = await c.complaints.findOne({ id: complaint.id });
    await insertDispatchApprovalNotification(
      c,
      complaint,
      user,
      "Replacement approved for dispatch",
      `${replacementSerialNo} approved from Manufactured Products.`,
      {
        status: "Awaiting Dispatch",
        replacementRequestSerialNo: complaint.replacementRequestSerialNo || complaint.productSerialNo,
        replacementSerialNo,
        replacementApprovalStatus: "Approved",
      }
    );
    return ok(res, updated);
  }

  const resolved = await resolveRawMaterialDeductions(c, parts);
  if ("error" in resolved) return fail(res, resolved.error ?? "Raw material stock could not be resolved", 400);

  for (const deduction of resolved.deductions) {
    await c.rawMaterials.updateOne(
      { id: deduction.raw.id },
      { $inc: { quantityAvailable: -deduction.quantity }, $set: { updatedAt: now } }
    );
    await c.inventoryLogs.insertOne({
      id: generateId(),
      type: "Spare Dispatch",
      itemId: deduction.raw.id,
      itemName: `${deduction.raw.materialName} (${deduction.raw.batch ?? "No Batch"})`,
      quantityChange: -deduction.quantity,
      referenceId: complaint.id,
      notes: `Approved spare for service ticket ${complaint.id}`,
      createdAt: now,
      createdBy: user.email || user.name || "System",
    });
  }

  await c.complaints.updateOne({ id: complaint.id }, { $set: update });
  const updated = await c.complaints.findOne({ id: complaint.id });
  await insertDispatchApprovalNotification(
    c,
    complaint,
    user,
    "Spare approved for dispatch",
    `${parts.map((part) => `${part.materialName} x ${part.quantity}`).join(", ")} approved from Manufactured Products.`,
    { status: "Awaiting Dispatch", spareRequestStatus: "Approved" }
  );
  return ok(res, updated);
});

router.put("/mark-repaired", authenticate, requireAnyPermission("inventory:manufactured", "inventory:raw-materials"), async (req: Request, res: Response) => {
  const { type, id } = req.body;
  const c = await getCollections();
  const now = new Date();

  if (type === "Inverter") {
    let query: Record<string, any> = { id };
    if (typeof id === "string" && id.length === 24) {
      try {
        const { ObjectId } = require("mongodb");
        query = { $or: [{ id }, { _id: new ObjectId(id) }, { serialNumber: id }] };
      } catch (err) {}
    } else {
      query = { $or: [{ id }, { serialNumber: id }] };
    }
    const mfg = await c.manufactured.findOne(query);
    if (!mfg) return fail(res, "Inverter not found", 404);
    if (mfg.status !== "Faulty" && mfg.status !== "Returned") return fail(res, "Inverter is not faulty or returned", 400);

    await c.manufactured.updateOne({ _id: mfg._id }, { $set: { status: "Repaired", updatedAt: now } });
    return ok(res, { message: "Inverter marked as repaired" });
  } else if (type === "Spare Part") {
    let query: Record<string, any> = { id };
    if (typeof id === "string" && id.length === 24) {
      try {
        const { ObjectId } = require("mongodb");
        query = { $or: [{ id }, { _id: new ObjectId(id) }] };
      } catch (err) {}
    }
    const raw = await c.rawMaterials.findOne(query);
    if (!raw) return fail(res, "Spare part not found", 404);
    if (!raw.faultyQuantity || raw.faultyQuantity <= 0) return fail(res, "No faulty stock available", 400);

    await c.rawMaterials.updateOne(
      { _id: raw._id },
      { $inc: { faultyQuantity: -1, repairedQuantity: 1 }, $set: { updatedAt: now } }
    );
    return ok(res, { message: "Spare part marked as repaired" });
  }

  return fail(res, "Invalid type", 400);
});

/** PUT /api/manufactured/:id/bom — modify BOM and adjust raw material stock by delta only */
router.put("/:id/bom", authenticate, requireAnyPermission("inventory:manufactured"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const id = req.params.id;
  const existing = await c.manufactured.findOne({ id });
  if (!existing) return fail(res, "Record not found", 404);

  const nextBomUsage = normalizeBomUsage(req.body?.bomUsage);
  const previousUsage = usageByRawMaterial(existing.bomUsage);
  const nextUsage = usageByRawMaterial(nextBomUsage);
  const rawMaterialIds = [...new Set([...previousUsage.keys(), ...nextUsage.keys()])];
  const rawMaterials = await c.rawMaterials.find({ id: { $in: rawMaterialIds } }).toArray();
  const rawById = new Map(rawMaterials.map((entry) => [entry.id, entry]));

  for (const rawMaterialId of nextUsage.keys()) {
    if (!rawById.has(rawMaterialId)) return fail(res, "Selected raw material entry not found", 404);
  }

  for (const rawMaterialId of rawMaterialIds) {
    const entry = rawById.get(rawMaterialId);
    if (!entry) continue;
    const delta = (nextUsage.get(rawMaterialId) ?? 0) - (previousUsage.get(rawMaterialId) ?? 0);
    if (delta > 0 && entry.quantityAvailable < delta) {
      return fail(
        res,
        `${entry.materialName} stock insufficient. Available ${entry.quantityAvailable}, additional required ${delta}.`
      );
    }
  }

  for (const rawMaterialId of rawMaterialIds) {
    const entry = rawById.get(rawMaterialId);
    if (!entry) continue;
    const delta = (nextUsage.get(rawMaterialId) ?? 0) - (previousUsage.get(rawMaterialId) ?? 0);
    if (delta === 0) continue;
    await c.rawMaterials.updateOne(
      { id: rawMaterialId },
      { $set: { quantityAvailable: entry.quantityAvailable - delta, updatedAt: new Date() } }
    );
  }

  const updatedAt = new Date();
  await c.manufactured.updateOne({ id }, { $set: { bomUsage: nextBomUsage, updatedAt } });
  return ok(res, { ...existing, bomUsage: nextBomUsage, updatedAt });
});

/** PUT /api/manufactured/:id */
router.put("/:id", authenticate, requireAnyPermission("inventory:manufactured", "sales:entry"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const id = req.params.id;
  const existing = await c.manufactured.findOne({ id });
  if (!existing) return fail(res, "Record not found", 404);
  const updatedAt = new Date();
  await c.manufactured.updateOne({ id }, { $set: { ...req.body, updatedAt } });
  return ok(res, { ...existing, ...req.body, updatedAt });
});

/** POST /api/manufactured/:id/return — mark product as returned */
router.post("/:id/return", authenticate, requireAnyPermission("inventory:manufactured"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const id = req.params.id;
  const existing = await c.manufactured.findOne({ id });
  if (!existing) return fail(res, "Record not found", 404);
  const { returnReason, replacedWithSerial } = req.body;
  const updatedAt = new Date();
  const isWarrantyCase = String(returnReason || "").startsWith("Warranty Case");
  const nextStatus: "Faulty" | "Returned" = isWarrantyCase ? "Faulty" : "Returned";

  const update = {
    status: nextStatus,
    returnReason: returnReason || "",
    returnedAt: new Date(),
    returnedBy: (req as any).user?.id,
    returnedByName: (req as any).user?.name,
    replacedWithSerial: replacedWithSerial || "",
    updatedAt
  };

  await c.manufactured.updateOne({ id }, { $set: update });
  return ok(res, { ...existing, ...update });
});

router.get("/faulty-returns", authenticate, requireAnyPermission("inventory:manufactured", "inventory:raw-materials"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const returnRecords = await c.complaints
    .find({ faultyReturnStatus: { $in: ["Pending", "Received"] } })
    .sort({ updatedAt: -1, createdAt: -1 })
    .toArray();
  const pendingReturns = returnRecords.filter((complaint) => complaint.faultyReturnStatus === "Pending");
  const faultyInverters = await c.manufactured.find({ status: { $in: ["Faulty", "Returned"] } }).toArray();
  const faultySpares = await c.rawMaterials.find({ faultyQuantity: { $gt: 0 } }).toArray();
  const repairedInverters = await c.manufactured.find({ status: "Repaired" }).toArray();
  const repairedSpares = await c.rawMaterials.find({ repairedQuantity: { $gt: 0 } }).toArray();

  return ok(res, {
    returnRecords,
    pendingReturns,
    faultyInverters,
    faultySpares,
    repairedInverters,
    repairedSpares,
  });
});

router.put("/faulty-return/:complaintId/receive", authenticate, requireAnyPermission("inventory:manufactured", "inventory:raw-materials"), async (req: Request, res: Response) => {
  const { complaintId } = req.params;
  const c = await getCollections();
  
  const complaint = await c.complaints.findOne({ id: complaintId });
  if (!complaint) return fail(res, "Complaint not found", 404);
  if (complaint.faultyReturnStatus !== "Pending") return fail(res, "Return is not pending", 400);

  const { notes } = req.body;
  const now = new Date();

  if (complaint.faultyReturnType === "Inverter" && complaint.faultyReturnItemId) {
    const mfg = await c.manufactured.findOne({ serialNumber: complaint.faultyReturnItemId });
    if (mfg) {
      await c.manufactured.updateOne(
        { _id: mfg._id }, 
        { $set: { status: "Faulty", returnReason: notes || "Returned from complaint " + complaint.id, updatedAt: now } }
      );
    }
  } else if (complaint.faultyReturnType === "Spare Part" && complaint.faultyReturnItemId) {
    const raw = await c.rawMaterials.findOne({ id: complaint.faultyReturnItemId });
    if (raw) {
      await c.rawMaterials.updateOne(
        { _id: raw._id },
        { $inc: { faultyQuantity: 1 }, $set: { updatedAt: now } }
      );
    }
  }

  await c.complaints.updateOne(
    { id: complaint.id },
    { $set: { faultyReturnStatus: "Received", faultyReturnNotes: notes, updatedAt: now } }
  );

  return ok(res, { message: "Return received successfully" });
});

export default router;
