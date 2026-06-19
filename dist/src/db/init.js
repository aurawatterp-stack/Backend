"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initDatabase = initDatabase;
const collections_1 = require("./collections");
const rbac_1 = require("../rbac");
const complaintRules_1 = require("../utils/complaintRules");
const id_1 = require("../utils/id");
const engineerAssignments_1 = require("../services/engineerAssignments");
async function ensureUniqueIndex(col, fields) {
    await col.createIndex(fields, { unique: true, background: true });
}
async function ensureSparseUniqueIndex(col, fields) {
    const targetName = Object.entries(fields).map(([key, value]) => `${key}_${value}`).join("_");
    const indexes = await col.indexes();
    const existing = indexes.find((index) => index.name === targetName);
    if (existing && !existing.sparse) {
        try {
            await col.dropIndex(targetName);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (!message.includes("index not found"))
                throw err;
        }
    }
    await col.createIndex(fields, { unique: true, sparse: true, background: true });
}
async function ensurePartialUniqueStringIndex(col, fields) {
    const targetName = Object.entries(fields).map(([key, value]) => `${key}_${value}`).join("_");
    const indexes = await col.indexes();
    const existing = indexes.find((index) => index.name === targetName);
    if (existing && !existing.partialFilterExpression) {
        await col.dropIndex(targetName);
    }
    const field = Object.keys(fields)[0];
    await col.createIndex(fields, {
        unique: true,
        background: true,
        partialFilterExpression: { [field]: { $type: "string" } },
    });
}
async function ensureIndex(col, fields) {
    await col.createIndex(fields, { background: true });
}
async function dropIndexIfExists(col, fields) {
    const targetName = Object.entries(fields).map(([key, value]) => `${key}_${value}`).join("_");
    const indexes = await col.indexes();
    if (indexes.some((index) => index.name === targetName)) {
        try {
            await col.dropIndex(targetName);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (!message.includes("index not found"))
                throw err;
        }
    }
}
function isLegacyTerminalComplaintStatus(status) {
    const normalized = (0, complaintRules_1.normalizeComplaintSerialKey)(status);
    return /(^| )(?:closed|complete|completed|cancelled|canceled|rejected|duplicate)( |$)/.test(normalized) || /(^| )resolved( |$)/.test(normalized);
}
function shouldClearComplaintSerialKey(complaint) {
    return Boolean(complaint.closedAt) || (0, complaintRules_1.isClosedComplaintStatus)(complaint.status) || isLegacyTerminalComplaintStatus(complaint.status);
}
async function repairComplaintSerialKeyIndex(col) {
    const complaintsWithSerialKey = await col
        .find({ productSerialNoKey: { $type: "string" } }, {
        projection: {
            id: 1,
            productSerialNoKey: 1,
            status: 1,
            closedAt: 1,
            updatedAt: 1,
            createdAt: 1,
        },
    })
        .sort({ productSerialNoKey: 1, updatedAt: -1, createdAt: -1, id: 1 })
        .toArray();
    const duplicateComplaintIds = [];
    const seenSerialKeys = new Set();
    for (const complaint of complaintsWithSerialKey) {
        const serialKey = (0, complaintRules_1.normalizeComplaintSerialKey)(complaint.productSerialNoKey);
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
        await col.updateMany({ id: { $in: duplicateComplaintIds } }, { $unset: { productSerialNoKey: "" } });
    }
}
function isDuplicateKeyError(err) {
    const message = err instanceof Error ? err.message : String(err);
    return message.includes("E11000 duplicate key error") || (typeof err === "object" && err !== null && "code" in err && err.code === 11000);
}
async function initDatabase() {
    const c = await (0, collections_1.getCollections)();
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
        await ensureUniqueIndex(col, { id: 1 });
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
    await Promise.all(complaintsWithSerial.map((complaint) => c.complaints.updateOne({ id: complaint.id }, {
        $set: {
            productSerialNoKey: (0, complaintRules_1.normalizeComplaintSerialKey)(complaint.productSerialNo),
        },
    })));
    await c.complaints.updateMany({
        status: { $in: [...complaintRules_1.CLOSED_COMPLAINT_STATUSES] },
        productSerialNoKey: { $type: "string" },
    }, {
        $unset: { productSerialNoKey: "" },
    });
    await repairComplaintSerialKeyIndex(c.complaints);
    try {
        await ensureSparseUniqueIndex(c.complaints, { productSerialNoKey: 1 });
    }
    catch (err) {
        if (!isDuplicateKeyError(err))
            throw err;
        console.warn("DB init: retrying complaint serial index build after repairing duplicate keys.");
        try {
            await repairComplaintSerialKeyIndex(c.complaints);
            await ensureSparseUniqueIndex(c.complaints, { productSerialNoKey: 1 });
        }
        catch (retryErr) {
            if (!isDuplicateKeyError(retryErr))
                throw retryErr;
            console.warn("DB init: complaint serial index still has legacy duplicates after repair; starting without enforcing the index on boot.");
        }
    }
    await (0, engineerAssignments_1.seedEngineerAssignmentsIfEmpty)();
    // Seed system roles (insert-only; never overwrite admin customizations).
    const now = new Date();
    for (const name of Object.keys(rbac_1.DEFAULT_ROLE_PERMISSIONS)) {
        const permissions = rbac_1.DEFAULT_ROLE_PERMISSIONS[name];
        await c.roles.updateOne({ name }, {
            $setOnInsert: {
                id: (0, id_1.generateId)(),
                name,
                isSystem: true,
                createdAt: now,
                updatedAt: now,
            },
            $addToSet: {
                permissions: { $each: permissions },
            },
        }, { upsert: true });
    }
}
