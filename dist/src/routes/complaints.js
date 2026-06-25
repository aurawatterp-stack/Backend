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
const serialLifecycle_1 = require("../utils/serialLifecycle");
const engineerAssignments_1 = require("../services/engineerAssignments");
const ticketRouting_1 = require("../services/ticketRouting");
const complaintRules_1 = require("../utils/complaintRules");
const validation_1 = require("../utils/validation");
const router = express_1.default.Router();
const MAX_INVERTER_PICTURE_BYTES = 5 * 1024 * 1024;
const inverterPictureUpload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: MAX_INVERTER_PICTURE_BYTES },
    fileFilter: (_req, file, cb) => {
        if (file.mimetype.startsWith("image/"))
            return cb(null, true);
        return cb(new multer_1.default.MulterError("LIMIT_UNEXPECTED_FILE", "picture"));
    },
});
function runInverterPictureUpload(req, res, next) {
    inverterPictureUpload.single("picture")(req, res, (err) => {
        if (!err)
            return next();
        if (err instanceof multer_1.default.MulterError && err.code === "LIMIT_FILE_SIZE") {
            return (0, http_1.fail)(res, "Picture size must be 5 MB or less", 413);
        }
        if (err instanceof multer_1.default.MulterError && err.code === "LIMIT_UNEXPECTED_FILE") {
            return (0, http_1.fail)(res, "Only image files are allowed", 400);
        }
        return next(err);
    });
}
const SERVICE_REGIONS = [
    {
        name: "NCR",
        keywords: ["delhi", "noida", "gurgaon", "gurugram", "faridabad", "ghaziabad"],
        engineers: [
            { id: "eng-ncr-l1", name: "Piyush" },
            { id: "eng-ncr-l1b", name: "Prashant Noida" },
        ],
    },
    {
        name: "UP",
        keywords: ["lucknow", "kanpur", "uttar pradesh", "varanasi", "prayagraj"],
        engineers: [
            { id: "eng-up-l1", name: "Neeraj" },
            { id: "eng-up-l1b", name: "Naveen Maurya" },
        ],
    },
    {
        name: "Rajasthan",
        keywords: ["jaipur", "ajmer", "rajasthan", "udaipur", "jodhpur"],
        engineers: [
            { id: "eng-rj-l1", name: "Prashant Singh" },
            { id: "eng-rj-l1b", name: "Pradeep" },
        ],
    },
    {
        name: "Punjab",
        keywords: ["ludhiana", "amritsar", "punjab", "jalandhar", "patiala"],
        engineers: [
            { id: "eng-pb-l1", name: "Nitin" },
            { id: "eng-pb-l1b", name: "Swastik" },
        ],
    },
];
const DISTRICT_L1_ENGINEER_MAPPING = [
    { state: "Uttar Pradesh", district: "Ghaziabad", engineerEmail: "l1.piyush@avavbusiness.com", engineerName: "Piyush" },
    { state: "Uttar Pradesh", district: "Noida", engineerEmail: "l1.piyush@avavbusiness.com", engineerName: "Piyush" },
    { state: "Rajasthan", district: "Jaipur", engineerEmail: "l1.prashant.singh@avavbusiness.com", engineerName: "Prashant Singh" },
];
const ACTIVE_ENGINEER_STATUSES = [
    "Assigned to Engineer",
    "In Progress at Aurawatt",
    "Escalated to L2",
    "Escalated to L3",
    "Pending L3 Approval",
    "Spare Requested",
    "Replacement Requested",
    "Awaiting Dispatch",
    "Dispatch in Progress",
];
const SERVICE_ROLE_BY_LEVEL = {
    L1: "L1 Engineer",
    L2: "L2 Technical Team",
    L3: "L3 Advanced OEM Support",
};
const ASSIGNABLE_SERVICE_ENGINEER_EMAILS = new Set([
    "l1.piyush@avavbusiness.com",
    "l1.neeraj@avavbusiness.com",
    "l1.nitin@avavbusiness.com",
    "l1.prashant.singh@avavbusiness.com",
    "l1.ashutosh@avavbusiness.com",
    "l1.rajat@avavbusiness.com",
    "l1.swastik@avavbusiness.com",
    "l1.pradeep@avavbusiness.com",
    "l2.naveen.maurya@avavbusiness.com",
    "l2.prashant.noida@avavbusiness.com",
    "l3.mahesh@avavbusiness.com",
]);
function normalizeText(value) {
    return String(value ?? "").trim();
}
function normalizeSpareRequestParts(input) {
    if (!Array.isArray(input))
        return [];
    return input
        .map((part, index) => {
        const materialName = normalizeText(part?.materialName ?? part?.name ?? part?.sparePartName ?? part?.partName);
        const quantity = Number(part?.quantity);
        if (!materialName || !Number.isFinite(quantity) || quantity <= 0)
            return null;
        const availableQuantity = Number(part?.availableQuantity);
        return {
            id: normalizeText(part?.id) || `${Date.now()}-${index}`,
            series: normalizeText(part?.series) || undefined,
            rawMaterialId: normalizeText(part?.rawMaterialId) || undefined,
            materialName,
            availableQuantity: Number.isFinite(availableQuantity) ? availableQuantity : undefined,
            quantity,
            notes: normalizeText(part?.notes) || undefined,
        };
    })
        .filter(Boolean);
}
function normalizeComplaintSpareParts(complaint) {
    const directParts = Array.isArray(complaint.spareParts) ? complaint.spareParts : [];
    if (directParts.length) {
        return directParts
            .map((part, index) => ({
            id: normalizeText(part?.id) || `${complaint.id}-spare-${index}`,
            series: normalizeText(part?.series) || undefined,
            rawMaterialId: normalizeText(part?.rawMaterialId) || undefined,
            materialName: normalizeText(part?.materialName),
            availableQuantity: Number.isFinite(Number(part?.availableQuantity)) ? Number(part?.availableQuantity) : undefined,
            quantity: Number(part?.quantity) || 0,
            notes: normalizeText(part?.notes) || undefined,
        }))
            .filter((part) => part.materialName && part.quantity > 0);
    }
    const spareName = normalizeText(complaint.spareName);
    const spareQuantity = Number(complaint.spareQuantity);
    if (!spareName || !Number.isFinite(spareQuantity) || spareQuantity <= 0)
        return [];
    return [{
            id: `${complaint.id}-legacy-spare`,
            materialName: spareName,
            quantity: spareQuantity,
            notes: normalizeText(complaint.dispatchPlan) || undefined,
        }];
}
function complaintNeedsSpareApproval(complaint) {
    const status = String(complaint.spareRequestStatus ?? "");
    return Boolean(complaint.spareRequired || normalizeComplaintSpareParts(complaint).length) && !["Approved", "Dispatched", "Delivered"].includes(status);
}
function complaintNeedsReplacementApproval(complaint) {
    const approvalStatus = String(complaint.replacementApprovalStatus ?? "");
    return Boolean(complaint.replacementRecommended || normalizeText(complaint.replacementSerialNo)) && !["Approved", "Rejected"].includes(approvalStatus);
}
function normalizeLookup(value) {
    return normalizeText(value).toLowerCase().replace(/\s+/g, " ");
}
function mappedL1EngineerForDistrict(state, district) {
    const normalizedState = normalizeLookup(state);
    const normalizedDistrict = normalizeLookup(district);
    if (!normalizedState || !normalizedDistrict)
        return undefined;
    return DISTRICT_L1_ENGINEER_MAPPING.find((mapping) => (normalizeLookup(mapping.state) === normalizedState &&
        normalizeLookup(mapping.district) === normalizedDistrict));
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
function activeQueueRank(status) {
    if (status === "In Progress at Aurawatt")
        return 0;
    if (status === "Assigned to Engineer")
        return 1;
    if (status === "Assigned for Onsite")
        return 2;
    if (status === "Escalated to L2")
        return 2;
    if (status === "Escalated to L3")
        return 3;
    if (status === "Pending L3 Approval")
        return 3;
    if (status === "Spare Requested")
        return 4;
    if (status === "Replacement Requested")
        return 4;
    if (status === "Awaiting Dispatch")
        return 5;
    if (status === "Dispatch in Progress")
        return 5;
    return 6;
}
function createWorkflowHistoryEvent(input) {
    return {
        id: (0, id_1.generateId)(),
        action: input.action,
        fromStatus: input.fromStatus,
        toStatus: input.toStatus,
        by: input.user.userId,
        byName: input.user.name,
        byRole: input.user.role,
        at: new Date(),
        note: input.note,
    };
}
function sortForL1Queue(rows) {
    return [...rows].sort((a, b) => (activeQueueRank(a.status) - activeQueueRank(b.status) ||
        priorityRank(a.priority) - priorityRank(b.priority) ||
        new Date(a.slaDueAt ?? a.createdAt).getTime() - new Date(b.slaDueAt ?? b.createdAt).getTime()));
}
function sortWaitingLobbyTickets(rows) {
    return [...rows].sort((a, b) => (new Date(a.waitingSince ?? a.createdAt).getTime() - new Date(b.waitingSince ?? b.createdAt).getTime() ||
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() ||
        a.id.localeCompare(b.id)));
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
function slaHoursForLevel(level) {
    return level === "L1" ? 4 : 48;
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
function normalizeServiceLevel(value) {
    const raw = normalizeText(value).toUpperCase();
    if (raw === "L2")
        return "L2";
    if (raw === "L3")
        return "L3";
    return "L1";
}
function engineerIdentityFilter(engineerId, engineerName) {
    const or = [{ assignedEngineerId: engineerId }];
    if (engineerName) {
        or.push({ assignedEngineerName: engineerName });
    }
    return { $or: or };
}
async function engineerTicketCounts(engineerId, engineerName, excludeComplaintId) {
    const c = await (0, collections_1.getCollections)();
    const activeFilter = {
        ...engineerIdentityFilter(engineerId, engineerName),
        status: { $in: [...complaintRules_1.ACTIVE_TICKET_STATUSES] },
    };
    const waitingFilter = {
        ...engineerIdentityFilter(engineerId, engineerName),
        assignmentStatus: "Waiting",
        status: { $in: [...complaintRules_1.LOBBY_TICKET_STATUSES] },
    };
    if (excludeComplaintId) {
        activeFilter.id = { $ne: excludeComplaintId };
        waitingFilter.id = { $ne: excludeComplaintId };
    }
    const [activeCount, waitingCount] = await Promise.all([
        c.complaints.countDocuments(activeFilter),
        c.complaints.countDocuments(waitingFilter),
    ]);
    return { activeCount, waitingCount };
}
function buildEngineerIdentityFilter(identities) {
    const or = [];
    const seen = new Set();
    for (const identity of identities) {
        const engineerId = normalizeText(identity.engineerId);
        const engineerName = normalizeText(identity.engineerName);
        if (engineerId) {
            const key = `id:${engineerId}`;
            if (!seen.has(key)) {
                seen.add(key);
                or.push({ assignedEngineerId: engineerId });
            }
        }
        if (engineerName) {
            const key = `name:${engineerName.toLowerCase()}`;
            if (!seen.has(key)) {
                seen.add(key);
                or.push({ assignedEngineerName: engineerName });
            }
        }
    }
    return or;
}
async function serviceEngineers(level) {
    const c = await (0, collections_1.getCollections)();
    const roles = level === "L1"
        ? ["L1", "Backup"]
        : level
            ? [level]
            : ["L1", "L2", "L3", "Backup"];
    const users = await c.engineerMasters
        .find({ role: { $in: roles }, isActive: { $ne: false } }, { projection: { id: 1, name: 1, email: 1, role: 1 } })
        .sort({ name: 1 })
        .toArray();
    return users.map((user) => ({ id: user.id, name: user.name, email: user.email ?? "", role: user.role }));
}
async function buildServiceAssignment(input) {
    const regionConfig = input.region ? mapRegion(input.region) : mapRegion(input.siteLocation);
    const priority = derivePriority(input.issueDescription, input.priority);
    const now = new Date();
    const engineers = await serviceEngineers(input.level);
    const engineerStats = await Promise.all(engineers.map(async (engineer) => ({
        ...engineer,
        ...await engineerTicketCounts(engineer.id, engineer.name, input.excludeComplaintId),
    })));
    const preferredId = normalizeText(input.preferredEngineerId);
    const preferredName = normalizeText(input.preferredEngineerName).toLowerCase();
    const preferredEmail = normalizeText(input.preferredEngineerEmail).toLowerCase();
    const districtAssignment = input.state && input.district ? await (0, engineerAssignments_1.resolveAssignmentByStateDistrict)(String(input.state), String(input.district)) : null;
    const preferredEngineer = (preferredId ? engineerStats.find((item) => item.id === preferredId) : undefined) ??
        (preferredEmail ? engineerStats.find((item) => item.email.toLowerCase() === preferredEmail) : undefined) ??
        (preferredName ? engineerStats.find((item) => item.name.toLowerCase() === preferredName) : undefined);
    const districtPrimary = input.level === "L1"
        ? districtAssignment?.l1Engineer
        : input.level === "L2"
            ? districtAssignment?.l2Engineer
            : undefined;
    const districtBackup = input.level === "L1" ? districtAssignment?.backupEngineer : undefined;
    const slaHours = slaHoursForLevel(input.level);
    const statusByLevel = {
        L1: "Assigned to Engineer",
        L2: "Escalated to L2",
        L3: "Escalated to L3",
    };
    const mappedPrimary = districtPrimary
        ? engineerStats.find((item) => item.id === districtPrimary.id || item.name.toLowerCase() === districtPrimary.name.toLowerCase())
        : undefined;
    const mappedBackup = districtBackup
        ? engineerStats.find((item) => item.id === districtBackup.id || item.name.toLowerCase() === districtBackup.name.toLowerCase())
        : undefined;
    function assignmentForEngineer(engineer) {
        if (engineer.activeCount < complaintRules_1.MAX_ACTIVE_SERVICE_TICKETS) {
            return {
                assignedEngineerId: engineer.id,
                assignedEngineerName: engineer.name,
                activeTicketCountAtAssignment: engineer.activeCount,
                assignmentStatus: "Assigned",
                waitingSince: undefined,
                slaStartedAt: undefined,
                slaDueAt: undefined,
                slaPaused: true,
                queuePosition: undefined,
                status: statusByLevel[input.level],
            };
        }
        if (engineer.waitingCount < complaintRules_1.MAX_WAITING_LOBBY_TICKETS) {
            return {
                assignedEngineerId: engineer.id,
                assignedEngineerName: engineer.name,
                waitingSince: now,
                assignmentStatus: "Waiting",
                slaStartedAt: undefined,
                slaDueAt: undefined,
                slaPaused: true,
                queuePosition: engineer.waitingCount + 1,
                status: "Waiting Lobby",
            };
        }
        return null;
    }
    let engineer = preferredEngineer ?? mappedPrimary ?? [...engineerStats].sort((a, b) => (a.activeCount - b.activeCount ||
        a.waitingCount - b.waitingCount ||
        a.name.localeCompare(b.name)))[0];
    if (!engineer) {
        return { blockedMessage: complaintRules_1.ENGINEER_CAPACITY_MESSAGE };
    }
    if (mappedPrimary && !preferredEngineer && input.level === "L1") {
        const primaryAssignment = assignmentForEngineer(engineer);
        if (primaryAssignment) {
            return {
                region: regionConfig.name,
                priority,
                escalationLevel: input.level,
                backupEngineerName: mappedBackup?.name ?? districtBackup?.name,
                ...primaryAssignment,
            };
        }
        const backupEngineer = mappedBackup ?? [...engineerStats].find((candidate) => candidate.id !== engineer.id);
        if (!backupEngineer) {
            return { blockedMessage: complaintRules_1.ENGINEER_CAPACITY_MESSAGE };
        }
        const backupAssignment = assignmentForEngineer(backupEngineer);
        if (!backupAssignment) {
            return { blockedMessage: complaintRules_1.ENGINEER_CAPACITY_MESSAGE };
        }
        return {
            region: regionConfig.name,
            priority,
            escalationLevel: input.level,
            backupEngineerName: backupEngineer.name,
            ...backupAssignment,
        };
    }
    if (mappedPrimary && !preferredEngineer && input.level === "L2") {
        const primaryAssignment = assignmentForEngineer(engineer);
        if (!primaryAssignment) {
            return { blockedMessage: complaintRules_1.ENGINEER_CAPACITY_MESSAGE };
        }
        return {
            region: regionConfig.name,
            priority,
            escalationLevel: input.level,
            backupEngineerName: mappedBackup?.name ?? districtBackup?.name,
            ...primaryAssignment,
        };
    }
    const genericAssignment = assignmentForEngineer(engineer);
    if (genericAssignment) {
        return {
            region: regionConfig.name,
            priority,
            escalationLevel: input.level,
            backupEngineerName: mappedBackup?.name ?? districtBackup?.name ?? engineerStats.find((candidate) => candidate.id !== engineer.id)?.name,
            ...genericAssignment,
        };
    }
    return {
        blockedMessage: complaintRules_1.ENGINEER_CAPACITY_MESSAGE,
    };
}
async function buildAssignment(input) {
    return buildServiceAssignment({ ...input, level: "L1" });
}
async function releaseNextWaitingTicket(identities = [], level) {
    const c = await (0, collections_1.getCollections)();
    const filter = { assignmentStatus: "Waiting", status: "Waiting Lobby" };
    if (level)
        filter.escalationLevel = level;
    const identityFilter = buildEngineerIdentityFilter(identities);
    if (identityFilter.length) {
        filter.$or = identityFilter;
    }
    while (true) {
        const waiting = sortWaitingLobbyTickets(await c.complaints.find(filter).toArray());
        if (!waiting.length)
            break;
        const next = waiting[0];
        const nextLevel = normalizeServiceLevel(next.escalationLevel);
        const assignment = await buildServiceAssignment({
            level: nextLevel,
            issueDescription: next.issueDescription,
            siteLocation: next.siteLocation,
            region: next.region,
            state: next.state,
            district: next.district,
            priority: next.priority,
            l1Sla: next.l1Sla,
            excludeComplaintId: next.id,
            preferredEngineerId: next.assignedEngineerId,
            preferredEngineerName: next.assignedEngineerName,
            preferredEngineerEmail: next.assignedEngineerId,
        });
        if (assignment.blockedMessage || assignment.assignmentStatus !== "Assigned")
            break;
        const promotedAt = new Date();
        await c.complaints.updateOne({ id: next.id }, {
            $set: {
                ...assignment,
                updatedAt: promotedAt,
            },
            $unset: { waitingSince: "", queuePosition: "" },
        });
    }
    const remaining = sortWaitingLobbyTickets(await c.complaints.find(filter).toArray());
    await Promise.all(remaining.map((complaint, index) => c.complaints.updateOne({ id: complaint.id }, { $set: { queuePosition: index + 1, updatedAt: new Date() } })));
}
/**
 * Like releaseNextWaitingTicket but excludes `excludeId` from the active count
 * so that exactly one slot appears free for the promotion check. Used after
 * manually starting SLA on a ticket so the active lobby auto-tops up to 5.
 */
async function releaseNextWaitingTicketExcluding(identities = [], level, excludeId) {
    const c = await (0, collections_1.getCollections)();
    const filter = { assignmentStatus: "Waiting", status: "Waiting Lobby" };
    if (level)
        filter.escalationLevel = level;
    const identityFilter = buildEngineerIdentityFilter(identities);
    if (identityFilter.length) {
        filter.$or = identityFilter;
    }
    // Promote at most one ticket (the SLA-start freed one slot).
    const waiting = sortWaitingLobbyTickets(await c.complaints.find(filter).toArray());
    if (!waiting.length)
        return;
    const next = waiting[0];
    const nextLevel = normalizeServiceLevel(next.escalationLevel);
    const assignment = await buildServiceAssignment({
        level: nextLevel,
        issueDescription: next.issueDescription,
        siteLocation: next.siteLocation,
        region: next.region,
        state: next.state,
        district: next.district,
        priority: next.priority,
        l1Sla: next.l1Sla,
        excludeComplaintId: excludeId ?? next.id, // exclude the SLA-started ticket from count
        preferredEngineerId: next.assignedEngineerId,
        preferredEngineerName: next.assignedEngineerName,
        preferredEngineerEmail: next.assignedEngineerId,
    });
    if (!assignment.blockedMessage && assignment.assignmentStatus === "Assigned") {
        const promotedAt = new Date();
        await c.complaints.updateOne({ id: next.id }, {
            $set: { ...assignment, updatedAt: promotedAt },
            $unset: { waitingSince: "", queuePosition: "" },
        });
    }
    // Renumber remaining waiting tickets.
    const remaining = sortWaitingLobbyTickets(await c.complaints.find(filter).toArray());
    await Promise.all(remaining.map((complaint, index) => c.complaints.updateOne({ id: complaint.id }, { $set: { queuePosition: index + 1, updatedAt: new Date() } })));
}
async function rebalanceWaitingLobby() {
    const c = await (0, collections_1.getCollections)();
    const waitingRows = await c.complaints
        .find({
        assignmentStatus: "Waiting",
        status: "Waiting Lobby",
        $or: [
            { assignedEngineerId: { $type: "string" } },
            { assignedEngineerName: { $type: "string" } },
        ],
    }, {
        projection: {
            assignedEngineerId: 1,
            assignedEngineerName: 1,
            escalationLevel: 1,
        },
    })
        .sort({ waitingSince: 1, createdAt: 1, id: 1 })
        .toArray();
    const seen = new Set();
    for (const complaint of waitingRows) {
        const engineerId = normalizeText(complaint.assignedEngineerId);
        const engineerName = normalizeText(complaint.assignedEngineerName);
        if (!engineerId && !engineerName)
            continue;
        const level = normalizeServiceLevel(complaint.escalationLevel);
        const key = `${level}:${engineerId || `name:${engineerName.toLowerCase()}`}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        await releaseNextWaitingTicket([{ engineerId: engineerId || undefined, engineerName: engineerName || undefined }], level);
    }
}
async function rebalanceL1Queue() {
    const c = await (0, collections_1.getCollections)();
    const active = await c.complaints
        .find({
        type: "Consumer",
        status: { $in: ACTIVE_ENGINEER_STATUSES },
        $or: [{ escalationLevel: "L1" }, { escalationLevel: { $exists: false } }],
    })
        .toArray();
    const byEngineer = new Map();
    for (const complaint of active) {
        if (!complaint.assignedEngineerId)
            continue;
        const rows = byEngineer.get(complaint.assignedEngineerId) ?? [];
        rows.push(complaint);
        byEngineer.set(complaint.assignedEngineerId, rows);
    }
    const now = new Date();
    const updates = [];
    for (const [engineerId, rows] of byEngineer.entries()) {
        if (rows.length <= complaintRules_1.MAX_ACTIVE_SERVICE_TICKETS)
            continue;
        const engineerName = rows[0]?.assignedEngineerName;
        const waitingCount = await c.complaints.countDocuments({
            ...engineerIdentityFilter(engineerId, engineerName),
            assignmentStatus: "Waiting",
            status: "Waiting Lobby",
        });
        const overflow = sortForL1Queue(rows).slice(complaintRules_1.MAX_ACTIVE_SERVICE_TICKETS);
        overflow.forEach((complaint, index) => {
            updates.push(c.complaints.updateOne({ id: complaint.id }, {
                $set: {
                    assignmentStatus: "Waiting",
                    status: "Waiting Lobby",
                    assignedEngineerId: complaint.assignedEngineerId,
                    assignedEngineerName: complaint.assignedEngineerName,
                    waitingSince: complaint.waitingSince ?? now,
                    slaPaused: true,
                    queuePosition: waitingCount + index + 1,
                    updatedAt: now,
                },
                $unset: {
                    slaStartedAt: "",
                    slaDueAt: "",
                },
            }));
        });
    }
    if (!updates.length)
        return;
    await Promise.all(updates);
}
function requireComplaintTypeAccess(user, type) {
    const t = (type || "").trim().toLowerCase();
    if (user.role === "Admin")
        return true;
    if (t === "consumer")
        return user.permissions.includes("complaints:consumer") || user.permissions.includes("dispatch:manage");
    if (t === "supplier")
        return user.permissions.includes("complaints:supplier");
    return user.permissions.includes("complaints:consumer") || user.permissions.includes("complaints:supplier");
}
function complaintRoleScope(user) {
    if (user.role === "L1 Engineer") {
        return {
            $or: [
                { assignedEngineerId: user.userId },
                ...(user.name ? [{ assignedEngineerName: user.name }] : []),
                { siteVisitRequired: true, siteVisitEngineerId: user.userId },
                ...(user.name ? [{ siteVisitRequired: true, siteVisitEngineerName: user.name }] : []),
                ...(user.name ? [{ siteVisitRequired: true, engineerName: user.name }] : []),
                { status: "Assigned for Onsite", siteVisitEngineerId: user.userId },
                ...(user.name ? [{ status: "Assigned for Onsite", siteVisitEngineerName: user.name }] : []),
                { assignmentStatus: "Waiting", status: "Waiting Lobby", $or: [{ escalationLevel: "L1" }, { escalationLevel: { $exists: false } }] },
            ],
        };
    }
    if (user.role === "Backup") {
        return {
            $or: [
                { assignedEngineerId: user.userId },
                ...(user.name ? [{ assignedEngineerName: user.name }] : []),
                { assignmentStatus: "Waiting", status: "Waiting Lobby", $or: [{ escalationLevel: "L1" }, { escalationLevel: { $exists: false } }] },
            ],
        };
    }
    if (user.role === "L2 Technical Team") {
        return {
            $or: [
                { assignedEngineerId: user.userId },
                ...(user.name ? [{ assignedEngineerName: user.name }] : []),
                { siteVisitRequired: true, siteVisitEngineerId: user.userId },
                ...(user.name ? [{ siteVisitRequired: true, siteVisitEngineerName: user.name }] : []),
                ...(user.name ? [{ siteVisitRequired: true, engineerName: user.name }] : []),
                { status: "Assigned for Onsite", siteVisitEngineerId: user.userId },
                ...(user.name ? [{ status: "Assigned for Onsite", siteVisitEngineerName: user.name }] : []),
                { assignmentStatus: "Waiting", status: "Waiting Lobby", escalationLevel: "L2" },
            ],
        };
    }
    if (user.role === "L3 Advanced OEM Support") {
        return null;
    }
    return null;
}
function onsiteTrackingScope(user) {
    if (user.role !== "L2 Technical Team")
        return null;
    const or = [{ siteVisitAssignedById: user.userId }];
    if (user.name) {
        or.push({ siteVisitAssignedByName: user.name });
    }
    return {
        siteVisitRequired: true,
        $or: or,
    };
}
function applyComplaintRoleScope(filter, user) {
    const scope = complaintRoleScope(user);
    return scope ? { $and: [filter, scope] } : filter;
}
function canAccessComplaint(user, complaint) {
    if (!requireComplaintTypeAccess(user, String(complaint.type)))
        return false;
    if (user.role === "L1 Engineer") {
        return (complaint.assignedEngineerId === user.userId ||
            (Boolean(user.name) && complaint.assignedEngineerName === user.name) ||
            (complaint.siteVisitRequired === true && complaint.siteVisitEngineerId === user.userId) ||
            (complaint.siteVisitRequired === true && Boolean(user.name) && (complaint.siteVisitEngineerName === user.name || complaint.engineerName === user.name)) ||
            (complaint.status === "Assigned for Onsite" && (complaint.siteVisitEngineerId === user.userId || (Boolean(user.name) && complaint.siteVisitEngineerName === user.name))) ||
            (complaint.assignmentStatus === "Waiting" && complaint.status === "Waiting Lobby" && normalizeServiceLevel(complaint.escalationLevel) === "L1"));
    }
    if (user.role === "Backup") {
        return (complaint.assignedEngineerId === user.userId ||
            (Boolean(user.name) && complaint.assignedEngineerName === user.name) ||
            (complaint.assignmentStatus === "Waiting" && complaint.status === "Waiting Lobby" && normalizeServiceLevel(complaint.escalationLevel) === "L1"));
    }
    if (user.role === "L2 Technical Team") {
        return (complaint.assignedEngineerId === user.userId ||
            (Boolean(user.name) && complaint.assignedEngineerName === user.name) ||
            (complaint.siteVisitRequired === true && complaint.siteVisitEngineerId === user.userId) ||
            (complaint.siteVisitRequired === true && Boolean(user.name) && (complaint.siteVisitEngineerName === user.name || complaint.engineerName === user.name)) ||
            (complaint.status === "Assigned for Onsite" && (complaint.siteVisitEngineerId === user.userId || (Boolean(user.name) && complaint.siteVisitEngineerName === user.name))) ||
            (complaint.assignmentStatus === "Waiting" && complaint.status === "Waiting Lobby" && complaint.escalationLevel === "L2"));
    }
    if (user.role === "L3 Advanced OEM Support") {
        return true;
    }
    return true;
}
/** GET /api/complaints — filter by type, status */
router.get("/", auth_1.authenticate, (0, auth_1.requireAnyPermission)("complaints:consumer", "complaints:supplier", "dispatch:manage"), async (req, res) => {
    try {
        const c = await (0, collections_1.getCollections)();
        const { type, status, page = "1", limit = "20", view } = req.query;
        const user = req.user;
        if (type && !requireComplaintTypeAccess(user, type)) {
            return (0, http_1.fail)(res, "Access denied: insufficient permissions", 403);
        }
        if (!view && (!type || String(type).toLowerCase() === "consumer")) {
            await rebalanceL1Queue();
            await rebalanceWaitingLobby();
        }
        const filter = {};
        if (type)
            filter.type = type;
        if (status)
            filter.status = status;
        const scopedFilter = view === "onsite-tracking"
            ? (() => {
                const scope = onsiteTrackingScope(user);
                if (!scope) {
                    return null;
                }
                return { $and: [filter, scope] };
            })()
            : applyComplaintRoleScope(filter, user);
        if (!scopedFilter) {
            return (0, http_1.fail)(res, "Access denied: insufficient permissions", 403);
        }
        const p = Math.max(1, parseInt(page));
        const l = Math.min(1000, parseInt(limit));
        const total = await c.complaints.countDocuments(scopedFilter);
        const data = await c.complaints.find(scopedFilter).skip((p - 1) * l).limit(l).toArray();
        return (0, http_1.ok)(res, { data, total, page: p, limit: l });
    }
    catch (err) {
        console.log(err);
    }
});
/** GET /api/complaints/stats — for donut chart */
router.get("/stats", auth_1.authenticate, (0, auth_1.requireAnyPermission)("complaints:consumer", "complaints:supplier"), async (_req, res) => {
    const c = await (0, collections_1.getCollections)();
    const statuses = [
        "Open at Aurawatt",
        "Waiting Lobby",
        "Assigned to Engineer",
        "Assigned for Onsite",
        "In Progress at Aurawatt",
        "Escalated to L2",
        "Escalated to L3",
        "Pending L3 Approval",
        "Spare Requested",
        "Replacement Requested",
        "Awaiting Dispatch",
        "Dispatch in Progress",
        "Resolved by Aurawatt",
        "Pending with Suppliers",
        "Resolved by Suppliers",
    ];
    const stats = await Promise.all(statuses.map(async (s) => ({ status: s, count: await c.complaints.countDocuments({ status: s }) })));
    return (0, http_1.ok)(res, stats);
});
/** GET /api/complaints/service-engineers — active L1/L2/L3 engineer accounts */
router.get("/service-engineers", auth_1.authenticate, (0, auth_1.requireAnyPermission)("complaints:consumer", "complaints:supplier"), async (_req, res) => {
    const engineers = await serviceEngineers();
    return (0, http_1.ok)(res, engineers);
});
/** POST /api/complaints/upload-inverter-picture — upload onsite inverter picture to Cloudinary */
router.post("/upload-inverter-picture", auth_1.authenticate, (0, auth_1.requireAnyPermission)("complaints:consumer", "complaints:supplier"), runInverterPictureUpload, async (req, res) => {
    const file = req.file;
    if (!file)
        return (0, http_1.fail)(res, "Inverter picture is required");
    try {
        const uploaded = await (0, cloudinary_1.uploadBufferToCloudinary)(file, "aurawatt/complaint-inverter-pictures");
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
        return (0, http_1.fail)(res, err instanceof Error ? err.message : "Failed to upload inverter picture", 502);
    }
});
/** POST /api/complaints — raise a consumer or supplier complaint */
router.post("/", auth_1.authenticate, (0, auth_1.requireAnyPermission)("complaints:consumer", "complaints:supplier"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const { type, productSerialNo, customerName, rawMaterialId, rawMaterialName, vendorName, dateOfSale, dateOfComplaint, issueDescription, ticketSource, l1Sla, dealerName, siteLocation, region, state, district, priority, warrantyStatus, productModel, forceAssign, backupEngineerName, initialAction, trackingNotes, escalationLevel, l1Inspection, onsiteInspection, serviceStartedAt, progressUpdates, technicalDiagnosis, spareRequired, spareName, spareQuantity, spareDispatchAddress, spareParts, spareInventoryStatus, spareRequestStatus, dispatchTrackingNo, dispatchLrCopyName, dispatchLrCopyUrl, procurementStatus, chargeableApprovalStatus, paymentVerificationStatus, replacementApprovalStatus, replacementRecommended, replacementSeriesName, replacementModelName, replacementProductName, replacementProductNo, replacementRequestSerialNo, replacementSerialNo, replacementEngineerId, replacementEngineerName, dispatchPlan, siteVisitRequired, siteVisitEngineerId, siteVisitEngineerName, siteVisitRequestedById, siteVisitRequestedByName, siteVisitRequestedByRole, siteVisitRequestedAt, siteVisitRemarks, siteVisitSpareParts, siteVisitScheduledDate, siteVisitAssignedById, siteVisitAssignedByName, siteVisitAssignedByRole, engineerName, l3SupportRequired, replacementReason, replacementRemarks, replacementRequestImages, replacementRequestedById, replacementRequestedByName, replacementRequestedByRole, replacementRequestedAt, replacementApprovedById, replacementApprovedByName, replacementApprovedByRole, replacementApprovedAt, finalResolution, clientFeedback, closureReport, closeRemark, closedByName, closedByRole, closedAt, } = req.body;
    const mobileNumber = req.body.mobileNumber ?? req.body.customerPhone;
    const customerEmail = (0, validation_1.normalizeEmailAddress)(req.body.customerEmail);
    const installationDate = req.body.installationDate ?? dateOfSale;
    const complaintState = req.body.state;
    const complaintDistrict = req.body.district;
    if (!type || !dateOfComplaint || !issueDescription) {
        return (0, http_1.fail)(res, "type, dateOfComplaint, issueDescription are required");
    }
    if (String(type).toLowerCase() === "consumer") {
        if (!productSerialNo || !customerName || !mobileNumber || !complaintState || !complaintDistrict) {
            return (0, http_1.fail)(res, "Serial number, customer name, mobile number, state, district and complaint description are required");
        }
        if (customerEmail && !(0, validation_1.isValidEmailAddress)(customerEmail)) {
            return (0, http_1.fail)(res, "Please enter a valid email address");
        }
    }
    const user = req.user;
    if (user.role === "Sales") {
        return (0, http_1.fail)(res, "Access denied: insufficient permissions", 403);
    }
    if (!requireComplaintTypeAccess(user, String(type))) {
        return (0, http_1.fail)(res, "Access denied: insufficient permissions", 403);
    }
    const productSerialNoKey = (0, complaintRules_1.normalizeComplaintSerialKey)(productSerialNo);
    if (productSerialNoKey) {
        const activeDuplicate = await c.complaints.findOne({
            productSerialNoKey,
            status: { $nin: [...complaintRules_1.CLOSED_COMPLAINT_STATUSES] },
        });
        if (activeDuplicate) {
            return (0, http_1.fail)(res, complaintRules_1.ACTIVE_COMPLAINT_DUPLICATE_MESSAGE, 409);
        }
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
            state: complaintState,
            district: complaintDistrict,
            priority,
            l1Sla,
            forceAssign: Boolean(forceAssign),
            preferredEngineerName: engineerName,
        })
        : undefined;
    if (assignment?.blockedMessage) {
        return (0, http_1.fail)(res, assignment.blockedMessage, 400);
    }
    const assignmentDecision = assignment && !("blockedMessage" in assignment) ? assignment : null;
    const complaintStatus = assignmentDecision?.status ?? "Open at Aurawatt";
    const complaint = {
        id: (0, id_1.generateId)(),
        type,
        productSerialNo,
        productSerialNoKey: (0, complaintRules_1.isClosedComplaintStatus)(complaintStatus) ? undefined : productSerialNoKey || undefined,
        customerName,
        customerPhone: mobileNumber ? String(mobileNumber) : undefined,
        customerEmail: customerEmail || undefined,
        rawMaterialId,
        rawMaterialName,
        vendorName,
        dateOfSale: installationDate ? new Date(installationDate) : undefined,
        installationDate: installationDate ? new Date(installationDate) : undefined,
        dateOfComplaint: new Date(dateOfComplaint),
        issueDescription,
        ticketSource,
        l1Sla,
        dealerName,
        siteLocation,
        state: complaintState ? String(complaintState) : undefined,
        district: complaintDistrict ? String(complaintDistrict) : undefined,
        region,
        priority: derivePriority(issueDescription, priority),
        warrantyStatus,
        productModel,
        assignmentStatus: assignmentDecision?.assignmentStatus,
        assignedEngineerId: assignmentDecision?.assignedEngineerId,
        assignedEngineerName: assignmentDecision?.assignedEngineerName,
        backupEngineerName: assignmentDecision?.backupEngineerName ?? backupEngineerName,
        activeTicketCountAtAssignment: assignmentDecision?.activeTicketCountAtAssignment,
        slaStartedAt: assignmentDecision?.slaStartedAt,
        slaDueAt: assignmentDecision?.slaDueAt,
        slaPaused: assignmentDecision?.slaPaused,
        escalatedById: undefined,
        escalatedByName: undefined,
        escalatedByRole: undefined,
        escalatedAt: undefined,
        initialAction,
        trackingNotes,
        escalationLevel,
        l1Inspection,
        l1InspectionValid,
        onsiteInspection,
        serviceStartedAt: serviceStartedAt ? new Date(serviceStartedAt) : undefined,
        progressUpdates,
        technicalDiagnosis,
        spareRequired,
        spareName,
        spareQuantity: spareQuantity ? Number(spareQuantity) : undefined,
        spareDispatchAddress,
        spareParts: normalizeSpareRequestParts(spareParts),
        spareInventoryStatus,
        spareRequestStatus,
        dispatchTrackingNo,
        dispatchLrCopyName,
        dispatchLrCopyUrl,
        procurementStatus,
        chargeableApprovalStatus,
        paymentVerificationStatus,
        replacementApprovalStatus,
        replacementRecommended,
        replacementSeriesName,
        replacementModelName,
        replacementProductName,
        replacementProductNo,
        replacementRequestSerialNo,
        replacementSerialNo,
        replacementEngineerId,
        replacementEngineerName,
        dispatchPlan,
        siteVisitRequired,
        siteVisitEngineerId,
        siteVisitEngineerName,
        siteVisitRequestedById,
        siteVisitRequestedByName,
        siteVisitRequestedByRole,
        siteVisitRequestedAt: siteVisitRequestedAt ? new Date(siteVisitRequestedAt) : undefined,
        siteVisitRemarks,
        siteVisitSpareParts,
        engineerName,
        l3SupportRequired,
        replacementReason,
        replacementRemarks,
        replacementRequestImages,
        replacementRequestedById,
        replacementRequestedByName,
        replacementRequestedByRole,
        replacementRequestedAt: replacementRequestedAt ? new Date(replacementRequestedAt) : undefined,
        replacementApprovedById,
        replacementApprovedByName,
        replacementApprovedByRole,
        replacementApprovedAt: replacementApprovedAt ? new Date(replacementApprovedAt) : undefined,
        finalResolution,
        clientFeedback,
        closureReport,
        closeRemark,
        closedByName,
        closedByRole,
        closedAt: closedAt ? new Date(closedAt) : undefined,
        status: complaintStatus,
        raisedBy: user.userId,
        createdAt: new Date(),
        updatedAt: new Date(),
        workflowHistory: [createWorkflowHistoryEvent({
                action: "Complaint raised",
                toStatus: assignment?.status ?? "Open at Aurawatt",
                user,
                note: "Complaint created through service intake.",
            })],
    };
    await c.complaints.insertOne(complaint);
    if (assignmentDecision && complaint.assignedEngineerId) {
        await (0, ticketRouting_1.recordTicketAssignmentLog)({
            ticketId: complaint.id,
            customerName,
            mobileNumber: complaint.customerPhone ?? String(mobileNumber ?? ""),
            email: complaint.customerEmail,
            state: complaint.state ?? String(complaintState ?? ""),
            district: complaint.district ?? String(complaintDistrict ?? ""),
            assignedEngineerId: complaint.assignedEngineerId,
            assignedEngineerName: complaint.assignedEngineerName ?? "",
            assignmentType: assignmentDecision.assignmentType || "Primary L1",
            assignmentReason: assignmentDecision.assignmentReason || "Assigned via buildAssignment",
            activeTicketCountAtAssignment: assignmentDecision.activeTicketCountAtAssignment || 0,
            lobbyTicketCountAtAssignment: assignmentDecision.lobbyTicketCountAtAssignment || 0,
            totalTicketCountAtAssignment: assignmentDecision.totalTicketCountAtAssignment || 0,
            assignmentStatus: assignmentDecision.assignmentStatus || "Assigned",
            status: assignmentDecision.status || "Assigned to Engineer",
            createdBy: user.userId,
            lastUpdatedBy: user.userId,
            backupEngineerName: assignmentDecision.backupEngineerName,
            slaStartedAt: assignmentDecision.slaStartedAt,
            slaDueAt: assignmentDecision.slaDueAt,
            slaPaused: assignmentDecision.slaPaused,
        });
        await (0, ticketRouting_1.refreshTicketLoadForAssignment)(complaint.assignedEngineerId, complaint.assignedEngineerName);
    }
    return (0, http_1.ok)(res, complaint, 201);
});
/** POST /api/complaints/:id/start-sla — manually start SLA timer */
router.post("/:id/start-sla", auth_1.authenticate, (0, auth_1.requireAnyPermission)("complaints:consumer", "complaints:supplier", "dispatch:manage"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const id = req.params.id;
    const complaint = await c.complaints.findOne({ id });
    if (!complaint)
        return (0, http_1.fail)(res, "Complaint not found", 404);
    if (complaint.slaStartedAt)
        return (0, http_1.fail)(res, "SLA timer has already started for this complaint.", 400);
    // Only active-lobby tickets (assignmentStatus === "Assigned") can have SLA started.
    if (complaint.assignmentStatus === "Waiting" || complaint.status === "Waiting Lobby") {
        return (0, http_1.fail)(res, "SLA cannot be started for a Waiting Lobby ticket. It must first be promoted to Active.", 400);
    }
    const now = new Date();
    // Default to L1 (4 hours) if no escalation level is found.
    const level = (complaint.escalationLevel || "L1");
    const slaHours = slaHoursForLevel(level);
    await c.complaints.updateOne({ id }, {
        $set: {
            slaStartedAt: now,
            slaDueAt: addHours(now, slaHours),
            slaPaused: false,
            updatedAt: now,
        },
    });
    // Auto-refill the active lobby: after SLA is started on this ticket,
    // promote the next waiting-lobby ticket so the active queue stays at 5.
    // We exclude this complaint from the active count so releaseNextWaitingTicket
    // sees one free slot and promotes exactly one waiting ticket.
    await releaseNextWaitingTicketExcluding([{ engineerId: complaint.assignedEngineerId, engineerName: complaint.assignedEngineerName }], normalizeServiceLevel(complaint.escalationLevel), complaint.id);
    const updated = await c.complaints.findOne({ id });
    return (0, http_1.ok)(res, updated);
});
/** PUT /api/complaints/:id/status — update complaint status */
router.put("/:id/status", auth_1.authenticate, (0, auth_1.requireAnyPermission)("complaints:consumer", "complaints:supplier", "dispatch:manage"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const id = req.params.id;
    const existing = await c.complaints.findOne({ id });
    if (!existing)
        return (0, http_1.fail)(res, "Complaint not found", 404);
    const user = req.user;
    if (!canAccessComplaint(user, existing)) {
        return (0, http_1.fail)(res, "Access denied: insufficient permissions", 403);
    }
    const { status } = req.body;
    if (!status)
        return (0, http_1.fail)(res, "status is required");
    const updatedAt = new Date();
    const nextStatus = String(status);
    const escalationReason = normalizeText(req.body.escalationReason);
    const escalationNotes = normalizeText(req.body.escalationNotes);
    const noteSuffix = nextStatus === "Escalated to L3"
        ? [
            escalationReason ? `Reason: ${escalationReason}.` : "",
            escalationNotes ? `Notes: ${escalationNotes}.` : "",
        ].filter(Boolean).join(" ")
        : "";
    const event = createWorkflowHistoryEvent({
        action: "Status updated",
        fromStatus: existing.status,
        toStatus: nextStatus,
        user,
        note: `Status changed to ${nextStatus}.${noteSuffix ? ` ${noteSuffix}` : ""}`,
    });
    const statusUpdate = {
        status,
        updatedAt,
    };
    const nextSerialKey = (0, complaintRules_1.isClosedComplaintStatus)(nextStatus) ? undefined : (0, complaintRules_1.normalizeComplaintSerialKey)(existing.productSerialNo) || undefined;
    if (nextSerialKey) {
        statusUpdate.productSerialNoKey = nextSerialKey;
    }
    await c.complaints.updateOne({ id }, {
        $set: statusUpdate,
        ...((0, complaintRules_1.isClosedComplaintStatus)(nextStatus) ? { $unset: { productSerialNoKey: "" } } : {}),
        $push: { workflowHistory: event },
    });
    if ((0, complaintRules_1.isClosedComplaintStatus)(nextStatus) && (0, complaintRules_1.isActiveWorkComplaint)(existing)) {
        await releaseNextWaitingTicket([
            { engineerId: existing.assignedEngineerId, engineerName: existing.assignedEngineerName },
            { engineerId: user.userId, engineerName: user.name },
        ], normalizeServiceLevel(existing.escalationLevel));
    }
    return (0, http_1.ok)(res, { ...existing, status, updatedAt });
});
/** PUT /api/complaints/:id/service — update service workflow fields */
router.put("/:id/service", auth_1.authenticate, (0, auth_1.requireAnyPermission)("complaints:consumer", "complaints:supplier", "dispatch:manage"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const id = req.params.id;
    const existing = await c.complaints.findOne({ id });
    if (!existing)
        return (0, http_1.fail)(res, "Complaint not found", 404);
    const user = req.user;
    if (!canAccessComplaint(user, existing)) {
        return (0, http_1.fail)(res, "Access denied: insufficient permissions", 403);
    }
    const nextInspection = req.body.l1Inspection ?? existing.l1Inspection;
    const l1InspectionValid = isL1InspectionValid(nextInspection);
    const isStartWorkRequest = req.body.status === "In Progress at Aurawatt" || (("serviceStartedAt" in req.body) && req.body.serviceStartedAt);
    if (isStartWorkRequest && (existing.assignmentStatus === "Waiting" || existing.status === "Waiting Lobby" || existing.status === "Assigned for Onsite")) {
        return (0, http_1.fail)(res, "Waiting Lobby tickets are queue only. Work can only be started from Active Work tickets.", 400);
    }
    const allowedFields = [
        "dealerName",
        "customerName",
        "customerPhone",
        "siteLocation",
        "state",
        "district",
        "region",
        "installationDate",
        "priority",
        "warrantyStatus",
        "productModel",
        "backupEngineerName",
        "escalatedById",
        "escalatedByName",
        "escalatedByRole",
        "escalatedAt",
        "escalationReason",
        "escalationNotes",
        "initialAction",
        "trackingNotes",
        "escalationLevel",
        "l1Inspection",
        "onsiteInspection",
        "serviceStartedAt",
        "progressUpdates",
        "technicalDiagnosis",
        "spareRequired",
        "spareName",
        "spareQuantity",
        "spareDispatchAddress",
        "spareParts",
        "spareInventoryStatus",
        "spareRequestStatus",
        "dispatchTrackingNo",
        "dispatchLrCopyName",
        "dispatchLrCopyUrl",
        "procurementStatus",
        "chargeableApprovalStatus",
        "paymentVerificationStatus",
        "replacementApprovalStatus",
        "replacementRecommended",
        "replacementSeriesName",
        "replacementModelName",
        "replacementProductName",
        "replacementProductNo",
        "replacementRequestSerialNo",
        "replacementSerialNo",
        "replacementEngineerId",
        "replacementEngineerName",
        "dispatchPlan",
        "siteVisitRequired",
        "siteVisitEngineerId",
        "siteVisitEngineerName",
        "siteVisitRequestedById",
        "siteVisitRequestedByName",
        "siteVisitRequestedByRole",
        "siteVisitRequestedAt",
        "siteVisitRemarks",
        "siteVisitSpareParts",
        "siteVisitScheduledDate",
        "siteVisitAssignedById",
        "siteVisitAssignedByName",
        "siteVisitAssignedByRole",
        "engineerName",
        "l3SupportRequired",
        "replacementReason",
        "replacementRemarks",
        "replacementRequestImages",
        "replacementRequestedById",
        "replacementRequestedByName",
        "replacementRequestedByRole",
        "replacementRequestedAt",
        "replacementApprovedById",
        "replacementApprovedByName",
        "replacementApprovedByRole",
        "replacementApprovedAt",
        "finalResolution",
        "clientFeedback",
        "closureReport",
        "closeRemark",
        "closedByName",
        "closedByRole",
        "closedAt",
        "status",
    ];
    const serverNow = new Date();
    const update = { updatedAt: serverNow, l1InspectionValid };
    const workflowHistory = [];
    const extraNotifications = [];
    const siteVisitActive = Boolean(req.body.siteVisitRequired ?? existing.siteVisitRequired);
    for (const field of allowedFields) {
        if (field in req.body)
            update[field] = req.body[field];
    }
    if ("spareParts" in req.body) {
        update.spareParts = normalizeSpareRequestParts(req.body.spareParts);
    }
    if ((req.body.status === "In Progress at Aurawatt" || ("serviceStartedAt" in req.body && req.body.serviceStartedAt)) && !existing.serviceStartedAt) {
        update.serviceStartedAt = serverNow;
        if (siteVisitActive && !existing.siteVisitAcceptedAt) {
            update.siteVisitAcceptedAt = serverNow;
        }
    }
    else {
        delete update.serviceStartedAt;
    }
    if (Array.isArray(req.body.progressUpdates)) {
        update.progressUpdates = req.body.progressUpdates.map((item) => ({
            ...item,
            date: item?.date ? new Date(item.date) : new Date(),
            createdAt: item?.createdAt ? new Date(item.createdAt) : new Date(),
        }));
    }
    if (complaintRules_1.CLOSED_COMPLAINT_STATUSES.includes(String(req.body.status))) {
        update.closedAt = serverNow;
        if (siteVisitActive && !existing.siteVisitCompletedAt) {
            update.siteVisitCompletedAt = serverNow;
        }
    }
    else {
        delete update.closedAt;
    }
    if ("installationDate" in req.body && req.body.installationDate)
        update.installationDate = new Date(req.body.installationDate);
    if ("siteVisitScheduledDate" in req.body && req.body.siteVisitScheduledDate)
        update.siteVisitScheduledDate = new Date(req.body.siteVisitScheduledDate);
    if (req.body.forceAssign || req.body.reassignEngineerName) {
        const assignment = await buildAssignment({
            issueDescription: existing.issueDescription,
            siteLocation: req.body.siteLocation ?? existing.siteLocation,
            region: req.body.region ?? existing.region,
            state: req.body.state ?? existing.state,
            district: req.body.district ?? existing.district,
            priority: req.body.priority ?? existing.priority,
            l1Sla: existing.l1Sla,
            preferredEngineerName: req.body.reassignEngineerName ?? req.body.engineerName,
        });
        if (assignment.blockedMessage) {
            return (0, http_1.fail)(res, assignment.blockedMessage, 400);
        }
        Object.assign(update, assignment);
    }
    const requestedAssignToId = normalizeText(req.body.assignToEngineerId);
    const requestedAssignToRole = normalizeText(req.body.assignToRole);
    if (requestedAssignToId) {
        const level = requestedAssignToRole.includes("L2")
            ? "L2"
            : requestedAssignToRole.includes("L3")
                ? "L3"
                : "L1";
        const candidates = await serviceEngineers(level);
        const target = candidates.find((candidate) => candidate.id === requestedAssignToId);
        if (!target)
            return (0, http_1.fail)(res, "Selected engineer not found", 404);
        const counts = await engineerTicketCounts(target.id, target.name, existing.id);
        if (counts.activeCount >= complaintRules_1.MAX_ACTIVE_SERVICE_TICKETS && counts.waitingCount >= complaintRules_1.MAX_WAITING_LOBBY_TICKETS) {
            return (0, http_1.fail)(res, complaintRules_1.ENGINEER_CAPACITY_MESSAGE, 400);
        }
        const assignment = await buildServiceAssignment({
            level,
            issueDescription: existing.issueDescription,
            siteLocation: req.body.siteLocation ?? existing.siteLocation,
            region: req.body.region ?? existing.region,
            state: req.body.state ?? existing.state,
            district: req.body.district ?? existing.district,
            priority: req.body.priority ?? existing.priority,
            l1Sla: existing.l1Sla,
            preferredEngineerId: target.id,
            preferredEngineerName: target.name,
            preferredEngineerEmail: target.email,
            excludeComplaintId: existing.id,
        });
        if (assignment.blockedMessage) {
            return (0, http_1.fail)(res, assignment.blockedMessage, 400);
        }
        Object.assign(update, assignment);
        if (assignment.assignmentStatus === "Waiting") {
            if (level === "L2" && !req.body.status) {
                update.status = "Waiting Lobby";
            }
            else if (level === "L3" && !req.body.status) {
                update.status = "Waiting Lobby";
            }
        }
    }
    else {
        const targetLevel = req.body.status === "Escalated to L2" || req.body.escalationLevel === "L2"
            ? "L2"
            : req.body.status === "Escalated to L3" || req.body.escalationLevel === "L3"
                ? "L3"
                : undefined;
        if (targetLevel && !complaintRules_1.CLOSED_COMPLAINT_STATUSES.includes(String(update.status))) {
            const assignment = await buildServiceAssignment({
                level: targetLevel,
                issueDescription: req.body.issueDescription ?? existing.issueDescription,
                siteLocation: req.body.siteLocation ?? existing.siteLocation,
                region: req.body.region ?? existing.region,
                priority: req.body.priority ?? existing.priority,
                l1Sla: existing.l1Sla,
                preferredEngineerId: req.body.preferredEngineerId,
                preferredEngineerName: req.body.preferredEngineerName ?? req.body.engineerName,
                excludeComplaintId: existing.id,
            });
            if (assignment.blockedMessage) {
                return (0, http_1.fail)(res, assignment.blockedMessage, 400);
            }
            Object.assign(update, assignment);
        }
    }
    const desiredStatus = String(req.body.status ?? update.status ?? existing.status);
    const wantsOnsiteAssignment = Boolean(req.body.sendForOnsite) || desiredStatus === "Assigned for Onsite";
    const wantsL3ReplacementReview = Boolean(req.body.escalateReplacementToL3) || desiredStatus === "Pending L3 Approval";
    const wantsDispatchApproval = Boolean(req.body.sendReplacementRequest) || desiredStatus === "Awaiting Dispatch" || desiredStatus === "Replacement Requested";
    if (wantsOnsiteAssignment) {
        const onsiteEngineerId = normalizeText(req.body.siteVisitEngineerId ?? update.siteVisitEngineerId ?? existing.siteVisitEngineerId);
        const onsiteEngineerName = normalizeText(req.body.siteVisitEngineerName ?? update.siteVisitEngineerName ?? existing.siteVisitEngineerName ?? req.body.engineerName ?? update.engineerName ?? existing.engineerName);
        if (!onsiteEngineerId && !onsiteEngineerName) {
            return (0, http_1.fail)(res, "Onsite engineer selection is required", 400);
        }
        const onsiteCounts = await engineerTicketCounts(onsiteEngineerId || onsiteEngineerName, onsiteEngineerName, existing.id);
        if (onsiteCounts.activeCount >= complaintRules_1.MAX_ACTIVE_SERVICE_TICKETS) {
            return (0, http_1.fail)(res, complaintRules_1.ONSITE_CAPACITY_MESSAGE, 400);
        }
        const sparePartsInput = Array.isArray(req.body.siteVisitSpareParts) ? req.body.siteVisitSpareParts : [];
        const onsiteSpareParts = sparePartsInput
            .map((part, index) => {
            const name = normalizeText(part?.name ?? part?.sparePartName ?? part?.partName);
            const quantity = Number(part?.quantity);
            if (!name || !Number.isFinite(quantity) || quantity <= 0)
                return null;
            return {
                id: normalizeText(part?.id) || `${serverNow.getTime()}-${index}`,
                name,
                quantity,
                notes: normalizeText(part?.notes) || undefined,
            };
        })
            .filter(Boolean);
        update.siteVisitRequired = true;
        update.siteVisitEngineerId = onsiteEngineerId || undefined;
        update.siteVisitEngineerName = onsiteEngineerName || undefined;
        update.siteVisitRequestedById = req.body.siteVisitRequestedById ?? user.userId;
        update.siteVisitRequestedByName = req.body.siteVisitRequestedByName ?? user.name ?? user.email;
        update.siteVisitRequestedByRole = req.body.siteVisitRequestedByRole ?? user.role;
        update.siteVisitRequestedAt = req.body.siteVisitRequestedAt ? new Date(req.body.siteVisitRequestedAt) : serverNow;
        update.siteVisitRemarks = normalizeText(req.body.siteVisitRemarks ?? update.siteVisitRemarks ?? existing.siteVisitRemarks) || undefined;
        update.siteVisitSpareParts = onsiteSpareParts;
        update.siteVisitAssignedById = user.userId;
        update.siteVisitAssignedByName = user.name ?? user.email;
        update.siteVisitAssignedByRole = user.role;
        update.engineerName = onsiteEngineerName || undefined;
        update.assignmentStatus = "Assigned";
        update.status = "Assigned for Onsite";
        update.slaPaused = false;
        update.waitingSince = undefined;
        update.queuePosition = undefined;
        workflowHistory.push(createWorkflowHistoryEvent({
            action: "Assigned for onsite",
            fromStatus: existing.status,
            toStatus: "Assigned for Onsite",
            user,
            note: onsiteSpareParts.length
                ? `Onsite request assigned to ${onsiteEngineerName || onsiteEngineerId} with ${onsiteSpareParts.length} spare part(s).`
                : `Onsite request assigned to ${onsiteEngineerName || onsiteEngineerId}.`,
        }));
        if (onsiteEngineerId) {
            extraNotifications.push({
                id: (0, id_1.generateId)(),
                type: "complaint_workflow_updated",
                title: "Onsite request assigned",
                body: `${existing.productSerialNo || "No serial"} assigned for onsite visit.`,
                entityType: "complaint",
                entityId: existing.id,
                meta: {
                    status: "Assigned for Onsite",
                    onsiteEngineerId,
                    onsiteEngineerName,
                    siteVisitSpareParts: onsiteSpareParts,
                    siteVisitRemarks: update.siteVisitRemarks,
                },
                audienceUserIds: [onsiteEngineerId],
                readBy: [],
                createdBy: user.userId,
                createdAt: serverNow,
            });
        }
    }
    if (wantsL3ReplacementReview) {
        const replacementReason = normalizeText(req.body.replacementReason ?? update.replacementReason ?? existing.replacementReason);
        const replacementRemarks = normalizeText(req.body.replacementRemarks ?? update.replacementRemarks ?? existing.replacementRemarks);
        const replacementImages = Array.isArray(req.body.replacementRequestImages) ? req.body.replacementRequestImages : [];
        update.replacementRecommended = true;
        update.replacementReason = replacementReason || undefined;
        update.replacementRemarks = replacementRemarks || undefined;
        update.replacementRequestImages = replacementImages.length ? replacementImages : undefined;
        update.replacementRequestedById = req.body.replacementRequestedById ?? user.userId;
        update.replacementRequestedByName = req.body.replacementRequestedByName ?? user.name ?? user.email;
        update.replacementRequestedByRole = req.body.replacementRequestedByRole ?? user.role;
        update.replacementRequestedAt = req.body.replacementRequestedAt ? new Date(req.body.replacementRequestedAt) : serverNow;
        update.status = "Pending L3 Approval";
        workflowHistory.push(createWorkflowHistoryEvent({
            action: "Escalated replacement to L3",
            fromStatus: existing.status,
            toStatus: "Pending L3 Approval",
            user,
            note: replacementReason || replacementRemarks || "Replacement review requested by onsite engineer.",
        }));
        extraNotifications.push({
            id: (0, id_1.generateId)(),
            type: "complaint_workflow_updated",
            title: "Replacement review pending",
            body: `${existing.productSerialNo || "No serial"} requires L3 review.`,
            entityType: "complaint",
            entityId: existing.id,
            meta: {
                status: "Pending L3 Approval",
                replacementReason,
                replacementRemarks,
            },
            audienceRoles: ["L3 Advanced OEM Support"],
            readBy: [],
            createdBy: user.userId,
            createdAt: serverNow,
        });
    }
    if (wantsDispatchApproval) {
        update.replacementRecommended = true;
        update.replacementApprovalStatus = "Pending";
        update.replacementRequestedById = update.replacementRequestedById ?? existing.replacementRequestedById ?? user.userId;
        update.replacementRequestedByName = update.replacementRequestedByName ?? existing.replacementRequestedByName ?? user.name ?? user.email;
        update.replacementRequestedByRole = update.replacementRequestedByRole ?? existing.replacementRequestedByRole ?? user.role;
        update.replacementRequestedAt = update.replacementRequestedAt ?? existing.replacementRequestedAt ?? serverNow;
        update.status = "Awaiting Dispatch";
        workflowHistory.push(createWorkflowHistoryEvent({
            action: "Queued replacement request for manufacturing approval",
            fromStatus: existing.status,
            toStatus: "Awaiting Dispatch",
            user,
            note: "Replacement request forwarded to Manufactured Products for approval.",
        }));
        extraNotifications.push({
            id: (0, id_1.generateId)(),
            type: "complaint_workflow_updated",
            title: "Replacement approval requested",
            body: `${existing.productSerialNo || "No serial"} sent to Manufactured Products for approval.`,
            entityType: "complaint",
            entityId: existing.id,
            meta: {
                status: "Awaiting Dispatch",
                replacementApprovalStatus: "Pending",
                replacementRequestedByName: update.replacementRequestedByName,
            },
            audienceRoles: ["Inventory"],
            readBy: [],
            createdBy: user.userId,
            createdAt: serverNow,
        });
    }
    if (req.body.status === "Escalated to L2" || req.body.status === "Escalated to L3") {
        update.escalatedById = req.body.escalatedById ?? user.userId;
        update.escalatedByName = req.body.escalatedByName ?? user.email;
        update.escalatedByRole = req.body.escalatedByRole ?? user.role;
        update.escalatedAt = new Date();
        workflowHistory.push(createWorkflowHistoryEvent({
            action: req.body.status === "Escalated to L2" ? "Escalated to L2" : "Escalated to L3",
            fromStatus: existing.status,
            toStatus: String(req.body.status),
            user,
            note: `Ticket escalated to ${req.body.status === "Escalated to L2" ? "L2" : "L3"}.`,
        }));
    }
    const isClosed = (0, complaintRules_1.isClosedComplaintStatus)(desiredStatus);
    const nextSerialKey = isClosed ? undefined : (0, complaintRules_1.normalizeComplaintSerialKey)(existing.productSerialNo) || undefined;
    const nextStatus = String(update.status ?? existing.status);
    const nextReplacementSerial = normalizeText(update.replacementSerialNo ?? existing.replacementSerialNo);
    if (nextStatus === "Dispatch in Progress" && existing.productSerialNo) {
        const originalSerial = await c.serials.findOne({ serialNumber: existing.productSerialNo }, { projection: { id: 1 } });
        if (!originalSerial) {
            return (0, http_1.fail)(res, "Original serial not found for replacement claim", 404);
        }
        if (nextReplacementSerial) {
            const replacementSerial = await c.serials.findOne({ serialNumber: nextReplacementSerial }, { projection: { id: 1 } });
            if (!replacementSerial) {
                return (0, http_1.fail)(res, "Replacement serial not found in serial pool", 404);
            }
        }
    }
    const setDoc = { ...update };
    if (nextSerialKey) {
        setDoc.productSerialNoKey = nextSerialKey;
    }
    const updateDoc = workflowHistory.length
        ? { $set: setDoc, $push: { workflowHistory: { $each: workflowHistory } } }
        : { $set: setDoc };
    if (isClosed) {
        updateDoc.$unset = { productSerialNoKey: "" };
    }
    await c.complaints.updateOne({ id }, updateDoc);
    if (nextStatus === "Dispatch in Progress" && existing.productSerialNo) {
        await (0, serialLifecycle_1.updateSerialStatus)(c, {
            serialNumber: existing.productSerialNo,
            status: "Replacement Claimed",
        });
        if (nextReplacementSerial) {
            await (0, serialLifecycle_1.updateSerialStatus)(c, {
                serialNumber: nextReplacementSerial,
                status: "Dispatched",
            });
        }
    }
    if (isClosed && (0, complaintRules_1.isActiveWorkComplaint)(existing)) {
        try {
            await releaseNextWaitingTicket([
                { engineerId: existing.assignedEngineerId, engineerName: existing.assignedEngineerName },
                { engineerId: user.userId, engineerName: user.name },
            ], normalizeServiceLevel(existing.escalationLevel));
        }
        catch (err) {
            console.warn("Failed to release next waiting ticket from service close:", err instanceof Error ? err.message : String(err));
        }
    }
    for (const notification of extraNotifications) {
        try {
            await c.notifications.insertOne(notification);
        }
        catch (err) {
            console.warn("Failed to insert workflow notification:", err instanceof Error ? err.message : String(err));
        }
    }
    if (complaintRules_1.CLOSED_COMPLAINT_STATUSES.includes(String(update.status)) && (0, complaintRules_1.isActiveWorkComplaint)(existing)) {
        try {
            await releaseNextWaitingTicket([
                { engineerId: existing.assignedEngineerId, engineerName: existing.assignedEngineerName },
                { engineerId: user.userId, engineerName: user.name },
            ], normalizeServiceLevel(existing.escalationLevel));
        }
        catch (err) {
            console.warn("Failed to release next waiting ticket:", err instanceof Error ? err.message : String(err));
        }
    }
    const updated = await c.complaints.findOne({ id });
    if (updated && req.body.notifyAdminOnCompletion && complaintRules_1.CLOSED_COMPLAINT_STATUSES.includes(String(update.status))) {
        try {
            const notification = {
                id: (0, id_1.generateId)(),
                type: "complaint_completed",
                title: "Complaint completed by service team",
                body: `${updated.productSerialNo || "No serial"} resolved. ${updated.finalResolution || "Final resolution submitted."}`,
                entityType: "complaint",
                entityId: updated.id,
                meta: {
                    serialNumber: updated.productSerialNo,
                    status: updated.status,
                    escalationLevel: updated.escalationLevel,
                    serviceStartedAt: updated.serviceStartedAt,
                    closedAt: updated.closedAt,
                    finalResolution: updated.finalResolution,
                },
                audienceRoles: ["Admin"],
                readBy: [],
                createdBy: user.userId,
                createdAt: new Date(),
            };
            await c.notifications.insertOne(notification);
            if (updated.siteVisitRequired && updated.siteVisitAssignedById && updated.siteVisitAssignedById !== user.userId) {
                const onsiteNotification = {
                    id: (0, id_1.generateId)(),
                    type: "complaint_completed",
                    title: "Onsite ticket closed by engineer",
                    body: `${updated.productSerialNo || "No serial"} onsite work closed by ${updated.closedByName || user.name || user.email}. ${updated.closeRemark || updated.finalResolution || "Work completed."}`,
                    entityType: "complaint",
                    entityId: updated.id,
                    meta: {
                        serialNumber: updated.productSerialNo,
                        status: updated.status,
                        closedByName: updated.closedByName,
                        closedByRole: updated.closedByRole,
                        serviceStartedAt: updated.serviceStartedAt,
                        closedAt: updated.closedAt,
                        closeRemark: updated.closeRemark,
                        finalResolution: updated.finalResolution,
                        siteVisitScheduledDate: updated.siteVisitScheduledDate,
                    },
                    audienceUserIds: [updated.siteVisitAssignedById],
                    readBy: [],
                    createdBy: user.userId,
                    createdAt: new Date(),
                };
                await c.notifications.insertOne(onsiteNotification);
            }
        }
        catch (err) {
            console.warn("Failed to insert complaint completion notification:", err instanceof Error ? err.message : String(err));
        }
    }
    return (0, http_1.ok)(res, updated);
});
exports.default = router;
