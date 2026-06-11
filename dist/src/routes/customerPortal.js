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
const PORTAL_SERVICE_REGIONS = [
    { name: "NCR", keywords: ["delhi", "noida", "gurgaon", "gurugram", "faridabad", "ghaziabad"], engineerId: "eng-ncr-l1", engineerName: "Rohit Sharma", backupEngineerName: "Amit Verma" },
    { name: "UP", keywords: ["lucknow", "kanpur", "uttar pradesh", "varanasi", "prayagraj"], engineerId: "eng-up-l1", engineerName: "Vikas Yadav", backupEngineerName: "Sandeep Singh" },
    { name: "Rajasthan", keywords: ["jaipur", "ajmer", "rajasthan", "udaipur", "jodhpur"], engineerId: "eng-rj-l1", engineerName: "Mahesh Choudhary", backupEngineerName: "Deepak Meena" },
    { name: "Punjab", keywords: ["ludhiana", "amritsar", "punjab", "jalandhar", "patiala"], engineerId: "eng-pb-l1", engineerName: "Harpreet Singh", backupEngineerName: "Gurpreet Gill" },
];
const PORTAL_ACTIVE_STATUSES = ["Assigned to Engineer", "In Progress at Aurawatt", "Escalated to L2", "Escalated to L3", "Spare Requested", "Dispatch in Progress"];
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
async function assignPortalTicket(issueDescription, location) {
    const c = await (0, collections_1.getCollections)();
    const region = mapPortalRegion(location);
    const priority = derivePriority(issueDescription);
    const now = new Date();
    const activeCount = await c.complaints.countDocuments({
        assignedEngineerId: region.engineerId,
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
        assignedEngineerId: region.engineerId,
        assignedEngineerName: region.engineerName,
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
        ? await c.customers.findOne({ id: manufactured.customerId }, { projection: { id: 1, name: 1, phone: 1, email: 1, address: 1 } })
        : null;
    const siteLocation = String(req.body.siteLocation ?? linkedCustomer?.address ?? "").trim();
    if (!linkedCustomer && (!customerName || !mobile)) {
        return (0, http_1.fail)(res, "Customer name and mobile number are required");
    }
    const now = new Date();
    const assignment = await assignPortalTicket(issueDescription, siteLocation);
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
        dateOfSale: manufactured.soldDate ? new Date(manufactured.soldDate) : undefined,
        dateOfComplaint: now,
        issueDescription,
        ticketSource: "Link",
        l1Sla: "4 Hours",
        siteLocation: siteLocation || undefined,
        region: assignment.region,
        priority: assignment.priority,
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
                ticketSource: "Link",
            },
            audienceRoles: ["Admin", "Sales"],
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
