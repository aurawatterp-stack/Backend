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
const router = express_1.default.Router();
/** GET /api/sales */
router.get("/", auth_1.authenticate, (0, auth_1.requireAnyPermission)("sales:entry"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const { page = "1", limit = "20" } = req.query;
    const p = Math.max(1, parseInt(page));
    const l = Math.min(100, parseInt(limit));
    const total = await c.sales.countDocuments({});
    const data = await c.sales
        .find({})
        .sort({ saleDate: -1 })
        .skip((p - 1) * l)
        .limit(l)
        .toArray();
    return (0, http_1.ok)(res, { data, total, page: p, limit: l });
});
/**
 * POST /api/sales
 * Records a sales workflow entry. If serialNumber is supplied, also marks
 * the manufactured product as Sold for backward-compatible serial sales.
 */
router.post("/", auth_1.authenticate, (0, auth_1.requireAnyPermission)("sales:entry"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const { serialNumber, documentType, referenceNo, saleDate, customerId, registrationCode, materialName, quantity, stateRegion, dealerRegistered, rjApprovalStatus, forcePiPermission, priceCategory, availableQuantity, inventoryStatus, forcePiApprovalStatus, expectedDispatchDate, dispatchStatus, paymentStatus, } = req.body;
    if (!documentType || !referenceNo || !saleDate || !customerId) {
        return (0, http_1.fail)(res, "documentType, referenceNo, saleDate, customerId are required");
    }
    const isWorkflowEntry = Boolean(registrationCode || materialName || quantity || stateRegion);
    if (!isWorkflowEntry && !serialNumber) {
        return (0, http_1.fail)(res, "serialNumber is required for legacy sale entries");
    }
    if (isWorkflowEntry && (!registrationCode || !materialName || !quantity || !stateRegion)) {
        return (0, http_1.fail)(res, "registrationCode, materialName, quantity and stateRegion are required");
    }
    const customer = await c.customers.findOne({ id: customerId }, { projection: { id: 1 } });
    if (!customer)
        return (0, http_1.fail)(res, "Customer not found", 404);
    const user = req.user;
    if (serialNumber) {
        const mfg = await c.manufactured.findOne({ serialNumber });
        if (!mfg)
            return (0, http_1.fail)(res, "Serial number not found in manufactured products");
        if (mfg.status === "Sold")
            return (0, http_1.fail)(res, "This product is already sold");
        const updatedAt = new Date();
        await c.manufactured.updateOne({ id: mfg.id }, {
            $set: {
                status: "Sold",
                invoiceNo: referenceNo,
                customerId,
                soldDate: new Date(saleDate),
                paymentStatus: paymentStatus === "Confirmed" ? "Verified" : "Pending",
                updatedAt,
            },
        });
    }
    const sale = {
        id: (0, id_1.generateId)(),
        documentType,
        referenceNo,
        saleDate: new Date(saleDate),
        customerId,
        createdBy: user.userId,
        createdAt: new Date(),
    };
    if (serialNumber)
        sale.serialNumber = String(serialNumber);
    if (registrationCode)
        sale.registrationCode = String(registrationCode);
    if (materialName)
        sale.materialName = String(materialName);
    if (quantity)
        sale.quantity = Number(quantity);
    if (stateRegion)
        sale.stateRegion = String(stateRegion);
    if (typeof dealerRegistered === "boolean")
        sale.dealerRegistered = dealerRegistered;
    if (rjApprovalStatus)
        sale.rjApprovalStatus = rjApprovalStatus;
    if (typeof forcePiPermission === "boolean")
        sale.forcePiPermission = forcePiPermission;
    if (priceCategory)
        sale.priceCategory = priceCategory;
    if (availableQuantity !== undefined && availableQuantity !== null)
        sale.availableQuantity = Number(availableQuantity);
    if (inventoryStatus)
        sale.inventoryStatus = inventoryStatus;
    if (forcePiApprovalStatus)
        sale.forcePiApprovalStatus = forcePiApprovalStatus;
    if (expectedDispatchDate)
        sale.expectedDispatchDate = new Date(expectedDispatchDate);
    if (dispatchStatus)
        sale.dispatchStatus = dispatchStatus;
    if (paymentStatus)
        sale.paymentStatus = paymentStatus;
    await c.sales.insertOne(sale);
    // Best-effort notification (never fail the main operation).
    try {
        const notification = {
            id: (0, id_1.generateId)(),
            type: "sale_recorded",
            title: isWorkflowEntry ? "New Sales Workflow PI" : "New Sale Recorded",
            body: `${referenceNo} • ${materialName || serialNumber || "Sales workflow"}`,
            entityType: "sale",
            entityId: sale.id,
            meta: { serialNumber, referenceNo, customerId, materialName, quantity, stateRegion },
            audienceRoles: ["Admin", "Sales", "Inventory"],
            readBy: [],
            createdBy: user.userId,
            createdAt: new Date(),
        };
        await c.notifications.insertOne(notification);
    }
    catch (err) {
        console.warn("Failed to insert notification:", err instanceof Error ? err.message : String(err));
    }
    return (0, http_1.ok)(res, sale, 201);
});
exports.default = router;
