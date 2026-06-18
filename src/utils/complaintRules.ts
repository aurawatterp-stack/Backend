import type { Complaint } from "../types";

export const MAX_ACTIVE_SERVICE_TICKETS = 5;
export const MAX_WAITING_LOBBY_TICKETS = 5;

export const CLOSED_COMPLAINT_STATUSES = [
  "Resolved by Aurawatt",
  "Resolved by Suppliers",
] as const;

export const ACTIVE_COMPLAINT_DUPLICATE_MESSAGE = "An active complaint already exists for this serial number. Please wait until the current ticket is resolved or closed before creating a new complaint for the same serial number.";

export const ENGINEER_CAPACITY_MESSAGE = "The selected engineer has reached the maximum ticket capacity (5 Active Work + 5 Waiting Lobby tickets). Please assign this ticket to another engineer.";

export const ONSITE_CAPACITY_MESSAGE = "Selected engineer already has 5 active onsite inspection tickets. Please select another engineer.";

export function normalizeComplaintSerialKey(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function isClosedComplaintStatus(status: unknown) {
  return CLOSED_COMPLAINT_STATUSES.includes(String(status) as (typeof CLOSED_COMPLAINT_STATUSES)[number]);
}

export function isActiveComplaintStatus(status: unknown) {
  return !isClosedComplaintStatus(status);
}

export function isWaitingLobbyComplaint(complaint: Pick<Complaint, "assignmentStatus" | "status">) {
  return complaint.assignmentStatus === "Waiting" && complaint.status === "Waiting Lobby";
}

export function isActiveWorkComplaint(complaint: Pick<Complaint, "assignmentStatus" | "status">) {
  return complaint.assignmentStatus === "Assigned" && complaint.status !== "Assigned for Onsite" && !isWaitingLobbyComplaint(complaint);
}

