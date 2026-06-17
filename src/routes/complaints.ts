import express, { type NextFunction, type Request, type Response, type Router } from "express";
import multer from "multer";

import { getCollections } from "../db/collections";
import { authenticate, requireAnyPermission } from "../middleware/auth";
import type { AuthUser, Complaint, Notification } from "../types";
import { uploadBufferToCloudinary } from "../utils/cloudinary";
import { fail, ok } from "../utils/http";
import { generateId } from "../utils/id";

const router: Router = express.Router();
const MAX_ACTIVE_L1_TICKETS = 5;
const MAX_ACTIVE_SERVICE_TICKETS = 5;
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
] as const;

const DISTRICT_L1_ENGINEER_MAPPING = [
  { state: "Uttar Pradesh", district: "Ghaziabad", engineerEmail: "l1.rahul@avavbusiness.com", engineerName: "Rahul Sharma" },
  { state: "Uttar Pradesh", district: "Noida", engineerEmail: "l1.aman@avavbusiness.com", engineerName: "Aman Singh" },
  { state: "Rajasthan", district: "Jaipur", engineerEmail: "l1.deepak.verma@avavbusiness.com", engineerName: "Deepak Verma" },
] as const;

const ACTIVE_ENGINEER_STATUSES = [
  "Assigned to Engineer",
  "In Progress at Aurawatt",
  "Escalated to L2",
  "Escalated to L3",
  "Spare Requested",
  "Dispatch in Progress",
];

const CLOSED_STATUSES = ["Resolved by Aurawatt", "Resolved by Suppliers"];
const SERVICE_ROLE_BY_LEVEL = {
  L1: "L1 Engineer",
  L2: "L2 Technical Team",
  L3: "L3 Advanced OEM Support",
} as const;
const ASSIGNABLE_SERVICE_ENGINEER_EMAILS = new Set([
  "l1.rohit@avavbusiness.com",
  "l1.amit@avavbusiness.com",
  "l1.rahul@avavbusiness.com",
  "l1.aman@avavbusiness.com",
  "l1.deepak.verma@avavbusiness.com",
  "l2.vikas@avavbusiness.com",
  "l2.sandeep@avavbusiness.com",
  "l3.mahesh@avavbusiness.com",
  "l3.deepak@avavbusiness.com",
]);

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
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
  if (status === "Escalated to L2") return 2;
  if (status === "Escalated to L3") return 3;
  if (status === "Spare Requested") return 4;
  if (status === "Dispatch in Progress") return 5;
  return 6;
}

