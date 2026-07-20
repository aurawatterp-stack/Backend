
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getCollections } from "../db/collections";
import { getIndiaGeography } from "../data/indiaGeography";
import { SEED_ENGINEER_ASSIGNMENT_ROWS, SEED_ENGINEER_MASTER_ROWS, type SeedEngineerAssignment } from "../data/engineerAssignmentSeed";
import type { AuthUser } from "../types";
import { ACTIVE_TICKET_STATUSES, LOBBY_TICKET_STATUSES } from "../utils/complaintRules";
import { generateId } from "../utils/id";

export type EngineerRole = "L1" | "L2" | "L3" | "Backup";

export type EngineerMasterRecord = {
  id: string;
  name: string;
  email?: string;
  mobile?: string;
  role: EngineerRole;
  isActive?: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type EngineerAssignmentRecord = {
  id: string;
  state: string;
  district: string;
  l1EngineerId: string;
  l2EngineerId: string;
  l1BackupEngineerId: string;
  source?: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: string;
  updatedBy?: string;
};

export type TicketLoadRecord = {
  id: string;
  engineerId: string;
  activeCount: number;
  waitingCount: number;
  totalCount: number;
  lastUpdated: Date;
  updatedAt: Date;
};

export type EngineerAssignmentAuditRecord = {
  id: string;
  assignmentId: string;
  action: "created" | "updated" | "deleted" | "imported";
  state?: string;
  district?: string;
  before?: Partial<EngineerAssignmentRecord>;
  after?: Partial<EngineerAssignmentRecord>;
  note?: string;
  by?: string;
  byName?: string;
  createdAt: Date;
};

export type ParsedEngineerAssignmentRow = {
  state: string;
  district: string;
  l1EngineerName: string;
  l2EngineerName: string;
  l1BackupEngineerName: string;
};

export type ImportResult = {
  inserted: number;
  updated: number;
  deleted: number;
  warnings: string[];
  rows: ParsedEngineerAssignmentRow[];
};

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeKey(value: unknown) {
  return normalizeText(value).toLowerCase().replace(/\s+/g, " ");
}

function slugify(value: string) {
  return normalizeKey(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function exactMatchRegex(value: string) {
  return new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
}

type EngineerAssignmentInput = {
  state: string;
  district: string;
  l1EngineerName: string;
  l2EngineerName: string;
  l1BackupEngineerName?: string;
};

type EngineerAssignmentMutationResult = {
  assignment: EngineerAssignmentRecord;
  l1Engineer: EngineerMasterRecord | null;
  l2Engineer: EngineerMasterRecord | null;
  backupEngineer: EngineerMasterRecord | null;
  previous?: EngineerAssignmentRecord | null;
};

function columnIndexFromRef(cellRef: string) {
  const letters = cellRef.replace(/\d+/g, "");
  let index = 0;
  for (const char of letters) {
    index = index * 26 + (char.charCodeAt(0) - 64);
  }
  return Math.max(0, index - 1);
}

import AdmZip from "adm-zip";

function workbookRows(filePath: string) {
  let sharedStringsXml = "";
  let sheetXml = "";
  try {
    const zip = new AdmZip(filePath);
    const entries = zip.getEntries();
    const sharedStringsEntry = entries.find((e) => e.entryName.toLowerCase().includes("sharedstrings.xml"));
    if (sharedStringsEntry) {
      sharedStringsXml = sharedStringsEntry.getData().toString("utf8");
    }
    const sheetEntry = entries.find((e) => e.entryName.toLowerCase().startsWith("xl/worksheets/") && e.entryName.toLowerCase().endsWith(".xml"));
    if (sheetEntry) {
      sheetXml = sheetEntry.getData().toString("utf8");
    }
  } catch (err) {
    console.warn(`Failed to read XLSX entries from ${filePath}`, err);
  }
  const sharedStrings = parseSharedStrings(sharedStringsXml);
  return parseWorksheetRows(sheetXml, sharedStrings);
}

function parseSharedStrings(xml: string) {
  if (!xml) return [] as string[];
  const entries: string[] = [];
  const sharedStringRegex = /<si\b[\s\S]*?<\/si>/g;
  let match: RegExpExecArray | null;
  while ((match = sharedStringRegex.exec(xml))) {
    const block = match[0];
    const parts: string[] = [];
    const textRegex = /<t[^>]*>([\s\S]*?)<\/t>/g;
    let textMatch: RegExpExecArray | null;
    while ((textMatch = textRegex.exec(block))) {
      parts.push(textMatch[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'"));
    }
    entries.push(parts.join(""));
  }
  return entries;
}

function parseWorksheetRows(xml: string, sharedStrings: string[]) {
  const rows: Array<Array<string>> = [];
  if (!xml) return rows;

  const rowRegex = /<row\b[\s\S]*?<\/row>/g;
  const cellRegex = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
  const valueRegex = /<v>([\s\S]*?)<\/v>/;

  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRegex.exec(xml))) {
    const rowXml = rowMatch[0];
    const rowCells: string[] = [];
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRegex.exec(rowXml))) {
      const attrs = cellMatch[1];
      const body = cellMatch[2];
      const refMatch = attrs.match(/\br="([A-Z]+\d+)"/);
      const typeMatch = attrs.match(/\bt="([^"]+)"/);
      const ref = refMatch?.[1] ?? "";
      const index = ref ? columnIndexFromRef(ref) : rowCells.length;
      const type = typeMatch?.[1] ?? "";
      let value = "";
      if (type === "s") {
        const vMatch = valueRegex.exec(body);
        const sharedIndex = vMatch ? Number(vMatch[1]) : NaN;
        value = Number.isFinite(sharedIndex) ? (sharedStrings[sharedIndex] ?? "") : "";
      } else if (type === "inlineStr") {
        const inlineParts: string[] = [];
        const inlineRegex = /<t[^>]*>([\s\S]*?)<\/t>/g;
        let inlineMatch: RegExpExecArray | null;
        while ((inlineMatch = inlineRegex.exec(body))) {
          inlineParts.push(inlineMatch[1]);
        }
        value = inlineParts.join("");
      } else {
        const vMatch = valueRegex.exec(body);
        value = vMatch?.[1] ?? "";
      }
      value = value
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
      rowCells[index] = value;
    }
    rows.push(rowCells);
  }
  return rows;
}

