import type { Collection, Document } from "mongodb";

import { getCollections } from "./collections";
import { DEFAULT_ROLE_PERMISSIONS } from "../rbac";
import { CLOSED_COMPLAINT_STATUSES, isClosedComplaintStatus, normalizeComplaintSerialKey } from "../utils/complaintRules";
import { generateId } from "../utils/id";
import type { Complaint, SystemRoleName } from "../types";
import { seedEngineerAssignmentsIfEmpty } from "../services/engineerAssignments";

async function ensureUniqueIndex<T extends Document>(col: Collection<T>, fields: Record<string, 1 | -1>) {
  await col.createIndex(fields as any, { unique: true, background: true });
}

async function ensureSparseUniqueIndex<T extends Document>(col: Collection<T>, fields: Record<string, 1 | -1>) {
  const targetName = Object.entries(fields).map(([key, value]) => `${key}_${value}`).join("_");
  const indexes = await col.indexes();
  const existing = indexes.find((index) => index.name === targetName);
  if (existing && !existing.sparse) {
    try {
      await col.dropIndex(targetName);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("index not found")) throw err;
    }
  }
  await col.createIndex(fields as any, { unique: true, sparse: true, background: true });
}

async function ensurePartialUniqueStringIndex<T extends Document>(col: Collection<T>, fields: Record<string, 1 | -1>) {
  const targetName = Object.entries(fields).map(([key, value]) => `${key}_${value}`).join("_");
  const indexes = await col.indexes();
  const existing = indexes.find((index) => index.name === targetName);
  if (existing && !existing.partialFilterExpression) {
    await col.dropIndex(targetName);
  }
  const field = Object.keys(fields)[0];
  await col.createIndex(fields as any, {
    unique: true,
    background: true,
    partialFilterExpression: { [field]: { $type: "string" } },
  });
}

async function ensureIndex<T extends Document>(col: Collection<T>, fields: Record<string, 1 | -1>) {
  await col.createIndex(fields as any, { background: true });
}

async function dropIndexIfExists<T extends Document>(col: Collection<T>, fields: Record<string, 1 | -1>) {
  const targetName = Object.entries(fields).map(([key, value]) => `${key}_${value}`).join("_");
  const indexes = await col.indexes();
  if (indexes.some((index) => index.name === targetName)) {
    try {
      await col.dropIndex(targetName);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("index not found")) throw err;
    }
  }
}

function isLegacyTerminalComplaintStatus(status: unknown) {
  const normalized = normalizeComplaintSerialKey(status);
  return /(^| )(?:closed|complete|completed|cancelled|canceled|rejected|duplicate)( |$)/.test(normalized) || /(^| )resolved( |$)/.test(normalized);
}

function shouldClearComplaintSerialKey(complaint: Pick<Complaint, "status" | "closedAt">) {
  return Boolean(complaint.closedAt) || isClosedComplaintStatus(complaint.status) || isLegacyTerminalComplaintStatus(complaint.status);
}

async function repairComplaintSerialKeyIndex(col: Collection<Complaint>) {
  const complaintsWithSerialKey = await col
    .find(
      { productSerialNoKey: { $type: "string" } },
      {
        projection: {
          id: 1,
          productSerialNoKey: 1,
          status: 1,
          closedAt: 1,
          updatedAt: 1,
          createdAt: 1,
        },
      }
    )
    .sort({ productSerialNoKey: 1, updatedAt: -1, createdAt: -1, id: 1 })
    .toArray();

  const duplicateComplaintIds: string[] = [];
  const seenSerialKeys = new Set<string>();

  for (const complaint of complaintsWithSerialKey) {
    const serialKey = normalizeComplaintSerialKey(complaint.productSerialNoKey);
    if (!serialKey || shouldClearComplaintSerialKey(complaint)) {
      duplicateComplaintIds.push(complaint.id);
      continue;
    }

    if (seenSerialKeys.has(serialKey)) {
      duplicateComplaintIds.push(complaint.id);
      continue;
    }

    seenSerialKeys.add(serialKey);
  }

  if (duplicateComplaintIds.length) {
    console.warn(`DB init: clearing productSerialNoKey from ${duplicateComplaintIds.length} complaint(s) so the unique serial index can be built.`);
    await col.updateMany(
      { id: { $in: duplicateComplaintIds } },
      { $unset: { productSerialNoKey: "" } }
    );
  }
}

function isDuplicateKeyError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("E11000 duplicate key error") || (typeof err === "object" && err !== null && "code" in err && (err as { code?: unknown }).code === 11000);
}

