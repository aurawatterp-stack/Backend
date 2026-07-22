import express, { type NextFunction, type Request, type Response, type Router } from "express";
import multer from "multer";



import { getCollections } from "../db/collections";
import { authenticate, requireAnyPermission } from "../middleware/auth";
import type { AuthUser, Complaint, Notification } from "../types";
import { uploadBufferToCloudinary } from "../utils/cloudinary";
import { fail, ok } from "../utils/http";
import { generateId } from "../utils/id";
import { updateSerialStatus } from "../utils/serialLifecycle";
import { generateTicketNumber } from "../utils/ticketNumber";
import { resolveAssignmentByStateDistrict, listL1TeamForL2, findEngineerMasterForUser } from "../services/engineerAssignments";
import { recordTicketAssignmentLog, routeCustomerTicketByStateDistrict, refreshTicketLoadForAssignment } from "../services/ticketRouting";
import {
  ACTIVE_COMPLAINT_DUPLICATE_MESSAGE,
  CLOSED_COMPLAINT_STATUSES,
  ENGINEER_CAPACITY_MESSAGE,
  MAX_ACTIVE_SERVICE_TICKETS,
  MAX_WAITING_LOBBY_TICKETS,
  ONSITE_CAPACITY_MESSAGE,
  ACTIVE_TICKET_STATUSES,
  LOBBY_TICKET_STATUSES,
  HOLD_TICKET_STATUS,
  isActiveWorkComplaint,
  isClosedComplaintStatus,
  isOnHoldComplaint,
  isWaitingLobbyComplaint,
  normalizeComplaintSerialKey,
} from "../utils/complaintRules";
import { isValidEmailAddress, normalizeEmailAddress } from "../utils/validation";

const router: Router = express.Router();
const MAX_INVERTER_PICTURE_BYTES = 5 * 1024 * 1024;

const inverterPictureUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_INVERTER_PICTURE_BYTES },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) return cb(null, true);
    return cb(new multer.MulterError("LIMIT_UNEXPECTED_FILE", "picture"));
  },
});

function runInverterPictureUpload(req: Request, res: Response, next: NextFunction) {
  inverterPictureUpload.single("picture")(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      return fail(res, "Picture size must be 5 MB or less", 413);
    }
    if (err instanceof multer.MulterError && err.code === "LIMIT_UNEXPECTED_FILE") {
      return fail(res, "Only image files are allowed", 400);
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
] as const;

const DISTRICT_L1_ENGINEER_MAPPING = [
  { state: "Uttar Pradesh", district: "Ghaziabad", engineerEmail: "l1.piyush@avavbusiness.com", engineerName: "Piyush" },
  { state: "Uttar Pradesh", district: "Noida", engineerEmail: "l1.piyush@avavbusiness.com", engineerName: "Piyush" },
  { state: "Rajasthan", district: "Jaipur", engineerEmail: "l1.prashant.singh@avavbusiness.com", engineerName: "Prashant Singh" },
] as const;

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
} as const;
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

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function stripUndefinedFields<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined)
  ) as Partial<T>;
}

