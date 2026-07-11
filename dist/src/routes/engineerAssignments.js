"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const multer_1 = __importDefault(require("multer"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const collections_1 = require("../db/collections");
const auth_1 = require("../middleware/auth");
const http_1 = require("../utils/http");
const engineerAssignments_1 = require("../services/engineerAssignments");
const router = express_1.default.Router();
const upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
});
function normalizeId(value) {
    return String(value ?? "").trim();
}
function normalizeDistrictList(value) {
    if (Array.isArray(value)) {
        return value.map((item) => normalizeId(item)).filter(Boolean);
    }
    const single = normalizeId(value);
    return single ? [single] : [];
}
async function enrichAssignments(rows) {
    const c = await (0, collections_1.getCollections)();
    const masterIds = Array.from(new Set(rows.flatMap((row) => [row.l1EngineerId, row.l2EngineerId, row.l1BackupEngineerId])));
    const [masters, loads] = await Promise.all([
        c.engineerMasters.find({ id: { $in: masterIds } }).toArray(),
        c.ticketLoads.find({ engineerId: { $in: masterIds } }).toArray(),
    ]);
    const masterMap = new Map(masters.map((master) => [master.id, master]));
    const loadMap = new Map(loads.map((load) => [load.engineerId, load]));
    return rows.map((row) => ({
        ...row,
        l1Engineer: masterMap.get(row.l1EngineerId) ?? null,
        l2Engineer: masterMap.get(row.l2EngineerId) ?? null,
        l1BackupEngineer: masterMap.get(row.l1BackupEngineerId) ?? null,
        l1Load: loadMap.get(row.l1EngineerId) ?? null,
        l2Load: loadMap.get(row.l2EngineerId) ?? null,
        backupLoad: loadMap.get(row.l1BackupEngineerId) ?? null,
    }));
}
/** GET /api/engineer-assignments/am-i-l1-backup — lets any logged-in engineer check
 * (for themselves only) whether they're configured as the L1 backup engineer for any
 * state/district, so the frontend can show a persistent "L1 Backup" queue tab. */
