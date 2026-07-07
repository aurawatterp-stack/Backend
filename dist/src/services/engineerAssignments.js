"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.engineerMasterId = engineerMasterId;
exports.normalizeEngineerAssignmentRow = normalizeEngineerAssignmentRow;
exports.parseEngineerAssignmentWorkbook = parseEngineerAssignmentWorkbook;
exports.seedEngineerAssignmentsIfEmpty = seedEngineerAssignmentsIfEmpty;
exports.ensureEngineerMasterRecord = ensureEngineerMasterRecord;
exports.findEngineerMasterForUser = findEngineerMasterForUser;
exports.listL1TeamForL2 = listL1TeamForL2;
exports.resolveAssignmentByStateDistrict = resolveAssignmentByStateDistrict;
exports.listEngineerAssignments = listEngineerAssignments;
exports.listEngineerAssignmentOptions = listEngineerAssignmentOptions;
exports.recomputeTicketLoadForEngineer = recomputeTicketLoadForEngineer;
exports.rebuildTicketLoads = rebuildTicketLoads;
exports.createOrUpdateEngineerAssignment = createOrUpdateEngineerAssignment;
exports.createOrUpdateEngineerAssignments = createOrUpdateEngineerAssignments;
exports.deleteEngineerAssignment = deleteEngineerAssignment;
exports.listEngineerAssignmentAudit = listEngineerAssignmentAudit;
exports.importEngineerAssignmentsFromWorkbook = importEngineerAssignmentsFromWorkbook;
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const collections_1 = require("../db/collections");
const indiaGeography_1 = require("../data/indiaGeography");
const engineerAssignmentSeed_1 = require("../data/engineerAssignmentSeed");
const complaintRules_1 = require("../utils/complaintRules");
const id_1 = require("../utils/id");
function normalizeText(value) {
    return String(value ?? "").trim();
}
function normalizeKey(value) {
    return normalizeText(value).toLowerCase().replace(/\s+/g, " ");
}
function slugify(value) {
    return normalizeKey(value)
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}
function exactMatchRegex(value) {
    return new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
}
function columnIndexFromRef(cellRef) {
    const letters = cellRef.replace(/\d+/g, "");
    let index = 0;
    for (const char of letters) {
        index = index * 26 + (char.charCodeAt(0) - 64);
    }
    return Math.max(0, index - 1);
}
const adm_zip_1 = __importDefault(require("adm-zip"));
function workbookRows(filePath) {
    let sharedStringsXml = "";
    let sheetXml = "";
    try {
        const zip = new adm_zip_1.default(filePath);
        const entries = zip.getEntries();
        const sharedStringsEntry = entries.find((e) => e.entryName.toLowerCase().includes("sharedstrings.xml"));
        if (sharedStringsEntry) {
            sharedStringsXml = sharedStringsEntry.getData().toString("utf8");
        }
        const sheetEntry = entries.find((e) => e.entryName.toLowerCase().startsWith("xl/worksheets/") && e.entryName.toLowerCase().endsWith(".xml"));
        if (sheetEntry) {
            sheetXml = sheetEntry.getData().toString("utf8");
        }
    }
    catch (err) {
        console.warn(`Failed to read XLSX entries from ${filePath}`, err);
    }
    const sharedStrings = parseSharedStrings(sharedStringsXml);
    return parseWorksheetRows(sheetXml, sharedStrings);
}
function parseSharedStrings(xml) {
    if (!xml)
        return [];
    const entries = [];
    const sharedStringRegex = /<si\b[\s\S]*?<\/si>/g;
    let match;
    while ((match = sharedStringRegex.exec(xml))) {
        const block = match[0];
        const parts = [];
        const textRegex = /<t[^>]*>([\s\S]*?)<\/t>/g;
        let textMatch;
        while ((textMatch = textRegex.exec(block))) {
            parts.push(textMatch[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'"));
        }
        entries.push(parts.join(""));
    }
    return entries;
}
function parseWorksheetRows(xml, sharedStrings) {
    const rows = [];
    if (!xml)
        return rows;
    const rowRegex = /<row\b[\s\S]*?<\/row>/g;
    const cellRegex = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
    const valueRegex = /<v>([\s\S]*?)<\/v>/;
    let rowMatch;
    while ((rowMatch = rowRegex.exec(xml))) {
        const rowXml = rowMatch[0];
        const rowCells = [];
        let cellMatch;
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
            }
            else if (type === "inlineStr") {
                const inlineParts = [];
                const inlineRegex = /<t[^>]*>([\s\S]*?)<\/t>/g;
                let inlineMatch;
                while ((inlineMatch = inlineRegex.exec(body))) {
                    inlineParts.push(inlineMatch[1]);
                }
                value = inlineParts.join("");
            }
            else {
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
function engineerMasterId(name, role) {
    return `eng-${slugify(role)}-${slugify(name)}`;
}
function normalizeEngineerAssignmentRow(row) {
    const state = normalizeText(row.state);
    const district = normalizeText(row.district);
    const l1EngineerName = normalizeText(row.l1EngineerName);
    const l2EngineerName = normalizeText(row.l2EngineerName);
    const l1BackupEngineerName = normalizeText(row.l1BackupEngineerName || row.l1_backup_engineer_name || row.l1BackupEngineer || row.backupEngineerName || l2EngineerName);
    return { state, district, l1EngineerName, l2EngineerName, l1BackupEngineerName };
}
async function parseEngineerAssignmentWorkbook(filePath) {
    const tempPath = node_path_1.default.join(node_os_1.default.tmpdir(), `engineer-assignment-${Date.now()}-${Math.random().toString(16).slice(2)}.xlsx`);
    node_fs_1.default.copyFileSync(filePath, tempPath);
    try {
        const rows = workbookRows(tempPath);
        if (!rows.length) {
            throw new Error("Workbook is empty");
        }
        const headers = rows[0].map((cell) => normalizeKey(cell));
        const headerIndex = new Map();
        headers.forEach((header, index) => {
            if (header)
                headerIndex.set(header, index);
        });
        const stateIndex = headerIndex.get("state");
        const districtIndex = headerIndex.get("district");
        const l1Index = headerIndex.get("l1 engineer");
        const l2Index = headerIndex.get("l2 engineer");
        const backupIndex = headerIndex.get("l1 backup engineer") ??
            headerIndex.get("backup engineer") ??
            headerIndex.get("l1 backup") ??
            headerIndex.get("backup");
        if (stateIndex === undefined || districtIndex === undefined || l1Index === undefined || l2Index === undefined) {
            throw new Error("Workbook must include State, District, L1 Engineer and L2 Engineer columns");
        }
        const parsed = [];
        const seen = new Set();
        const warnings = [];
        for (const row of rows.slice(1)) {
            const normalized = normalizeEngineerAssignmentRow({
                state: row[stateIndex],
                district: row[districtIndex],
                l1EngineerName: row[l1Index],
                l2EngineerName: row[l2Index],
                l1BackupEngineerName: backupIndex === undefined ? row[l2Index] : row[backupIndex],
            });
            if (!normalized.state && !normalized.district && !normalized.l1EngineerName && !normalized.l2EngineerName)
                continue;
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
    }
    finally {
        try {
            node_fs_1.default.unlinkSync(tempPath);
        }
        catch {
            // ignore
        }
    }
}
function seedEngineerMasterDocument(name, role) {
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
function seedEngineerAssignmentDocument(row) {
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
async function seedEngineerAssignmentsIfEmpty() {
    const c = await (0, collections_1.getCollections)();
    const existingAssignments = await c.engineerAssignments.estimatedDocumentCount();
    const masters = engineerAssignmentSeed_1.SEED_ENGINEER_MASTER_ROWS.map((row) => seedEngineerMasterDocument(row.name, row.role));
    if (masters.length) {
        for (const master of masters) {
            await c.engineerMasters.updateOne({ id: master.id }, {
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
            }, { upsert: true });
        }
    }
    if (existingAssignments > 0) {
        await rebuildTicketLoads();
        return;
    }
    const assignments = engineerAssignmentSeed_1.SEED_ENGINEER_ASSIGNMENT_ROWS.map((row) => seedEngineerAssignmentDocument(row));
    if (assignments.length) {
        await c.engineerAssignments.insertMany(assignments, { ordered: false });
    }
    const now = new Date();
    const audits = assignments.map((assignment) => ({
        id: (0, id_1.generateId)(),
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
async function ensureEngineerMasterRecord(name, role) {
    const c = await (0, collections_1.getCollections)();
    const id = engineerMasterId(name, role);
    const now = new Date();
    await c.engineerMasters.updateOne({ id }, {
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
    }, { upsert: true });
    return c.engineerMasters.findOne({ id });
}
async function findEngineerMasterForUser(user, role) {
    const c = await (0, collections_1.getCollections)();
    const email = normalizeText(user.email);
    const name = normalizeText(user.name);
    if (email) {
        const byEmail = await c.engineerMasters.findOne({ role, email: exactMatchRegex(email) });
        if (byEmail)
            return byEmail;
    }
    if (name) {
        const byName = await c.engineerMasters.findOne({ role, name: exactMatchRegex(name) });
        if (byName)
            return byName;
    }
    return null;
}
/**
 * An L2 engineer's "team" is derived from the State/District Engineer Assignment
 * mapping: every L1 (primary or backup) whose district lists this L2 as the
 * district's L2 contact. There is no separate manager/reportsTo field in the app.
 */
async function listL1TeamForL2(user) {
    const c = await (0, collections_1.getCollections)();
    const l2Master = await findEngineerMasterForUser(user, "L2");
    if (!l2Master)
        return [];
    const assignments = await c.engineerAssignments.find({ l2EngineerId: l2Master.id }).toArray();
    const l1Ids = new Set();
    for (const assignment of assignments) {
        if (assignment.l1EngineerId)
            l1Ids.add(assignment.l1EngineerId);
        if (assignment.l1BackupEngineerId)
            l1Ids.add(assignment.l1BackupEngineerId);
    }
    l1Ids.delete(l2Master.id);
    if (!l1Ids.size)
        return [];
    const l1Masters = await c.engineerMasters.find({ id: { $in: [...l1Ids] }, isActive: { $ne: false } }).toArray();
    return l1Masters;
}
async function resolveAssignmentByStateDistrict(state, district) {
    const c = await (0, collections_1.getCollections)();
    const assignment = await c.engineerAssignments.findOne({
        state: { $regex: `^${state.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" },
        district: { $regex: `^${district.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" },
    });
    if (!assignment)
        return null;
    const [l1Engineer, l2Engineer, backupEngineer] = await Promise.all([
        c.engineerMasters.findOne({ id: assignment.l1EngineerId }),
        c.engineerMasters.findOne({ id: assignment.l2EngineerId }),
        c.engineerMasters.findOne({ id: assignment.l1BackupEngineerId }),
    ]);
    return { assignment, l1Engineer, l2Engineer, backupEngineer };
}
async function listEngineerAssignments(params) {
    const c = await (0, collections_1.getCollections)();
    const q = normalizeKey(params.q);
    const filter = {};
    if (params.state)
        filter.state = params.state;
    if (params.district)
        filter.district = params.district;
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
async function listEngineerAssignmentOptions() {
    const c = await (0, collections_1.getCollections)();
    const [assignments, masters] = await Promise.all([
        c.engineerAssignments.find({}).sort({ state: 1, district: 1 }).toArray(),
        c.engineerMasters.find({}).sort({ role: 1, name: 1 }).toArray(),
    ]);
    const geography = (0, indiaGeography_1.getIndiaGeography)();
    const visibleEngineers = masters.filter((row) => row.role !== "Backup" && !/backup/i.test(row.name));
    const districtsByState = Object.fromEntries(geography.stateDistrictEntries.map((entry) => [entry.state, [...entry.districts]]));
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
        engineers: visibleEngineers.map((row) => ({ id: row.id, name: row.name, role: row.role, email: row.email ?? "", mobile: row.mobile ?? "" })),
    };
}
async function countTicketLoadForEngineer(engineerId, engineerName, excludeComplaintId) {
    const c = await (0, collections_1.getCollections)();
    const identityFilter = engineerName
        ? { $or: [{ assignedEngineerId: engineerId }, { assignedEngineerName: engineerName }] }
        : { assignedEngineerId: engineerId };
    const [activeCount, waitingCount] = await Promise.all([
        c.complaints.countDocuments({
            ...identityFilter,
            status: { $in: [...complaintRules_1.ACTIVE_TICKET_STATUSES] },
            ...(excludeComplaintId ? { id: { $ne: excludeComplaintId } } : {}),
        }),
        c.complaints.countDocuments({
            ...identityFilter,
            assignmentStatus: "Waiting",
            status: { $in: [...complaintRules_1.LOBBY_TICKET_STATUSES] },
            ...(excludeComplaintId ? { id: { $ne: excludeComplaintId } } : {}),
        }),
    ]);
    return { activeCount, waitingCount, totalCount: activeCount + waitingCount };
}
async function recomputeTicketLoadForEngineer(engineerId, engineerName) {
    const c = await (0, collections_1.getCollections)();
    const now = new Date();
    const { activeCount, waitingCount, totalCount } = await countTicketLoadForEngineer(engineerId, engineerName);
    await c.ticketLoads.updateOne({ engineerId }, {
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
    }, { upsert: true });
    return { engineerId, activeCount, waitingCount, totalCount, lastUpdated: now, updatedAt: now };
}
async function rebuildTicketLoads() {
    const c = await (0, collections_1.getCollections)();
    const engineers = await c.engineerMasters.find({}).toArray();
    const loads = await Promise.all(engineers.map((engineer) => recomputeTicketLoadForEngineer(engineer.id, engineer.name)));
    return loads;
}
async function upsertEngineerAssignment(input, actor) {
    const c = await (0, collections_1.getCollections)();
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
    const next = {
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
    }
    else {
        await c.engineerAssignments.insertOne(next);
    }
    await c.engineerAssignmentAudit.insertOne({
        id: (0, id_1.generateId)(),
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
async function createOrUpdateEngineerAssignment(input, actor) {
    const result = await upsertEngineerAssignment(input, actor);
    await rebuildTicketLoads();
    return result;
}
async function createOrUpdateEngineerAssignments(input, actor) {
    const districts = Array.from(new Set(input.districts
        .map((district) => normalizeText(district))
        .filter(Boolean)));
    if (!districts.length) {
        throw new Error("At least one district is required");
    }
    const results = [];
    for (const district of districts) {
        results.push(await upsertEngineerAssignment({ ...input, district }, actor));
    }
    await rebuildTicketLoads();
    return {
        assignments: results.map((result) => result.assignment),
        results,
    };
}
async function deleteEngineerAssignment(id, actor) {
    const c = await (0, collections_1.getCollections)();
    const existing = await c.engineerAssignments.findOne({ id });
    if (!existing)
        return null;
    await c.engineerAssignments.deleteOne({ id });
    await c.engineerAssignmentAudit.insertOne({
        id: (0, id_1.generateId)(),
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
async function listEngineerAssignmentAudit(params) {
    const c = await (0, collections_1.getCollections)();
    const q = normalizeKey(params.q);
    const filter = {};
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
async function importEngineerAssignmentsFromWorkbook(filePath, actor) {
    const { rows, warnings } = await parseEngineerAssignmentWorkbook(filePath);
    const c = await (0, collections_1.getCollections)();
    let inserted = 0;
    let updated = 0;
    const now = new Date();
    for (const row of rows) {
        const before = await c.engineerAssignments.findOne({
            state: { $regex: `^${row.state.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" },
            district: { $regex: `^${row.district.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" },
        });
        const result = await createOrUpdateEngineerAssignment(row, actor);
        if (before)
            updated += 1;
        else
            inserted += 1;
        await c.engineerAssignmentAudit.updateOne({ assignmentId: result.assignment.id, action: before ? "updated" : "created", createdAt: result.assignment.updatedAt }, { $set: { action: "imported", note: `Imported from ${node_path_1.default.basename(filePath)}` } }).catch(() => undefined);
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
        id: (0, id_1.generateId)(),
        assignmentId: "bulk-import",
        action: "imported",
        note: `Imported ${rows.length} assignment row(s) from ${node_path_1.default.basename(filePath)}.`,
        by: actor?.userId,
        byName: actor?.name,
        createdAt: now,
    });
    return { inserted, updated, deleted, warnings, rows };
}
