"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initDatabase = initDatabase;
const collections_1 = require("./collections");
async function ensureUniqueIndex(col, fields) {
    await col.createIndex(fields, { unique: true, background: true });
}
async function ensureIndex(col, fields) {
    await col.createIndex(fields, { background: true });
}
async function initDatabase() {
    const c = await (0, collections_1.getCollections)();
    await ensureUniqueIndex(c.users, { id: 1 });
    await ensureUniqueIndex(c.users, { email: 1 });
    await ensureIndex(c.users, { role: 1 });
    await ensureUniqueIndex(c.pendingRegistrations, { id: 1 });
    await ensureUniqueIndex(c.pendingRegistrations, { email: 1 });
    for (const col of [
        c.customers,
        c.products,
        c.rawMaterials,
        c.manufactured,
        c.serials,
        c.sales,
        c.complaints,
        c.distributors,
    ]) {
        await ensureUniqueIndex(col, { id: 1 });
    }
    await ensureIndex(c.serials, { serialNumber: 1 });
    await ensureIndex(c.manufactured, { serialNumber: 1 });
}
