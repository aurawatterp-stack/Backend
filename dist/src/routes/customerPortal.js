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
const MAX_ACTIVE_TICKETS_PER_ENGINEER = 5;
const STANDARD_WARRANTY_MONTHS = 60;
const PORTAL_SERVICE_REGIONS = [
    { name: "NCR", keywords: ["delhi", "noida", "gurgaon", "gurugram", "faridabad", "ghaziabad"], engineerEmail: "l1.rohit@avavbusiness.com", engineerName: "Rohit Sharma", backupEngineerName: "Amit Verma" },
    { name: "UP", keywords: ["lucknow", "kanpur", "uttar pradesh", "varanasi", "prayagraj"], engineerEmail: "l1.rahul@avavbusiness.com", engineerName: "Rahul Sharma", backupEngineerName: "Aman Singh" },
    { name: "Rajasthan", keywords: ["jaipur", "ajmer", "rajasthan", "udaipur", "jodhpur"], engineerEmail: "l1.deepak.verma@avavbusiness.com", engineerName: "Deepak Verma", backupEngineerName: "Deepak Meena" },
    { name: "Punjab", keywords: ["ludhiana", "amritsar", "punjab", "jalandhar", "patiala"], engineerEmail: "l1.rohit@avavbusiness.com", engineerName: "Rohit Sharma", backupEngineerName: "Amit Verma" },
];
const PORTAL_DISTRICT_L1_ENGINEER_MAPPING = [
    { state: "Uttar Pradesh", district: "Ghaziabad", engineerEmail: "l1.rahul@avavbusiness.com", engineerName: "Rahul Sharma" },
    { state: "Uttar Pradesh", district: "Noida", engineerEmail: "l1.aman@avavbusiness.com", engineerName: "Aman Singh" },
    { state: "Rajasthan", district: "Jaipur", engineerEmail: "l1.deepak.verma@avavbusiness.com", engineerName: "Deepak Verma" },
];
const PORTAL_ACTIVE_STATUSES = ["Assigned to Engineer", "In Progress at Aurawatt", "Escalated to L2", "Escalated to L3", "Spare Requested", "Dispatch in Progress"];
const STATE_HINTS = [
    { state: "Uttar Pradesh", aliases: ["uttar pradesh", " up ", "lucknow", "kanpur", "varanasi", "prayagraj", "ghaziabad", "noida", "saharanpur", "mathura", "mirzapur"] },
    { state: "Delhi", aliases: ["delhi", "ncr"] },
    { state: "Haryana", aliases: ["haryana", "gurgaon", "gurugram", "faridabad"] },
    { state: "Rajasthan", aliases: ["rajasthan", "jaipur", "ajmer", "udaipur", "jodhpur"] },
    { state: "Punjab", aliases: ["punjab", "ludhiana", "amritsar", "jalandhar", "patiala"] },
    { state: "Bihar", aliases: ["bihar", "patna"] },
];
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
];
function normalizeSerial(value) {
    return String(value ?? "").trim();
}
function normalizePhone(value) {
    return String(value ?? "").replace(/\D/g, "");
}
function mergePhones(...values) {
    const seen = new Set();
    const phones = [];
    for (const value of values) {
        const items = Array.isArray(value) ? value : [value];
        for (const item of items) {
            const phone = normalizePhone(item);
            if (!phone || seen.has(phone))
                continue;
            seen.add(phone);
            phones.push(phone);
        }
    }
    return phones;
}
function derivePriority(issueDescription) {
    const issue = issueDescription.toLowerCase();
    if (/(fire|burn|smell|commercial plant down|plant down|smoke)/.test(issue))
        return "Emergency";
    if (/(shutdown|system down|not starting|dead|trip)/.test(issue))
        return "High";
    if (/(export|battery|charging|hardware|spare)/.test(issue))
        return "Medium";
    return "Low";
}
function mapPortalRegion(location) {
    const text = String(location ?? "").trim().toLowerCase();
    return PORTAL_SERVICE_REGIONS.find((region) => region.name.toLowerCase() === text || region.keywords.some((keyword) => text.includes(keyword))) ?? PORTAL_SERVICE_REGIONS[0];
}
function normalizeForLookup(value) {
    return ` ${String(value ?? "").trim().toLowerCase()} `;
}
function normalizeExactLookup(value) {
    return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}
