import { getCollections } from "../db/collections";
import { resolveIndiaStateName, isIndiaDistrictForState } from "../data/indiaGeography";
import type { AuthUser, Complaint, TicketAssignmentLog } from "../types";
import { ACTIVE_TICKET_STATUSES, ENGINEER_CAPACITY_MESSAGE, LOBBY_TICKET_STATUSES, MAX_ACTIVE_SERVICE_TICKETS, MAX_WAITING_LOBBY_TICKETS } from "../utils/complaintRules";
import { generateId } from "../utils/id";
import { recomputeTicketLoadForEngineer, resolveAssignmentByStateDistrict } from "./engineerAssignments";

export type TicketAssignmentDecision = {
  assignmentType: "Primary L1" | "Backup L1" | "L2 Escalation";
  assignmentReason: string;
  assignedEngineerId: string;
  assignedEngineerName: string;
  backupEngineerName?: string;
  activeTicketCountAtAssignment: number;
  lobbyTicketCountAtAssignment: number;
  totalTicketCountAtAssignment: number;
  assignmentStatus: "Assigned";
  status: Complaint["status"];
  slaStartedAt?: Date;
  slaDueAt?: Date;
  slaPaused?: boolean;
  queuePosition?: number;
  waitingSince?: Date;
};

export type TicketAssignmentInput = {
  ticketId: string;
  customerName: string;
  mobileNumber: string;
  email?: string;
  state: string;
  district: string;
  createdBy?: string;
  lastUpdatedBy?: string;
};

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function engineerIdentityFilter(engineerId: string, engineerName?: string) {
  const or: Record<string, unknown>[] = [{ assignedEngineerId: engineerId }];
  if (engineerName) {
    or.push({ assignedEngineerName: engineerName });
  }
  return { $or: or };
}

async function countEngineerLoad(engineerId: string, engineerName?: string) {
  const c = await getCollections();
  const [activeTicketCount, lobbyTicketCount] = await Promise.all([
    c.complaints.countDocuments({
      ...engineerIdentityFilter(engineerId, engineerName),
      status: { $in: [...ACTIVE_TICKET_STATUSES] },
    }),
    c.complaints.countDocuments({
      ...engineerIdentityFilter(engineerId, engineerName),
      assignmentStatus: "Waiting",
      status: { $in: [...LOBBY_TICKET_STATUSES] },
    }),
  ]);
  return {
    activeTicketCount,
    lobbyTicketCount,
    totalTicketCount: activeTicketCount + lobbyTicketCount,
  };
}

function canAcceptL1TicketStrict(load: { activeTicketCount: number; totalTicketCount: number }) {
  return load.activeTicketCount < MAX_ACTIVE_SERVICE_TICKETS && load.totalTicketCount < 10;
}

function buildAssignedComplaintStatus(assignmentType: TicketAssignmentDecision["assignmentType"]) {
  return assignmentType === "L2 Escalation" ? "Escalated to L2" : "Assigned to Engineer";
}

export async function routeCustomerTicketByStateDistrict(input: {
  state: string;
  district: string;
}) {
  const state = resolveIndiaStateName(input.state);
  const district = normalizeText(input.district);
  if (!state) {
    return { blockedMessage: "Please select a valid Indian state." } as const;
  }
  if (!district) {
    return { blockedMessage: "Please select a valid district." } as const;
  }
  if (!isIndiaDistrictForState(state, district)) {
    return { blockedMessage: "Selected district does not belong to the chosen state." } as const;
  }

  const assignment = await resolveAssignmentByStateDistrict(state, district);
  if (!assignment?.assignment) {
    return { blockedMessage: "No engineer mapping is configured for the selected state and district." } as const;
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
    return {
      assignmentType: "Primary L1" as const,
      assignmentReason: "Primary L1 capacity available.",
      assignedEngineerId: primary.id,
      assignedEngineerName: primary.name,
      backupEngineerName: backup?.name,
      activeTicketCountAtAssignment: primaryLoad.activeTicketCount,
      lobbyTicketCountAtAssignment: primaryLoad.lobbyTicketCount,
      totalTicketCountAtAssignment: primaryLoad.totalTicketCount,
      assignmentStatus: "Assigned" as const,
      status: buildAssignedComplaintStatus("Primary L1") as Complaint["status"],
      slaStartedAt: new Date(),
      slaDueAt: new Date(Date.now() + 4 * 60 * 60 * 1000),
      slaPaused: false,
    } satisfies TicketAssignmentDecision;
  }

  if (backup && backupLoad && canAcceptL1TicketStrict(backupLoad)) {
    return {
      assignmentType: "Backup L1" as const,
      assignmentReason: primary ? "Primary L1 is full; backup capacity is available." : "Primary L1 is unavailable; backup capacity is available.",
      assignedEngineerId: backup.id,
      assignedEngineerName: backup.name,
      backupEngineerName: backup.name,
      activeTicketCountAtAssignment: backupLoad.activeTicketCount,
      lobbyTicketCountAtAssignment: backupLoad.lobbyTicketCount,
      totalTicketCountAtAssignment: backupLoad.totalTicketCount,
      assignmentStatus: "Assigned" as const,
      status: buildAssignedComplaintStatus("Backup L1") as Complaint["status"],
      slaStartedAt: new Date(),
      slaDueAt: new Date(Date.now() + 4 * 60 * 60 * 1000),
      slaPaused: false,
    } satisfies TicketAssignmentDecision;
  }

  if (l2 && l2Load) {
    return {
      assignmentType: "L2 Escalation" as const,
      assignmentReason: "Primary L1 and backup L1 are full.",
      assignedEngineerId: l2.id,
      assignedEngineerName: l2.name,
      backupEngineerName: backup?.name,
      activeTicketCountAtAssignment: l2Load.activeTicketCount,
      lobbyTicketCountAtAssignment: l2Load.lobbyTicketCount,
      totalTicketCountAtAssignment: l2Load.totalTicketCount,
      assignmentStatus: "Assigned" as const,
      status: buildAssignedComplaintStatus("L2 Escalation") as Complaint["status"],
      slaStartedAt: new Date(),
      slaDueAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      slaPaused: false,
    } satisfies TicketAssignmentDecision;
  }

  return {
    blockedMessage: ENGINEER_CAPACITY_MESSAGE,
  } as const;
}

export async function recordTicketAssignmentLog(input: TicketAssignmentInput & TicketAssignmentDecision & Record<string, unknown>) {
  const c = await getCollections();
  const now = new Date();
  const log: TicketAssignmentLog = {
    id: generateId(),
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

export async function refreshTicketLoadForAssignment(engineerId: string, engineerName?: string) {
  return recomputeTicketLoadForEngineer(engineerId, engineerName);
}