export async function initDatabase() {
  const c = await getCollections();

  await ensureUniqueIndex(c.users, { id: 1 });
  await ensureUniqueIndex(c.users, { email: 1 });
  await ensureIndex(c.users, { role: 1 });

  await ensureUniqueIndex(c.roles, { id: 1 });
  await ensureUniqueIndex(c.roles, { name: 1 });
  await ensureIndex(c.roles, { updatedAt: -1 });

  await ensureUniqueIndex(c.engineerMasters, { id: 1 });
  await ensureIndex(c.engineerMasters, { role: 1 });
  await ensureIndex(c.engineerMasters, { name: 1 });
  await ensureUniqueIndex(c.engineerAssignments, { id: 1 });
  await ensureUniqueIndex(c.engineerAssignments, { state: 1, district: 1 });
  await ensureIndex(c.engineerAssignments, { state: 1 });
  await ensureIndex(c.engineerAssignments, { district: 1 });
  await ensureUniqueIndex(c.ticketLoads, { id: 1 });
  await ensureUniqueIndex(c.ticketLoads, { engineerId: 1 });
  await ensureUniqueIndex(c.ticketAssignmentAudit, { id: 1 });
  await ensureIndex(c.ticketAssignmentAudit, { ticketId: 1 });
  await ensureIndex(c.ticketAssignmentAudit, { assignedAt: -1 });
  await ensureIndex(c.engineerAssignmentAudit, { createdAt: -1 });
  await ensureIndex(c.engineerAssignmentAudit, { assignmentId: 1 });

  await ensureUniqueIndex(c.pendingRegistrations, { id: 1 });
  await ensureUniqueIndex(c.pendingRegistrations, { email: 1 });
  await ensureUniqueIndex(c.pendingCustomerRegistrations, { id: 1 });
  await ensurePartialUniqueStringIndex(c.pendingCustomerRegistrations, { email: 1 });

  for (const col of [
    c.customers,
    c.products,
    c.rawMaterials,
    c.manufactured,
    c.serials,
    c.sales,
    c.complaints,
    c.distributors,
    c.notifications,
    c.engineerMasters,
    c.engineerAssignments,
    c.ticketLoads,
    c.ticketAssignmentAudit,
    c.engineerAssignmentAudit,
  ]) {
    await ensureUniqueIndex(col as any, { id: 1 });
  }

  await ensureIndex(c.serials, { serialNumber: 1 });
  await ensureIndex(c.manufactured, { serialNumber: 1 });
  await ensureIndex(c.notifications, { createdAt: -1 });
  await ensureIndex(c.notifications, { audienceRoles: 1 });
  await ensureIndex(c.notifications, { audienceUserIds: 1 });

  // Remove any pre-existing complaint serial index before we normalize old rows.
  // Otherwise the cleanup writes can trip the unique constraint before we get a
  // chance to repair the collection.
  await dropIndexIfExists(c.complaints, { productSerialNoKey: 1 });

  const complaintsWithSerial = await c.complaints
    .find({ productSerialNo: { $type: "string" } }, { projection: { id: 1, productSerialNo: 1, productSerialNoKey: 1 } })
    .toArray();
  await Promise.all(
    complaintsWithSerial.map((complaint) => c.complaints.updateOne(
      { id: complaint.id },
      {
        $set: {
          productSerialNoKey: normalizeComplaintSerialKey(complaint.productSerialNo),
        },
      }
    ))
  );
  await c.complaints.updateMany(
    {
      status: { $in: [...CLOSED_COMPLAINT_STATUSES] },
      productSerialNoKey: { $type: "string" },
    },
    {
      $unset: { productSerialNoKey: "" },
    }
  );

  await repairComplaintSerialKeyIndex(c.complaints);

  try {
    await ensureSparseUniqueIndex(c.complaints, { productSerialNoKey: 1 });
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err;
    console.warn("DB init: retrying complaint serial index build after repairing duplicate keys.");
    try {
      await repairComplaintSerialKeyIndex(c.complaints);
      await ensureSparseUniqueIndex(c.complaints, { productSerialNoKey: 1 });
    } catch (retryErr) {
      if (!isDuplicateKeyError(retryErr)) throw retryErr;
      console.warn("DB init: complaint serial index still has legacy duplicates after repair; starting without enforcing the index on boot.");
    }
  }

  await seedEngineerAssignmentsIfEmpty();

  // Seed system roles (insert-only; never overwrite admin customizations).
  const now = new Date();
  for (const name of Object.keys(DEFAULT_ROLE_PERMISSIONS) as SystemRoleName[]) {
    const permissions = DEFAULT_ROLE_PERMISSIONS[name];
    await c.roles.updateOne(
      { name },
      {
        $setOnInsert: {
          id: generateId(),
          name,
          isSystem: true,
          createdAt: now,
          updatedAt: now,
        },
        $addToSet: {
          permissions: { $each: permissions },
        },
      },
      { upsert: true }
    );
  }
}
