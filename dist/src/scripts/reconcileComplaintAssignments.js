"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const connect_1 = require("../db/connect");
const collections_1 = require("../db/collections");
const mongo_1 = require("../db/mongo");
const engineerAssignments_1 = require("../services/engineerAssignments");
const serviceRegions_1 = require("../utils/serviceRegions");
function normalizeText(value) {
    return String(value ?? "").trim();
}
function normalizeServiceLevel(complaint) {
    const explicit = normalizeText(complaint.escalationLevel).toUpperCase();
    if (explicit === "L2")
        return "L2";
    if (explicit === "L3")
        return "L3";
    if (complaint.status === "Escalated to L2")
        return "L2";
    if (complaint.status === "Escalated to L3" || complaint.status === "Pending L3 Approval")
        return "L3";
    return "L1";
}
function currentEngineName(complaint) {
    return normalizeText(complaint.assignedEngineerName || complaint.engineerName);
}
async function main() {
    const connectivity = await (0, connect_1.connectDatabase)();
    if (!connectivity.connected) {
        console.error(connectivity.message);
        process.exit(1);
    }
    const c = await (0, collections_1.getCollections)();
    const complaints = await c.complaints.find({
        type: "Consumer",
        state: { $type: "string" },
        district: { $type: "string" },
        status: { $nin: ["Resolved by Aurawatt", "Resolved by Suppliers"] },
    }).toArray();
    let scanned = 0;
    let updated = 0;
    let relabelled = 0;
    let missingMapping = 0;
    for (const complaint of complaints) {
        scanned += 1;
        const state = normalizeText(complaint.state);
        const district = normalizeText(complaint.district);
        const level = normalizeServiceLevel(complaint);
        const set = {};
        // Region is only a label, and a wrong one is what makes a correctly routed ticket look like it
        // went to an engineer from another region. Recompute it from the district/state the ticket is
        // actually routed by, using the same rule the API applies to new tickets.
        const region = (0, serviceRegions_1.resolveComplaintRegionName)(complaint);
        if (region !== normalizeText(complaint.region)) {
            set.region = region;
            relabelled += 1;
            console.log(`Relabelled ${complaint.id} (${complaint.productSerialNo || "no-serial"}) ${state} / ${district}: region ${normalizeText(complaint.region) || "none"} -> ${region}`);
        }
        // Onsite tickets are deliberately parked with the onsite engineer — repointing them at the
        // mapped L1/L2 would pull the ticket away from the visit that is in progress.
        const mapping = level === "L3" || complaint.status === "Assigned for Onsite"
            ? null
            : await (0, engineerAssignments_1.resolveAssignmentByStateDistrict)(state, district);
        const target = level === "L2" ? mapping?.l2Engineer : mapping?.l1Engineer;
        if (mapping && !target) {
            missingMapping += 1;
        }
        const currentId = normalizeText(complaint.assignedEngineerId);
        const currentName = currentEngineName(complaint);
        const alreadyCorrect = Boolean(target) && currentId === target.id && currentName.toLowerCase() === target.name.toLowerCase();
        if (target && !alreadyCorrect) {
            set.assignedEngineerId = target.id;
            set.assignedEngineerName = target.name;
            set.engineerName = target.name;
            set.backupEngineerName = mapping?.backupEngineer?.name ?? complaint.backupEngineerName;
            updated += 1;
            console.log(`Reassigned ${complaint.id} (${complaint.productSerialNo || "no-serial"}) ${state} / ${district}: ${currentName || currentId || "unassigned"} -> ${target.name} (${level})`);
        }
        if (!Object.keys(set).length)
            continue;
        set.updatedAt = new Date();
        await c.complaints.updateOne({ id: complaint.id }, { $set: set });
    }
    await (0, engineerAssignments_1.rebuildTicketLoads)();
    const client = await (0, mongo_1.getMongoClient)();
    await client.close();
    console.log(`Scanned ${scanned} consumer complaints.`);
    console.log(`Reassigned ${updated} complaint(s) to their mapped engineer.`);
    console.log(`Relabelled the region on ${relabelled} complaint(s).`);
    console.log(`Missing mapping for ${missingMapping} complaint(s) — configure these in Engineer Assignment Management.`);
}
main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
});
