"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const multer_1 = __importDefault(require("multer"));
const collections_1 = require("../db/collections");
const auth_1 = require("../middleware/auth");
const cloudinary_1 = require("../utils/cloudinary");
const http_1 = require("../utils/http");
const id_1 = require("../utils/id");
const router = express_1.default.Router();
const MAX_DISPATCH_DOCKET_BYTES = 5 * 1024 * 1024;
const dispatchDocketUpload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: MAX_DISPATCH_DOCKET_BYTES },
});
function parsePiItems(value) {
    if (!Array.isArray(value))
        return undefined;
    const parsed = [];
    for (const item of value) {
        if (!item || typeof item !== "object")
            continue;
        const row = item;
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
function piYearFromDate(value) {
    const parsed = value ? new Date(String(value)) : new Date();
    return Number.isFinite(parsed.getTime()) ? parsed.getFullYear() : new Date().getFullYear();
}
function isPlaceholderPiNumber(value) {
    return /^PI-\d{4}-X+$/i.test(value);
}
async function nextPiNumber(c, year = new Date().getFullYear()) {
    const rows = await c.sales
        .find({ referenceNo: { $regex: `^PI-${year}-\\d+$`, $options: "i" } }, { projection: { referenceNo: 1 } })
        .toArray();
    const maxNumber = rows.reduce((max, row) => {
        const match = String(row.referenceNo ?? "").match(new RegExp(`^PI-${year}-(\\d+)$`, "i"));
        return match ? Math.max(max, Number(match[1]) || 0) : max;
    }, 0);
    return `PI-${year}-${String(maxNumber + 1).padStart(4, "0")}`;
}
async function resolveUniquePiNumber(c, value, saleDate, excludeSaleId) {
    const year = piYearFromDate(saleDate);
    let referenceNo = String(value ?? "").trim();
    if (!referenceNo || isPlaceholderPiNumber(referenceNo)) {
        referenceNo = await nextPiNumber(c, year);
    }
    const duplicate = await c.sales.findOne({ referenceNo, ...(excludeSaleId ? { id: { $ne: excludeSaleId } } : {}) }, { projection: { id: 1 } });
    if (duplicate) {
        throw new Error("This PI number already exists. Please generate a new PI number.");
    }
    return referenceNo;
}
function runDispatchDocketUpload(req, res, next) {
    dispatchDocketUpload.single("docket")(req, res, (err) => {
        if (!err)
            return next();
        if (err instanceof multer_1.default.MulterError && err.code === "LIMIT_FILE_SIZE") {
            return (0, http_1.fail)(res, "File size must be 5 MB or less", 413);
        }
        return next(err);
    });
}
function runPiUpload(req, res, next) {
    dispatchDocketUpload.single("pi")(req, res, (err) => {
        if (!err)
            return next();
        if (err instanceof multer_1.default.MulterError && err.code === "LIMIT_FILE_SIZE") {
            return (0, http_1.fail)(res, "File size must be 5 MB or less", 413);
        }
        return next(err);
    });
}
/** GET /api/sales */
router.get("/", auth_1.authenticate, (0, auth_1.requireAnyPermission)("sales:entry", "dispatch:manage", "accounts:manage"), async (req, res) => {
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
router.get("/next-pi-number", auth_1.authenticate, (0, auth_1.requireAnyPermission)("sales:entry"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const yearParam = Number(req.query.year);
    const year = Number.isInteger(yearParam) && yearParam >= 2000 && yearParam <= 9999 ? yearParam : new Date().getFullYear();
    return (0, http_1.ok)(res, { referenceNo: await nextPiNumber(c, year) });
});
router.put("/:id/force-pi", auth_1.authenticate, (0, auth_1.authorize)("Admin"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const { id } = req.params;
    const { documentType, referenceNo, saleDate, customerId, unregisteredCustomerName, unregisteredCustomerAddress, unregisteredCustomerGst, shipToAddressKey, registrationCode, materialName, quantity, piItems, stateRegion, dealerRegistered, priceCategory, availableQuantity, inventoryStatus, expectedDispatchDate, dispatchStatus, paymentStatus, } = req.body;
    const sale = await c.sales.findOne({ id });
    if (!sale)
        return (0, http_1.fail)(res, "PI record not found", 404);
    if (sale.forcePiApprovalStatus !== "Pending")
        return (0, http_1.fail)(res, "Only pending PI can be edited before approval");
    const update = {};
    if (documentType !== undefined)
        update.documentType = String(documentType);
    if (saleDate)
        update.saleDate = new Date(saleDate);
    if (referenceNo !== undefined) {
        try {
            update.referenceNo = await resolveUniquePiNumber(c, referenceNo, saleDate ?? sale.saleDate, String(id));
        }
        catch (err) {
            return (0, http_1.fail)(res, err instanceof Error ? err.message : "Invalid PI number");
        }
    }
    if (customerId !== undefined) {
        const customer = await c.customers.findOne({ id: String(customerId) }, { projection: { id: 1 } });
        if (!customer)
            return (0, http_1.fail)(res, "Customer not found", 404);
        update.customerId = String(customerId);
    }
    if (unregisteredCustomerName !== undefined)
        update.unregisteredCustomerName = String(unregisteredCustomerName);
    if (unregisteredCustomerAddress !== undefined)
        update.unregisteredCustomerAddress = String(unregisteredCustomerAddress);
    if (unregisteredCustomerGst !== undefined)
        update.unregisteredCustomerGst = String(unregisteredCustomerGst);
    if (shipToAddressKey !== undefined)
        update.shipToAddressKey = shipToAddressKey;
    if (registrationCode !== undefined)
        update.registrationCode = String(registrationCode);
    if (materialName !== undefined)
        update.materialName = String(materialName);
    if (quantity !== undefined && quantity !== null)
        update.quantity = Number(quantity);
    if (piItems !== undefined) {
        const parsedPiItems = parsePiItems(piItems);
        if (!parsedPiItems?.length)
            return (0, http_1.fail)(res, "At least one valid PI item is required");
        update.piItems = parsedPiItems;
        update.materialName = parsedPiItems[0].materialName;
        update.quantity = parsedPiItems.reduce((sum, item) => sum + item.quantity, 0);
    }
    if (stateRegion !== undefined)
        update.stateRegion = String(stateRegion);
    if (typeof dealerRegistered === "boolean")
        update.dealerRegistered = dealerRegistered;
    if (priceCategory !== undefined)
        update.priceCategory = priceCategory;
    if (availableQuantity !== undefined && availableQuantity !== null)
        update.availableQuantity = Number(availableQuantity);
    if (inventoryStatus !== undefined)
        update.inventoryStatus = inventoryStatus;
    if (expectedDispatchDate)
        update.expectedDispatchDate = new Date(expectedDispatchDate);
    if (dispatchStatus !== undefined)
        update.dispatchStatus = dispatchStatus;
    if (paymentStatus !== undefined)
        update.paymentStatus = paymentStatus;
    if (Object.keys(update).length === 0)
        return (0, http_1.fail)(res, "No PI updates provided");
    await c.sales.updateOne({ id }, { $set: update });
    const updated = await c.sales.findOne({ id });
    return (0, http_1.ok)(res, updated);
});
router.post("/:id/approve-force-pi", auth_1.authenticate, (0, auth_1.authorize)("Admin"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const { id } = req.params;
    const { documentType, referenceNo, saleDate, customerId, dealerRegistered, registrationCode, unregisteredCustomerName, unregisteredCustomerAddress, unregisteredCustomerGst, shipToAddressKey, materialName, quantity, piItems, stateRegion, priceCategory, availableQuantity, inventoryStatus, expectedDispatchDate, dispatchStatus, paymentStatus, } = req.body;
    const sale = await c.sales.findOne({ id });
    if (!sale)
        return (0, http_1.fail)(res, "PI record not found", 404);
    if (sale.forcePiApprovalStatus === "Approved")
        return (0, http_1.fail)(res, "Force PI is already approved");
    const user = req.user;
    const update = {
        forcePiPermission: true,
        forcePiApprovalStatus: "Approved",
        forcePiApprovedBy: user.userId,
        forcePiApprovedAt: new Date(),
    };
    if (documentType !== undefined)
        update.documentType = String(documentType);
    if (saleDate)
        update.saleDate = new Date(saleDate);
    if (referenceNo !== undefined) {
        try {
            update.referenceNo = await resolveUniquePiNumber(c, referenceNo, saleDate ?? sale.saleDate, String(id));
        }
        catch (err) {
            return (0, http_1.fail)(res, err instanceof Error ? err.message : "Invalid PI number");
        }
    }
    if (customerId !== undefined) {
        const customer = await c.customers.findOne({ id: String(customerId) }, { projection: { id: 1 } });
        if (!customer)
            return (0, http_1.fail)(res, "Customer not found", 404);
        update.customerId = String(customerId);
    }
    if (typeof dealerRegistered === "boolean")
        update.dealerRegistered = dealerRegistered;
    if (registrationCode !== undefined)
        update.registrationCode = String(registrationCode);
    if (unregisteredCustomerName !== undefined)
        update.unregisteredCustomerName = String(unregisteredCustomerName);
    if (unregisteredCustomerAddress !== undefined)
        update.unregisteredCustomerAddress = String(unregisteredCustomerAddress);
    if (unregisteredCustomerGst !== undefined)
        update.unregisteredCustomerGst = String(unregisteredCustomerGst);
    if (shipToAddressKey !== undefined)
        update.shipToAddressKey = shipToAddressKey;
    if (materialName !== undefined)
        update.materialName = String(materialName);
    if (quantity !== undefined && quantity !== null)
        update.quantity = Number(quantity);
    if (piItems !== undefined) {
        const parsedPiItems = parsePiItems(piItems);
        if (!parsedPiItems?.length)
            return (0, http_1.fail)(res, "At least one valid PI item is required");
        update.piItems = parsedPiItems;
        update.materialName = parsedPiItems[0].materialName;
        update.quantity = parsedPiItems.reduce((sum, item) => sum + item.quantity, 0);
    }
    if (stateRegion !== undefined)
        update.stateRegion = String(stateRegion);
    if (priceCategory !== undefined)
        update.priceCategory = priceCategory;
    if (availableQuantity !== undefined && availableQuantity !== null)
        update.availableQuantity = Number(availableQuantity);
    if (inventoryStatus !== undefined)
        update.inventoryStatus = inventoryStatus;
    if (expectedDispatchDate)
        update.expectedDispatchDate = new Date(expectedDispatchDate);
    if (dispatchStatus !== undefined)
        update.dispatchStatus = dispatchStatus;
    if (paymentStatus !== undefined)
        update.paymentStatus = paymentStatus;
    await c.sales.updateOne({ id }, { $set: update });
    const approved = await c.sales.findOne({ id });
    return (0, http_1.ok)(res, approved);
});
/** POST /api/sales/upload-docket — upload courier docket file to Cloudinary */
router.post("/upload-docket", auth_1.authenticate, (0, auth_1.requireAnyPermission)("dispatch:manage"), runDispatchDocketUpload, async (req, res) => {
    const file = req.file;
    if (!file)
        return (0, http_1.fail)(res, "Courier docket file is required");
    try {
        const uploaded = await (0, cloudinary_1.uploadBufferToCloudinary)(file, "aurawatt/dispatch-dockets");
        if (!uploaded.url)
            return (0, http_1.fail)(res, "Cloudinary did not return a file URL", 502);
        return (0, http_1.ok)(res, {
            fileName: file.originalname,
            fileType: file.mimetype || undefined,
            fileSize: file.size,
            url: uploaded.url,
            publicId: uploaded.publicId,
            resourceType: uploaded.resourceType,
            format: uploaded.format,
            uploadedAt: new Date(),
        }, 201);
    }
    catch (err) {
        return (0, http_1.fail)(res, err instanceof Error ? err.message : "Failed to upload courier docket", 502);
    }
});
/** POST /api/sales/upload-pi — upload PI file to Cloudinary */
router.post("/upload-pi", auth_1.authenticate, (0, auth_1.requireAnyPermission)("sales:entry", "accounts:manage"), runPiUpload, async (req, res) => {
    const file = req.file;
    if (!file)
        return (0, http_1.fail)(res, "PI file is required");
    try {
        const uploaded = await (0, cloudinary_1.uploadBufferToCloudinary)(file, "aurawatt/pi-attachments");
        if (!uploaded.url)
            return (0, http_1.fail)(res, "Cloudinary did not return a file URL", 502);
        return (0, http_1.ok)(res, {
            fileName: file.originalname,
            fileType: file.mimetype || undefined,
            fileSize: file.size,
            url: uploaded.url,
            publicId: uploaded.publicId,
            resourceType: uploaded.resourceType,
            format: uploaded.format,
            uploadedAt: new Date(),
        }, 201);
    }
    catch (err) {
        return (0, http_1.fail)(res, err instanceof Error ? err.message : "Failed to upload PI file", 502);
    }
});
router.put("/:id/accounts", auth_1.authenticate, (0, auth_1.requireAnyPermission)("accounts:manage"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const { id } = req.params;
    const { taxInvoiceAttachmentName, taxInvoiceAttachmentUrl, ewayBillAttachmentName, ewayBillAttachmentUrl, paymentStatus, } = req.body;
    const sale = await c.sales.findOne({ id });
    if (!sale)
        return (0, http_1.fail)(res, "PI record not found", 404);
    if (!sale.referenceNo)
        return (0, http_1.fail)(res, "PI must be generated before payment verification");
    const user = req.user;
    const update = {};
    if (taxInvoiceAttachmentName !== undefined)
        update.taxInvoiceAttachmentName = String(taxInvoiceAttachmentName);
    if (taxInvoiceAttachmentUrl !== undefined)
        update.taxInvoiceAttachmentUrl = String(taxInvoiceAttachmentUrl);
    if (ewayBillAttachmentName !== undefined)
        update.ewayBillAttachmentName = String(ewayBillAttachmentName);
    if (ewayBillAttachmentUrl !== undefined)
        update.ewayBillAttachmentUrl = String(ewayBillAttachmentUrl);
    if (paymentStatus !== undefined)
        update.paymentStatus = paymentStatus === "Confirmed" ? "Confirmed" : "Pending";
    if ((taxInvoiceAttachmentName !== undefined || taxInvoiceAttachmentUrl !== undefined || ewayBillAttachmentName !== undefined || ewayBillAttachmentUrl !== undefined) &&
        ((!update.taxInvoiceAttachmentName && !sale.taxInvoiceAttachmentName) ||
            (!update.ewayBillAttachmentName && !sale.ewayBillAttachmentName))) {
        return (0, http_1.fail)(res, "Tax Invoice and E-Way Bill upload required before accounts documents can be shared");
    }
    if ((update.taxInvoiceAttachmentName || update.taxInvoiceAttachmentUrl || update.ewayBillAttachmentName || update.ewayBillAttachmentUrl) && sale.dispatchStatus === "Planned") {
        return (0, http_1.fail)(res, "Dispatch request must be generated before Tax Invoice and E-Way Bill upload");
    }
    if (update.paymentStatus === "Confirmed" || update.taxInvoiceAttachmentName || update.ewayBillAttachmentName) {
        update.accountsSharedAt = new Date();
        update.accountsSharedBy = user.userId;
    }
    await c.sales.updateOne({ id }, { $set: update });
    const updated = await c.sales.findOne({ id });
    return (0, http_1.ok)(res, updated);
});
router.put("/:id/sales-dispatch", auth_1.authenticate, (0, auth_1.requireAnyPermission)("sales:entry"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const { id } = req.params;
    const { saleDate, piAttachmentName, piAttachmentUrl, expectedDispatchDate, confirmedDispatchDate, dispatchStatus } = req.body;
    const sale = await c.sales.findOne({ id });
    if (!sale)
        return (0, http_1.fail)(res, "PI record not found", 404);
    if (dispatchStatus === "Ready" && sale.paymentStatus !== "Confirmed") {
        return (0, http_1.fail)(res, "Payment must be verified before Sales Order and dispatch request");
    }
    const update = {};
    if (saleDate)
        update.saleDate = new Date(saleDate);
    if (piAttachmentName !== undefined)
        update.piAttachmentName = String(piAttachmentName);
    if (piAttachmentUrl !== undefined)
        update.piAttachmentUrl = String(piAttachmentUrl);
    if (expectedDispatchDate)
        update.expectedDispatchDate = new Date(expectedDispatchDate);
    if (confirmedDispatchDate)
        update.confirmedDispatchDate = new Date(confirmedDispatchDate);
    if (dispatchStatus !== undefined)
        update.dispatchStatus = dispatchStatus;
    if (!update.saleDate && !update.piAttachmentName && !update.expectedDispatchDate && !update.confirmedDispatchDate) {
        return (0, http_1.fail)(res, "PI attachment or dispatch date is required");
    }
    await c.sales.updateOne({ id }, { $set: update });
    const updated = await c.sales.findOne({ id });
    return (0, http_1.ok)(res, updated);
});
router.put("/:id/dispatch-team", auth_1.authenticate, (0, auth_1.requireAnyPermission)("dispatch:manage"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const { id } = req.params;
    const { serialNumber, confirmedDispatchDate, dispatchStatus, courierDocketNo, courierDocketAttachmentName, courierDocketAttachmentUrl, } = req.body;
    const sale = await c.sales.findOne({ id });
    if (!sale)
        return (0, http_1.fail)(res, "PI record not found", 404);
    const update = {};
    if (serialNumber) {
        const mfg = await c.manufactured.findOne({ serialNumber: String(serialNumber) });
        if (!mfg)
            return (0, http_1.fail)(res, "Serial number not found in manufactured products");
        if (mfg.status === "Sold" && mfg.invoiceNo !== sale.referenceNo)
            return (0, http_1.fail)(res, "This product is already sold");
        update.serialNumber = String(serialNumber);
        await c.manufactured.updateOne({ id: mfg.id }, {
            $set: {
                status: "Sold",
                invoiceNo: sale.referenceNo,
                customerId: sale.customerId,
                soldDate: confirmedDispatchDate ? new Date(confirmedDispatchDate) : new Date(),
                paymentStatus: sale.paymentStatus === "Confirmed" ? "Verified" : "Pending",
                updatedAt: new Date(),
            },
        });
    }
    if (confirmedDispatchDate)
        update.confirmedDispatchDate = new Date(confirmedDispatchDate);
    if (dispatchStatus !== undefined)
        update.dispatchStatus = dispatchStatus;
    if (courierDocketNo !== undefined)
        update.courierDocketNo = String(courierDocketNo);
    if (courierDocketAttachmentName !== undefined)
        update.courierDocketAttachmentName = String(courierDocketAttachmentName);
    if (courierDocketAttachmentUrl !== undefined)
        update.courierDocketAttachmentUrl = String(courierDocketAttachmentUrl);
    const isDeliveryStatus = dispatchStatus === "Final Dispatch" || dispatchStatus === "Delivered";
    if (isDeliveryStatus && sale.paymentStatus !== "Confirmed") {
        return (0, http_1.fail)(res, "Payment must be confirmed by Accounts before delivery");
    }
    if (isDeliveryStatus && !update.serialNumber && !sale.serialNumber) {
        return (0, http_1.fail)(res, "Serial allocation is required before material dispatch");
    }
    if (isDeliveryStatus && (!sale.taxInvoiceAttachmentName || !sale.ewayBillAttachmentName)) {
        return (0, http_1.fail)(res, "Tax Invoice and E-Way Bill are required before delivery");
    }
    if (isDeliveryStatus && !update.confirmedDispatchDate && !sale.confirmedDispatchDate) {
        return (0, http_1.fail)(res, "Confirm date of dispatch is required for delivery");
    }
    if (isDeliveryStatus &&
        !update.courierDocketNo &&
        !update.courierDocketAttachmentName &&
        !sale.courierDocketNo &&
        !sale.courierDocketAttachmentName) {
        return (0, http_1.fail)(res, "Courier docket no. or docket attachment is required for delivery");
    }
    if (Object.keys(update).length === 0)
        return (0, http_1.fail)(res, "No dispatch updates provided");
    await c.sales.updateOne({ id }, { $set: update });
    const updated = await c.sales.findOne({ id });
    return (0, http_1.ok)(res, updated);
});
/**
 * POST /api/sales
 * Records a sales workflow entry. If serialNumber is supplied, also marks
 * the manufactured product as Sold for backward-compatible serial sales.
 */
router.post("/", auth_1.authenticate, (0, auth_1.requireAnyPermission)("sales:entry"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const { serialNumber, documentType, referenceNo, saleDate, customerId, unregisteredCustomerName, unregisteredCustomerAddress, unregisteredCustomerGst, shipToAddressKey, registrationCode, materialName, quantity, piItems, stateRegion, dealerRegistered, rjApprovalStatus, forcePiPermission, priceCategory, availableQuantity, inventoryStatus, forcePiApprovalStatus, piAttachmentName, piAttachmentUrl, expectedDispatchDate, confirmedDispatchDate, dispatchStatus, courierDocketNo, courierDocketAttachmentName, courierDocketAttachmentUrl, paymentStatus, } = req.body;
    const isRegisteredCustomer = dealerRegistered !== false;
    if (!documentType || !saleDate || (isRegisteredCustomer && !customerId)) {
        return (0, http_1.fail)(res, "documentType, saleDate and registered customer are required");
    }
    if (!isRegisteredCustomer && (!unregisteredCustomerName || !unregisteredCustomerAddress || !stateRegion)) {
        return (0, http_1.fail)(res, "Non-registered customer name, ship-to address and state/region are required");
    }
    const parsedPiItems = parsePiItems(piItems);
    const isWorkflowEntry = Boolean(materialName || quantity || parsedPiItems?.length || stateRegion);
    const isDispatchEntry = Boolean(piAttachmentName ||
        piAttachmentUrl ||
        expectedDispatchDate ||
        confirmedDispatchDate ||
        dispatchStatus ||
        courierDocketNo ||
        courierDocketAttachmentName ||
        courierDocketAttachmentUrl);
    if (!isWorkflowEntry && !isDispatchEntry && !serialNumber) {
        return (0, http_1.fail)(res, "serialNumber or dispatch details are required");
    }
    if (isWorkflowEntry && (!(materialName || parsedPiItems?.length) || !(quantity || parsedPiItems?.length) || !stateRegion)) {
        return (0, http_1.fail)(res, "PI item, quantity and stateRegion are required");
    }
    if (isRegisteredCustomer) {
        const customer = await c.customers.findOne({ id: customerId }, { projection: { id: 1 } });
        if (!customer)
            return (0, http_1.fail)(res, "Customer not found", 404);
    }
    const user = req.user;
    let finalReferenceNo = "";
    try {
        finalReferenceNo = await resolveUniquePiNumber(c, referenceNo, saleDate);
    }
    catch (err) {
        return (0, http_1.fail)(res, err instanceof Error ? err.message : "Invalid PI number");
    }
    const requestedForcePi = Boolean(forcePiPermission) ||
        forcePiApprovalStatus === "Pending" ||
        forcePiApprovalStatus === "Approved" ||
        dealerRegistered === false;
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
                invoiceNo: finalReferenceNo,
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
        referenceNo: finalReferenceNo,
        saleDate: new Date(saleDate),
        customerId: customerId || undefined,
        createdBy: user.userId,
        createdAt: new Date(),
    };
    if (serialNumber)
        sale.serialNumber = String(serialNumber);
    if (unregisteredCustomerName)
        sale.unregisteredCustomerName = String(unregisteredCustomerName);
    if (unregisteredCustomerAddress)
        sale.unregisteredCustomerAddress = String(unregisteredCustomerAddress);
    if (unregisteredCustomerGst)
        sale.unregisteredCustomerGst = String(unregisteredCustomerGst);
    if (shipToAddressKey)
        sale.shipToAddressKey = shipToAddressKey;
    if (registrationCode)
        sale.registrationCode = String(registrationCode);
    if (parsedPiItems?.length) {
        sale.piItems = parsedPiItems;
        sale.materialName = parsedPiItems[0].materialName;
        sale.quantity = parsedPiItems.reduce((sum, item) => sum + item.quantity, 0);
    }
    else {
        if (materialName)
            sale.materialName = String(materialName);
        if (quantity)
            sale.quantity = Number(quantity);
    }
    if (stateRegion)
        sale.stateRegion = String(stateRegion);
    if (typeof dealerRegistered === "boolean")
        sale.dealerRegistered = dealerRegistered;
    if (rjApprovalStatus)
        sale.rjApprovalStatus = rjApprovalStatus;
    if (requestedForcePi) {
        sale.forcePiPermission = true;
        if (forcePiApprovalStatus === "Approved" && user.role === "Admin") {
            sale.forcePiApprovalStatus = "Approved";
            sale.forcePiApprovedBy = user.userId;
            sale.forcePiApprovedAt = new Date();
        }
        else {
            sale.forcePiApprovalStatus = "Pending";
        }
    }
    else if (typeof forcePiPermission === "boolean") {
        sale.forcePiPermission = false;
    }
    if (priceCategory)
        sale.priceCategory = priceCategory;
    if (availableQuantity !== undefined && availableQuantity !== null)
        sale.availableQuantity = Number(availableQuantity);
    if (inventoryStatus)
        sale.inventoryStatus = inventoryStatus;
    if (!requestedForcePi && forcePiApprovalStatus)
        sale.forcePiApprovalStatus = forcePiApprovalStatus;
    if (piAttachmentName)
        sale.piAttachmentName = String(piAttachmentName);
    if (piAttachmentUrl)
        sale.piAttachmentUrl = String(piAttachmentUrl);
    if (expectedDispatchDate)
        sale.expectedDispatchDate = new Date(expectedDispatchDate);
    if (confirmedDispatchDate)
        sale.confirmedDispatchDate = new Date(confirmedDispatchDate);
    if (dispatchStatus)
        sale.dispatchStatus = dispatchStatus;
    if (courierDocketNo)
        sale.courierDocketNo = String(courierDocketNo);
    if (courierDocketAttachmentName)
        sale.courierDocketAttachmentName = String(courierDocketAttachmentName);
    if (courierDocketAttachmentUrl)
        sale.courierDocketAttachmentUrl = String(courierDocketAttachmentUrl);
    if (paymentStatus)
        sale.paymentStatus = paymentStatus;
    await c.sales.insertOne(sale);
    // Best-effort notification (never fail the main operation).
    try {
        const notification = {
            id: (0, id_1.generateId)(),
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
    }
    catch (err) {
        console.warn("Failed to insert notification:", err instanceof Error ? err.message : String(err));
    }
    return (0, http_1.ok)(res, sale, 201);
});
exports.default = router;
