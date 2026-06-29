"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const collections_1 = require("../db/collections");
const auth_1 = require("../middleware/auth");
const http_1 = require("../utils/http");
const id_1 = require("../utils/id");
const serialLifecycle_1 = require("../utils/serialLifecycle");
const router = express_1.default.Router();
function normalizeBomUsage(input) {
    if (!Array.isArray(input))
        return [];
    return input
        .map((item) => ({
        rawMaterialId: item.rawMaterialId ? String(item.rawMaterialId) : undefined,
        materialName: String(item.materialName ?? ""),
        batch: item.batch ? String(item.batch) : undefined,
        inwardMode: item.inwardMode === "Local" || item.inwardMode === "International"
            ? item.inwardMode
            : undefined,
        invoiceNo: item.invoiceNo ? String(item.invoiceNo) : undefined,
        vendorName: item.vendorName ? String(item.vendorName) : undefined,
        quantityUsed: Number(item.quantityUsed) || 0,
    }))
        .filter((item) => item.rawMaterialId && item.materialName && item.quantityUsed > 0);
}
function usageByRawMaterial(usage) {
    const map = new Map();
    for (const item of usage ?? []) {
        if (!item.rawMaterialId)
            continue;
        map.set(item.rawMaterialId, (map.get(item.rawMaterialId) ?? 0) + (Number(item.quantityUsed) || 0));
    }
    return map;
}
function normalizeText(value) {
    return String(value ?? "").trim();
}
function complaintSpareParts(complaint) {
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
    if (!materialName || quantity <= 0)
        return [];
    return [{
            id: `${complaint.id}-spare`,
            series: undefined,
            rawMaterialId: normalizeText(complaint.rawMaterialId) || undefined,
            materialName,
            quantity,
            notes: normalizeText(complaint.dispatchPlan) || undefined,
        }];
}
function replacementLabel(complaint) {
    return [
        complaint.replacementSeriesName || complaint.replacementProductName,
        complaint.replacementModelName || complaint.replacementProductNo,
    ].filter(Boolean).join(" ") || "Replacement inverter";
}
async function resolveComplaintReplacementSeries(c, complaint) {
    const explicitSeries = normalizeText(complaint.replacementSeriesName || complaint.replacementProductName);
    if (explicitSeries)
        return explicitSeries;
    const explicitModel = normalizeText(complaint.replacementModelName || complaint.replacementProductNo || complaint.productModel);
    if (!explicitModel)
        return "";
    const product = await c.products.findOne({
        $or: [{ id: explicitModel }, { model: explicitModel }],
    });
    return product?.series ?? "";
}
async function insertDispatchApprovalNotification(c, complaint, user, title, body, meta) {
    const notification = {
        id: (0, id_1.generateId)(),
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
async function resolveRawMaterialDeductions(c, parts) {
    const deductions = [];
    for (const part of parts) {
        let remaining = part.quantity;
        const selectedRows = [];
        if (part.rawMaterialId) {
            const raw = await c.rawMaterials.findOne({ id: part.rawMaterialId });
            if (!raw)
                return { error: `${part.materialName} raw material entry not found` };
            selectedRows.push(raw);
        }
        else {
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
            if (remaining <= 0)
                break;
            const quantity = Math.min(Number(raw.quantityAvailable) || 0, remaining);
            if (quantity <= 0)
                continue;
            deductions.push({ raw, quantity, partName: part.materialName });
            remaining -= quantity;
        }
        if (remaining > 0) {
            return {
                error: `${part.materialName} stock insufficient. Required ${part.quantity}, available ${part.quantity - remaining}.`,
            };
        }
    }
    return { deductions };
}
async function resolveManufacturingSerial(c, productSeriesId, requestedSerial) {
    const serial = String(requestedSerial ?? "").trim();
    if (serial) {
        const existing = await c.serials.findOne({ serialNumber: serial, productSeriesId });
        if (!existing)
            return { error: "Serial number not found for the selected series" };
        if (existing.status !== "Available")
            return { error: "Selected serial is not available for manufacturing" };
        return { serialNumber: serial };
    }
    const nextAvailable = await c.serials
        .find({ productSeriesId, status: "Available" }, { projection: { serialNumber: 1 } })
        .sort({ uploadedAt: 1 })
        .limit(1)
        .toArray();
    const autoSerial = nextAvailable[0]?.serialNumber?.trim();
    if (!autoSerial)
        return { error: "No available serials found for this product series" };
    return { serialNumber: autoSerial };
}
/** GET /api/manufactured — filter by status, model, dateFrom, dateTo, customer */
router.get("/", auth_1.authenticate, (0, auth_1.requireAnyPermission)("inventory:manufactured", "sales:entry", "complaints:consumer"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const { q = "", status, model, page = "1", limit = "20" } = req.query;
    const filter = {};
    if (status)
        filter.status = status;
    if (model)
        filter.productId = model;
    if (q) {
        filter.$or = [{ serialNumber: { $regex: q, $options: "i" } }, { productId: { $regex: q, $options: "i" } }];
    }
    const p = Math.max(1, parseInt(page));
    const l = Math.min(100, parseInt(limit));
    const total = await c.manufactured.countDocuments(filter);
    const data = await c.manufactured.find(filter).skip((p - 1) * l).limit(l).toArray();
    return (0, http_1.ok)(res, { data, total, page: p, limit: l });
});
/** POST /api/manufactured — record new production */
router.post("/", auth_1.authenticate, (0, auth_1.requireAnyPermission)("inventory:manufactured"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const { productId, serialNumber, mfgDate, status, invoiceNo, paymentStatus } = req.body;
    if (!productId || !mfgDate) {
        return (0, http_1.fail)(res, "productId and mfgDate are required");
    }
    const product = await c.products.findOne({ id: productId });
    if (!product)
        return (0, http_1.fail)(res, "Product model not found", 404);
    const productSeries = String(product.series ?? "").trim();
    if (!productSeries)
        return (0, http_1.fail)(res, "Product series not found for the selected model", 404);
    const resolvedSerial = await resolveManufacturingSerial(c, productSeries, serialNumber);
    if ("error" in resolvedSerial)
        return (0, http_1.fail)(res, resolvedSerial.error ?? "Serial resolution failed");
    const duplicate = await c.manufactured.findOne({ serialNumber: resolvedSerial.serialNumber }, { projection: { id: 1 } });
    if (duplicate)
        return (0, http_1.fail)(res, "This serial number already exists");
    const seriesBom = await c.boms.findOne({ series: productSeries });
    const bomUsage = [];
    if (seriesBom && Array.isArray(seriesBom.items)) {
        for (const item of seriesBom.items) {
            const requiredQty = Number(item.quantity) || 0;
            if (requiredQty <= 0)
                continue;
            const rawMaterials = await c.rawMaterials
                .find({ productSeriesId: productSeries, materialName: item.materialName, quantityAvailable: { $gt: 0 } })
                .sort({ dateReceived: 1, createdAt: 1 })
                .toArray();
            let remainingRequired = requiredQty;
            const deductions = [];
            for (const rm of rawMaterials) {
                if (remainingRequired <= 0)
                    break;
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
                return (0, http_1.fail)(res, `Insufficient stock for Raw Material: ${item.materialName}. Required: ${requiredQty}, Available: ${requiredQty - remainingRequired}`);
            }
            for (const d of deductions) {
                await c.rawMaterials.updateOne({ id: d.id }, { $inc: { quantityAvailable: -d.qty }, $set: { updatedAt: new Date() } });
                await c.inventoryLogs.insertOne({
                    id: (0, id_1.generateId)(),
                    type: "Manufacturing",
                    itemId: d.id,
                    itemName: `${d.materialName} (${d.batch ?? "No Batch"}${d.inwardMode ? `, ${d.inwardMode}` : ""})`,
                    quantityChange: -d.qty,
                    referenceId: serialNumber,
                    notes: `Consumed for Manufacturing Serial: ${serialNumber}`,
                    createdAt: new Date(),
                    createdBy: req.user?.email || "System",
                });
            }
        }
    }
    const normalizedStatus = status === "Sold" || status === "Returned" || status === "In Stock" ? status : "In Stock";
    const normalizedPayment = paymentStatus === "Pending" || paymentStatus === "Verified" || paymentStatus === "N/A"
        ? paymentStatus
        : "N/A";
    const entry = {
        id: (0, id_1.generateId)(),
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
        id: (0, id_1.generateId)(),
        type: "Manufacturing",
        itemId: entry.id,
        itemName: `${productSeries} ${product.model} (${resolvedSerial.serialNumber})`,
        quantityChange: 1,
        referenceId: resolvedSerial.serialNumber,
        notes: `Produced new serial`,
        createdAt: new Date(),
        createdBy: req.user?.email || "System",
    });
    await (0, serialLifecycle_1.updateSerialStatus)(c, {
        serialNumber: resolvedSerial.serialNumber,
        productSeriesId: productSeries,
        status: "Manufactured",
    });
    return (0, http_1.ok)(res, entry, 201);
});
/** GET /api/manufactured/approval-requests - service spares/replacements awaiting inventory approval */
router.get("/approval-requests", auth_1.authenticate, (0, auth_1.requireAnyPermission)("inventory:manufactured"), async (_req, res) => {
    const c = await (0, collections_1.getCollections)();
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
    return (0, http_1.ok)(res, { data, total: data.length, page: 1, limit: 200 });
});
/** POST /api/manufactured/approval-requests/:id/approve - approve stock release and notify Dispatch */
router.post("/approval-requests/:id/approve", auth_1.authenticate, (0, auth_1.requireAnyPermission)("inventory:manufactured"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const user = req.user;
    const complaint = await c.complaints.findOne({ id: req.params.id });
    if (!complaint)
        return (0, http_1.fail)(res, "Approval request not found", 404);
    const now = new Date();
    const note = normalizeText(req.body?.note) || "Approved from Manufactured Products.";
    const serialFromRequest = normalizeText(req.body?.replacementSerialNo);
    const isReplacement = Boolean(complaint.replacementRecommended || complaint.replacementApprovalStatus === "Pending");
    const parts = complaintSpareParts(complaint);
    if (!isReplacement && !parts.length) {
        return (0, http_1.fail)(res, "No spare parts found for approval", 400);
    }
    const update = {
        updatedAt: now,
        spareInventoryStatus: "Available",
        spareRequestStatus: "Approved",
        status: "Awaiting Dispatch",
        trackingNotes: `${complaint.trackingNotes ? `${complaint.trackingNotes}\n` : ""}${note} at ${now.toLocaleString()}.`,
        workflowHistory: [
            ...(complaint.workflowHistory ?? []),
            {
                id: (0, id_1.generateId)(),
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
        if (!replacementSerialNo)
            return (0, http_1.fail)(res, "New replacement stock serial number is required", 400);
        const manufactured = await c.manufactured.findOne({ serialNumber: replacementSerialNo });
        if (!manufactured)
            return (0, http_1.fail)(res, "Replacement serial not found in Manufactured Products", 404);
        if (manufactured.status !== "In Stock")
            return (0, http_1.fail)(res, "Replacement serial must be In Stock before approval", 400);
        const requestedSeries = await resolveComplaintReplacementSeries(c, complaint);
        if (requestedSeries) {
            const stockProduct = await c.products.findOne({
                $or: [{ id: manufactured.productId }, { model: manufactured.productId }],
            });
            const stockSeries = normalizeText(stockProduct?.series);
            if (!stockSeries || stockSeries !== requestedSeries) {
                return (0, http_1.fail)(res, `Replacement serial must belong to the requested series (${requestedSeries})`, 400);
            }
        }
        await c.manufactured.updateOne({ id: manufactured.id }, {
            $set: {
                status: "Sold",
                invoiceNo: complaint.id,
                paymentStatus: "N/A",
                soldDate: now,
                updatedAt: now,
            },
        });
        await (0, serialLifecycle_1.updateSerialStatus)(c, { serialNumber: replacementSerialNo, status: "Dispatched" });
        await c.inventoryLogs.insertOne({
            id: (0, id_1.generateId)(),
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
        await insertDispatchApprovalNotification(c, complaint, user, "Replacement approved for dispatch", `${replacementSerialNo} approved from Manufactured Products.`, {
            status: "Awaiting Dispatch",
            replacementRequestSerialNo: complaint.replacementRequestSerialNo || complaint.productSerialNo,
            replacementSerialNo,
            replacementApprovalStatus: "Approved",
        });
        return (0, http_1.ok)(res, updated);
    }
    const resolved = await resolveRawMaterialDeductions(c, parts);
    if ("error" in resolved)
        return (0, http_1.fail)(res, resolved.error ?? "Raw material stock could not be resolved", 400);
    for (const deduction of resolved.deductions) {
        await c.rawMaterials.updateOne({ id: deduction.raw.id }, { $inc: { quantityAvailable: -deduction.quantity }, $set: { updatedAt: now } });
        await c.inventoryLogs.insertOne({
            id: (0, id_1.generateId)(),
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
    await insertDispatchApprovalNotification(c, complaint, user, "Spare approved for dispatch", `${parts.map((part) => `${part.materialName} x ${part.quantity}`).join(", ")} approved from Manufactured Products.`, { status: "Awaiting Dispatch", spareRequestStatus: "Approved" });
    return (0, http_1.ok)(res, updated);
});
/** PUT /api/manufactured/:id/bom — modify BOM and adjust raw material stock by delta only */
router.put("/:id/bom", auth_1.authenticate, (0, auth_1.requireAnyPermission)("inventory:manufactured"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const id = req.params.id;
    const existing = await c.manufactured.findOne({ id });
    if (!existing)
        return (0, http_1.fail)(res, "Record not found", 404);
    const nextBomUsage = normalizeBomUsage(req.body?.bomUsage);
    const previousUsage = usageByRawMaterial(existing.bomUsage);
    const nextUsage = usageByRawMaterial(nextBomUsage);
    const rawMaterialIds = [...new Set([...previousUsage.keys(), ...nextUsage.keys()])];
    const rawMaterials = await c.rawMaterials.find({ id: { $in: rawMaterialIds } }).toArray();
    const rawById = new Map(rawMaterials.map((entry) => [entry.id, entry]));
    for (const rawMaterialId of nextUsage.keys()) {
        if (!rawById.has(rawMaterialId))
            return (0, http_1.fail)(res, "Selected raw material entry not found", 404);
    }
    for (const rawMaterialId of rawMaterialIds) {
        const entry = rawById.get(rawMaterialId);
        if (!entry)
            continue;
        const delta = (nextUsage.get(rawMaterialId) ?? 0) - (previousUsage.get(rawMaterialId) ?? 0);
        if (delta > 0 && entry.quantityAvailable < delta) {
            return (0, http_1.fail)(res, `${entry.materialName} stock insufficient. Available ${entry.quantityAvailable}, additional required ${delta}.`);
        }
    }
    for (const rawMaterialId of rawMaterialIds) {
        const entry = rawById.get(rawMaterialId);
        if (!entry)
            continue;
        const delta = (nextUsage.get(rawMaterialId) ?? 0) - (previousUsage.get(rawMaterialId) ?? 0);
        if (delta === 0)
            continue;
        await c.rawMaterials.updateOne({ id: rawMaterialId }, { $set: { quantityAvailable: entry.quantityAvailable - delta, updatedAt: new Date() } });
    }
    const updatedAt = new Date();
    await c.manufactured.updateOne({ id }, { $set: { bomUsage: nextBomUsage, updatedAt } });
    return (0, http_1.ok)(res, { ...existing, bomUsage: nextBomUsage, updatedAt });
});
/** PUT /api/manufactured/:id */
router.put("/:id", auth_1.authenticate, (0, auth_1.requireAnyPermission)("inventory:manufactured", "sales:entry"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const id = req.params.id;
    const existing = await c.manufactured.findOne({ id });
    if (!existing)
        return (0, http_1.fail)(res, "Record not found", 404);
    const updatedAt = new Date();
    await c.manufactured.updateOne({ id }, { $set: { ...req.body, updatedAt } });
    return (0, http_1.ok)(res, { ...existing, ...req.body, updatedAt });
});
/** POST /api/manufactured/:id/return — mark product as returned */
router.post("/:id/return", auth_1.authenticate, (0, auth_1.requireAnyPermission)("inventory:manufactured"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const id = req.params.id;
    const existing = await c.manufactured.findOne({ id });
    if (!existing)
        return (0, http_1.fail)(res, "Record not found", 404);
    const { returnReason, replacedWithSerial } = req.body;
    const updatedAt = new Date();
    const update = {
        status: "Returned",
        returnReason: returnReason || "",
        returnedAt: new Date(),
        returnedBy: req.user?.id,
        returnedByName: req.user?.name,
        replacedWithSerial: replacedWithSerial || "",
        updatedAt
    };
    await c.manufactured.updateOne({ id }, { $set: update });
    return (0, http_1.ok)(res, { ...existing, ...update });
});
exports.default = router;
