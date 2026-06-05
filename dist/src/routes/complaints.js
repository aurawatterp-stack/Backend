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
const MAX_ACTIVE_TICKETS_PER_ENGINEER = 5;
const SERVICE_REGIONS = [
    {
        name: "NCR",
        keywords: ["delhi", "noida", "gurgaon", "gurugram", "faridabad", "ghaziabad"],
        engineers: [
            { id: "eng-ncr-l1", name: "Rohit Sharma" },
            { id: "eng-ncr-l1b", name: "Amit Verma" },
        ],
    },
    {
        name: "UP",
        keywords: ["lucknow", "kanpur", "uttar pradesh", "varanasi", "prayagraj"],
        engineers: [
            { id: "eng-up-l1", name: "Vikas Yadav" },
            { id: "eng-up-l1b", name: "Sandeep Singh" },
        ],
    },
    {
        name: "Rajasthan",
        keywords: ["jaipur", "ajmer", "rajasthan", "udaipur", "jodhpur"],
        engineers: [
            { id: "eng-rj-l1", name: "Mahesh Choudhary" },
            { id: "eng-rj-l1b", name: "Deepak Meena" },
        ],
    },
    {
        name: "Punjab",
        keywords: ["ludhiana", "amritsar", "punjab", "jalandhar", "patiala"],
        engineers: [
            { id: "eng-pb-l1", name: "Harpreet Singh" },
            { id: "eng-pb-l1b", name: "Gurpreet Gill" },
        ],
    },
];
const ACTIVE_ENGINEER_STATUSES = [
    "Assigned to Engineer",
    "In Progress at Aurawatt",
    "Escalated to L2",
    "Escalated to L3",
    "Spare Requested",
    "Dispatch in Progress",
];
const CLOSED_STATUSES = ["Resolved by Aurawatt", "Resolved by Suppliers"];
function normalizeText(value) {
    return String(value ?? "").trim();
}
function mapRegion(input) {
    const text = normalizeText(input).toLowerCase();
    return SERVICE_REGIONS.find((region) => region.name.toLowerCase() === text || region.keywords.some((keyword) => text.includes(keyword))) ?? SERVICE_REGIONS[0];
}
function priorityRank(priority) {
    if (priority === "Emergency")
        return 0;
    if (priority === "High")
        return 1;
    if (priority === "Medium")
        return 2;
    return 3;
}
function derivePriority(issueDescription, requestedPriority) {
    const requested = normalizeText(requestedPriority);
    if (["Low", "Medium", "High", "Emergency"].includes(requested))
        return requested;
    const issue = normalizeText(issueDescription).toLowerCase();
    if (/(fire|burn|smell|commercial plant down|plant down|smoke)/.test(issue))
        return "Emergency";
    if (/(shutdown|system down|not starting|dead|trip)/.test(issue))
        return "High";
    if (/(export|battery|charging|hardware|spare)/.test(issue))
        return "Medium";
    return "Low";
}
function parseSlaHours(l1Sla, priority) {
    if (priority === "Emergency")
        return 2;
    const hours = parseInt(normalizeText(l1Sla), 10);
    return Number.isFinite(hours) && hours > 0 ? hours : 4;
}
function addHours(date, hours) {
    return new Date(date.getTime() + hours * 60 * 60 * 1000);
}
function isL1InspectionValid(inspection) {
    if (!inspection)
        return false;
    const acRequired = ["l1L2Voltage", "l2L3Voltage", "l3L1Voltage", "l1NVoltage", "l2NVoltage", "l3NVoltage", "nEVoltage"];
    const dcRequired = ["string1PN", "string1PE", "string1NE", "totalStringCount"];
    const hasAc = acRequired.every((key) => Number.isFinite(Number(inspection.acReadings?.[key])));
    const hasDc = dcRequired.every((key) => Number.isFinite(Number(inspection.dcReadings?.[key])));
    return Boolean(inspection.errorCode && inspection.observationNotes && hasAc && hasDc);
}
async function buildAssignment(input) {
    const c = await (0, collections_1.getCollections)();
    const regionConfig = input.region ? mapRegion(input.region) : mapRegion(input.siteLocation);
    const priority = derivePriority(input.issueDescription, input.priority);
    const now = new Date();
    const engineerStats = await Promise.all(regionConfig.engineers.map(async (engineer) => ({
        ...engineer,
        activeCount: await c.complaints.countDocuments({
            assignedEngineerId: engineer.id,
            status: { $in: ACTIVE_ENGINEER_STATUSES },
        }),
    })));
    const preferred = normalizeText(input.preferredEngineerName).toLowerCase();
    const engineer = (preferred ? engineerStats.find((item) => item.name.toLowerCase() === preferred) : undefined) ??
        [...engineerStats].sort((a, b) => a.activeCount - b.activeCount)[0];
    const canAssign = Boolean(engineer) && (input.forceAssign || engineer.activeCount < MAX_ACTIVE_TICKETS_PER_ENGINEER);
    const slaHours = parseSlaHours(input.l1Sla, priority);
    if (!canAssign || !engineer) {
        const queuePosition = (await c.complaints.countDocuments({
            region: regionConfig.name,
            assignmentStatus: "Waiting",
            status: "Waiting Lobby",
        })) + 1;
        return {
            region: regionConfig.name,
            priority,
            assignmentStatus: "Waiting",
            backupEngineerName: regionConfig.engineers[1]?.name,
            waitingSince: now,
            slaPaused: true,
            queuePosition,
            status: "Waiting Lobby",
        };
    }
    return {
        region: regionConfig.name,
        priority,
        assignmentStatus: "Assigned",
        assignedEngineerId: engineer.id,
        assignedEngineerName: engineer.name,
        backupEngineerName: regionConfig.engineers.find((candidate) => candidate.id !== engineer.id)?.name,
        activeTicketCountAtAssignment: engineer.activeCount,
        slaStartedAt: now,
        slaDueAt: addHours(now, slaHours),
        slaPaused: false,
        queuePosition: undefined,
        status: "Assigned to Engineer",
    };
}
async function releaseNextWaitingTicket(region) {
    const c = await (0, collections_1.getCollections)();
    const filter = { assignmentStatus: "Waiting", status: "Waiting Lobby" };
    if (region)
        filter.region = region;
    const waiting = await c.complaints
        .find(filter)
        .toArray();
    const next = waiting
        .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || new Date(a.waitingSince ?? a.createdAt).getTime() - new Date(b.waitingSince ?? b.createdAt).getTime())[0];
    if (!next)
        return;
    const assignment = await buildAssignment({
        issueDescription: next.issueDescription,
        siteLocation: next.siteLocation,
        region: next.region,
        priority: next.priority,
        l1Sla: next.l1Sla,
    });
    if (assignment.assignmentStatus !== "Assigned")
        return;
    await c.complaints.updateOne({ id: next.id }, {
        $set: {
            ...assignment,
            updatedAt: new Date(),
        },
        $unset: { waitingSince: "", queuePosition: "" },
    });
}
function requireComplaintTypeAccess(user, type) {
    const t = (type || "").trim().toLowerCase();
    if (user.role === "Admin")
        return true;
    if (t === "consumer")
        return user.permissions.includes("complaints:consumer");
    if (t === "supplier")
        return user.permissions.includes("complaints:supplier");
    return user.permissions.includes("complaints:consumer") || user.permissions.includes("complaints:supplier");
}
/** GET /api/complaints — filter by type, status */
router.get("/", auth_1.authenticate, (0, auth_1.requireAnyPermission)("complaints:consumer", "complaints:supplier"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const { type, status, page = "1", limit = "20" } = req.query;
    const user = req.user;
    if (type && !requireComplaintTypeAccess(user, type)) {
        return (0, http_1.fail)(res, "Access denied: insufficient permissions", 403);
    }
    const filter = {};
    if (type)
        filter.type = type;
    if (status)
        filter.status = status;
    const p = Math.max(1, parseInt(page));
    const l = Math.min(100, parseInt(limit));
    const total = await c.complaints.countDocuments(filter);
    const data = await c.complaints.find(filter).skip((p - 1) * l).limit(l).toArray();
    return (0, http_1.ok)(res, { data, total, page: p, limit: l });
});
/** GET /api/complaints/stats — for donut chart */
router.get("/stats", auth_1.authenticate, (0, auth_1.requireAnyPermission)("complaints:consumer", "complaints:supplier"), async (_req, res) => {
    const c = await (0, collections_1.getCollections)();
    const statuses = [
        "Open at Aurawatt",
        "Waiting Lobby",
        "Assigned to Engineer",
        "In Progress at Aurawatt",
        "Escalated to L2",
        "Escalated to L3",
        "Spare Requested",
        "Dispatch in Progress",
        "Resolved by Aurawatt",
        "Pending with Suppliers",
        "Resolved by Suppliers",
    ];
    const stats = await Promise.all(statuses.map(async (s) => ({ status: s, count: await c.complaints.countDocuments({ status: s }) })));
    return (0, http_1.ok)(res, stats);
});
/** POST /api/complaints — raise a consumer or supplier complaint */
router.post("/", auth_1.authenticate, (0, auth_1.requireAnyPermission)("complaints:consumer", "complaints:supplier"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const { type, productSerialNo, customerName, rawMaterialId, rawMaterialName, vendorName, dateOfSale, dateOfComplaint, issueDescription, ticketSource, l1Sla, dealerName, siteLocation, region, priority, warrantyStatus, productModel, forceAssign, backupEngineerName, initialAction, trackingNotes, escalationLevel, l1Inspection, technicalDiagnosis, spareRequired, spareName, spareInventoryStatus, spareRequestStatus, dispatchTrackingNo, procurementStatus, chargeableApprovalStatus, paymentVerificationStatus, replacementApprovalStatus, dispatchPlan, siteVisitRequired, engineerName, l3SupportRequired, finalResolution, clientFeedback, closureReport, } = req.body;
    if (!type || !dateOfComplaint || !issueDescription) {
        return (0, http_1.fail)(res, "type, dateOfComplaint, issueDescription are required");
    }
    const user = req.user;
    if (!requireComplaintTypeAccess(user, String(type))) {
        return (0, http_1.fail)(res, "Access denied: insufficient permissions", 403);
    }
    const l1InspectionValid = isL1InspectionValid(l1Inspection);
    if (["L2", "L3"].includes(String(escalationLevel ?? "")) && !l1InspectionValid) {
        return (0, http_1.fail)(res, "L1 inspection readings are mandatory before L2/L3 escalation");
    }
    const assignment = String(type).toLowerCase() === "consumer"
        ? await buildAssignment({
            issueDescription,
            siteLocation,
            region,
            priority,
            l1Sla,
            forceAssign: Boolean(forceAssign),
            preferredEngineerName: engineerName,
        })
        : undefined;
    const complaint = {
        id: (0, id_1.generateId)(),
        type,
        productSerialNo,
        customerName,
        rawMaterialId,
        rawMaterialName,
        vendorName,
        dateOfSale: dateOfSale ? new Date(dateOfSale) : undefined,
        dateOfComplaint: new Date(dateOfComplaint),
        issueDescription,
        ticketSource,
        l1Sla,
        dealerName,
        siteLocation,
        region: assignment?.region ?? region,
        priority: assignment?.priority ?? derivePriority(issueDescription, priority),
        warrantyStatus,
        productModel,
        assignmentStatus: assignment?.assignmentStatus,
        assignedEngineerId: assignment?.assignedEngineerId,
        assignedEngineerName: assignment?.assignedEngineerName,
        backupEngineerName: assignment?.backupEngineerName ?? backupEngineerName,
        activeTicketCountAtAssignment: assignment?.activeTicketCountAtAssignment,
        waitingSince: assignment?.waitingSince,
        slaStartedAt: assignment?.slaStartedAt,
        slaDueAt: assignment?.slaDueAt,
        slaPaused: assignment?.slaPaused,
        queuePosition: assignment?.queuePosition,
        initialAction,
        trackingNotes,
        escalationLevel,
        l1Inspection,
        l1InspectionValid,
        technicalDiagnosis,
        spareRequired,
        spareName,
        spareInventoryStatus,
        spareRequestStatus,
        dispatchTrackingNo,
        procurementStatus,
        chargeableApprovalStatus,
        paymentVerificationStatus,
        replacementApprovalStatus,
        dispatchPlan,
        siteVisitRequired,
        engineerName,
        l3SupportRequired,
        finalResolution,
        clientFeedback,
        closureReport,
        status: assignment?.status ?? "Open at Aurawatt",
        raisedBy: user.userId,
        createdAt: new Date(),
        updatedAt: new Date(),
    };
    await c.complaints.insertOne(complaint);
    return (0, http_1.ok)(res, complaint, 201);
});
/** PUT /api/complaints/:id/status — update complaint status */
router.put("/:id/status", auth_1.authenticate, (0, auth_1.requireAnyPermission)("complaints:consumer", "complaints:supplier"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const id = req.params.id;
    const existing = await c.complaints.findOne({ id });
    if (!existing)
        return (0, http_1.fail)(res, "Complaint not found", 404);
    const user = req.user;
    if (!requireComplaintTypeAccess(user, String(existing.type))) {
        return (0, http_1.fail)(res, "Access denied: insufficient permissions", 403);
    }
    const { status } = req.body;
    if (!status)
        return (0, http_1.fail)(res, "status is required");
    const updatedAt = new Date();
    await c.complaints.updateOne({ id }, { $set: { status, updatedAt } });
    if (CLOSED_STATUSES.includes(String(status))) {
        await releaseNextWaitingTicket(existing.region);
    }
    return (0, http_1.ok)(res, { ...existing, status, updatedAt });
});
/** PUT /api/complaints/:id/service — update service workflow fields */
router.put("/:id/service", auth_1.authenticate, (0, auth_1.requireAnyPermission)("complaints:consumer", "complaints:supplier"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const id = req.params.id;
    const existing = await c.complaints.findOne({ id });
    if (!existing)
        return (0, http_1.fail)(res, "Complaint not found", 404);
    const user = req.user;
    if (!requireComplaintTypeAccess(user, String(existing.type))) {
        return (0, http_1.fail)(res, "Access denied: insufficient permissions", 403);
    }
    const nextInspection = req.body.l1Inspection ?? existing.l1Inspection;
    const l1InspectionValid = isL1InspectionValid(nextInspection);
    if (["L2", "L3"].includes(String(req.body.escalationLevel ?? existing.escalationLevel ?? "")) && !l1InspectionValid) {
        return (0, http_1.fail)(res, "L1 inspection readings are mandatory before L2/L3 escalation");
    }
    const allowedFields = [
        "dealerName",
        "customerName",
        "siteLocation",
        "region",
        "priority",
        "warrantyStatus",
        "productModel",
        "backupEngineerName",
        "initialAction",
        "trackingNotes",
        "escalationLevel",
        "l1Inspection",
        "technicalDiagnosis",
        "spareRequired",
        "spareName",
        "spareInventoryStatus",
        "spareRequestStatus",
        "dispatchTrackingNo",
        "procurementStatus",
        "chargeableApprovalStatus",
        "paymentVerificationStatus",
        "replacementApprovalStatus",
        "dispatchPlan",
        "siteVisitRequired",
        "engineerName",
        "l3SupportRequired",
        "finalResolution",
        "clientFeedback",
        "closureReport",
        "status",
    ];
    const update = { updatedAt: new Date(), l1InspectionValid };
    for (const field of allowedFields) {
        if (field in req.body)
            update[field] = req.body[field];
    }
    if (req.body.forceAssign || req.body.reassignEngineerName) {
        const assignment = await buildAssignment({
            issueDescription: existing.issueDescription,
            siteLocation: req.body.siteLocation ?? existing.siteLocation,
            region: req.body.region ?? existing.region,
            priority: req.body.priority ?? existing.priority,
            l1Sla: existing.l1Sla,
            forceAssign: Boolean(req.body.forceAssign),
            preferredEngineerName: req.body.reassignEngineerName ?? req.body.engineerName,
        });
        Object.assign(update, assignment);
    }
    await c.complaints.updateOne({ id }, { $set: update });
    if (CLOSED_STATUSES.includes(String(update.status))) {
        await releaseNextWaitingTicket(existing.region);
    }
    const updated = await c.complaints.findOne({ id });
    return (0, http_1.ok)(res, updated);
});
exports.default = router;