function mappedPortalL1EngineerForDistrict(state, district) {
    const normalizedState = normalizeExactLookup(state);
    const normalizedDistrict = normalizeExactLookup(district);
    if (!normalizedState || !normalizedDistrict)
        return undefined;
    return PORTAL_DISTRICT_L1_ENGINEER_MAPPING.find((mapping) => (normalizeExactLookup(mapping.state) === normalizedState &&
        normalizeExactLookup(mapping.district) === normalizedDistrict));
}
function firstText(...values) {
    return values.map((value) => String(value ?? "").trim()).find(Boolean);
}
function inferState(...values) {
    const text = normalizeForLookup(values.filter(Boolean).join(" "));
    return STATE_HINTS.find((entry) => entry.aliases.some((alias) => text.includes(alias)))?.state;
}
function inferDistrict(...values) {
    const text = normalizeForLookup(values.filter(Boolean).join(" "));
    return DISTRICT_HINTS.find((district) => text.includes(district.toLowerCase()));
}
function addMonths(date, months) {
    const next = new Date(date);
    next.setMonth(next.getMonth() + months);
    return next;
}
function calculateWarrantyStatus(soldDate) {
    if (!soldDate)
        return "Unknown";
    const parsed = new Date(soldDate);
    if (!Number.isFinite(parsed.getTime()))
        return "Unknown";
    return addMonths(parsed, STANDARD_WARRANTY_MONTHS).getTime() >= Date.now() ? "In Warranty" : "Out of Warranty";
}
async function assignPortalTicket(issueDescription, input) {
    const c = await (0, collections_1.getCollections)();
    const region = mapPortalRegion(input.location);
    const mappedEngineer = mappedPortalL1EngineerForDistrict(input.state, input.district);
    const targetEngineer = mappedEngineer ?? region;
    const engineer = await c.users.findOne({ email: targetEngineer.engineerEmail, role: "L1 Engineer", isActive: { $ne: false } }, { projection: { id: 1, name: 1 } });
    const assignedEngineerId = engineer?.id ?? targetEngineer.engineerEmail;
    const assignedEngineerName = engineer?.name ?? targetEngineer.engineerName;
    const priority = derivePriority(issueDescription);
    const now = new Date();
    const activeCount = await c.complaints.countDocuments({
        assignedEngineerId,
        status: { $in: PORTAL_ACTIVE_STATUSES },
    });
    if (activeCount >= MAX_ACTIVE_TICKETS_PER_ENGINEER) {
        const queuePosition = (await c.complaints.countDocuments({ region: region.name, assignmentStatus: "Waiting", status: "Waiting Lobby" })) + 1;
        return {
            region: region.name,
            priority,
            assignmentStatus: "Waiting",
            backupEngineerName: region.backupEngineerName,
            waitingSince: now,
            slaPaused: true,
            queuePosition,
            status: "Waiting Lobby",
        };
    }
    return {
        region: region.name,
        priority,
        assignmentStatus: "Assigned",
        assignedEngineerId,
        assignedEngineerName,
        backupEngineerName: region.backupEngineerName,
        activeTicketCountAtAssignment: activeCount,
        slaStartedAt: now,
        slaDueAt: new Date(now.getTime() + (priority === "Emergency" ? 2 : 4) * 60 * 60 * 1000),
        slaPaused: false,
        status: "Assigned to Engineer",
    };
}
async function findManufacturedBySerial(serialNumber) {
    const c = await (0, collections_1.getCollections)();
    return c.manufactured.findOne({ serialNumber });
}
async function findLatestSaleForSerial(serialNumber, manufactured) {
    const c = await (0, collections_1.getCollections)();
    const invoiceNo = manufactured?.invoiceNo ? String(manufactured.invoiceNo) : "";
    const saleByInvoice = invoiceNo
        ? await c.sales.findOne({ referenceNo: invoiceNo })
        : null;
    if (saleByInvoice)
        return saleByInvoice;
    return c.sales.find({ serialNumber }).sort({ saleDate: -1 }).limit(1).next();
}
function invoiceAddressFor(sale, customer) {
    return firstText(sale?.unregisteredCustomerAddress, customer?.deliveryAddress1, customer?.deliveryAddress2, customer?.deliveryAddress3, customer?.billingAddress, customer?.address);
}
async function resolveInvoiceServiceDetails(serialNumber, manufactured) {
    const c = await (0, collections_1.getCollections)();
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
        taxInvoiceNo: sale?.referenceNo ?? manufactured.invoiceNo,
        taxInvoiceDate: sale?.saleDate,
        state,
        district,
        region: mapPortalRegion(regionSource).name,
        dealerName: firstText(sale?.dealerName, customer?.name, sale?.unregisteredCustomerName, sale?.customerName),
        warrantyStatus,
        productModel: product?.model ?? manufactured.productId,
        customer,
        sale,
        invoiceAddress,
    };
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
    const invoiceDetails = await resolveInvoiceServiceDetails(serialNumber, manufactured);
    const customer = manufactured.customerId
        ? await c.customers.findOne({ id: manufactured.customerId }, { projection: { id: 1, name: 1, phone: 1, email: 1 } })
        : null;
    return (0, http_1.ok)(res, {
        session: {
            serialNumber: manufactured.serialNumber,
            productId: manufactured.productId,
            soldDate: manufactured.soldDate,
            customerId: manufactured.customerId,
        },
        invoice: {
            taxInvoiceNo: invoiceDetails.taxInvoiceNo,
            taxInvoiceDate: invoiceDetails.taxInvoiceDate,
            state: invoiceDetails.state,
            district: invoiceDetails.district,
            region: invoiceDetails.region,
            dealerName: invoiceDetails.dealerName,
            warrantyStatus: invoiceDetails.warrantyStatus,
            productModel: invoiceDetails.productModel,
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
    const invoiceDetails = await resolveInvoiceServiceDetails(serialNumber, manufactured);
    const linkedCustomer = invoiceDetails.customer;
    const siteLocation = String(req.body.siteLocation ?? invoiceDetails.invoiceAddress ?? linkedCustomer?.address ?? "").trim();
    if (!linkedCustomer && (!customerName || !mobile)) {
        return (0, http_1.fail)(res, "Customer name and mobile number are required");
    }
    const now = new Date();
    const assignment = await assignPortalTicket(issueDescription, {
        location: invoiceDetails.region || siteLocation,
        state: invoiceDetails.state,
        district: invoiceDetails.district,
    });
    const customerPhones = mergePhones(mobile, linkedCustomer?.phone, manufactured.customerPhones);
    const complaint = {
        id: (0, id_1.generateId)(),
        type: "Consumer",
        productSerialNo: serialNumber,
        customerId: linkedCustomer?.id ?? manufactured.customerId,
        customerName: customerName || linkedCustomer?.name,
        customerPhone: mobile,
        customerPhones,
        customerEmail: customerEmail || linkedCustomer?.email,
        dateOfSale: manufactured.soldDate
            ? new Date(manufactured.soldDate)
            : invoiceDetails.sale?.saleDate
                ? new Date(invoiceDetails.sale.saleDate)
                : undefined,
        dateOfComplaint: now,
        issueDescription,
        ticketSource: "Link",
        l1Sla: "4 Hours",
        dealerName: invoiceDetails.dealerName,
        siteLocation: siteLocation || undefined,
        state: invoiceDetails.state,
        district: invoiceDetails.district,
        region: assignment.region,
        priority: assignment.priority,
        warrantyStatus: invoiceDetails.warrantyStatus,
        productModel: invoiceDetails.productModel,
        taxInvoiceNo: invoiceDetails.taxInvoiceNo,
        taxInvoiceDate: invoiceDetails.taxInvoiceDate ? new Date(invoiceDetails.taxInvoiceDate) : undefined,
        assignmentStatus: assignment.assignmentStatus,
        assignedEngineerId: assignment.assignedEngineerId,
        assignedEngineerName: assignment.assignedEngineerName,
        backupEngineerName: assignment.backupEngineerName,
        activeTicketCountAtAssignment: assignment.activeTicketCountAtAssignment,
        waitingSince: assignment.waitingSince,
        slaStartedAt: assignment.slaStartedAt,
        slaDueAt: assignment.slaDueAt,
        slaPaused: assignment.slaPaused,
        queuePosition: assignment.queuePosition,
        initialAction: "Customer portal intake. Service team to triage and assign engineer.",
        escalationLevel: "L1",
        spareRequired: false,
        spareInventoryStatus: "Not Required",
        siteVisitRequired: false,
        l3SupportRequired: false,
        status: assignment.status,
        raisedBy: "customer-portal",
        createdAt: now,
        updatedAt: now,
    };
    await c.complaints.insertOne(complaint);
    await c.manufactured.updateOne({ serialNumber }, { $set: { customerPhones, updatedAt: now } });
    try {
        const notification = {
            id: (0, id_1.generateId)(),
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
    }
    catch (err) {
        console.warn("Failed to insert complaint notification:", err instanceof Error ? err.message : String(err));
    }
    return (0, http_1.ok)(res, {
        id: complaint.id,
        status: complaint.status,
        productSerialNo: complaint.productSerialNo,
        dateOfComplaint: complaint.dateOfComplaint,
        region: complaint.region,
        assignedEngineerName: complaint.assignedEngineerName,
        warrantyStatus: complaint.warrantyStatus,
    }, 201);
});
exports.default = router;
