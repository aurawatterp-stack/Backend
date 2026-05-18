"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.seedDatabaseIfEmpty = seedDatabaseIfEmpty;
const collections_1 = require("./collections");
const mockDb_1 = require("./mockDb");
async function seedDatabaseIfEmpty() {
    const c = await (0, collections_1.getCollections)();
    const existingUsers = await c.users.estimatedDocumentCount();
    if (existingUsers > 0)
        return;
    // Seed minimal baseline so the app can login and show initial lists.
    if (mockDb_1.db.users.length)
        await c.users.insertMany(mockDb_1.db.users);
    if (mockDb_1.db.customers.length)
        await c.customers.insertMany(mockDb_1.db.customers);
    if (mockDb_1.db.products.length)
        await c.products.insertMany(mockDb_1.db.products);
    if (mockDb_1.db.distributors.length)
        await c.distributors.insertMany(mockDb_1.db.distributors);
}
