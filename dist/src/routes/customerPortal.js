"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const collections_1 = require("../db/collections");
const http_1 = require("../utils/http");
const id_1 = require("../utils/id");
const router = express_1.default.Router();
function normalizeSerial(value) {
    return String(value ?? "").trim();
}
function normalizePhone(value) {
    return String(value ?? "").replace(/\D/g, "");
}
function phoneMatches(input, stored) {
    const cleanInput = normalizePhone(input);
    const cleanStored = normalizePhone(stored);
    if (!cleanInput || !cleanStored)
        return true;
    return cleanInput === cleanStored || cleanInput.endsWith(cleanStored) || cleanStored.endsWith(cleanInput);
}
async function findManufacturedBySerial(serialNumber) {
    const c = await (0, collections_1.getCollections)();
    return c.manufactured.findOne({ serialNumber });
}
/**
 * POST /api/customer-portal/login
 * Lightweight customer verification for QR/link support flow.
 */
router.post("/login", async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const serialNumber = normalizeSerial(req.body.serialNumber);
    const mobile = normalizePhone(req.body.mobile);
    if (!serialNumber || !mobile)
        return (0, http_1.fail)(res, "Inverter serial number and mobile number are required");
    const manufactured = await findManufacturedBySerial(serialNumber);
    if (!manufactured)
        return (0, http_1.fail)(res, "Serial number not found", 404);
    const customer = manufactured.customerId
        ? await c.customers.findOne({ id: manufactured.customerId }, { projection: { id: 1, name: 1, phone: 1, email: 1 } })
        : null;
    if (customer?.phone && mobile && !phoneMatches(mobile, customer.phone)) {
        return (0, http_1.fail)(res, "Mobile number does not match this serial number", 401);
    }
    return (0, http_1.ok)(res, {
        session: {
            serialNumber: manufactured.serialNumber,
            productId: manufactured.productId,
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
    });
});
/**
 * POST /api/customer-portal/complaints
 * Public customer complaint intake from mobile web / QR link.
 */
router.post("/complaints", async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const serialNumber = normalizeSerial(req.body.serialNumber);
    const mobile = normalizePhone(req.body.mobile);
    const customerName = String(req.body.customerName ?? "").trim();
    const customerEmail = String(req.body.customerEmail ?? "").trim().toLowerCase();
    const issueDescription = String(req.body.issueDescription ?? "").trim();
    if (!serialNumber || !mobile || !issueDescription) {
        return (0, http_1.fail)(res, "Serial number, mobile number and issue description are required");
    }
    const manufactured = await findManufacturedBySerial(serialNumber);
    if (!manufactured)
        return (0, http_1.fail)(res, "Serial number not found", 404);
    const linkedCustomer = manufactured.customerId
        ? await c.customers.findOne({ id: manufactured.customerId }, { projection: { id: 1, name: 1, phone: 1, email: 1 } })
        : null;
    if (linkedCustomer?.phone && mobile && !phoneMatches(mobile, linkedCustomer.phone)) {
        return (0, http_1.fail)(res, "Mobile number does not match this serial number", 401);
    }
    if (!linkedCustomer && (!customerName || !mobile)) {
        return (0, http_1.fail)(res, "Customer name and mobile number are required");
    }
    const now = new Date();
    const complaint = {
        id: (0, id_1.generateId)(),
        type: "Consumer",
        productSerialNo: serialNumber,
        customerId: linkedCustomer?.id ?? manufactured.customerId,
        customerName: linkedCustomer?.name ?? customerName,
        customerPhone: linkedCustomer?.phone ?? mobile,
        customerEmail: linkedCustomer?.email ?? (customerEmail || undefined),
        dateOfSale: manufactured.soldDate ? new Date(manufactured.soldDate) : undefined,
        dateOfComplaint: now,
        issueDescription,
        ticketSource: "Link",
        l1Sla: "4 Hours",
        initialAction: "Customer portal intake. Service team to triage and assign engineer.",
        escalationLevel: "L1",
        spareRequired: false,
        spareInventoryStatus: "Not Required",
        siteVisitRequired: false,
        l3SupportRequired: false,
        status: "Open at Aurawatt",
        raisedBy: "customer-portal",
        createdAt: now,
        updatedAt: now,
    };
    await c.complaints.insertOne(complaint);
    try {
        const notification = {
            id: (0, id_1.generateId)(),
            type: "complaint_created",
            title: "Customer complaint raised",
            body: `${complaint.productSerialNo} • ${complaint.customerName || "Customer"} • ${complaint.customerPhone || "No mobile"}`,
            entityType: "complaint",
            entityId: complaint.id,
            meta: {
                serialNumber,
                customerName: complaint.customerName,
                customerPhone: complaint.customerPhone,
                customerEmail: complaint.customerEmail,
                ticketSource: "Link",
            },
            audienceRoles: ["Admin", "Service"],
            readBy: [],
            createdBy: "customer-portal",
            createdAt: now,
        };
        await c.notifications.insertOne(notification);
    }
    catch (err) {
        console.warn("Failed to insert complaint notification:", err instanceof Error ? err.message : String(err));
    }
    return (0, http_1.ok)(res, {
        id: complaint.id,
        status: complaint.status,
        productSerialNo: complaint.productSerialNo,
        dateOfComplaint: complaint.dateOfComplaint,
    }, 201);
});
exports.default = router;