function normalizeSpareRequestParts(input: unknown): NonNullable<Complaint["spareParts"]> {
  if (!Array.isArray(input)) return [];
  return input
    .map((part, index) => {
      const materialName = normalizeText(part?.materialName ?? part?.name ?? part?.sparePartName ?? part?.partName);
      const quantity = Number(part?.quantity);
      if (!materialName || !Number.isFinite(quantity) || quantity <= 0) return null;
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
    .filter(Boolean) as NonNullable<Complaint["spareParts"]>;
}

function normalizeComplaintSpareParts(complaint: Complaint) {
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
  if (!spareName || !Number.isFinite(spareQuantity) || spareQuantity <= 0) return [];
  return [{
    id: `${complaint.id}-legacy-spare`,
    materialName: spareName,
    quantity: spareQuantity,
    notes: normalizeText(complaint.dispatchPlan) || undefined,
  }];
}

function complaintNeedsSpareApproval(complaint: Complaint) {
  const status = String(complaint.spareRequestStatus ?? "");
  return Boolean(complaint.spareRequired || normalizeComplaintSpareParts(complaint).length) && !["Approved", "Dispatched", "Delivered"].includes(status);
}

function complaintNeedsReplacementApproval(complaint: Complaint) {
  const approvalStatus = String(complaint.replacementApprovalStatus ?? "");
  return Boolean(complaint.replacementRecommended || normalizeText(complaint.replacementSerialNo)) && !["Approved", "Rejected"].includes(approvalStatus);
}

function normalizeLookup(value: unknown) {
  return normalizeText(value).toLowerCase().replace(/\s+/g, " ");
}

function mappedL1EngineerForDistrict(state: unknown, district: unknown) {
  const normalizedState = normalizeLookup(state);
  const normalizedDistrict = normalizeLookup(district);
  if (!normalizedState || !normalizedDistrict) return undefined;
  return DISTRICT_L1_ENGINEER_MAPPING.find((mapping) => (
    normalizeLookup(mapping.state) === normalizedState &&
    normalizeLookup(mapping.district) === normalizedDistrict
  ));
}

function mapRegion(input: unknown) {
  const text = normalizeText(input).toLowerCase();
  return SERVICE_REGIONS.find((region) => region.name.toLowerCase() === text || region.keywords.some((keyword) => text.includes(keyword))) ?? SERVICE_REGIONS[0];
}

function priorityRank(priority: string | undefined) {
  if (priority === "Emergency") return 0;
  if (priority === "High") return 1;
  if (priority === "Medium") return 2;
  return 3;
}

function activeQueueRank(status: string | undefined) {
  if (status === "In Progress at Aurawatt") return 0;
  if (status === "Assigned to Engineer") return 1;
  if (status === "Assigned for Onsite") return 2;
  if (status === "Escalated to L2") return 2;
  if (status === "Escalated to L3") return 3;
  if (status === "Pending L3 Approval") return 3;
  if (status === "Spare Requested") return 4;
  if (status === "Replacement Requested") return 4;
  if (status === "Awaiting Dispatch") return 5;
  if (status === "Dispatch in Progress") return 5;
  return 6;
}

function createWorkflowHistoryEvent(input: {
  action: string;
  fromStatus?: string;
  toStatus: string;
  user: AuthUser;
  note?: string;
}) {
  return {
    id: generateId(),
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

function isL1ServiceRole(role?: string) {
  return role === "L1 Engineer" || role === "Backup" || role === "L1 Backup Engineer";
}

function isOnsiteTicket(complaint: Pick<Complaint, "siteVisitRequired" | "status">) {
  return complaint.siteVisitRequired === true || complaint.status === "Assigned for Onsite";
}

function sortForL1Queue(rows: Complaint[]) {
  return [...rows].sort((a, b) => (
    activeQueueRank(a.status) - activeQueueRank(b.status) ||
    priorityRank(a.priority) - priorityRank(b.priority) ||
    new Date(a.slaDueAt ?? a.createdAt).getTime() - new Date(b.slaDueAt ?? b.createdAt).getTime()
  ));
}

function sortWaitingLobbyTickets(rows: Complaint[]) {
  return [...rows].sort((a, b) => (
    new Date(a.waitingSince ?? a.createdAt).getTime() - new Date(b.waitingSince ?? b.createdAt).getTime() ||
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() ||
    a.id.localeCompare(b.id)
  ));
}

function derivePriority(issueDescription: unknown, requestedPriority?: unknown) {
  const requested = normalizeText(requestedPriority);
  if (["Low", "Medium", "High", "Emergency"].includes(requested)) return requested as Complaint["priority"];

  const issue = normalizeText(issueDescription).toLowerCase();
  if (/(fire|burn|smell|commercial plant down|plant down|smoke)/.test(issue)) return "Emergency";
  if (/(shutdown|system down|not starting|dead|trip)/.test(issue)) return "High";
  if (/(export|battery|charging|hardware|spare)/.test(issue)) return "Medium";
  return "Low";
}

function slaHoursForLevel(level: ServiceLevel) {
  return level === "L1" ? 4 : 48;
}

function addHours(date: Date, hours: number) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function isL1InspectionValid(inspection: Complaint["l1Inspection"] | undefined) {
  if (!inspection) return false;
  const acRequired = ["l1L2Voltage", "l2L3Voltage", "l3L1Voltage", "l1NVoltage", "l2NVoltage", "l3NVoltage", "nEVoltage"];
  const dcRequired = ["string1PN", "string1PE", "string1NE", "totalStringCount"];
  const hasAc = acRequired.every((key) => Number.isFinite(Number(inspection.acReadings?.[key])));
  const hasDc = dcRequired.every((key) => Number.isFinite(Number(inspection.dcReadings?.[key])));
  return Boolean(inspection.errorCode && inspection.observationNotes && hasAc && hasDc);
}

type ServiceLevel = keyof typeof SERVICE_ROLE_BY_LEVEL;
type EngineerIdentity = {
  engineerId?: string;
  engineerName?: string;
};

function normalizeServiceLevel(value: unknown): ServiceLevel {
  const raw = normalizeText(value).toUpperCase();
  if (raw === "L2") return "L2";
  if (raw === "L3") return "L3";
  return "L1";
}

function engineerIdentityFilter(engineerId: string, engineerName?: string) {
  const or: Record<string, unknown>[] = [{ assignedEngineerId: engineerId }];
  if (engineerName) {
    or.push({ assignedEngineerName: engineerName });
  }
  return { $or: or };
}

async function currentEngineerAssignmentFilters(user: AuthUser, role: "L1" | "L2" | "L3" | "Backup") {
  const ownMaster = await findEngineerMasterForUser(user, role);
  const or: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  const add = (field: "assignedEngineerId" | "assignedEngineerName", value: unknown) => {
    const normalized = normalizeText(value);
    if (!normalized) return;
    const key = `${field}:${normalized}`;
    if (seen.has(key)) return;
    seen.add(key);
    or.push({ [field]: normalized });
  };

  add("assignedEngineerId", user.userId);
  add("assignedEngineerId", ownMaster?.id);
  add("assignedEngineerName", user.name);
  add("assignedEngineerName", ownMaster?.name);
  return or;
}

async function engineerTicketCounts(engineerId: string, engineerName?: string, excludeComplaintId?: string) {
  const c = await getCollections();
  // Backup-overflow tickets live in the engineer's dedicated "L1 Backup" queue and must not
  // eat into their own primary Active Work / Waiting Lobby capacity.
  const activeFilter: Record<string, unknown> = {
    ...engineerIdentityFilter(engineerId, engineerName),
    status: { $in: [...ACTIVE_TICKET_STATUSES] },
    assignmentType: { $ne: "Backup L1" },
  };
  const waitingFilter: Record<string, unknown> = {
    ...engineerIdentityFilter(engineerId, engineerName),
    assignmentStatus: "Waiting",
    status: { $in: [...LOBBY_TICKET_STATUSES] },
    assignmentType: { $ne: "Backup L1" },
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

/** Count of tickets currently sitting in this engineer's dedicated backup queue
 * (assignmentType "Backup L1"). Uncapped — used only for the activeTicketCountAtAssignment
 * metadata, independent of the engineer's own primary Active Work / Waiting Lobby load. */
async function backupTicketCount(engineerId: string, engineerName?: string, excludeComplaintId?: string) {
  const c = await getCollections();
  const filter: Record<string, unknown> = {
    ...engineerIdentityFilter(engineerId, engineerName),
    assignmentType: "Backup L1",
    status: { $nin: [...CLOSED_COMPLAINT_STATUSES] },
  };
  if (excludeComplaintId) filter.id = { $ne: excludeComplaintId };
  return c.complaints.countDocuments(filter);
}

function buildEngineerIdentityFilter(identities: EngineerIdentity[]) {
  const or: Record<string, unknown>[] = [];
  const seen = new Set<string>();
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

async function serviceEngineers(level?: ServiceLevel) {
  const c = await getCollections();
  const roles = level === "L1"
    ? ["L1", "Backup"] as const
    : level
      ? [level] as const
      : ["L1", "L2", "L3", "Backup"] as const;
  const users = await c.engineerMasters
    .find({ role: { $in: roles }, isActive: { $ne: false } }, { projection: { id: 1, name: 1, email: 1, role: 1 } })
    .sort({ name: 1 })
    .toArray();
  return users.map((user) => ({ id: user.id, name: user.name, email: user.email ?? "", role: user.role }));
}

async function buildServiceAssignment(input: {
  level: ServiceLevel;
  issueDescription: unknown;
  siteLocation?: unknown;
  region?: unknown;
  priority?: unknown;
  l1Sla?: unknown;
  forceAssign?: boolean;
  preferredEngineerId?: unknown;
  preferredEngineerName?: unknown;
  preferredEngineerEmail?: unknown;
  state?: unknown;
  district?: unknown;
  excludeComplaintId?: string;
}): Promise<Partial<Complaint> & { blockedMessage?: string }> {
  const regionConfig = input.region ? mapRegion(input.region) : mapRegion(input.siteLocation);
  const priority = derivePriority(input.issueDescription, input.priority);
  const now = new Date();
  const engineers = await serviceEngineers(input.level);

  const engineerStats = await Promise.all(
    engineers.map(async (engineer) => ({
      ...engineer,
      ...await engineerTicketCounts(engineer.id, engineer.name, input.excludeComplaintId),
    }))
  );

  const preferredId = normalizeText(input.preferredEngineerId);
  const preferredName = normalizeText(input.preferredEngineerName).toLowerCase();
  const preferredEmail = normalizeText(input.preferredEngineerEmail).toLowerCase();
  const districtAssignment = input.state && input.district ? await resolveAssignmentByStateDistrict(String(input.state), String(input.district)) : null;
  const allowPreferredOverride = Boolean(input.forceAssign) || !districtAssignment;
  const preferredEngineer = allowPreferredOverride
    ? (
        (preferredId ? engineerStats.find((item) => item.id === preferredId) : undefined) ??
        (preferredEmail ? engineerStats.find((item) => item.email.toLowerCase() === preferredEmail) : undefined) ??
        (preferredName ? engineerStats.find((item) => item.name.toLowerCase() === preferredName) : undefined)
      )
    : undefined;

  const districtPrimary = input.level === "L1"
    ? districtAssignment?.l1Engineer
    : input.level === "L2"
      ? districtAssignment?.l2Engineer
      : undefined;
  const districtBackup = input.level === "L1" ? districtAssignment?.backupEngineer : undefined;
  const slaHours = slaHoursForLevel(input.level);
  const statusByLevel: Record<ServiceLevel, Complaint["status"]> = {
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

  function assignmentForEngineer(engineer: { id: string; name: string; activeCount: number; waitingCount: number }) {
    if (engineer.activeCount < MAX_ACTIVE_SERVICE_TICKETS) {
      const shouldStartSla = input.level === "L2";
      return {
        assignedEngineerId: engineer.id,
        assignedEngineerName: engineer.name,
        activeTicketCountAtAssignment: engineer.activeCount,
        assignmentStatus: "Assigned" as const,
        waitingSince: undefined,
        slaStartedAt: shouldStartSla ? now : undefined,
        slaDueAt: shouldStartSla ? new Date(now.getTime() + slaHours * 60 * 60 * 1000) : undefined,
        slaPaused: !shouldStartSla,
        queuePosition: undefined,
        status: statusByLevel[input.level],
      };
    }
    if (engineer.waitingCount < MAX_WAITING_LOBBY_TICKETS) {
      return {
        assignedEngineerId: engineer.id,
        assignedEngineerName: engineer.name,
        waitingSince: now,
        assignmentStatus: "Waiting" as const,
        slaStartedAt: undefined,
        slaDueAt: undefined,
        slaPaused: true,
        queuePosition: engineer.waitingCount + 1,
        status: "Waiting Lobby" as Complaint["status"],
      };
    }
    return null;
  }

  let engineer = preferredEngineer ?? mappedPrimary ?? [...engineerStats].sort((a, b) => (
    a.activeCount - b.activeCount ||
    a.waitingCount - b.waitingCount ||
    a.name.localeCompare(b.name)
  ))[0];

  if (!engineer) {
    return { blockedMessage: ENGINEER_CAPACITY_MESSAGE };
  }

  if (mappedPrimary && !preferredEngineer && input.level === "L1") {
    const primaryAssignment = assignmentForEngineer(engineer);
    if (primaryAssignment) {
      return {
        region: regionConfig.name,
        priority,
        escalationLevel: input.level,
        backupEngineerName: mappedBackup?.name ?? districtBackup?.name,
        assignmentType: "Primary L1" as const,
        ...primaryAssignment,
      };
    }

    const backupEngineer = mappedBackup ?? [...engineerStats].find((candidate) => candidate.id !== engineer.id);
    if (!backupEngineer) {
      return { blockedMessage: ENGINEER_CAPACITY_MESSAGE };
    }
    // Backup tickets don't split into active/waiting like primary work does, and have no
    // capacity cap — they all land in the backup engineer's dedicated "L1 Backup" queue
    // (solved from there only, paginated), independent of that engineer's own primary
    // Active Work / Waiting Lobby load.
    const backupCount = await backupTicketCount(backupEngineer.id, backupEngineer.name, input.excludeComplaintId);
    return {
      region: regionConfig.name,
      priority,
      escalationLevel: input.level,
      backupEngineerName: backupEngineer.name,
      assignmentType: "Backup L1" as const,
      overflowFromEngineerId: engineer.id,
      overflowFromEngineerName: engineer.name,
      assignedEngineerId: backupEngineer.id,
      assignedEngineerName: backupEngineer.name,
      activeTicketCountAtAssignment: backupCount,
      assignmentStatus: "Assigned" as const,
      waitingSince: undefined,
      slaStartedAt: undefined,
      slaDueAt: undefined,
      slaPaused: true,
      queuePosition: undefined,
      status: statusByLevel[input.level],
    };
  }

  if (mappedPrimary && !preferredEngineer && input.level === "L2") {
    const primaryAssignment = assignmentForEngineer(mappedPrimary);
    if (!primaryAssignment) {
      return { blockedMessage: `Mapped L2 engineer ${districtPrimary?.name || "unknown"} is unavailable for ${regionConfig.name}. Please verify the complaint location or engineer mapping.` };
    }
    return {
      region: regionConfig.name,
      priority,
      escalationLevel: input.level,
      backupEngineerName: mappedBackup?.name ?? districtBackup?.name,
      assignmentType: "L2 Escalation" as const,
      ...primaryAssignment,
    };
  }

  if (!preferredEngineer && input.level === "L2") {
    return {
      blockedMessage: `No L2 mapping found for ${regionConfig.name}. Please verify the complaint location before escalating.`,
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
    blockedMessage: ENGINEER_CAPACITY_MESSAGE,
  };
}

async function buildAssignment(input: {
  issueDescription: unknown;
  siteLocation?: unknown;
  region?: unknown;
  priority?: unknown;
  l1Sla?: unknown;
  forceAssign?: boolean;
  preferredEngineerName?: unknown;
  state?: unknown;
  district?: unknown;
}): Promise<Partial<Complaint> & { blockedMessage?: string }> {
  return buildServiceAssignment({ ...input, level: "L1" });
}

async function releaseNextWaitingTicket(identities: EngineerIdentity[] = [], level?: ServiceLevel) {
  const c = await getCollections();
  const filter: Record<string, unknown> = { assignmentStatus: "Waiting", status: "Waiting Lobby" };
  if (level) filter.escalationLevel = level;
  const identityFilter = buildEngineerIdentityFilter(identities);
  if (identityFilter.length) {
    filter.$or = identityFilter;
  }
  while (true) {
    const waiting = sortWaitingLobbyTickets(await c.complaints.find(filter).toArray());
    if (!waiting.length) break;
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
    if (assignment.blockedMessage || assignment.assignmentStatus !== "Assigned") break;
    const promotedAt = new Date();
    const { waitingSince: _waitingSince, queuePosition: _queuePosition, ...assignmentSet } = assignment;
    await c.complaints.updateOne(
      { id: next.id },
      {
        $set: {
          ...assignmentSet,
          updatedAt: promotedAt,
        },
        $unset: { waitingSince: "", queuePosition: "" },
      }
    );
  }

  const remaining = sortWaitingLobbyTickets(await c.complaints.find(filter).toArray());
  await Promise.all(
    remaining.map((complaint, index) => c.complaints.updateOne(
      { id: complaint.id },
      { $set: { queuePosition: index + 1, updatedAt: new Date() } }
    ))
  );
}

/**
 * Like releaseNextWaitingTicket but excludes `excludeId` from the active count
 * so that exactly one slot appears free for the promotion check. Used after
 * manually starting SLA on a ticket so the active lobby auto-tops up to 5.
 */
async function releaseNextWaitingTicketExcluding(identities: EngineerIdentity[] = [], level?: ServiceLevel, excludeId?: string) {
  const c = await getCollections();
  const filter: Record<string, unknown> = { assignmentStatus: "Waiting", status: "Waiting Lobby" };
  if (level) filter.escalationLevel = level;
  const identityFilter = buildEngineerIdentityFilter(identities);
  if (identityFilter.length) {
    filter.$or = identityFilter;
  }

  // Promote at most one ticket (the SLA-start freed one slot).
  const waiting = sortWaitingLobbyTickets(await c.complaints.find(filter).toArray());
  if (!waiting.length) return;
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
    excludeComplaintId: excludeId ?? next.id,   // exclude the SLA-started ticket from count
    preferredEngineerId: next.assignedEngineerId,
    preferredEngineerName: next.assignedEngineerName,
    preferredEngineerEmail: next.assignedEngineerId,
  });
  if (!assignment.blockedMessage && assignment.assignmentStatus === "Assigned") {
    const promotedAt = new Date();
    const { waitingSince: _waitingSince, queuePosition: _queuePosition, ...assignmentSet } = assignment;
    await c.complaints.updateOne(
      { id: next.id },
      {
        $set: { ...assignmentSet, updatedAt: promotedAt },
        $unset: { waitingSince: "", queuePosition: "" },
      }
    );
  }

  // Renumber remaining waiting tickets.
  const remaining = sortWaitingLobbyTickets(await c.complaints.find(filter).toArray());
  await Promise.all(
    remaining.map((complaint, index) => c.complaints.updateOne(
      { id: complaint.id },
      { $set: { queuePosition: index + 1, updatedAt: new Date() } }
    ))
  );
}


async function rebalanceWaitingLobby() {
  const c = await getCollections();

  const waitingRows = await c.complaints
    .find(
      {
        assignmentStatus: "Waiting",
        status: "Waiting Lobby",
        $or: [
          { assignedEngineerId: { $type: "string" } },
          { assignedEngineerName: { $type: "string" } },
        ],
      },
      {
        projection: {
          assignedEngineerId: 1,
          assignedEngineerName: 1,
          escalationLevel: 1,
        },
      }
    )
    .sort({ waitingSince: 1, createdAt: 1, id: 1 })
    .toArray();

  const seen = new Set<string>();
  for (const complaint of waitingRows) {
    const engineerId = normalizeText(complaint.assignedEngineerId);
    const engineerName = normalizeText(complaint.assignedEngineerName);
    if (!engineerId && !engineerName) continue;
    const level = normalizeServiceLevel(complaint.escalationLevel);
    const key = `${level}:${engineerId || `name:${engineerName.toLowerCase()}`}`;
    if (seen.has(key)) continue;
    seen.add(key);
    await releaseNextWaitingTicket([{ engineerId: engineerId || undefined, engineerName: engineerName || undefined }], level);
  }
}

async function rebalanceL1Queue() {
  const c = await getCollections();
  const active = await c.complaints
    .find({
      type: "Consumer",
      status: { $in: ACTIVE_ENGINEER_STATUSES },
      $or: [{ escalationLevel: "L1" }, { escalationLevel: { $exists: false } }],
      // Backup-overflow tickets live in their own uncapped dedicated queue — don't let
      // this primary-capacity sweep demote them.
      assignmentType: { $ne: "Backup L1" },
    })
    .toArray();
  const byEngineer = new Map<string, Complaint[]>();
  for (const complaint of active) {
    if (!complaint.assignedEngineerId) continue;
    const rows = byEngineer.get(complaint.assignedEngineerId) ?? [];
    rows.push(complaint);
    byEngineer.set(complaint.assignedEngineerId, rows);
  }

  const now = new Date();
  const updates: Promise<unknown>[] = [];
  for (const [engineerId, rows] of byEngineer.entries()) {
    if (rows.length <= MAX_ACTIVE_SERVICE_TICKETS) continue;
    const engineerName = rows[0]?.assignedEngineerName;
    const waitingCount = await c.complaints.countDocuments({
      ...engineerIdentityFilter(engineerId, engineerName),
      assignmentStatus: "Waiting",
      status: "Waiting Lobby",
    });
    const overflow = sortForL1Queue(rows).slice(MAX_ACTIVE_SERVICE_TICKETS);
    overflow.forEach((complaint, index) => {
      updates.push(c.complaints.updateOne(
        { id: complaint.id },
        {
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
        }
      ));
    });
  }

  if (!updates.length) return;
  await Promise.all(updates);
}

let queueRebalanceInFlight: Promise<void> | null = null;

/**
 * rebalanceL1Queue/rebalanceWaitingLobby each do a full, sequential sweep of the
 * collection. GET /api/complaints runs this on every call, so closing several
 * tickets in quick succession (each triggering its own reload) used to fire that
 * many overlapping full sweeps concurrently, slowing/timing out the backend.
 * Collapse concurrent callers onto a single in-flight sweep instead.
 */
async function runQueueRebalance(): Promise<void> {
  if (!queueRebalanceInFlight) {
    queueRebalanceInFlight = (async () => {
      try {
        await rebalanceL1Queue();
        await rebalanceWaitingLobby();
      } finally {
        queueRebalanceInFlight = null;
      }
    })();
  }
  return queueRebalanceInFlight;
}

function requireComplaintTypeAccess(user: AuthUser, type: string): boolean {
  const t = (type || "").trim().toLowerCase();
  if (user.role === "Admin") return true;
  if (t === "consumer") return user.permissions.includes("complaints:consumer") || user.permissions.includes("dispatch:manage");
  if (t === "supplier") return user.permissions.includes("complaints:supplier");
  return user.permissions.includes("complaints:consumer") || user.permissions.includes("complaints:supplier");
}

async function complaintRoleScope(user: AuthUser): Promise<Record<string, unknown> | null> {
  if (user.role === "L1 Engineer") {
    // Assignment/reassignment always writes assignedEngineerId from the engineerMasters
    // directory (see buildServiceAssignment), never the real auth user id, and
    // assignedEngineerName is only reliable if it matches user.name byte-for-byte. Resolve
    // this engineer's own directory record so directory-id matching also works.
    const ownAssignmentFilters = await currentEngineerAssignmentFilters(user, "L1");
    return {
      $or: [
        ...ownAssignmentFilters,
        { status: "Assigned for Onsite", siteVisitEngineerId: user.userId },
        ...(user.name ? [{ status: "Assigned for Onsite", siteVisitEngineerName: user.name }] : []),
      ],
    };
  }

  if (user.role === "Backup") {
    const ownAssignmentFilters = await currentEngineerAssignmentFilters(user, "L1");
    return {
      $or: ownAssignmentFilters,
    };
  }

  if (user.role === "L2 Technical Team") {
    const team = await listL1TeamForL2(user);
    const teamNames = team.map((engineer) => engineer.name).filter(Boolean);
    return {
      $or: [
        { assignedEngineerId: user.userId },
        ...(user.name ? [{ assignedEngineerName: user.name }] : []),
        { siteVisitRequired: true, siteVisitEngineerId: user.userId },
        ...(user.name ? [{ siteVisitRequired: true, siteVisitEngineerName: user.name }] : []),
        { status: "Assigned for Onsite", siteVisitEngineerId: user.userId },
        ...(user.name ? [{ status: "Assigned for Onsite", siteVisitEngineerName: user.name }] : []),
        { assignmentStatus: "Waiting", status: "Waiting Lobby", escalationLevel: "L2" },
        ...(teamNames.length ? [{ type: "Consumer", assignedEngineerName: { $in: teamNames } }] : []),
      ],
    };
  }

  if (user.role === "L3 Advanced OEM Support") {
    return null;
  }

  return null;
}

function onsiteTrackingScope(user: AuthUser): Record<string, unknown> | null {
  if (user.role !== "L2 Technical Team") return null;
  const or: Record<string, unknown>[] = [{ siteVisitAssignedById: user.userId }];
  if (user.name) {
    or.push({ siteVisitAssignedByName: user.name });
  }
  return {
    siteVisitRequired: true,
    $or: or,
  };
}

async function applyComplaintRoleScope(filter: Record<string, unknown>, user: AuthUser) {
  const scope = await complaintRoleScope(user);
  return scope ? { $and: [filter, scope] } : filter;
}

async function canAccessComplaint(user: AuthUser, complaint: Complaint): Promise<boolean> {
  if (!requireComplaintTypeAccess(user, String(complaint.type))) return false;
  if (user.role === "L1 Engineer" || user.role === "Backup") {
    const ownAssignmentFilters = await currentEngineerAssignmentFilters(user, "L1");
    const ownMatch = (
      ownAssignmentFilters.some((filter) => (
        ("assignedEngineerId" in filter && complaint.assignedEngineerId === filter.assignedEngineerId) ||
        ("assignedEngineerName" in filter && complaint.assignedEngineerName === filter.assignedEngineerName)
      ))
    );
    if (user.role === "Backup") return ownMatch;
    return (
      ownMatch ||
      (complaint.status === "Assigned for Onsite" && (complaint.siteVisitEngineerId === user.userId || (Boolean(user.name) && complaint.siteVisitEngineerName === user.name)))
    );
  }
  if (user.role === "L2 Technical Team") {
    const ownMatch = (
      complaint.assignedEngineerId === user.userId ||
      (Boolean(user.name) && complaint.assignedEngineerName === user.name) ||
      (complaint.siteVisitRequired === true && complaint.siteVisitEngineerId === user.userId) ||
      (complaint.siteVisitRequired === true && Boolean(user.name) && complaint.siteVisitEngineerName === user.name) ||
      (complaint.status === "Assigned for Onsite" && (complaint.siteVisitEngineerId === user.userId || (Boolean(user.name) && complaint.siteVisitEngineerName === user.name))) ||
      (complaint.assignmentStatus === "Waiting" && complaint.status === "Waiting Lobby" && complaint.escalationLevel === "L2")
    );
    if (ownMatch) return true;
    if (complaint.type === "Consumer" && complaint.assignedEngineerName) {
      const team = await listL1TeamForL2(user);
      if (team.some((engineer) => engineer.name === complaint.assignedEngineerName)) return true;
    }
    return false;
  }
  if (user.role === "L3 Advanced OEM Support") {
    return true;
  }
  return true;
}

/** GET /api/complaints — filter by type, status */
router.get("/", authenticate, requireAnyPermission("complaints:consumer", "complaints:supplier", "dispatch:manage"), async (req: Request, res: Response) => {
  try {
    const c = await getCollections();
    const { type, status, page = "1", limit = "20", view } = req.query as Record<string, string>;
    const user = (req as any).user as AuthUser;
    if (type && !requireComplaintTypeAccess(user, type)) {
      return fail(res, "Access denied: insufficient permissions", 403);
    }
    if (!view && (!type || String(type).toLowerCase() === "consumer")) {
      await runQueueRebalance();
    }
    const filter: Record<string, unknown> = {};
    if (type) filter.type = type;
    if (status) filter.status = status;
    let scopedFilter: Record<string, unknown> | null;
    if (view === "onsite-tracking") {
      const scope = onsiteTrackingScope(user);
      scopedFilter = scope ? { $and: [filter, scope] } : null;
    } else {
      scopedFilter = await applyComplaintRoleScope(filter, user);
    }
    if (!scopedFilter) {
      return fail(res, "Access denied: insufficient permissions", 403);
    }

    const p = Math.max(1, parseInt(page));
    const l = Math.min(1000, parseInt(limit));
    const total = await c.complaints.countDocuments(scopedFilter);
    const data = await c.complaints.find(scopedFilter).skip((p - 1) * l).limit(l).toArray();
    return ok(res, { data, total, page: p, limit: l });
  } catch (err: any) {
    console.error("Failed to load complaints list:", err);
    return fail(res, err instanceof Error ? err.message : "Failed to load complaints", 500);
  }
});

/** GET /api/complaints/stats — for donut chart */
router.get("/stats", authenticate, requireAnyPermission("complaints:consumer", "complaints:supplier"), async (_req: Request, res: Response) => {
  const c = await getCollections();
  const statuses: Complaint["status"][] = [
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
  const stats = await Promise.all(
    statuses.map(async (s) => ({ status: s, count: await c.complaints.countDocuments({ status: s }) }))
  );
  return ok(res, stats);
});

/** GET /api/complaints/service-engineers — active L1/L2/L3 engineer accounts */
router.get("/service-engineers", authenticate, requireAnyPermission("complaints:consumer", "complaints:supplier"), async (_req: Request, res: Response) => {
  const engineers = await serviceEngineers();
  return ok(res, engineers);
});

/** GET /api/complaints/my-l1-team — L1 engineers reporting to the current L2 engineer (via district mapping) */
router.get("/my-l1-team", authenticate, requireAnyPermission("complaints:consumer", "complaints:supplier"), async (req: Request, res: Response) => {
  const user = (req as any).user as AuthUser;
  if (user.role !== "L2 Technical Team") return ok(res, []);
  const team = await listL1TeamForL2(user);
  return ok(res, team.map((engineer) => ({ id: engineer.id, name: engineer.name, role: engineer.role })));
});

/** POST /api/complaints/upload-inverter-picture — upload onsite inverter picture to Cloudinary */
router.post(
  "/upload-inverter-picture",
  authenticate,
  requireAnyPermission("complaints:consumer", "complaints:supplier"),
  runInverterPictureUpload,
  async (req: Request, res: Response) => {
    const file = req.file;
    if (!file) return fail(res, "Inverter picture is required");

    try {
      const uploaded = await uploadBufferToCloudinary(file, "aurawatt/complaint-inverter-pictures");
      if (!uploaded.url) return fail(res, "Cloudinary did not return a file URL", 502);
      return ok(
        res,
        {
          fileName: file.originalname,
          fileType: file.mimetype || undefined,
          fileSize: file.size,
          url: uploaded.url,
          publicId: uploaded.publicId,
          resourceType: uploaded.resourceType,
          format: uploaded.format,
          uploadedAt: new Date(),
        },
        201
      );
    } catch (err) {
      return fail(res, err instanceof Error ? err.message : "Failed to upload inverter picture", 502);
    }
  }
);

/** POST /api/complaints — raise a consumer or supplier complaint */
router.post("/", authenticate, requireAnyPermission("complaints:consumer", "complaints:supplier"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const {
    type,
    productSerialNo,
    customerName,
    rawMaterialId,
    rawMaterialName,
    vendorName,
    dateOfSale,
    dateOfComplaint,
    issueDescription,
    ticketSource,
    l1Sla,
    dealerName,
    siteLocation,
    region,
    state,
    district,
    priority,
    warrantyStatus,
    productModel,
    forceAssign,
    backupEngineerName,
    initialAction,
    trackingNotes,
    escalationLevel,
    l1Inspection,
    onsiteInspection,
    serviceStartedAt,
    progressUpdates,
    technicalDiagnosis,
    spareRequired,
    spareName,
    spareQuantity,
    spareDispatchAddress,
    spareParts,
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
    siteVisitRequestedAt,
    siteVisitRemarks,
    siteVisitSpareParts,
    siteVisitScheduledDate,
    siteVisitAssignedById,
    siteVisitAssignedByName,
    siteVisitAssignedByRole,
    engineerName,
    l3SupportRequired,
    replacementReason,
    replacementRemarks,
    replacementRequestImages,
    replacementRequestedById,
    replacementRequestedByName,
    replacementRequestedByRole,
    replacementRequestedAt,
    replacementApprovedById,
    replacementApprovedByName,
    replacementApprovedByRole,
    replacementApprovedAt,
    finalResolution,
    clientFeedback,
    closureReport,
    closeRemark,
    closedByName,
    closedByRole,
    closedAt,
  } = req.body;

  const mobileNumber = req.body.mobileNumber ?? req.body.customerPhone;
  const customerEmail = normalizeEmailAddress(req.body.customerEmail);
  const installationDate = req.body.installationDate ?? dateOfSale;
  const complaintState = req.body.state;
  const complaintDistrict = req.body.district;

  if (!type || !dateOfComplaint || !issueDescription) {
    return fail(res, "type, dateOfComplaint, issueDescription are required");
  }
  if (String(type).toLowerCase() === "consumer") {
    if (!customerName || !mobileNumber || !complaintState || !complaintDistrict) {
      return fail(res, "Customer name, mobile number, state and district are required");
    }
    if (customerEmail && !isValidEmailAddress(customerEmail)) {
      return fail(res, "Please enter a valid email address");
    }
  }

  const user = (req as any).user as AuthUser;
  if (user.role === "Sales") {
    return fail(res, "Access denied: insufficient permissions", 403);
  }
  if (!requireComplaintTypeAccess(user, String(type))) {
    return fail(res, "Access denied: insufficient permissions", 403);
  }

  const productSerialNoKey = normalizeComplaintSerialKey(productSerialNo);
  if (productSerialNoKey) {
    const activeDuplicate = await c.complaints.findOne({
      productSerialNoKey,
      status: { $nin: [...CLOSED_COMPLAINT_STATUSES] },
    });
    if (activeDuplicate) {
      return fail(res, ACTIVE_COMPLAINT_DUPLICATE_MESSAGE, 409);
    }
  }

  const l1InspectionValid = isL1InspectionValid(l1Inspection);
  if (["L2", "L3"].includes(String(escalationLevel ?? "")) && !l1InspectionValid) {
    return fail(res, "L1 inspection readings are mandatory before L2/L3 escalation");
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
      preferredEngineerName: forceAssign ? engineerName : undefined,
    })
    : undefined;
  if (assignment?.blockedMessage) {
    return fail(res, assignment.blockedMessage, 400);
  }
  const assignmentDecision = assignment && !("blockedMessage" in assignment) ? assignment : null;

  const complaintStatus = assignmentDecision?.status ?? "Open at Aurawatt";
  const ticketNumber = await generateTicketNumber();
  const complaint: Complaint = {
    id: generateId(),
    ticketNumber,
    type,
    productSerialNo,
    productSerialNoKey: isClosedComplaintStatus(complaintStatus) ? undefined : productSerialNoKey || undefined,
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
    assignmentType: assignmentDecision?.assignmentType,
    overflowFromEngineerId: assignmentDecision?.overflowFromEngineerId,
    overflowFromEngineerName: assignmentDecision?.overflowFromEngineerName,
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
    faultyReturnStatus: replacementApprovalStatus === "Pending" ? "Pending" : (spareRequestStatus === "Requested" ? "Pending" : undefined),
    faultyReturnType: replacementApprovalStatus === "Pending" ? "Inverter" : (spareRequestStatus === "Requested" ? "Spare Part" : undefined),
    faultyReturnItemId: replacementApprovalStatus === "Pending" && productSerialNo ? productSerialNo : (spareRequestStatus === "Requested" && spareParts && spareParts.length > 0 ? (spareParts as any)[0].rawMaterialId : undefined),
    status: complaintStatus as Complaint["status"],
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
    await recordTicketAssignmentLog({
      ticketId: complaint.id,
      customerName,
      mobileNumber: complaint.customerPhone ?? String(mobileNumber ?? ""),
      email: complaint.customerEmail,
      state: complaint.state ?? String(complaintState ?? ""),
      district: complaint.district ?? String(complaintDistrict ?? ""),
      assignedEngineerId: complaint.assignedEngineerId,
      assignedEngineerName: complaint.assignedEngineerName ?? "",
      assignmentType: (assignmentDecision as any).assignmentType || "Primary L1",
      assignmentReason: (assignmentDecision as any).assignmentReason || "Assigned via buildAssignment",
      activeTicketCountAtAssignment: (assignmentDecision as any).activeTicketCountAtAssignment || 0,
      lobbyTicketCountAtAssignment: (assignmentDecision as any).lobbyTicketCountAtAssignment || 0,
      totalTicketCountAtAssignment: (assignmentDecision as any).totalTicketCountAtAssignment || 0,
      assignmentStatus: (assignmentDecision as any).assignmentStatus || "Assigned",
      status: assignmentDecision.status || "Assigned to Engineer",
      createdBy: user.userId,
      lastUpdatedBy: user.userId,
      backupEngineerName: (assignmentDecision as any).backupEngineerName,
      slaStartedAt: assignmentDecision.slaStartedAt,
      slaDueAt: assignmentDecision.slaDueAt,
      slaPaused: assignmentDecision.slaPaused,
    });
    await refreshTicketLoadForAssignment(complaint.assignedEngineerId, complaint.assignedEngineerName);
  }
  return ok(res, complaint, 201);
});

/** POST /api/complaints/:id/start-sla — manually start SLA timer */
router.post(
  "/:id/start-sla",
  authenticate,
  requireAnyPermission("complaints:consumer", "complaints:supplier", "dispatch:manage"),
  async (req: Request, res: Response) => {
    const c = await getCollections();
    const id = req.params.id;
    const complaint = await c.complaints.findOne({ id });
    if (!complaint) return fail(res, "Complaint not found", 404);
    if (complaint.slaStartedAt) return fail(res, "SLA timer has already started for this complaint.", 400);
    // Only active-lobby tickets (assignmentStatus === "Assigned") can have SLA started.
    if (complaint.assignmentStatus === "Waiting" || complaint.status === "Waiting Lobby") {
      return fail(res, "SLA cannot be started for a Waiting Lobby ticket. It must first be promoted to Active.", 400);
    }

    const now = new Date();
    // Default to L1 (4 hours) if no escalation level is found.
    const level = (complaint.escalationLevel || "L1") as "L1" | "L2" | "L3";
    const slaHours = slaHoursForLevel(level);

    await c.complaints.updateOne(
      { id },
      {
        $set: {
          slaStartedAt: now,
          slaDueAt: addHours(now, slaHours),
          slaPaused: false,
          updatedAt: now,
        },
      }
    );

    // Auto-refill the active lobby: after SLA is started on this ticket,
    // promote the next waiting-lobby ticket so the active queue stays at 5.
    // We exclude this complaint from the active count so releaseNextWaitingTicket
    // sees one free slot and promotes exactly one waiting ticket.
    await releaseNextWaitingTicketExcluding(
      [{ engineerId: complaint.assignedEngineerId, engineerName: complaint.assignedEngineerName }],
      normalizeServiceLevel(complaint.escalationLevel),
      complaint.id
    );

    const updated = await c.complaints.findOne({ id });
    return ok(res, updated);
  }
);

/** PUT /api/complaints/:id/status — update complaint status */
router.put(
  "/:id/status",
  authenticate,
  requireAnyPermission("complaints:consumer", "complaints:supplier", "dispatch:manage"),
  async (req: Request, res: Response) => {
    const c = await getCollections();
    const id = req.params.id;
    const existing = await c.complaints.findOne({ id });
    if (!existing) return fail(res, "Complaint not found", 404);
    const user = (req as any).user as AuthUser;
    if (!(await canAccessComplaint(user, existing))) {
      return fail(res, "Access denied: insufficient permissions", 403);
    }
    const { status } = req.body;
    if (!status) return fail(res, "status is required");
    const updatedAt = new Date();
    const nextStatus = String(status);
    if (isL1ServiceRole(user.role) && isOnsiteTicket(existing) && isClosedComplaintStatus(nextStatus)) {
      return fail(res, "Onsite tickets assigned by L2 can only be closed by L2 after reviewing the onsite progress.", 403);
    }
    if (isL1ServiceRole(user.role) && isOnsiteTicket(existing) && (nextStatus === "Escalated to L2" || nextStatus === "Escalated to L3")) {
      return fail(res, "Use Updates done, progress sent to L2 for onsite tickets assigned by L2.", 403);
    }
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
    const statusUpdate: Record<string, unknown> = {
      status,
      updatedAt,
    };
    const nextSerialKey = isClosedComplaintStatus(nextStatus) ? undefined : normalizeComplaintSerialKey(existing.productSerialNo) || undefined;
    if (nextSerialKey) {
      statusUpdate.productSerialNoKey = nextSerialKey;
    }
    await c.complaints.updateOne(
      { id },
      {
        $set: statusUpdate,
        ...(isClosedComplaintStatus(nextStatus) ? { $unset: { productSerialNoKey: "" } } : {}),
        $push: { workflowHistory: event },
      }
    );
    if (isClosedComplaintStatus(nextStatus) && isActiveWorkComplaint(existing)) {
      await releaseNextWaitingTicket([
        { engineerId: existing.assignedEngineerId, engineerName: existing.assignedEngineerName },
        { engineerId: user.userId, engineerName: user.name },
      ], normalizeServiceLevel(existing.escalationLevel));
    }
    return ok(res, { ...existing, status, updatedAt });
  }
);

/**
 * PUT /api/complaints/:id/hold — park a blocked ticket.
 *
 * Real-world case: the customer is not at home, so the engineer cannot make
 * progress. A held ticket leaves the 5-active / 5-lobby capacity counters, which
 * frees a slot for the next waiting ticket instead of the engineer sitting
 * blocked at full capacity. SLA is paused because the delay is on the customer
 * side, and the remaining time is stored so resuming stays fair.
 */
router.put(
  "/:id/hold",
  authenticate,
  requireAnyPermission("complaints:consumer", "complaints:supplier"),
  async (req: Request, res: Response) => {
    const c = await getCollections();
    const id = req.params.id;
    const existing = await c.complaints.findOne({ id });
    if (!existing) return fail(res, "Complaint not found", 404);
    const user = (req as any).user as AuthUser;
    if (!(await canAccessComplaint(user, existing))) {
      return fail(res, "Access denied: insufficient permissions", 403);
    }

    const holdReason = normalizeText(req.body?.holdReason);
    if (!holdReason) return fail(res, "A hold reason is required");
    if (isOnHoldComplaint(existing)) return fail(res, "This ticket is already on hold");
    if (isClosedComplaintStatus(existing.status)) return fail(res, "A closed ticket cannot be put on hold");
    if (isWaitingLobbyComplaint(existing)) {
      return fail(res, "Waiting Lobby tickets cannot be held. Hold applies to active work only.");
    }

    const now = new Date();
    const slaRemainingMs = existing.slaDueAt
      ? Math.max(0, new Date(existing.slaDueAt).getTime() - now.getTime())
      : undefined;
    const event = createWorkflowHistoryEvent({
      action: "Ticket put on hold",
      fromStatus: existing.status,
      toStatus: HOLD_TICKET_STATUS,
      user,
      note: `Ticket put on hold. Reason: ${holdReason}`,
    });

    await c.complaints.updateOne(
      { id },
      {
        $set: {
          status: HOLD_TICKET_STATUS,
          statusBeforeHold: existing.status,
          holdReason,
          heldAt: now,
          heldById: user.userId,
          heldByName: user.name || user.email,
          slaPaused: true,
          ...(slaRemainingMs === undefined ? {} : { slaRemainingMsAtHold: slaRemainingMs }),
          updatedAt: now,
        },
        $unset: { slaDueAt: "" },
        $push: { workflowHistory: event },
      }
    );

    // The freed active slot should immediately pull the next waiting ticket in.
    if (isActiveWorkComplaint(existing)) {
      await releaseNextWaitingTicket([
        { engineerId: existing.assignedEngineerId, engineerName: existing.assignedEngineerName },
        { engineerId: user.userId, engineerName: user.name },
      ], normalizeServiceLevel(existing.escalationLevel));
    }
    if (existing.assignedEngineerId) {
      try {
        await refreshTicketLoadForAssignment(existing.assignedEngineerId, existing.assignedEngineerName);
      } catch (err) {
        console.warn("Failed to refresh engineer load after hold:", err instanceof Error ? err.message : String(err));
      }
    }

    return ok(res, { ...existing, status: HOLD_TICKET_STATUS, holdReason, heldAt: now, updatedAt: now });
  }
);

/**
 * PUT /api/complaints/:id/unhold — move a held ticket back into the work queue.
 *
 * Used when a ticket was held by mistake. If the engineer's active queue is
 * already full the ticket joins the waiting lobby rather than becoming a 6th
 * active ticket, so the capacity rule still holds.
 */
router.put(
  "/:id/unhold",
  authenticate,
  requireAnyPermission("complaints:consumer", "complaints:supplier"),
  async (req: Request, res: Response) => {
    const c = await getCollections();
    const id = req.params.id;
    const existing = await c.complaints.findOne({ id });
    if (!existing) return fail(res, "Complaint not found", 404);
    const user = (req as any).user as AuthUser;
    if (!(await canAccessComplaint(user, existing))) {
      return fail(res, "Access denied: insufficient permissions", 403);
    }
    if (!isOnHoldComplaint(existing)) return fail(res, "This ticket is not on hold");

    const now = new Date();
    const engineerId = normalizeText(existing.assignedEngineerId);
    const engineerName = normalizeText(existing.assignedEngineerName);
    const activeCount = await c.complaints.countDocuments({
      ...engineerIdentityFilter(engineerId, engineerName || undefined),
      status: { $in: [...ACTIVE_TICKET_STATUSES] },
      id: { $ne: String(id) },
    });
    const hasActiveSlot = activeCount < MAX_ACTIVE_SERVICE_TICKETS;

    const restoredStatus = hasActiveSlot
      ? ((existing.statusBeforeHold as Complaint["status"]) || "Assigned to Engineer")
      : ("Waiting Lobby" as Complaint["status"]);
    const event = createWorkflowHistoryEvent({
      action: "Hold released",
      fromStatus: HOLD_TICKET_STATUS,
      toStatus: restoredStatus,
      user,
      note: hasActiveSlot
        ? "Hold released; ticket moved back to active work."
        : "Hold released; active queue is full so the ticket joined the waiting lobby.",
    });

    const set: Record<string, unknown> = {
      status: restoredStatus,
      assignmentStatus: hasActiveSlot ? "Assigned" : "Waiting",
      slaPaused: !hasActiveSlot,
      updatedAt: now,
    };
    if (hasActiveSlot && existing.slaRemainingMsAtHold !== undefined) {
      set.slaDueAt = new Date(now.getTime() + existing.slaRemainingMsAtHold);
    }
    if (!hasActiveSlot) {
      set.waitingSince = existing.waitingSince ?? now;
    }

    await c.complaints.updateOne(
      { id },
      {
        $set: set,
        $unset: { holdReason: "", heldAt: "", heldById: "", heldByName: "", statusBeforeHold: "", slaRemainingMsAtHold: "" },
        $push: { workflowHistory: event },
      }
    );

    if (existing.assignedEngineerId) {
      try {
        await refreshTicketLoadForAssignment(existing.assignedEngineerId, existing.assignedEngineerName);
      } catch (err) {
        console.warn("Failed to refresh engineer load after unhold:", err instanceof Error ? err.message : String(err));
      }
    }

    return ok(res, { ...existing, status: restoredStatus, updatedAt: now });
  }
);

/** PUT /api/complaints/:id/service — update service workflow fields */
router.put(
  "/:id/service",
  authenticate,
  requireAnyPermission("complaints:consumer", "complaints:supplier", "dispatch:manage"),
  async (req: Request, res: Response) => {
    const c = await getCollections();
    const id = req.params.id;
    const existing = await c.complaints.findOne({ id });
    if (!existing) return fail(res, "Complaint not found", 404);
    const user = (req as any).user as AuthUser;
    if (!(await canAccessComplaint(user, existing))) {
      return fail(res, "Access denied: insufficient permissions", 403);
    }

    const returnOnsiteProgressToL2 = Boolean(req.body.returnOnsiteProgressToL2);
    const l1ActingOnOnsiteTicket = isL1ServiceRole(user.role) && isOnsiteTicket(existing);
    const requestedStatus = String(req.body.status ?? "");
    const requestedEscalationLevel = String(req.body.escalationLevel ?? "");
    if (l1ActingOnOnsiteTicket && isClosedComplaintStatus(requestedStatus)) {
      return fail(res, "Onsite tickets assigned by L2 can only be closed by L2 after reviewing the onsite progress.", 403);
    }
    if (
      l1ActingOnOnsiteTicket &&
      !returnOnsiteProgressToL2 &&
      (requestedStatus === "Escalated to L2" || requestedStatus === "Escalated to L3" || requestedEscalationLevel === "L2" || requestedEscalationLevel === "L3")
    ) {
      return fail(res, "Use Updates done, progress sent to L2 for onsite tickets assigned by L2.", 403);
    }

    const nextInspection = req.body.l1Inspection ?? existing.l1Inspection;
    const l1InspectionValid = isL1InspectionValid(nextInspection);
    const isStartWorkRequest = req.body.status === "In Progress at Aurawatt" || (("serviceStartedAt" in req.body) && req.body.serviceStartedAt);
    if (isStartWorkRequest && (existing.assignmentStatus === "Waiting" || existing.status === "Waiting Lobby" || existing.status === "Assigned for Onsite")) {
      return fail(res, "Waiting Lobby tickets are queue only. Work can only be started from Active Work tickets.", 400);
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
      "faultyReturnStatus",
      "faultyReturnNotes",
      "faultyReturnType",
      "faultyReturnItemId",
    ] as const;

    const serverNow = new Date();
    const update: Record<string, unknown> = { updatedAt: serverNow, l1InspectionValid };
    const workflowHistory: NonNullable<Complaint["workflowHistory"]> = [];
    const extraNotifications: Notification[] = [];
    const siteVisitActive = Boolean(req.body.siteVisitRequired ?? existing.siteVisitRequired);
    for (const field of allowedFields) {
      if (field in req.body) update[field] = req.body[field];
    }
    if ("spareParts" in req.body) {
      update.spareParts = normalizeSpareRequestParts(req.body.spareParts);
    }
    if ("productSerialNo" in req.body) {
      const requestedProductSerialNo = normalizeText(req.body.productSerialNo);
      if (requestedProductSerialNo) {
        const requestedSerialKey = normalizeComplaintSerialKey(requestedProductSerialNo);
        const activeDuplicateFilter = {
          id: { $ne: id },
          productSerialNoKey: requestedSerialKey,
          status: { $nin: [...CLOSED_COMPLAINT_STATUSES] },
        } as any;
        const activeDuplicate = await c.complaints.findOne(activeDuplicateFilter);
        if (activeDuplicate) {
          return fail(res, ACTIVE_COMPLAINT_DUPLICATE_MESSAGE, 409);
        }
        update.productSerialNo = requestedProductSerialNo;
      } else {
        update.productSerialNo = "";
      }
    }

    if ((req.body.status === "In Progress at Aurawatt" || ("serviceStartedAt" in req.body && req.body.serviceStartedAt)) && !existing.serviceStartedAt) {
      update.serviceStartedAt = serverNow;
      if (siteVisitActive && !existing.siteVisitAcceptedAt) {
        update.siteVisitAcceptedAt = serverNow;
      }
    } else {
      delete update.serviceStartedAt;
    }
    if (Array.isArray(req.body.progressUpdates)) {
      update.progressUpdates = req.body.progressUpdates.map((item: any) => ({
        ...item,
        date: item?.date ? new Date(item.date) : new Date(),
        createdAt: item?.createdAt ? new Date(item.createdAt) : new Date(),
      }));
    }
    if (CLOSED_COMPLAINT_STATUSES.includes(String(req.body.status) as (typeof CLOSED_COMPLAINT_STATUSES)[number])) {
      update.closedAt = serverNow;
      // Once a ticket is closed the SLA clock must stop for good — freeze the timer at
      // close time so no consumer keeps counting the ticket as a live/overdue SLA.
      update.slaPaused = true;
      if (siteVisitActive && !existing.siteVisitCompletedAt) {
        update.siteVisitCompletedAt = serverNow;
      }
    } else {
      delete update.closedAt;
    }
    if ("installationDate" in req.body && req.body.installationDate) update.installationDate = new Date(req.body.installationDate);
    if ("siteVisitScheduledDate" in req.body && req.body.siteVisitScheduledDate) update.siteVisitScheduledDate = new Date(req.body.siteVisitScheduledDate);

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
        forceAssign: true,
      });
      if (assignment.blockedMessage) {
        return fail(res, assignment.blockedMessage, 400);
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
      if (user.role === "L2 Technical Team" && level !== "L1") {
        return fail(res, "L2 engineers can only reassign tickets to L1 engineers.", 403);
      }
      // L2 can reassign to any L1 engineer, not just the ones mapped to their own
      // district team — the team mapping only scopes which tickets an L2 sees.
      const candidates = await serviceEngineers(level);
      const target = candidates.find((candidate) => candidate.id === requestedAssignToId);
      if (!target) return fail(res, "Selected engineer not found", 404);
      const counts = await engineerTicketCounts(target.id, target.name, existing.id);
      if (counts.activeCount >= MAX_ACTIVE_SERVICE_TICKETS && counts.waitingCount >= MAX_WAITING_LOBBY_TICKETS) {
        return fail(res, ENGINEER_CAPACITY_MESSAGE, 400);
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
        // Manually picking a specific engineer is an explicit override; without
        // forceAssign, buildServiceAssignment ignores preferredEngineer* whenever a
        // district mapping exists and silently reassigns back to the mapped engineer.
        forceAssign: true,
        preferredEngineerId: target.id,
        preferredEngineerName: target.name,
        preferredEngineerEmail: target.email,
        excludeComplaintId: existing.id,
      });
      if (assignment.blockedMessage) {
        return fail(res, assignment.blockedMessage, 400);
      }
      Object.assign(update, assignment);
      if (assignment.assignmentStatus === "Waiting") {
        if (level === "L2" && !req.body.status) {
          update.status = "Waiting Lobby";
        } else if (level === "L3" && !req.body.status) {
          update.status = "Waiting Lobby";
        }
      }
      workflowHistory.push(createWorkflowHistoryEvent({
        action: "Reassigned ticket",
        fromStatus: existing.status,
        toStatus: String(update.status ?? existing.status),
        user,
        note: `${user.role === "L2 Technical Team" ? "L2" : "L3"} reassigned ticket from ${existing.assignedEngineerName || "unassigned"} to ${target.name} (${target.role}).`,
      }));
    } else {
      const targetLevel =
        req.body.status === "Escalated to L2" || req.body.escalationLevel === "L2"
          ? "L2"
          : req.body.status === "Escalated to L3" || req.body.escalationLevel === "L3"
            ? "L3"
            : undefined;
      if (targetLevel && !CLOSED_COMPLAINT_STATUSES.includes(String(update.status) as (typeof CLOSED_COMPLAINT_STATUSES)[number])) {
        const assignment = await buildServiceAssignment({
          level: targetLevel,
          issueDescription: req.body.issueDescription ?? existing.issueDescription,
          siteLocation: req.body.siteLocation ?? existing.siteLocation,
          region: req.body.region ?? existing.region,
          state: req.body.state ?? existing.state,
          district: req.body.district ?? existing.district,
          priority: req.body.priority ?? existing.priority,
          l1Sla: existing.l1Sla,
          preferredEngineerId: req.body.preferredEngineerId,
          preferredEngineerName: req.body.preferredEngineerName,
          forceAssign: Boolean(req.body.forceAssign),
          excludeComplaintId: existing.id,
        });
        if (assignment.blockedMessage) {
          return fail(res, assignment.blockedMessage, 400);
        }
        Object.assign(update, assignment);
      }
    }

    if (returnOnsiteProgressToL2) {
      if (!l1ActingOnOnsiteTicket) {
        return fail(res, "Only the onsite L1 engineer can send onsite progress back to L2.", 403);
      }
      const targetL2Id = normalizeText(existing.siteVisitRequestedById ?? existing.siteVisitAssignedById);
      const targetL2Name = normalizeText(existing.siteVisitRequestedByName ?? existing.siteVisitAssignedByName);
      if (!targetL2Id && !targetL2Name) {
        return fail(res, "Original L2 requester not found for this onsite ticket.", 400);
      }
      const actor = user.name || user.email || "Onsite engineer";
      const returnNote = normalizeText(req.body.onsiteProgressReturnNote) ||
        `Onsite progress submitted by ${actor}; ticket returned to L2 for review and closure.`;

      update.status = "Escalated to L2";
      update.escalationLevel = "L2";
      update.assignmentStatus = "Assigned";
      update.assignedEngineerId = targetL2Id || undefined;
      update.assignedEngineerName = targetL2Name || undefined;
      update.engineerName = targetL2Name || undefined;
      update.escalatedById = user.userId;
      update.escalatedByName = user.name || user.email;
      update.escalatedByRole = user.role;
      update.escalatedAt = serverNow;
      update.siteVisitCompletedAt = existing.siteVisitCompletedAt ?? serverNow;
      update.slaStartedAt = existing.slaStartedAt ?? serverNow;
      update.slaDueAt = existing.slaDueAt ?? new Date(serverNow.getTime() + slaHoursForLevel("L2") * 60 * 60 * 1000);
      update.slaPaused = false;
      update.waitingSince = undefined;
      update.queuePosition = undefined;

      workflowHistory.push(createWorkflowHistoryEvent({
        action: "Onsite progress sent to L2",
        fromStatus: existing.status,
        toStatus: "Escalated to L2",
        user,
        note: returnNote,
      }));
      if (targetL2Id) {
        extraNotifications.push({
          id: generateId(),
          type: "complaint_workflow_updated",
          title: "Onsite progress sent to L2",
          body: `${existing.productSerialNo || "No serial"} onsite progress submitted by ${actor}. Review and close the ticket.`,
          entityType: "complaint",
          entityId: existing.id,
          meta: {
            status: "Escalated to L2",
            onsiteEngineerName: existing.siteVisitEngineerName || existing.engineerName,
            siteVisitCompletedAt: update.siteVisitCompletedAt,
          },
          audienceUserIds: [targetL2Id],
          readBy: [],
          createdBy: user.userId,
          createdAt: serverNow,
        });
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
        return fail(res, "Onsite engineer selection is required", 400);
      }
      const onsiteCounts = await engineerTicketCounts(onsiteEngineerId || onsiteEngineerName, onsiteEngineerName, existing.id);
      if (onsiteCounts.activeCount >= MAX_ACTIVE_SERVICE_TICKETS) {
        return fail(res, ONSITE_CAPACITY_MESSAGE, 400);
      }

      const sparePartsInput = Array.isArray(req.body.siteVisitSpareParts) ? req.body.siteVisitSpareParts : [];
      const onsiteSpareParts = sparePartsInput
        .map((part: any, index: number) => {
          const name = normalizeText(part?.name ?? part?.sparePartName ?? part?.partName);
          const quantity = Number(part?.quantity);
          if (!name || !Number.isFinite(quantity) || quantity <= 0) return null;
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
      update.siteVisitSpareParts = onsiteSpareParts as Complaint["siteVisitSpareParts"];
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
          id: generateId(),
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
        id: generateId(),
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
        id: generateId(),
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

    const isClosed = isClosedComplaintStatus(desiredStatus);
    const effectiveProductSerialNo = normalizeText(update.productSerialNo ?? existing.productSerialNo);
    const nextSerialKey = isClosed ? undefined : normalizeComplaintSerialKey(effectiveProductSerialNo) || undefined;
    const nextStatus = String(update.status ?? existing.status);
    const nextReplacementSerial = normalizeText(update.replacementSerialNo ?? existing.replacementSerialNo);
    if (nextStatus === "Dispatch in Progress" && effectiveProductSerialNo) {
      const originalSerial = await c.serials.findOne({ serialNumber: effectiveProductSerialNo }, { projection: { id: 1 } });
      if (!originalSerial) {
        return fail(res, "Original serial not found for replacement claim", 404);
      }
      if (nextReplacementSerial) {
        const replacementSerial = await c.serials.findOne({ serialNumber: nextReplacementSerial }, { projection: { id: 1 } });
        if (!replacementSerial) {
          return fail(res, "Replacement serial not found in serial pool", 404);
        }
      }
    }
    if (update.replacementApprovalStatus === "Pending" && (existing.replacementApprovalStatus !== "Pending" || !existing.faultyReturnStatus)) {
      update.faultyReturnStatus = "Pending";
      update.faultyReturnType = "Inverter";
      if (existing.productSerialNo) {
        update.faultyReturnItemId = existing.productSerialNo;
      }
    }

    if (update.spareRequestStatus === "Requested" && (existing.spareRequestStatus !== "Requested" || !existing.faultyReturnStatus)) {
      update.faultyReturnStatus = "Pending";
      update.faultyReturnType = "Spare Part";
      if (update.spareParts && Array.isArray(update.spareParts) && update.spareParts.length > 0) {
        update.faultyReturnItemId = (update.spareParts as any)[0].rawMaterialId;
      } else if (existing.spareParts && existing.spareParts.length > 0) {
        update.faultyReturnItemId = existing.spareParts[0].rawMaterialId;
      }
    }

    const setDoc: Record<string, unknown> = stripUndefinedFields({ ...update });
    // Fields explicitly set to `undefined` above (e.g. slaDueAt/slaStartedAt on a fresh
    // reassignment) are meant to be cleared, not left untouched — $set silently ignores
    // undefined values, so those clears must go through $unset instead.
    const unsetDoc: Record<string, ""> = {};
    for (const [key, value] of Object.entries(update)) {
      if (value === undefined) unsetDoc[key] = "";
    }
    if (nextSerialKey) {
      setDoc.productSerialNoKey = nextSerialKey;
    }
    const updateDoc: Record<string, unknown> = workflowHistory.length
      ? { $set: setDoc, $push: { workflowHistory: { $each: workflowHistory } } }
      : { $set: setDoc };
    if (Object.keys(unsetDoc).length) {
      updateDoc.$unset = { ...(updateDoc.$unset as Record<string, string> | undefined), ...unsetDoc };
    }
    if (isClosed) {
      updateDoc.$unset = { ...(updateDoc.$unset as Record<string, string> | undefined), productSerialNoKey: "" };
    }

    await c.complaints.updateOne({ id }, updateDoc as any);
    if (nextStatus === "Dispatch in Progress" && effectiveProductSerialNo) {
      await updateSerialStatus(c, {
        serialNumber: effectiveProductSerialNo,
        status: "Replacement Claimed",
      });
      if (nextReplacementSerial) {
        await updateSerialStatus(c, {
          serialNumber: nextReplacementSerial,
          status: "Dispatched",
        });
      }
    }

    if (isClosed && isActiveWorkComplaint(existing)) {
      try {
        await releaseNextWaitingTicket([
          { engineerId: existing.assignedEngineerId, engineerName: existing.assignedEngineerName },
          { engineerId: user.userId, engineerName: user.name },
        ], normalizeServiceLevel(existing.escalationLevel));
      } catch (err) {
        console.warn("Failed to release next waiting ticket from service close:", err instanceof Error ? err.message : String(err));
      }
    }

    for (const notification of extraNotifications) {
      try {
        await c.notifications.insertOne(notification);
      } catch (err) {
        console.warn("Failed to insert workflow notification:", err instanceof Error ? err.message : String(err));
      }
    }

    const updated = await c.complaints.findOne({ id });
    if (updated && req.body.notifyAdminOnCompletion && CLOSED_COMPLAINT_STATUSES.includes(String(update.status) as (typeof CLOSED_COMPLAINT_STATUSES)[number])) {
      try {
        const notification: Notification = {
          id: generateId(),
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
          const onsiteNotification: Notification = {
            id: generateId(),
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
      } catch (err) {
        console.warn("Failed to insert complaint completion notification:", err instanceof Error ? err.message : String(err));
      }
    }
    return ok(res, updated);
  }
);

export default router;