function sortForL1Queue(rows: Complaint[]) {
  return [...rows].sort((a, b) => (
    activeQueueRank(a.status) - activeQueueRank(b.status) ||
    priorityRank(a.priority) - priorityRank(b.priority) ||
    new Date(a.slaDueAt ?? a.createdAt).getTime() - new Date(b.slaDueAt ?? b.createdAt).getTime()
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

function parseSlaHours(l1Sla: unknown, priority: Complaint["priority"]) {
  if (priority === "Emergency") return 2;
  const hours = parseInt(normalizeText(l1Sla), 10);
  return Number.isFinite(hours) && hours > 0 ? hours : 4;
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

function normalizeServiceLevel(value: unknown): ServiceLevel {
  const raw = normalizeText(value).toUpperCase();
  if (raw === "L2") return "L2";
  if (raw === "L3") return "L3";
  return "L1";
}

async function activeTicketCountForEngineer(engineerId: string, excludeComplaintId?: string) {
  const c = await getCollections();
  const filter: Record<string, unknown> = {
    assignedEngineerId: engineerId,
    status: { $in: ACTIVE_ENGINEER_STATUSES },
  };
  if (excludeComplaintId) filter.id = { $ne: excludeComplaintId };
  return c.complaints.countDocuments(filter);
}

async function serviceEngineers(level?: ServiceLevel) {
  const c = await getCollections();
  const roles = level
    ? [SERVICE_ROLE_BY_LEVEL[level]]
    : Object.values(SERVICE_ROLE_BY_LEVEL);
  const users = await c.users
    .find({ role: { $in: roles }, email: { $in: [...ASSIGNABLE_SERVICE_ENGINEER_EMAILS] }, isActive: { $ne: false } }, { projection: { id: 1, name: 1, email: 1, role: 1 } })
    .sort({ name: 1 })
    .toArray();
  return users.map((user) => ({ id: user.id, name: user.name, email: user.email, role: user.role }));
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
}) {
  const c = await getCollections();
  const regionConfig = input.region ? mapRegion(input.region) : mapRegion(input.siteLocation);
  const priority = derivePriority(input.issueDescription, input.priority);
  const now = new Date();
  const engineers = await serviceEngineers(input.level);

  const engineerStats = await Promise.all(
    engineers.map(async (engineer) => ({
      ...engineer,
      activeCount: await activeTicketCountForEngineer(engineer.id, input.excludeComplaintId),
    }))
  );

  const preferredId = normalizeText(input.preferredEngineerId);
  const preferredName = normalizeText(input.preferredEngineerName).toLowerCase();
  const preferredEmail = normalizeText(input.preferredEngineerEmail).toLowerCase();
  const districtEngineer = input.level === "L1" ? mappedL1EngineerForDistrict(input.state, input.district) : undefined;
  const preferredEngineer =
    (preferredId ? engineerStats.find((item) => item.id === preferredId) : undefined) ??
    (preferredEmail ? engineerStats.find((item) => item.email.toLowerCase() === preferredEmail) : undefined) ??
    (preferredName ? engineerStats.find((item) => item.name.toLowerCase() === preferredName) : undefined);
  const mappedEngineer = districtEngineer
    ? engineerStats.find((item) => item.email.toLowerCase() === districtEngineer.engineerEmail.toLowerCase() || item.name.toLowerCase() === districtEngineer.engineerName.toLowerCase())
    : undefined;
  const engineer = preferredEngineer ?? mappedEngineer ?? [...engineerStats].sort((a, b) => a.activeCount - b.activeCount || a.name.localeCompare(b.name))[0];
  const canAssign = Boolean(engineer) && (input.forceAssign || (engineer?.activeCount ?? 0) < MAX_ACTIVE_SERVICE_TICKETS);

  if (!canAssign || !engineer) {
    const queuePosition = (await c.complaints.countDocuments({
      type: "Consumer",
      assignmentStatus: "Waiting",
      escalationLevel: input.level,
      status: "Waiting Lobby",
    })) + 1;
    return {
      region: regionConfig.name,
      priority,
      escalationLevel: input.level,
      assignmentStatus: "Waiting" as const,
      waitingSince: now,
      slaPaused: true,
      queuePosition,
      status: "Waiting Lobby" as Complaint["status"],
      assignedEngineerId: undefined,
      assignedEngineerName: undefined,
    };
  }

  const slaHours = parseSlaHours(input.l1Sla, priority);
  const statusByLevel: Record<ServiceLevel, Complaint["status"]> = {
    L1: "Assigned to Engineer",
    L2: "Escalated to L2",
    L3: "Escalated to L3",
  };

  return {
    region: regionConfig.name,
    priority,
    escalationLevel: input.level,
    assignmentStatus: "Assigned" as const,
    assignedEngineerId: engineer.id,
    assignedEngineerName: engineer.name,
    backupEngineerName: engineerStats.find((candidate) => candidate.id !== engineer.id)?.name,
    activeTicketCountAtAssignment: engineer.activeCount,
    slaStartedAt: now,
    slaDueAt: addHours(now, slaHours),
    slaPaused: false,
    queuePosition: undefined,
    status: statusByLevel[input.level],
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
}) {
  return buildServiceAssignment({ ...input, level: "L1" });
}

async function releaseNextWaitingTicket(region?: string) {
  const c = await getCollections();
  const filter: Record<string, unknown> = { assignmentStatus: "Waiting", status: "Waiting Lobby" };
  if (region) filter.region = region;
  const waiting = await c.complaints
    .find(filter)
    .toArray();
  const next = waiting
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || new Date(a.waitingSince ?? a.createdAt).getTime() - new Date(b.waitingSince ?? b.createdAt).getTime())[0];
  if (!next) return;
  const level = normalizeServiceLevel(next.escalationLevel);
  const assignment = await buildServiceAssignment({
    level,
    issueDescription: next.issueDescription,
    siteLocation: next.siteLocation,
    region: next.region,
    state: next.state,
    district: next.district,
    priority: next.priority,
    l1Sla: next.l1Sla,
    excludeComplaintId: next.id,
  });
  if (assignment.assignmentStatus !== "Assigned") return;
  await c.complaints.updateOne(
    { id: next.id },
    {
      $set: {
        ...assignment,
        updatedAt: new Date(),
      },
      $unset: { waitingSince: "", queuePosition: "" },
    }
  );
}

async function rebalanceL1Queue() {
  const c = await getCollections();
  const active = await c.complaints
    .find({
      type: "Consumer",
      status: { $in: ACTIVE_ENGINEER_STATUSES },
      $or: [{ escalationLevel: "L1" }, { escalationLevel: { $exists: false } }],
    })
    .toArray();
  const byEngineer = new Map<string, Complaint[]>();
  for (const complaint of active) {
    if (!complaint.assignedEngineerId) continue;
    const rows = byEngineer.get(complaint.assignedEngineerId) ?? [];
    rows.push(complaint);
    byEngineer.set(complaint.assignedEngineerId, rows);
  }

  const overflow = [...byEngineer.values()].flatMap((rows) => (
    rows.length > MAX_ACTIVE_L1_TICKETS ? sortForL1Queue(rows).slice(MAX_ACTIVE_L1_TICKETS) : []
  ));
  if (!overflow.length) return;

  const waitingCount = await c.complaints.countDocuments({ type: "Consumer", assignmentStatus: "Waiting", status: "Waiting Lobby" });
  const now = new Date();

  await Promise.all(
    overflow.map((complaint, index) => c.complaints.updateOne(
      { id: complaint.id },
      {
        $set: {
          assignmentStatus: "Waiting",
          status: "Waiting Lobby",
          waitingSince: complaint.waitingSince ?? now,
          slaPaused: true,
          queuePosition: waitingCount + index + 1,
          updatedAt: now,
        },
        $unset: {
          assignedEngineerId: "",
          assignedEngineerName: "",
          slaStartedAt: "",
          slaDueAt: "",
        },
      }
    ))
  );
}

function requireComplaintTypeAccess(user: AuthUser, type: string): boolean {
  const t = (type || "").trim().toLowerCase();
  if (user.role === "Admin") return true;
  if (t === "consumer") return user.permissions.includes("complaints:consumer") || user.permissions.includes("dispatch:manage");
  if (t === "supplier") return user.permissions.includes("complaints:supplier");
  return user.permissions.includes("complaints:consumer") || user.permissions.includes("complaints:supplier");
}

function complaintRoleScope(user: AuthUser): Record<string, unknown> | null {
  if (user.role === "L1 Engineer") {
    return {
      $or: [
        { assignedEngineerId: user.userId },
        ...(user.name ? [{ assignedEngineerName: user.name }] : []),
        { siteVisitRequired: true, siteVisitEngineerId: user.userId },
        ...(user.name ? [{ siteVisitRequired: true, engineerName: user.name }] : []),
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
        ...(user.name ? [{ siteVisitRequired: true, engineerName: user.name }] : []),
        { assignmentStatus: "Waiting", status: "Waiting Lobby", escalationLevel: "L2" },
      ],
    };
  }

  if (user.role === "L3 Advanced OEM Support") {
    return null;
  }

  return null;
}

function applyComplaintRoleScope(filter: Record<string, unknown>, user: AuthUser) {
  const scope = complaintRoleScope(user);
  return scope ? { $and: [filter, scope] } : filter;
}

function canAccessComplaint(user: AuthUser, complaint: Complaint): boolean {
  if (!requireComplaintTypeAccess(user, String(complaint.type))) return false;
  if (user.role === "L1 Engineer") {
    return (
      complaint.assignedEngineerId === user.userId ||
      (Boolean(user.name) && complaint.assignedEngineerName === user.name) ||
      (complaint.siteVisitRequired === true && complaint.siteVisitEngineerId === user.userId) ||
      (complaint.siteVisitRequired === true && Boolean(user.name) && complaint.engineerName === user.name) ||
      (complaint.assignmentStatus === "Waiting" && complaint.status === "Waiting Lobby" && normalizeServiceLevel(complaint.escalationLevel) === "L1")
    );
  }
  if (user.role === "L2 Technical Team") {
    return (
      complaint.assignedEngineerId === user.userId ||
      (Boolean(user.name) && complaint.assignedEngineerName === user.name) ||
      (complaint.siteVisitRequired === true && complaint.siteVisitEngineerId === user.userId) ||
      (complaint.siteVisitRequired === true && Boolean(user.name) && complaint.engineerName === user.name) ||
      (complaint.assignmentStatus === "Waiting" && complaint.status === "Waiting Lobby" && complaint.escalationLevel === "L2")
    );
  }
  if (user.role === "L3 Advanced OEM Support") {
    return true;
  }
  return true;
}

/** GET /api/complaints — filter by type, status */
router.get("/", authenticate, requireAnyPermission("complaints:consumer", "complaints:supplier", "dispatch:manage"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const { type, status, page = "1", limit = "20" } = req.query as Record<string, string>;
  const user = (req as any).user as AuthUser;
  if (type && !requireComplaintTypeAccess(user, type)) {
    return fail(res, "Access denied: insufficient permissions", 403);
  }
  if (!type || String(type).toLowerCase() === "consumer") {
    await rebalanceL1Queue();
  }
  const filter: Record<string, unknown> = {};
  if (type) filter.type = type;
  if (status) filter.status = status;
  const scopedFilter = applyComplaintRoleScope(filter, user);

  const p = Math.max(1, parseInt(page));
  const l = Math.min(100, parseInt(limit));
  const total = await c.complaints.countDocuments(scopedFilter);
  const data = await c.complaints.find(scopedFilter).skip((p - 1) * l).limit(l).toArray();
  return ok(res, { data, total, page: p, limit: l });
});

/** GET /api/complaints/stats — for donut chart */
router.get("/stats", authenticate, requireAnyPermission("complaints:consumer", "complaints:supplier"), async (_req: Request, res: Response) => {
  const c = await getCollections();
  const statuses: Complaint["status"][] = [
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
    replacementSerialNo,
    replacementEngineerId,
    replacementEngineerName,
    dispatchPlan,
    siteVisitRequired,
    engineerName,
    l3SupportRequired,
    finalResolution,
    clientFeedback,
    closureReport,
    closeRemark,
    closedByName,
    closedByRole,
    closedAt,
  } = req.body;

  const mobileNumber = req.body.mobileNumber ?? req.body.customerPhone;
  const installationDate = req.body.installationDate ?? dateOfSale;
  const complaintState = req.body.state;
  const complaintDistrict = req.body.district;

  if (!type || !dateOfComplaint || !issueDescription) {
    return fail(res, "type, dateOfComplaint, issueDescription are required");
  }
  if (String(type).toLowerCase() === "consumer") {
    if (!productSerialNo || !customerName || !mobileNumber || !complaintState || !complaintDistrict) {
      return fail(res, "Serial number, customer name, mobile number, state, district and complaint description are required");
    }
  }

  const user = (req as any).user as AuthUser;
  if (user.role === "Sales") {
    return fail(res, "Access denied: insufficient permissions", 403);
  }
  if (!requireComplaintTypeAccess(user, String(type))) {
    return fail(res, "Access denied: insufficient permissions", 403);
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
        preferredEngineerName: engineerName,
      })
    : undefined;

  const complaint: Complaint = {
    id: generateId(),
    type,
    productSerialNo,
    customerName,
    customerPhone: mobileNumber ? String(mobileNumber) : undefined,
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
    region: assignment?.region ?? region,
    priority: assignment?.priority ?? derivePriority(issueDescription, priority),
    warrantyStatus,
    productModel,
    assignmentStatus: assignment?.assignmentStatus,
    assignedEngineerId: assignment?.assignedEngineerId,
    assignedEngineerName: assignment?.assignedEngineerName,
    backupEngineerName: assignment?.backupEngineerName ?? backupEngineerName,
    activeTicketCountAtAssignment: assignment?.activeTicketCountAtAssignment,
    escalatedById: undefined,
    escalatedByName: undefined,
    escalatedByRole: undefined,
    escalatedAt: undefined,
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
    onsiteInspection,
    serviceStartedAt: serviceStartedAt ? new Date(serviceStartedAt) : undefined,
    progressUpdates,
    technicalDiagnosis,
    spareRequired,
    spareName,
    spareQuantity: spareQuantity ? Number(spareQuantity) : undefined,
    spareDispatchAddress,
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
    replacementSerialNo,
    replacementEngineerId,
    replacementEngineerName,
    dispatchPlan,
    siteVisitRequired,
    engineerName,
    l3SupportRequired,
    finalResolution,
    clientFeedback,
    closureReport,
    closeRemark,
    closedByName,
    closedByRole,
    closedAt: closedAt ? new Date(closedAt) : undefined,
    status: assignment?.status ?? "Open at Aurawatt",
    raisedBy: user.userId,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await c.complaints.insertOne(complaint);
  return ok(res, complaint, 201);
});

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
  if (!canAccessComplaint(user, existing)) {
    return fail(res, "Access denied: insufficient permissions", 403);
  }
  const { status } = req.body;
  if (!status) return fail(res, "status is required");
  const updatedAt = new Date();
  await c.complaints.updateOne({ id }, { $set: { status, updatedAt } });
  if (CLOSED_STATUSES.includes(String(status))) {
    await releaseNextWaitingTicket();
  }
  return ok(res, { ...existing, status, updatedAt });
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
    if (!canAccessComplaint(user, existing)) {
      return fail(res, "Access denied: insufficient permissions", 403);
    }

    const nextInspection = req.body.l1Inspection ?? existing.l1Inspection;
    const l1InspectionValid = isL1InspectionValid(nextInspection);

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
      "replacementSerialNo",
      "replacementEngineerId",
      "replacementEngineerName",
      "dispatchPlan",
      "siteVisitRequired",
      "siteVisitEngineerId",
      "siteVisitScheduledDate",
      "siteVisitAssignedById",
      "siteVisitAssignedByName",
      "siteVisitAssignedByRole",
      "engineerName",
      "l3SupportRequired",
      "finalResolution",
      "clientFeedback",
      "closureReport",
      "closeRemark",
      "closedByName",
      "closedByRole",
      "closedAt",
      "status",
    ] as const;

    const serverNow = new Date();
    const update: Record<string, unknown> = { updatedAt: serverNow, l1InspectionValid };
    for (const field of allowedFields) {
      if (field in req.body) update[field] = req.body[field];
    }
    if ((req.body.status === "In Progress at Aurawatt" || ("serviceStartedAt" in req.body && req.body.serviceStartedAt)) && !existing.serviceStartedAt) {
      update.serviceStartedAt = serverNow;
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
    if (CLOSED_STATUSES.includes(String(req.body.status))) {
      update.closedAt = serverNow;
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
        forceAssign: Boolean(req.body.forceAssign),
        preferredEngineerName: req.body.reassignEngineerName ?? req.body.engineerName,
      });
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
      if (!target) return fail(res, "Selected engineer not found", 404);
      const activeCount = await activeTicketCountForEngineer(target.id, existing.id);
      if (!req.body.forceAssign && activeCount >= MAX_ACTIVE_SERVICE_TICKETS) {
        return fail(res, `${target.name} already has ${MAX_ACTIVE_SERVICE_TICKETS} active tickets`, 400);
      }
      const statusByLevel: Record<ServiceLevel, Complaint["status"]> = {
        L1: "Assigned to Engineer",
        L2: "Escalated to L2",
        L3: "Escalated to L3",
      };
      Object.assign(update, {
        escalationLevel: level,
        assignmentStatus: "Assigned",
        assignedEngineerId: target.id,
        assignedEngineerName: target.name,
        activeTicketCountAtAssignment: activeCount,
        status: req.body.status ?? statusByLevel[level],
        slaPaused: false,
        waitingSince: undefined,
        queuePosition: undefined,
      });
    } else {
      const targetLevel =
        req.body.status === "Escalated to L2" || req.body.escalationLevel === "L2"
          ? "L2"
          : req.body.status === "Escalated to L3" || req.body.escalationLevel === "L3"
            ? "L3"
            : undefined;
      if (targetLevel && !CLOSED_STATUSES.includes(String(update.status))) {
        const assignment = await buildServiceAssignment({
          level: targetLevel,
          issueDescription: req.body.issueDescription ?? existing.issueDescription,
          siteLocation: req.body.siteLocation ?? existing.siteLocation,
          region: req.body.region ?? existing.region,
          priority: req.body.priority ?? existing.priority,
          l1Sla: existing.l1Sla,
          forceAssign: Boolean(req.body.forceAssign),
          preferredEngineerId: req.body.preferredEngineerId,
          preferredEngineerName: req.body.preferredEngineerName ?? req.body.engineerName,
          excludeComplaintId: existing.id,
        });
        Object.assign(update, assignment);
      }
    }

    if (req.body.status === "Escalated to L2" || req.body.status === "Escalated to L3") {
      update.escalatedById = req.body.escalatedById ?? user.userId;
      update.escalatedByName = req.body.escalatedByName ?? user.email;
      update.escalatedByRole = req.body.escalatedByRole ?? user.role;
      update.escalatedAt = new Date();
    }

    await c.complaints.updateOne({ id }, { $set: update });
    if (CLOSED_STATUSES.includes(String(update.status))) {
      try {
        await releaseNextWaitingTicket();
      } catch (err) {
        console.warn("Failed to release next waiting ticket:", err instanceof Error ? err.message : String(err));
      }
    }
    const updated = await c.complaints.findOne({ id });
    if (updated && req.body.notifyAdminOnCompletion && CLOSED_STATUSES.includes(String(update.status))) {
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