export function engineerMasterId(name: string, role: EngineerRole) {
  return `eng-${slugify(role)}-${slugify(name)}`;
}

export function normalizeEngineerAssignmentRow(row: Partial<ParsedEngineerAssignmentRow> & Record<string, unknown>): ParsedEngineerAssignmentRow {
  const state = normalizeText(row.state);
  const district = normalizeText(row.district);
  const l1EngineerName = normalizeText(row.l1EngineerName);
  const l2EngineerName = normalizeText(row.l2EngineerName);
  const l1BackupEngineerName = normalizeText(row.l1BackupEngineerName || row.l1_backup_engineer_name || row.l1BackupEngineer || row.backupEngineerName || l2EngineerName);
  return { state, district, l1EngineerName, l2EngineerName, l1BackupEngineerName };
}

export async function parseEngineerAssignmentWorkbook(filePath: string): Promise<{ rows: ParsedEngineerAssignmentRow[]; warnings: string[] }> {
  const tempPath = path.join(os.tmpdir(), `engineer-assignment-${Date.now()}-${Math.random().toString(16).slice(2)}.xlsx`);
  fs.copyFileSync(filePath, tempPath);
  try {
    const rows = workbookRows(tempPath);
    if (!rows.length) {
      throw new Error("Workbook is empty");
    }

    const headers = rows[0].map((cell) => normalizeKey(cell));
    const headerIndex = new Map<string, number>();
    headers.forEach((header, index) => {
      if (header) headerIndex.set(header, index);
    });

    const stateIndex = headerIndex.get("state");
    const districtIndex = headerIndex.get("district");
    const l1Index = headerIndex.get("l1 engineer");
    const l2Index = headerIndex.get("l2 engineer");
    const backupIndex =
      headerIndex.get("l1 backup engineer") ??
      headerIndex.get("backup engineer") ??
      headerIndex.get("l1 backup") ??
      headerIndex.get("backup");

    if (stateIndex === undefined || districtIndex === undefined || l1Index === undefined || l2Index === undefined) {
      throw new Error("Workbook must include State, District, L1 Engineer and L2 Engineer columns");
    }

    const parsed: ParsedEngineerAssignmentRow[] = [];
    const seen = new Set<string>();
    const warnings: string[] = [];
    for (const row of rows.slice(1)) {
      const normalized = normalizeEngineerAssignmentRow({
        state: row[stateIndex],
        district: row[districtIndex],
        l1EngineerName: row[l1Index],
        l2EngineerName: row[l2Index],
        l1BackupEngineerName: backupIndex === undefined ? row[l2Index] : row[backupIndex],
      });
      if (!normalized.state && !normalized.district && !normalized.l1EngineerName && !normalized.l2EngineerName) continue;
      if (!normalized.state || !normalized.district || !normalized.l1EngineerName || !normalized.l2EngineerName) {
        throw new Error(`Invalid row in workbook: ${JSON.stringify(normalized)}`);
      }
      const key = `${normalizeKey(normalized.state)}::${normalizeKey(normalized.district)}`;
      if (seen.has(key)) {
        throw new Error(`Duplicate State + District combination found for ${normalized.state} / ${normalized.district}`);
      }
      seen.add(key);
      if (!backupIndex || !normalizeText(row[backupIndex])) {
        warnings.push(`Backup engineer missing for ${normalized.state} / ${normalized.district}; defaulted to L2 engineer.`);
      }
      parsed.push(normalized);
    }
    return { rows: parsed, warnings };
  } finally {
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // ignore
    }
  }
}

