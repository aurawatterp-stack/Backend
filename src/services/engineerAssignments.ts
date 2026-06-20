import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getCollections } from "../db/collections";
import { SEED_ENGINEER_ASSIGNMENT_ROWS, SEED_ENGINEER_MASTER_ROWS, type SeedEngineerAssignment } from "../data/engineerAssignmentSeed";
import type { AuthUser } from "../types";
import { ACTIVE_TICKET_STATUSES, LOBBY_TICKET_STATUSES } from "../utils/complaintRules";
import { generateId } from "../utils/id";

export type EngineerRole = "L1" | "L2" | "L3";

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

function columnIndexFromRef(cellRef: string) {
  const letters = cellRef.replace(/\d+/g, "");
  let index = 0;
  for (const char of letters) {
    index = index * 26 + (char.charCodeAt(0) - 64);
  }
  return Math.max(0, index - 1);
}

function readXmlFromXlsx(filePath: string, entryPath: string) {
  try {
    return execFileSync("unzip", ["-p", filePath, entryPath], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  } catch {
    return "";
  }
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
    const sharedStrings = parseSharedStrings(readXmlFromXlsx(tempPath, "xl/sharedStrings.xml"));
    const rows = parseWorksheetRows(readXmlFromXlsx(tempPath, "xl/worksheets/sheet1.xml"), sharedStrings);
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

export async function listEngineerAssignmentOptions() {
  const c = await getCollections();
  const [assignments, masters] = await Promise.all([
    c.engineerAssignments.find({}).sort({ state: 1, district: 1 }).toArray(),
    c.engineerMasters.find({}).sort({ role: 1, name: 1 }).toArray(),
  ]);
  const visibleEngineers = masters.filter((row) => row.role !== "Backup" && !/backup/i.test(row.name));
  return {
    states: Array.from(new Set(assignments.map((row) => row.state))).sort((a, b) => a.localeCompare(b)),
    districts: Array.from(new Set(assignments.map((row) => row.district))).sort((a, b) => a.localeCompare(b)),
    engineers: visibleEngineers.map((row) => ({ id: row.id, name: row.name, role: row.role, email: row.email ?? "", mobile: row.mobile ?? "" })),
  };
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

export async function createOrUpdateEngineerAssignment(input: {
  state: string;
  district: string;
  l1EngineerName: string;
  l2EngineerName: string;
  l1BackupEngineerName?: string;
}, actor?: AuthUser) {
  const c = await getCollections();
  const row = normalizeEngineerAssignmentRow({
    state: input.state,
    district: input.district,
    l1EngineerName: input.l1EngineerName,
    l2EngineerName: input.l2EngineerName,
    l1BackupEngineerName: input.l1BackupEngineerName || input.l2EngineerName,
  });
  const previous = await c.engineerAssignments.findOne({
    state: { $regex: `^${row.state.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" },
    district: { $regex: `^${row.district.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" },
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

  await rebuildTicketLoads();
  return {
    assignment: next,
    l1Engineer: l1,
    l2Engineer: l2,
    backupEngineer: backup,
    previous,
  };
}

export async function deleteEngineerAssignment(id: string, actor?: AuthUser) {
  const c = await getCollections();
  const existing = await c.engineerAssignments.findOne({ id });
  if (!existing) return null;
  await c.engineerAssignments.deleteOne({ id });
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
