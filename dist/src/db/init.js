"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initDatabase = initDatabase;
const collections_1 = require("./collections");
const rbac_1 = require("../rbac");
const complaintRules_1 = require("../utils/complaintRules");
const id_1 = require("../utils/id");
async function ensureUniqueIndex(col, fields) {
    await col.createIndex(fields, { unique: true, background: true });
}
async function ensureSparseUniqueIndex(col, fields) {
    const targetName = Object.entries(fields).map(([key, value]) => `${key}_${value}`).join("_");
    const indexes = await col.indexes();
    const existing = indexes.find((index) => index.name === targetName);
    if (existing && !existing.sparse) {
        await col.dropIndex(targetName);
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
async function initDatabase() {
    const c = await (0, collections_1.getCollections)();
    await ensureUniqueIndex(c.users, { id: 1 });
    await ensureUniqueIndex(c.users, { email: 1 });
    await ensureIndex(c.users, { role: 1 });
    await ensureUniqueIndex(c.roles, { id: 1 });
    await ensureUniqueIndex(c.roles, { name: 1 });
    await ensureIndex(c.roles, { updatedAt: -1 });
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
    ]) {
        await ensureUniqueIndex(col, { id: 1 });
    }
    await ensureIndex(c.serials, { serialNumber: 1 });
    await ensureIndex(c.manufactured, { serialNumber: 1 });
    await ensureIndex(c.notifications, { createdAt: -1 });
    await ensureIndex(c.notifications, { audienceRoles: 1 });
    await ensureIndex(c.notifications, { audienceUserIds: 1 });
    const complaintsWithSerial = await c.complaints
        .find({ productSerialNo: { $type: "string" } }, { projection: { id: 1, productSerialNo: 1, productSerialNoKey: 1 } })
        .toArray();
    await Promise.all(complaintsWithSerial.map((complaint) => c.complaints.updateOne({ id: complaint.id }, {
        $set: {
            productSerialNoKey: (0, complaintRules_1.normalizeComplaintSerialKey)(complaint.productSerialNo),
        },
    })));
    await c.complaints.createIndex({ productSerialNoKey: 1 }, {
        unique: true,
        background: true,
        partialFilterExpression: {
            productSerialNoKey: { $type: "string" },
            status: { $nin: [...complaintRules_1.CLOSED_COMPLAINT_STATUSES] },
        },
    });
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
