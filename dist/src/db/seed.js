"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.seedDatabaseIfEmpty = seedDatabaseIfEmpty;
const collections_1 = require("./collections");
const mockDb_1 = require("./mockDb");
async function seedDatabaseIfEmpty() {
    const c = await (0, collections_1.getCollections)();
    const existingUsers = await c.users.find({}, { projection: { email: 1 } }).toArray();
    const existingEmails = new Set(existingUsers.map((u) => String(u.email || "").toLowerCase()));
    const usersToInsert = mockDb_1.db.users.filter((u) => !existingEmails.has(u.email.toLowerCase()));
    if (usersToInsert.length)
        await c.users.insertMany(usersToInsert);
    // Seed minimal baseline for first-time DB only (keep non-user collections stable).
    const usersCount = await c.users.estimatedDocumentCount();
    if (usersCount === usersToInsert.length) {
        if (mockDb_1.db.customers.length)
            await c.customers.insertMany(mockDb_1.db.customers);
        if (mockDb_1.db.products.length)
            await c.products.insertMany(mockDb_1.db.products);
        if (mockDb_1.db.distributors.length)
            await c.distributors.insertMany(mockDb_1.db.distributors);
    }
}
