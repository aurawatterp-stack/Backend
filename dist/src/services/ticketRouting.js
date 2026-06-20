"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.routeCustomerTicketByStateDistrict = routeCustomerTicketByStateDistrict;
exports.recordTicketAssignmentLog = recordTicketAssignmentLog;
exports.refreshTicketLoadForAssignment = refreshTicketLoadForAssignment;
const collections_1 = require("../db/collections");
const indiaGeography_1 = require("../data/indiaGeography");
const complaintRules_1 = require("../utils/complaintRules");
const id_1 = require("../utils/id");
const engineerAssignments_1 = require("./engineerAssignments");
function normalizeText(value) {
    return String(value ?? "").trim();
}
function engineerIdentityFilter(engineerId, engineerName) {
    const or = [{ assignedEngineerId: engineerId }];
    if (engineerName) {
        or.push({ assignedEngineerName: engineerName });
    }
    return { $or: or };
}
async function countEngineerLoad(engineerId, engineerName) {
    const c = await (0, collections_1.getCollections)();
    const [activeTicketCount, lobbyTicketCount] = await Promise.all([
        c.complaints.countDocuments({
            ...engineerIdentityFilter(engineerId, engineerName),
            status: { $in: [...complaintRules_1.ACTIVE_TICKET_STATUSES] },
        }),
        c.complaints.countDocuments({
            ...engineerIdentityFilter(engineerId, engineerName),
            assignmentStatus: "Waiting",
            status: { $in: [...complaintRules_1.LOBBY_TICKET_STATUSES] },
        }),
    ]);
    return {
        activeTicketCount,
        lobbyTicketCount,
        totalTicketCount: activeTicketCount + lobbyTicketCount,
    };
}
function canAcceptL1TicketStrict(load) {
    return load.activeTicketCount < complaintRules_1.MAX_ACTIVE_SERVICE_TICKETS || load.lobbyTicketCount < complaintRules_1.MAX_WAITING_LOBBY_TICKETS;
}
function buildAssignedComplaintStatus(assignmentType) {
    return assignmentType === "L2 Escalation" ? "Escalated to L2" : "Assigned to Engineer";
}
async function routeCustomerTicketByStateDistrict(input) {
    const state = (0, indiaGeography_1.resolveIndiaStateName)(input.state);
    const district = normalizeText(input.district);
    if (!state) {
        return { blockedMessage: "Please select a valid Indian state." };
    }
    if (!district) {
        return { blockedMessage: "Please select a valid district." };
    }
    if (!(0, indiaGeography_1.isIndiaDistrictForState)(state, district)) {
        return { blockedMessage: "Selected district does not belong to the chosen state." };
    }
    const assignment = await (0, engineerAssignments_1.resolveAssignmentByStateDistrict)(state, district);
    if (!assignment?.assignment) {
        return { blockedMessage: "No engineer mapping is configured for the selected state and district." };
    }
    const primary = assignment.l1Engineer && assignment.l1Engineer.isActive !== false
        ? assignment.l1Engineer
        : null;
    const backup = assignment.backupEngineer && assignment.backupEngineer.isActive !== false
        ? assignment.backupEngineer
        : null;
    const l2 = assignment.l2Engineer && assignment.l2Engineer.isActive !== false
        ? assignment.l2Engineer
        : null;
    const primaryLoad = primary ? await countEngineerLoad(primary.id, primary.name) : null;
    const backupLoad = backup ? await countEngineerLoad(backup.id, backup.name) : null;
    const l2Load = l2 ? await countEngineerLoad(l2.id, l2.name) : null;
    if (primary && primaryLoad && canAcceptL1TicketStrict(primaryLoad)) {
        const isWaiting = primaryLoad.activeTicketCount >= complaintRules_1.MAX_ACTIVE_SERVICE_TICKETS;
        return {
            assignmentType: "Primary L1",
            assignmentReason: isWaiting ? "Primary L1 active queue full, placed in waiting lobby." : "Primary L1 capacity available.",
            assignedEngineerId: primary.id,
            assignedEngineerName: primary.name,
            backupEngineerName: backup?.name,
            activeTicketCountAtAssignment: primaryLoad.activeTicketCount,
            lobbyTicketCountAtAssignment: primaryLoad.lobbyTicketCount,
            totalTicketCountAtAssignment: primaryLoad.totalTicketCount,
            assignmentStatus: isWaiting ? "Waiting" : "Assigned",
            status: isWaiting ? "Waiting Lobby" : buildAssignedComplaintStatus("Primary L1"),
            slaStartedAt: undefined,
            slaDueAt: undefined,
            slaPaused: true,
            queuePosition: isWaiting ? primaryLoad.lobbyTicketCount + 1 : undefined,
            waitingSince: isWaiting ? new Date() : undefined,
        };
    }
    if (backup && backupLoad && canAcceptL1TicketStrict(backupLoad)) {
        const isWaiting = backupLoad.activeTicketCount >= complaintRules_1.MAX_ACTIVE_SERVICE_TICKETS;
        return {
            assignmentType: "Backup L1",
            assignmentReason: isWaiting ? "Backup L1 active queue full, placed in waiting lobby." : (primary ? "Primary L1 is full; backup capacity is available." : "Primary L1 is unavailable; backup capacity is available."),
            assignedEngineerId: backup.id,
            assignedEngineerName: backup.name,
            backupEngineerName: backup.name,
            activeTicketCountAtAssignment: backupLoad.activeTicketCount,
            lobbyTicketCountAtAssignment: backupLoad.lobbyTicketCount,
            totalTicketCountAtAssignment: backupLoad.totalTicketCount,
            assignmentStatus: isWaiting ? "Waiting" : "Assigned",
            status: isWaiting ? "Waiting Lobby" : buildAssignedComplaintStatus("Backup L1"),
            slaStartedAt: undefined,
            slaDueAt: undefined,
            slaPaused: true,
            queuePosition: isWaiting ? backupLoad.lobbyTicketCount + 1 : undefined,
            waitingSince: isWaiting ? new Date() : undefined,
        };
    }
    if (l2 && l2Load) {
        const isWaiting = l2Load.activeTicketCount >= complaintRules_1.MAX_ACTIVE_SERVICE_TICKETS;
        return {
            assignmentType: "L2 Escalation",
            assignmentReason: isWaiting ? "L2 active queue full, placed in waiting lobby." : "Primary L1 and backup L1 are full.",
            assignedEngineerId: l2.id,
            assignedEngineerName: l2.name,
            backupEngineerName: backup?.name,
            activeTicketCountAtAssignment: l2Load.activeTicketCount,
            lobbyTicketCountAtAssignment: l2Load.lobbyTicketCount,
            totalTicketCountAtAssignment: l2Load.totalTicketCount,
            assignmentStatus: isWaiting ? "Waiting" : "Assigned",
            status: isWaiting ? "Waiting Lobby" : buildAssignedComplaintStatus("L2 Escalation"),
            slaStartedAt: undefined,
            slaDueAt: undefined,
            slaPaused: true,
            queuePosition: isWaiting ? l2Load.lobbyTicketCount + 1 : undefined,
            waitingSince: isWaiting ? new Date() : undefined,
        };
    }
    return {
        blockedMessage: complaintRules_1.ENGINEER_CAPACITY_MESSAGE,
    };
}
async function recordTicketAssignmentLog(input) {
    const c = await (0, collections_1.getCollections)();
    const now = new Date();
    const log = {
        id: (0, id_1.generateId)(),
        ticketId: input.ticketId,
        customerName: input.customerName,
        mobileNumber: input.mobileNumber,
        email: input.email || undefined,
        state: input.state,
        district: input.district,
        assignedEngineerId: input.assignedEngineerId,
        assignedEngineerName: input.assignedEngineerName,
        assignmentType: input.assignmentType,
        assignmentReason: input.assignmentReason,
        assignedAt: now,
        createdBy: input.createdBy,
        lastUpdatedBy: input.lastUpdatedBy ?? input.createdBy,
        createdAt: now,
        updatedAt: now,
    };
    await c.ticketAssignmentAudit.insertOne(log);
    return log;
}
async function refreshTicketLoadForAssignment(engineerId, engineerName) {
    return (0, engineerAssignments_1.recomputeTicketLoadForEngineer)(engineerId, engineerName);
}
