import express, { type Request, type Response, type Router } from "express";
import multer from "multer";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getCollections } from "../db/collections";
import { authenticate, requireAnyPermission } from "../middleware/auth";
import { fail, ok } from "../utils/http";
import {
  createOrUpdateEngineerAssignment,
  createOrUpdateEngineerAssignments,
  deleteEngineerAssignment,
  importEngineerAssignmentsFromWorkbook,
  listEngineerAssignmentAudit,
  listEngineerAssignmentOptions,
  listEngineerAssignments,
  rebuildTicketLoads,
} from "../services/engineerAssignments";

const router: Router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

function normalizeId(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeDistrictList(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeId(item)).filter(Boolean);
  }
  const single = normalizeId(value);
  return single ? [single] : [];
}

async function enrichAssignments(rows: Awaited<ReturnType<typeof listEngineerAssignments>>["data"]) {
  const c = await getCollections();
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

router.get("/", authenticate, requireAnyPermission("roles:manage", "users:manage"), async (req: Request, res: Response) => {
  const { q, state, district, page, limit } = req.query as Record<string, string>;
  const data = await listEngineerAssignments({
    q,
    state,
    district,
    page: page ? Number(page) : undefined,
    limit: limit ? Number(limit) : undefined,
  });
  return ok(res, {
    ...data,
    data: await enrichAssignments(data.data),
  });
});

router.get("/options", authenticate, requireAnyPermission("roles:manage", "users:manage"), async (_req: Request, res: Response) => {
  const data = await listEngineerAssignmentOptions();
  return ok(res, data);
});

router.get("/audit", authenticate, requireAnyPermission("roles:manage", "users:manage"), async (req: Request, res: Response) => {
  const { q, page, limit } = req.query as Record<string, string>;
  const data = await listEngineerAssignmentAudit({
    q,
    page: page ? Number(page) : undefined,
    limit: limit ? Number(limit) : undefined,
  });
  return ok(res, data);
});

router.get("/ticket-loads", authenticate, requireAnyPermission("roles:manage", "users:manage"), async (_req: Request, res: Response) => {
  const c = await getCollections();
  const data = await c.ticketLoads.find({}).sort({ updatedAt: -1 }).toArray();
  return ok(res, data);
});

router.post("/", authenticate, requireAnyPermission("roles:manage", "users:manage"), async (req: Request, res: Response) => {
  const { state, district, districts, l1EngineerName, l2EngineerName, l1BackupEngineerName } = req.body ?? {};
  const districtList = normalizeDistrictList(districts).length ? normalizeDistrictList(districts) : normalizeDistrictList(district);
  if (!state || !districtList.length || !l1EngineerName || !l2EngineerName) {
    return fail(res, "state, district(s), l1EngineerName and l2EngineerName are required");
  }
  try {
    if (districtList.length === 1) {
      const result = await createOrUpdateEngineerAssignment(
        { state, district: districtList[0], l1EngineerName, l2EngineerName, l1BackupEngineerName },
        (req as any).user
      );
      return ok(res, result, 201);
    }

    const result = await createOrUpdateEngineerAssignments(
      { state, districts: districtList, l1EngineerName, l2EngineerName, l1BackupEngineerName },
      (req as any).user
    );
    return ok(res, result, 201);
  } catch (err) {
    return fail(res, err instanceof Error ? err.message : "Failed to save assignment", 400);
  }
});

router.put("/:id", authenticate, requireAnyPermission("roles:manage", "users:manage"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const id = normalizeId(req.params.id);
  const existing = await c.engineerAssignments.findOne({ id });
  if (!existing) return fail(res, "Assignment not found", 404);
  const nextState = req.body.state ?? existing.state;
  const nextDistrict = req.body.district ?? existing.district;
  const l1EngineerName = req.body.l1EngineerName ?? (await c.engineerMasters.findOne({ id: existing.l1EngineerId }))?.name;
  const l2EngineerName = req.body.l2EngineerName ?? (await c.engineerMasters.findOne({ id: existing.l2EngineerId }))?.name;
  const l1BackupEngineerName = req.body.l1BackupEngineerName ?? (await c.engineerMasters.findOne({ id: existing.l1BackupEngineerId }))?.name;
  if (!l1EngineerName || !l2EngineerName) {
    return fail(res, "Unable to resolve engineer names for update", 400);
  }
  try {
    const result = await createOrUpdateEngineerAssignment(
      { state: nextState, district: nextDistrict, l1EngineerName, l2EngineerName, l1BackupEngineerName },
      (req as any).user
    );
    if (result.assignment.id !== existing.id) {
      await c.engineerAssignments.deleteOne({ id: existing.id });
    }
    return ok(res, result.assignment);
  } catch (err) {
    return fail(res, err instanceof Error ? err.message : "Failed to update assignment", 400);
  }
});

router.delete("/:id", authenticate, requireAnyPermission("roles:manage", "users:manage"), async (req: Request, res: Response) => {
  const deleted = await deleteEngineerAssignment(normalizeId(req.params.id), (req as any).user);
  if (!deleted) return fail(res, "Assignment not found", 404);
  return ok(res, { message: "Assignment deleted" });
});

router.post(
  "/import",
  authenticate,
  requireAnyPermission("roles:manage", "users:manage"),
  upload.single("file"),
  async (req: Request, res: Response) => {
    const file = req.file;
    if (!file) return fail(res, "Excel file is required");
    const ext = path.extname(file.originalname || "").toLowerCase();
    if (ext !== ".xlsx") {
      return fail(res, "Only .xlsx files are supported");
    }
    const tempPath = path.join(os.tmpdir(), `engineer-import-${Date.now()}-${Math.random().toString(16).slice(2)}.xlsx`);
    fs.writeFileSync(tempPath, file.buffer);
    try {
      const data = await importEngineerAssignmentsFromWorkbook(tempPath, (req as any).user);
      return ok(res, data, 201);
    } catch (err) {
      return fail(res, err instanceof Error ? err.message : "Failed to import workbook", 400);
    } finally {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        // ignore
      }
    }
  }
);

router.post("/rebuild-loads", authenticate, requireAnyPermission("roles:manage", "users:manage"), async (_req: Request, res: Response) => {
  const data = await rebuildTicketLoads();
  return ok(res, data);
});

export default router;

