"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ONSITE_CAPACITY_MESSAGE = exports.ENGINEER_CAPACITY_MESSAGE = exports.ACTIVE_COMPLAINT_DUPLICATE_MESSAGE = exports.CLOSED_COMPLAINT_STATUSES = exports.HOLD_TICKET_STATUS = exports.LOBBY_TICKET_STATUSES = exports.ACTIVE_TICKET_STATUSES = exports.MAX_WAITING_LOBBY_TICKETS = exports.MAX_ACTIVE_SERVICE_TICKETS = void 0;
exports.normalizeComplaintSerialKey = normalizeComplaintSerialKey;
exports.isClosedComplaintStatus = isClosedComplaintStatus;
exports.isActiveComplaintStatus = isActiveComplaintStatus;
exports.isOnHoldComplaint = isOnHoldComplaint;
exports.isWaitingLobbyComplaint = isWaitingLobbyComplaint;
exports.isActiveWorkComplaint = isActiveWorkComplaint;
exports.MAX_ACTIVE_SERVICE_TICKETS = 5;
exports.MAX_WAITING_LOBBY_TICKETS = 5;
exports.ACTIVE_TICKET_STATUSES = [
    "New",
    "Assigned",
    "In Progress",
    "Open at Aurawatt",
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
exports.LOBBY_TICKET_STATUSES = [
    "Pending Assignment",
    "Waiting Queue",
    "Waiting Lobby",
];
/**
 * Deliberately excluded from ACTIVE_TICKET_STATUSES and LOBBY_TICKET_STATUSES:
 * a held ticket must not consume the engineer's 5 active / 5 lobby capacity, so
 * putting a blocked ticket on hold frees a slot for the next waiting ticket.
 */
exports.HOLD_TICKET_STATUS = "On Hold";
exports.CLOSED_COMPLAINT_STATUSES = [
    "Resolved by Aurawatt",
    "Resolved by Suppliers",
];
exports.ACTIVE_COMPLAINT_DUPLICATE_MESSAGE = "An active complaint already exists for this serial number. Please wait until the current ticket is resolved or closed before creating a new complaint for the same serial number.";
exports.ENGINEER_CAPACITY_MESSAGE = "The selected engineer has reached the maximum ticket capacity (5 Active Work + 5 Waiting Lobby tickets). Please assign this ticket to another engineer.";
exports.ONSITE_CAPACITY_MESSAGE = "Selected engineer already has 5 active onsite inspection tickets. Please select another engineer.";
function normalizeComplaintSerialKey(value) {
    return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}
function isClosedComplaintStatus(status) {
    return exports.CLOSED_COMPLAINT_STATUSES.includes(String(status));
}
function isActiveComplaintStatus(status) {
    return !isClosedComplaintStatus(status);
}
function isOnHoldComplaint(complaint) {
    return complaint.status === exports.HOLD_TICKET_STATUS;
}
function isWaitingLobbyComplaint(complaint) {
    return complaint.assignmentStatus === "Waiting" && exports.LOBBY_TICKET_STATUSES.includes(complaint.status);
}
function isActiveWorkComplaint(complaint) {
    return complaint.assignmentStatus === "Assigned" && exports.ACTIVE_TICKET_STATUSES.includes(complaint.status) && !isWaitingLobbyComplaint(complaint);
}
