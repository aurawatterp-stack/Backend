"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const collections_1 = require("../db/collections");
async function run() {
    const c = await (0, collections_1.getCollections)();
    const result = await c.complaints.deleteMany({ issueDescription: { $regex: "DEBUGTEST" } });
    console.log(`Deleted ${result.deletedCount} debug complaint(s).`);
    process.exit(0);
}
run().catch((err) => {
    console.error(err);
    process.exit(1);
});