function seedEngineerMasterDocument(name: string, role: EngineerRole): EngineerMasterRecord {
  const now = new Date();
  return {
    id: engineerMasterId(name, role),
    name,
    email: "",
    mobile: "",
    role,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
}

function seedEngineerAssignmentDocument(row: SeedEngineerAssignment): EngineerAssignmentRecord {
  const now = new Date();
  return {
    id: `assignment-${slugify(row.state)}-${slugify(row.district)}`,
    state: row.state,
    district: row.district,
    l1EngineerId: engineerMasterId(row.l1EngineerName, "L1"),
    l2EngineerId: engineerMasterId(row.l2EngineerName, "L2"),
    l1BackupEngineerId: engineerMasterId(row.l1BackupEngineerName, "L1"),
    source: "seeded-workbook",
    createdAt: now,
    updatedAt: now,
  };
}

export async function seedEngineerAssignmentsIfEmpty() {
  const c = await getCollections();
  const existingAssignments = await c.engineerAssignments.estimatedDocumentCount();
  const masters = SEED_ENGINEER_MASTER_ROWS.map((row) => seedEngineerMasterDocument(row.name, row.role));
  if (masters.length) {
    for (const master of masters) {
      await c.engineerMasters.updateOne(
        { id: master.id },
        {
          $set: {
            name: master.name,
            role: master.role,
            isActive: master.isActive,
            updatedAt: master.updatedAt,
          },
          $setOnInsert: {
            id: master.id,
            email: master.email,
            mobile: master.mobile,
            createdAt: master.createdAt,
          },
        },
        { upsert: true }
      );
    }
  }

  if (existingAssignments > 0) {
    await rebuildTicketLoads();
    return;
  }

  const assignments = SEED_ENGINEER_ASSIGNMENT_ROWS.map((row) => seedEngineerAssignmentDocument(row));
  if (assignments.length) {
    await c.engineerAssignments.insertMany(assignments, { ordered: false });
  }

  const now = new Date();
  const audits: EngineerAssignmentAuditRecord[] = assignments.map((assignment) => ({
    id: generateId(),
    assignmentId: assignment.id,
    action: "imported",
    state: assignment.state,
    district: assignment.district,
    after: assignment,
    note: "Seeded from Service group details.xlsx",
    createdAt: now,
  }));
  if (audits.length) {
    await c.engineerAssignmentAudit.insertMany(audits, { ordered: false });
  }

  await rebuildTicketLoads();
}

export async function ensureEngineerMasterRecord(name: string, role: EngineerRole) {
  const c = await getCollections();
  const id = engineerMasterId(name, role);
  const now = new Date();
  await c.engineerMasters.updateOne(
    { id },
    {
      $setOnInsert: {
        id,
        email: "",
        mobile: "",
        isActive: true,
        createdAt: now,
      },
      $set: {
        name,
        role,
        updatedAt: now,
      },
    },
    { upsert: true }
  );
  return c.engineerMasters.findOne({ id });
}

export async function findEngineerMasterForUser(user: { email?: string; name?: string }, role: EngineerRole): Promise<EngineerMasterRecord | null> {
  const c = await getCollections();
  const email = normalizeText(user.email);
  const name = normalizeText(user.name);
  const filters: Array<Record<string, unknown>> = [];
  if (email) filters.push({ role, email: exactMatchRegex(email) });
  if (name) filters.push({ role, name: exactMatchRegex(name) });
  // Prefer active rows: after a rename the old (deactivated) registry row can carry the same
  // email as the live one, and a bare findOne returns whichever comes first.
  for (const filter of filters) {
    const active = await c.engineerMasters.findOne({ ...filter, isActive: { $ne: false } });
    if (active) return active;
  }
  for (const filter of filters) {
    const any = await c.engineerMasters.findOne(filter);
    if (any) return any;
  }
  return null;
}

/**
 * Moves every reference to an engineer identity onto a new name/role. Engineer_master ids are
 * derived from the name (`eng-l1-<name-slug>`), so renaming an engineer account changes their id
 * and silently orphans district assignments, open tickets and their dashboard queue unless all of
 * those references are migrated together.
 */
export async function migrateEngineerIdentity(input: {
  oldName: string;
  newName: string;
  oldRole: EngineerRole;
  newRole: EngineerRole;
  email?: string;
  mobile?: string;
}) {
  const c = await getCollections();
  const oldName = normalizeText(input.oldName);
  const newName = normalizeText(input.newName);
  const oldId = engineerMasterId(oldName, input.oldRole);
  const newId = engineerMasterId(newName, input.newRole);
  if (!oldName || !newName || oldId === newId) {
    return { migrated: false, oldId, newId, assignments: 0, complaints: 0 };
  }

  const now = new Date();
  const oldMaster = await c.engineerMasters.findOne({ id: oldId });

  await c.engineerMasters.updateOne(
    { id: newId },
    {
      $set: {
        name: newName,
        role: input.newRole,
        email: input.email ?? oldMaster?.email ?? "",
        mobile: input.mobile ?? oldMaster?.mobile ?? "",
        isActive: oldMaster?.isActive ?? true,
        updatedAt: now,
      },
      $setOnInsert: { id: newId, createdAt: oldMaster?.createdAt ?? now },
    },
    { upsert: true }
  );

  const assignmentUpdates = await Promise.all([
    c.engineerAssignments.updateMany({ l1EngineerId: oldId }, { $set: { l1EngineerId: newId, updatedAt: now } }),
    c.engineerAssignments.updateMany({ l2EngineerId: oldId }, { $set: { l2EngineerId: newId, updatedAt: now } }),
    c.engineerAssignments.updateMany({ l1BackupEngineerId: oldId }, { $set: { l1BackupEngineerId: newId, updatedAt: now } }),
  ]);

  const nameRegex = exactMatchRegex(oldName);
  const complaintUpdates = await Promise.all([
    c.complaints.updateMany({ assignedEngineerId: oldId }, { $set: { assignedEngineerId: newId } }),
    c.complaints.updateMany({ assignedEngineerName: nameRegex }, { $set: { assignedEngineerName: newName } }),
    c.complaints.updateMany({ engineerName: nameRegex }, { $set: { engineerName: newName } }),
    c.complaints.updateMany({ backupEngineerName: nameRegex }, { $set: { backupEngineerName: newName } }),
    c.complaints.updateMany({ overflowFromEngineerId: oldId }, { $set: { overflowFromEngineerId: newId } }),
    c.complaints.updateMany({ overflowFromEngineerName: nameRegex }, { $set: { overflowFromEngineerName: newName } }),
    c.complaints.updateMany({ replacementEngineerId: oldId }, { $set: { replacementEngineerId: newId } }),
    c.complaints.updateMany({ replacementEngineerName: nameRegex }, { $set: { replacementEngineerName: newName } }),
    c.complaints.updateMany({ siteVisitEngineerId: oldId }, { $set: { siteVisitEngineerId: newId } }),
    c.complaints.updateMany({ siteVisitEngineerName: nameRegex }, { $set: { siteVisitEngineerName: newName } }),
  ]);

  // The old registry row is fully superseded; deleting it keeps the email-based lookup in
  // findEngineerMasterForUser from ever resolving to the dead identity again.
  await c.engineerMasters.deleteOne({ id: oldId });
  await c.ticketLoads.deleteOne({ engineerId: oldId });
  await rebuildTicketLoads();

  return {
    migrated: true,
    oldId,
    newId,
    assignments: assignmentUpdates.reduce((sum, result) => sum + result.modifiedCount, 0),
    complaints: complaintUpdates.reduce((sum, result) => sum + result.modifiedCount, 0),
  };
}

/**
 * An L2 engineer's "team" is derived from the State/District Engineer Assignment
 * mapping: every L1 (primary or backup) whose district lists this L2 as the
 * district's L2 contact. There is no separate manager/reportsTo field in the app.
 */
export async function listL1TeamForL2(user: { email?: string; name?: string }): Promise<EngineerMasterRecord[]> {
  const c = await getCollections();
  const l2Master = await findEngineerMasterForUser(user, "L2");
  if (!l2Master) return [];

  const assignments = await c.engineerAssignments.find({ l2EngineerId: l2Master.id }).toArray();
  const l1Ids = new Set<string>();
  for (const assignment of assignments) {
    if (assignment.l1EngineerId) l1Ids.add(assignment.l1EngineerId);
    if (assignment.l1BackupEngineerId) l1Ids.add(assignment.l1BackupEngineerId);
  }
  l1Ids.delete(l2Master.id);
  if (!l1Ids.size) return [];

  const l1Masters = await c.engineerMasters.find({ id: { $in: [...l1Ids] }, isActive: { $ne: false } }).toArray();
  return l1Masters;
}

export async function resolveAssignmentByStateDistrict(state: string, district: string) {
  const c = await getCollections();
  const assignment = await c.engineerAssignments.findOne({
    state: { $regex: `^${state.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" },
    district: { $regex: `^${district.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" },
  });
  if (!assignment) return null;
  const [l1Engineer, l2Engineer, backupEngineer] = await Promise.all([
    c.engineerMasters.findOne({ id: assignment.l1EngineerId }),
    c.engineerMasters.findOne({ id: assignment.l2EngineerId }),
    c.engineerMasters.findOne({ id: assignment.l1BackupEngineerId }),
  ]);
  return { assignment, l1Engineer, l2Engineer, backupEngineer };
}

export async function listEngineerAssignments(params: { q?: string; state?: string; district?: string; page?: number; limit?: number }) {
  const c = await getCollections();
  const q = normalizeKey(params.q);
  const filter: Record<string, unknown> = {};
  if (params.state) filter.state = params.state;
  if (params.district) filter.district = params.district;
  if (q) {
    filter.$or = [
      { state: { $regex: q, $options: "i" } },
      { district: { $regex: q, $options: "i" } },
      { l1EngineerName: { $regex: q, $options: "i" } },
      { l2EngineerName: { $regex: q, $options: "i" } },
      { l1BackupEngineerName: { $regex: q, $options: "i" } },
    ];
  }

  const page = Math.max(1, Number(params.page ?? 1));
  const limit = Math.min(100, Math.max(1, Number(params.limit ?? 20)));
  const total = await c.engineerAssignments.countDocuments(filter);
  const data = await c.engineerAssignments
    .find(filter)
    .sort({ state: 1, district: 1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .toArray();

  return { data, total, page, limit };
}

/** Maps a live user account's role (from Manage User Profiles) to the engineer role used by the assignment module. */
const USER_ROLE_TO_ENGINEER_ROLE: Record<string, EngineerRole> = {
  "L1 Engineer": "L1",
  "L2 Technical Team": "L2",
};

/** Live, active L1/L2 user accounts (not the freeform engineerMasters registry), keyed the same
 * way assignment rows reference engineers so staleness can be checked by id. */
async function listActiveEngineers() {
  const c = await getCollections();
  const activeUsers = await c.users
    .find({ role: { $in: Object.keys(USER_ROLE_TO_ENGINEER_ROLE) }, isActive: { $ne: false } })
    .sort({ name: 1 })
    .toArray();
  return activeUsers.map((user) => {
    const role = USER_ROLE_TO_ENGINEER_ROLE[user.role];
    return {
      id: engineerMasterId(user.name, role),
      name: user.name,
      role,
      email: user.email ?? "",
      mobile: user.mobile ?? "",
    };
  });
}

/**
 * Deactivates engineer_master rows in `candidateIds` that, after the caller's change, are no
 * longer referenced by any assignment and don't correspond to a currently active login account.
 * Called whenever an assignment's L1/L2/backup engineer is replaced or its row is deleted — without
 * this, the replaced/removed name stays `isActive: true` forever and keeps showing up in the
 * Onsite Engineer / L1-L2 dropdowns, which read engineer_master directly.
 */
async function deactivateOrphanedEngineerMasters(candidateIds: Iterable<string | undefined>) {
  const c = await getCollections();
  const ids = [...new Set(candidateIds)].filter((id): id is string => Boolean(id));
  if (!ids.length) return;

  const [assignments, activeEngineers] = await Promise.all([
    c.engineerAssignments.find({}).toArray(),
    listActiveEngineers(),
  ]);
  const referencedIds = new Set<string>();
  for (const assignment of assignments) {
    if (assignment.l1EngineerId) referencedIds.add(assignment.l1EngineerId);
    if (assignment.l2EngineerId) referencedIds.add(assignment.l2EngineerId);
    if (assignment.l1BackupEngineerId) referencedIds.add(assignment.l1BackupEngineerId);
  }
  const activeIds = new Set(activeEngineers.map((engineer) => engineer.id));

  const staleIds = ids.filter((id) => !referencedIds.has(id) && !activeIds.has(id));
  if (staleIds.length) {
    await c.engineerMasters.updateMany({ id: { $in: staleIds } }, { $set: { isActive: false, updatedAt: new Date() } });
  }
}

export async function listEngineerAssignmentOptions() {
  const c = await getCollections();
  const [assignments, visibleEngineers] = await Promise.all([
    c.engineerAssignments.find({}).sort({ state: 1, district: 1 }).toArray(),
    listActiveEngineers(),
  ]);
  const geography = getIndiaGeography();
  const districtsByState: Record<string, string[]> = Object.fromEntries(
    geography.stateDistrictEntries.map((entry) => [entry.state, [...entry.districts]])
  );
  for (const assignment of assignments) {
    const stateDistricts = districtsByState[assignment.state] ?? [];
    if (!stateDistricts.some((district) => normalizeKey(district) === normalizeKey(assignment.district))) {
      stateDistricts.push(assignment.district);
    }
    districtsByState[assignment.state] = stateDistricts.sort((a, b) => a.localeCompare(b));
  }
  return {
    states: Array.from(new Set([...geography.states, ...assignments.map((row) => row.state)])).sort((a, b) => a.localeCompare(b)),
    districts: Array.from(new Set(Object.values(districtsByState).flat())).sort((a, b) => a.localeCompare(b)),
    districtsByState,
    engineers: visibleEngineers,
  };
}

/**
 * Deletes assignment rows whose L1 or L2 engineer no longer maps to an active account (routing
 * would be broken for that district anyway), and clears just the backup field when only the
 * backup engineer has gone stale (L1/L2 still work, so the row is kept).
 */
export async function cleanupStaleEngineerAssignments(actor?: AuthUser) {
  const c = await getCollections();
  const [assignments, activeEngineers] = await Promise.all([
    c.engineerAssignments.find({}).toArray(),
    listActiveEngineers(),
  ]);
  const activeIds = new Set(activeEngineers.map((engineer) => engineer.id));
  const now = new Date();

  const removedRows: Array<{ state: string; district: string }> = [];
  let backupCleared = 0;

  for (const assignment of assignments) {
    const l1Stale = !activeIds.has(assignment.l1EngineerId);
    const l2Stale = !activeIds.has(assignment.l2EngineerId);

    if (l1Stale || l2Stale) {
      await c.engineerAssignments.deleteOne({ id: assignment.id });
      await c.engineerAssignmentAudit.insertOne({
        id: generateId(),
        assignmentId: assignment.id,
        action: "deleted",
        state: assignment.state,
        district: assignment.district,
        before: assignment,
        by: actor?.userId,
        byName: actor?.name,
        note: "Removed automatically: L1 or L2 engineer is no longer an active account.",
        createdAt: now,
      });
      removedRows.push({ state: assignment.state, district: assignment.district });
      continue;
    }

    const backupStale = Boolean(assignment.l1BackupEngineerId) && !activeIds.has(assignment.l1BackupEngineerId);
    if (backupStale) {
      await c.engineerAssignments.updateOne({ id: assignment.id }, { $set: { l1BackupEngineerId: "", updatedAt: now } });
      await c.engineerAssignmentAudit.insertOne({
        id: generateId(),
        assignmentId: assignment.id,
        action: "updated",
        state: assignment.state,
        district: assignment.district,
        before: assignment,
        by: actor?.userId,
        byName: actor?.name,
        note: "Backup engineer cleared automatically: no longer an active account.",
        createdAt: now,
      });
      backupCleared += 1;
    }
  }

  // Permanently delete engineerMasters rows that no remaining assignment references and that
  // don't correspond to a currently active account — these are the ghost names (like old,
  // deleted engineers) that used to silently come back on every server restart.
  const remainingAssignments = await c.engineerAssignments.find({}).toArray();
  const referencedIds = new Set<string>();
  for (const assignment of remainingAssignments) {
    if (assignment.l1EngineerId) referencedIds.add(assignment.l1EngineerId);
    if (assignment.l2EngineerId) referencedIds.add(assignment.l2EngineerId);
    if (assignment.l1BackupEngineerId) referencedIds.add(assignment.l1BackupEngineerId);
  }
  const keepIds = new Set([...activeIds, ...referencedIds]);
  const allMasters = await c.engineerMasters.find({}).toArray();
  const staleMasterIds = allMasters.filter((master) => !keepIds.has(master.id)).map((master) => master.id);
  if (staleMasterIds.length) {
    await c.engineerMasters.deleteMany({ id: { $in: staleMasterIds } });
  }

  if (removedRows.length || backupCleared) {
    await rebuildTicketLoads();
  }

  return { removed: removedRows.length, backupCleared, mastersDeleted: staleMasterIds.length, removedRows };
}

async function countTicketLoadForEngineer(engineerId: string, engineerName?: string, excludeComplaintId?: string) {
  const c = await getCollections();
  const identityFilter: Record<string, unknown> = engineerName
    ? { $or: [{ assignedEngineerId: engineerId }, { assignedEngineerName: engineerName }] }
    : { assignedEngineerId: engineerId };
  const [activeCount, waitingCount] = await Promise.all([
    c.complaints.countDocuments({
      ...identityFilter,
      status: { $in: [...ACTIVE_TICKET_STATUSES] },
      ...(excludeComplaintId ? { id: { $ne: excludeComplaintId } } : {}),
    }),
    c.complaints.countDocuments({
      ...identityFilter,
      assignmentStatus: "Waiting",
      status: { $in: [...LOBBY_TICKET_STATUSES] },
      ...(excludeComplaintId ? { id: { $ne: excludeComplaintId } } : {}),
    }),
  ]);
  return { activeCount, waitingCount, totalCount: activeCount + waitingCount };
}

export async function recomputeTicketLoadForEngineer(engineerId: string, engineerName?: string) {
  const c = await getCollections();
  const now = new Date();
  const { activeCount, waitingCount, totalCount } = await countTicketLoadForEngineer(engineerId, engineerName);
  await c.ticketLoads.updateOne(
    { engineerId },
    {
      $set: {
        engineerId,
        activeCount,
        waitingCount,
        totalCount,
        lastUpdated: now,
        updatedAt: now,
      },
      $setOnInsert: {
        id: `load-${slugify(engineerId)}`,
      },
    },
    { upsert: true }
  );
  return { engineerId, activeCount, waitingCount, totalCount, lastUpdated: now, updatedAt: now };
}

export async function rebuildTicketLoads() {
  const c = await getCollections();
  const engineers = await c.engineerMasters.find({}).toArray();
  const loads = await Promise.all(engineers.map((engineer) => recomputeTicketLoadForEngineer(engineer.id, engineer.name)));
  return loads;
}

async function upsertEngineerAssignment(input: EngineerAssignmentInput, actor?: AuthUser): Promise<EngineerAssignmentMutationResult> {
  const c = await getCollections();
  const row = normalizeEngineerAssignmentRow({
    state: input.state,
    district: input.district,
    l1EngineerName: input.l1EngineerName,
    l2EngineerName: input.l2EngineerName,
    l1BackupEngineerName: input.l1BackupEngineerName || input.l2EngineerName,
  });
  const previous = await c.engineerAssignments.findOne({
    state: exactMatchRegex(row.state),
    district: exactMatchRegex(row.district),
  });

  const [l1, l2, backup] = await Promise.all([
    ensureEngineerMasterRecord(row.l1EngineerName, "L1"),
    ensureEngineerMasterRecord(row.l2EngineerName, "L2"),
    ensureEngineerMasterRecord(row.l1BackupEngineerName, "L1"),
  ]);

  const now = new Date();
  const next: EngineerAssignmentRecord = {
    id: previous?.id ?? `assignment-${slugify(row.state)}-${slugify(row.district)}`,
    state: row.state,
    district: row.district,
    l1EngineerId: l1?.id ?? engineerMasterId(row.l1EngineerName, "L1"),
    l2EngineerId: l2?.id ?? engineerMasterId(row.l2EngineerName, "L2"),
    l1BackupEngineerId: backup?.id ?? engineerMasterId(row.l1BackupEngineerName, "L1"),
    source: previous?.source ?? "manual",
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    createdBy: previous?.createdBy ?? actor?.userId,
    updatedBy: actor?.userId,
  };

  if (previous) {
    await c.engineerAssignments.updateOne({ id: previous.id }, { $set: next });
    await deactivateOrphanedEngineerMasters([previous.l1EngineerId, previous.l2EngineerId, previous.l1BackupEngineerId]);
  } else {
    await c.engineerAssignments.insertOne(next);
  }

  await c.engineerAssignmentAudit.insertOne({
    id: generateId(),
    assignmentId: next.id,
    action: previous ? "updated" : "created",
    state: next.state,
    district: next.district,
    before: previous ?? undefined,
    after: next,
    by: actor?.userId,
    byName: actor?.name,
    note: previous ? "Assignment updated from ERP module." : "Assignment created from ERP module.",
    createdAt: now,
  });

  return {
    assignment: next,
    l1Engineer: l1,
    l2Engineer: l2,
    backupEngineer: backup,
    previous,
  };
}

export async function createOrUpdateEngineerAssignment(input: EngineerAssignmentInput, actor?: AuthUser) {
  const result = await upsertEngineerAssignment(input, actor);
  await rebuildTicketLoads();
  return result;
}

export async function createOrUpdateEngineerAssignments(input: Omit<EngineerAssignmentInput, "district"> & { districts: string[] }, actor?: AuthUser) {
  const districts = Array.from(
    new Set(
      input.districts
        .map((district) => normalizeText(district))
        .filter(Boolean)
    )
  );
  if (!districts.length) {
    throw new Error("At least one district is required");
  }

  const results: EngineerAssignmentMutationResult[] = [];
  for (const district of districts) {
    results.push(await upsertEngineerAssignment({ ...input, district }, actor));
  }

  await rebuildTicketLoads();
  return {
    assignments: results.map((result) => result.assignment),
    results,
  };
}

export async function deleteEngineerAssignment(id: string, actor?: AuthUser) {
  const c = await getCollections();
  const existing = await c.engineerAssignments.findOne({ id });
  if (!existing) return null;
  await c.engineerAssignments.deleteOne({ id });
  await deactivateOrphanedEngineerMasters([existing.l1EngineerId, existing.l2EngineerId, existing.l1BackupEngineerId]);
  await c.engineerAssignmentAudit.insertOne({
    id: generateId(),
    assignmentId: id,
    action: "deleted",
    state: existing.state,
    district: existing.district,
    before: existing,
    by: actor?.userId,
    byName: actor?.name,
    note: "Assignment deleted from ERP module.",
    createdAt: new Date(),
  });
  await rebuildTicketLoads();
  return existing;
}

export async function listEngineerAssignmentAudit(params: { q?: string; page?: number; limit?: number }) {
  const c = await getCollections();
  const q = normalizeKey(params.q);
  const filter: Record<string, unknown> = {};
  if (q) {
    filter.$or = [
      { state: { $regex: q, $options: "i" } },
      { district: { $regex: q, $options: "i" } },
      { note: { $regex: q, $options: "i" } },
      { byName: { $regex: q, $options: "i" } },
    ];
  }
  const page = Math.max(1, Number(params.page ?? 1));
  const limit = Math.min(100, Math.max(1, Number(params.limit ?? 20)));
  const total = await c.engineerAssignmentAudit.countDocuments(filter);
  const data = await c.engineerAssignmentAudit
    .find(filter)
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .toArray();
  return { data, total, page, limit };
}

export async function importEngineerAssignmentsFromWorkbook(filePath: string, actor?: AuthUser): Promise<ImportResult> {
  const { rows, warnings } = await parseEngineerAssignmentWorkbook(filePath);
  const c = await getCollections();
  let inserted = 0;
  let updated = 0;
  const now = new Date();

  for (const row of rows) {
    const before = await c.engineerAssignments.findOne({
      state: { $regex: `^${row.state.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" },
      district: { $regex: `^${row.district.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" },
    });
    const result = await createOrUpdateEngineerAssignment(row, actor);
    if (before) updated += 1;
    else inserted += 1;
    await c.engineerAssignmentAudit.updateOne(
      { assignmentId: result.assignment.id, action: before ? "updated" : "created", createdAt: result.assignment.updatedAt },
      { $set: { action: "imported", note: `Imported from ${path.basename(filePath)}` } }
    ).catch(() => undefined);
  }

  const assignmentIds = new Set(rows.map((row) => `assignment-${slugify(row.state)}-${slugify(row.district)}`));
  const existingAssignments = await c.engineerAssignments.find({}).toArray();
  const deletable = existingAssignments.filter((assignment) => !assignmentIds.has(assignment.id) && assignment.source === "seeded-workbook");
  let deleted = 0;
  for (const row of deletable) {
    await deleteEngineerAssignment(row.id, actor);
    deleted += 1;
  }

  await c.engineerAssignmentAudit.insertOne({
    id: generateId(),
    assignmentId: "bulk-import",
    action: "imported",
    note: `Imported ${rows.length} assignment row(s) from ${path.basename(filePath)}.`,
    by: actor?.userId,
    byName: actor?.name,
    createdAt: now,
  });

  return { inserted, updated, deleted, warnings, rows };
}
