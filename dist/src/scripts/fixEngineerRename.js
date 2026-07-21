"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const connect_1 = require("../db/connect");
const collections_1 = require("../db/collections");
const mongo_1 = require("../db/mongo");
const engineerAssignments_1 = require("../services/engineerAssignments");
/**
 * Repairs the references left behind when an engineer account was renamed in User Management
 * before renames migrated engineer_master / assignment / complaint references automatically.
 *
 * Usage: npx tsx src/scripts/fixEngineerRename.ts "<old name>" "<new name>" [L1|L2|L3]
 * Example: npx tsx src/scripts/fixEngineerRename.ts "Bhaskar" "Piyush" L1
 */
async function main() {
    const [oldName, newName, roleArg] = process.argv.slice(2);
    if (!oldName || !newName) {
        console.error('Usage: npx tsx src/scripts/fixEngineerRename.ts "<old name>" "<new name>" [L1|L2|L3]');
        process.exit(1);
    }
    const normalizedRole = (roleArg ?? "L1").toUpperCase();
    const role = normalizedRole === "L2" ? "L2" : normalizedRole === "L3" ? "L3" : "L1";
    const connectivity = await (0, connect_1.connectDatabase)();
    if (!connectivity.connected) {
        console.error(connectivity.message);
        process.exit(1);
    }
    const c = await (0, collections_1.getCollections)();
    const result = await (0, engineerAssignments_1.migrateEngineerIdentity)({ oldName, newName, oldRole: role, newRole: role });
    if (!result.migrated) {
        console.log(`Nothing to migrate: "${oldName}" and "${newName}" resolve to the same ${role} identity (${result.newId}).`);
    }
    else {
        console.log(`Migrated ${role} engineer "${oldName}" (${result.oldId}) -> "${newName}" (${result.newId}).`);
        console.log(`District assignment references updated: ${result.assignments}`);
        console.log(`Complaint ticket references updated: ${result.complaints}`);
    }
    const newId = (0, engineerAssignments_1.engineerMasterId)(newName, role);
    const [assignmentCount, ticketCount, master] = await Promise.all([
        c.engineerAssignments.countDocuments({ $or: [{ l1EngineerId: newId }, { l2EngineerId: newId }, { l1BackupEngineerId: newId }] }),
        c.complaints.countDocuments({ assignedEngineerId: newId }),
        c.engineerMasters.findOne({ id: newId }),
    ]);
    console.log(`Now: engineer_master ${master ? `"${master.name}" (isActive: ${master.isActive !== false})` : "MISSING"}, ${assignmentCount} district assignment(s), ${ticketCount} assigned ticket(s).`);
    if (!assignmentCount) {
        console.warn("Warning: no district assignments reference this engineer — re-map their districts in the Engineer Assignment module or new tickets will not route to them.");
    }
    const client = await (0, mongo_1.getMongoClient)();
    await client.close();
}
main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
});
