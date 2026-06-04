"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const connect_1 = require("../db/connect");
const init_1 = require("../db/init");
const collections_1 = require("../db/collections");
const mockDb_1 = require("../db/mockDb");
async function main() {
    const db = await (0, connect_1.connectDatabase)();
    if (!db.connected) {
        console.error(db.message);
        process.exit(1);
    }
    await (0, init_1.initDatabase)();
    const c = await (0, collections_1.getCollections)();
    const existing = await c.users.find({}, { projection: { email: 1 } }).toArray();
    const existingEmails = new Set(existing.map((u) => String(u.email || "").toLowerCase()));
    const toInsert = mockDb_1.db.users.filter((u) => !existingEmails.has(u.email.toLowerCase()));
    if (toInsert.length) {
        await c.users.insertMany(toInsert);
        console.log(`Inserted ${toInsert.length} demo users.`);
    }
    else {
        console.log("No demo users to insert (already present).");
    }
    const existingProducts = await c.products.find({}, { projection: { id: 1, model: 1 } }).toArray();
    const existingProductModels = new Set(existingProducts.map((p) => String(p.model || "").toLowerCase()));
    const productsToInsert = mockDb_1.db.products.filter((p) => !existingProductModels.has(p.model.toLowerCase()));
    if (productsToInsert.length) {
        await c.products.insertMany(productsToInsert);
        console.log(`Inserted ${productsToInsert.length} demo products.`);
    }
    else {
        console.log("No demo products to insert (already present).");
    }
    let productsUpdated = 0;
    for (const product of mockDb_1.db.products) {
        const hasPricing = product.hsnSac !== undefined ||
            product.gstRate !== undefined ||
            product.dealerPrice !== undefined ||
            product.distributorPrice !== undefined;
        if (!hasPricing)
            continue;
        const result = await c.products.updateOne({ model: product.model }, {
            $set: {
                hsnSac: product.hsnSac,
                gstRate: product.gstRate,
                dealerPrice: product.dealerPrice,
                distributorPrice: product.distributorPrice,
            },
        });
        if (result.modifiedCount)
            productsUpdated += 1;
    }
    console.log(`Updated pricing for ${productsUpdated} demo products.`);
    const roles = await c.roles.find({}).sort({ name: 1 }).toArray();
    console.log(`Roles in DB: ${roles.map((r) => r.name).join(", ")}`);
}
main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
});