router.get("/am-i-l1-backup", auth_1.authenticate, async (req, res) => {
    const user = req.user;
    if (!user?.name)
        return (0, http_1.ok)(res, { isL1Backup: false });
    const c = await (0, collections_1.getCollections)();
    const masters = await c.engineerMasters
        .find({ name: user.name, role: { $in: ["L1", "Backup"] } }, { projection: { id: 1 } })
        .toArray();
    const masterIds = masters.map((m) => m.id);
    if (!masterIds.length)
        return (0, http_1.ok)(res, { isL1Backup: false });
    const count = await c.engineerAssignments.countDocuments({ l1BackupEngineerId: { $in: masterIds } });
    return (0, http_1.ok)(res, { isL1Backup: count > 0 });
});
router.get("/", auth_1.authenticate, (0, auth_1.requireAnyPermission)("roles:manage", "users:manage"), async (req, res) => {
    const { q, state, district, page, limit } = req.query;
    const data = await (0, engineerAssignments_1.listEngineerAssignments)({
        q,
        state,
        district,
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
    });
    return (0, http_1.ok)(res, {
        ...data,
        data: await enrichAssignments(data.data),
    });
});
router.get("/options", auth_1.authenticate, (0, auth_1.requireAnyPermission)("roles:manage", "users:manage"), async (_req, res) => {
    const data = await (0, engineerAssignments_1.listEngineerAssignmentOptions)();
    return (0, http_1.ok)(res, data);
});
router.get("/audit", auth_1.authenticate, (0, auth_1.requireAnyPermission)("roles:manage", "users:manage"), async (req, res) => {
    const { q, page, limit } = req.query;
    const data = await (0, engineerAssignments_1.listEngineerAssignmentAudit)({
        q,
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
    });
    return (0, http_1.ok)(res, data);
});
router.get("/ticket-loads", auth_1.authenticate, (0, auth_1.requireAnyPermission)("roles:manage", "users:manage"), async (_req, res) => {
    const c = await (0, collections_1.getCollections)();
    const data = await c.ticketLoads.find({}).sort({ updatedAt: -1 }).toArray();
    return (0, http_1.ok)(res, data);
});
router.post("/", auth_1.authenticate, (0, auth_1.requireAnyPermission)("roles:manage", "users:manage"), async (req, res) => {
    const { state, district, districts, l1EngineerName, l2EngineerName, l1BackupEngineerName } = req.body ?? {};
    const districtList = normalizeDistrictList(districts).length ? normalizeDistrictList(districts) : normalizeDistrictList(district);
    if (!state || !districtList.length || !l1EngineerName || !l2EngineerName) {
        return (0, http_1.fail)(res, "state, district(s), l1EngineerName and l2EngineerName are required");
    }
    try {
        if (districtList.length === 1) {
            const result = await (0, engineerAssignments_1.createOrUpdateEngineerAssignment)({ state, district: districtList[0], l1EngineerName, l2EngineerName, l1BackupEngineerName }, req.user);
            return (0, http_1.ok)(res, result, 201);
        }
        const result = await (0, engineerAssignments_1.createOrUpdateEngineerAssignments)({ state, districts: districtList, l1EngineerName, l2EngineerName, l1BackupEngineerName }, req.user);
        return (0, http_1.ok)(res, result, 201);
    }
    catch (err) {
        return (0, http_1.fail)(res, err instanceof Error ? err.message : "Failed to save assignment", 400);
    }
});
router.put("/:id", auth_1.authenticate, (0, auth_1.requireAnyPermission)("roles:manage", "users:manage"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const id = normalizeId(req.params.id);
    const existing = await c.engineerAssignments.findOne({ id });
    if (!existing)
        return (0, http_1.fail)(res, "Assignment not found", 404);
    const nextState = req.body.state ?? existing.state;
    const nextDistrict = req.body.district ?? existing.district;
    const l1EngineerName = req.body.l1EngineerName ?? (await c.engineerMasters.findOne({ id: existing.l1EngineerId }))?.name;
    const l2EngineerName = req.body.l2EngineerName ?? (await c.engineerMasters.findOne({ id: existing.l2EngineerId }))?.name;
    const l1BackupEngineerName = req.body.l1BackupEngineerName ?? (await c.engineerMasters.findOne({ id: existing.l1BackupEngineerId }))?.name;
    if (!l1EngineerName || !l2EngineerName) {
        return (0, http_1.fail)(res, "Unable to resolve engineer names for update", 400);
    }
    try {
        const result = await (0, engineerAssignments_1.createOrUpdateEngineerAssignment)({ state: nextState, district: nextDistrict, l1EngineerName, l2EngineerName, l1BackupEngineerName }, req.user);
        if (result.assignment.id !== existing.id) {
            await c.engineerAssignments.deleteOne({ id: existing.id });
        }
        return (0, http_1.ok)(res, result.assignment);
    }
    catch (err) {
        return (0, http_1.fail)(res, err instanceof Error ? err.message : "Failed to update assignment", 400);
    }
});
router.delete("/:id", auth_1.authenticate, (0, auth_1.requireAnyPermission)("roles:manage", "users:manage"), async (req, res) => {
    const deleted = await (0, engineerAssignments_1.deleteEngineerAssignment)(normalizeId(req.params.id), req.user);
    if (!deleted)
        return (0, http_1.fail)(res, "Assignment not found", 404);
    return (0, http_1.ok)(res, { message: "Assignment deleted" });
});
router.post("/import", auth_1.authenticate, (0, auth_1.requireAnyPermission)("roles:manage", "users:manage"), upload.single("file"), async (req, res) => {
    const file = req.file;
    if (!file)
        return (0, http_1.fail)(res, "Excel file is required");
    const ext = node_path_1.default.extname(file.originalname || "").toLowerCase();
    if (ext !== ".xlsx") {
        return (0, http_1.fail)(res, "Only .xlsx files are supported");
    }
    const tempPath = node_path_1.default.join(node_os_1.default.tmpdir(), `engineer-import-${Date.now()}-${Math.random().toString(16).slice(2)}.xlsx`);
    node_fs_1.default.writeFileSync(tempPath, file.buffer);
    try {
        const data = await (0, engineerAssignments_1.importEngineerAssignmentsFromWorkbook)(tempPath, req.user);
        return (0, http_1.ok)(res, data, 201);
    }
    catch (err) {
        return (0, http_1.fail)(res, err instanceof Error ? err.message : "Failed to import workbook", 400);
    }
    finally {
        try {
            node_fs_1.default.unlinkSync(tempPath);
        }
        catch {
            // ignore
        }
    }
});
router.post("/rebuild-loads", auth_1.authenticate, (0, auth_1.requireAnyPermission)("roles:manage", "users:manage"), async (_req, res) => {
    const data = await (0, engineerAssignments_1.rebuildTicketLoads)();
    return (0, http_1.ok)(res, data);
});
exports.default = router;
