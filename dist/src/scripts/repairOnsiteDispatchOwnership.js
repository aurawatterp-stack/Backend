"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Repairs onsite tickets whose dispatch ownership was overwritten with the onsite engineer.
 *
 * Until the dispatch-ownership fix, any save on a ticket already sitting in "Assigned for Onsite"
 * re-ran the dispatch block and re-stamped `siteVisitRequestedBy*` / `siteVisitAssignedBy*` with
 * whoever made that call — normally the onsite engineer updating their own inspection form. When the
 * engineer then pressed "Updates done, progress sent to L2", the ticket was handed back to that
 * engineer instead of the L2 who had sent it, so it vanished from the L2 queue and could not be
 * closed by anyone.
 *
 * This restores the real dispatcher from the ticket's own workflow history and, for tickets already
 * returned ("Escalated to L2"), points the assignment back at that L2 so it reappears in their
 * queue for closure.
 *
 * Dry run by default — prints what it would change. Pass --apply to write.
 *
 *   npm run repair:onsite-ownership            # preview
 *   npm run repair:onsite-ownership -- --apply # apply
 */
const connect_1 = require("../db/connect");
const collections_1 = require("../db/collections");
const mongo_1 = require("../db/mongo");
const engineerAssignments_1 = require("../services/engineerAssignments");
const CLOSED_STATUSES = ["Resolved by Aurawatt", "Resolved by Suppliers"];
function normalizeText(value) {
    return String(value ?? "").trim();
}
function normalizeLookup(value) {
    return normalizeText(value).toLowerCase().replace(/\s+/g, " ");
}
function isL1Role(role) {
    return role === "L1 Engineer" || role === "Backup" || role === "L1 Backup Engineer";
}
/** The last non-L1 user who dispatched this onsite visit, according to the ticket's history. */
function findDispatcherFromHistory(complaint) {
    for (const event of [...(complaint.workflowHistory ?? [])].reverse()) {
        if (event.action !== "Assigned for onsite" || isL1Role(event.byRole))
            continue;
        const id = normalizeText(event.by);
        const name = normalizeText(event.byName);
        if (!id && !name)
            continue;
        return { id, name, role: normalizeText(event.byRole) || undefined };
    }
    return null;
}
async function main() {
    const apply = process.argv.includes("--apply");
    const connectivity = await (0, connect_1.connectDatabase)();
    if (!connectivity.connected) {
        console.error(connectivity.message);
        process.exit(1);
    }
    const c = await (0, collections_1.getCollections)();
    const complaints = await c.complaints.find({
        type: "Consumer",
        siteVisitRequired: true,
        status: { $nin: CLOSED_STATUSES },
    }).toArray();
    let scanned = 0;
    let repaired = 0;
    let reassigned = 0;
    for (const complaint of complaints) {
        scanned += 1;
        const onsiteEngineerName = normalizeLookup(complaint.siteVisitEngineerName);
        const recordedRequesterName = normalizeLookup(complaint.siteVisitRequestedByName);
        const recordedAssignerName = normalizeLookup(complaint.siteVisitAssignedByName);
        // The tell-tale of a clobbered record: the ticket says the onsite engineer dispatched it.
        const ownershipClobbered = Boolean(onsiteEngineerName) && (recordedRequesterName === onsiteEngineerName || recordedAssignerName === onsiteEngineerName);
        if (!ownershipClobbered)
            continue;
        const dispatcher = findDispatcherFromHistory(complaint);
        if (!dispatcher) {
            console.log(`SKIP ${complaint.ticketNumber || complaint.id}: no L2/L3 "Assigned for onsite" event in history to restore from.`);
            continue;
        }
        const set = {
            siteVisitRequestedById: dispatcher.id || undefined,
            siteVisitRequestedByName: dispatcher.name || undefined,
            siteVisitRequestedByRole: dispatcher.role,
            siteVisitAssignedById: dispatcher.id || undefined,
            siteVisitAssignedByName: dispatcher.name || undefined,
            siteVisitAssignedByRole: dispatcher.role,
        };
        console.log(`REPAIR ${complaint.ticketNumber || complaint.id} (${complaint.status}): dispatcher ${normalizeText(complaint.siteVisitRequestedByName) || "unknown"} -> ${dispatcher.name}`);
        repaired += 1;
        // A ticket the engineer already sent back is sitting on the wrong owner — hand it to the L2 who
        // dispatched it so it shows up in their queue and they can close it.
        if (complaint.status === "Escalated to L2" && normalizeLookup(complaint.assignedEngineerName) === onsiteEngineerName) {
            set.assignedEngineerId = dispatcher.id || undefined;
            set.assignedEngineerName = dispatcher.name || undefined;
            set.engineerName = dispatcher.name || undefined;
            set.assignmentStatus = "Assigned";
            reassigned += 1;
            console.log(`       returned ticket reassigned ${normalizeText(complaint.assignedEngineerName)} -> ${dispatcher.name} for closure`);
        }
        if (!apply)
            continue;
        set.updatedAt = new Date();
        const unset = {};
        for (const [key, value] of Object.entries(set)) {
            if (value === undefined)
                unset[key] = "";
        }
        const update = { $set: set };
        if (Object.keys(unset).length)
            update.$unset = unset;
        await c.complaints.updateOne({ id: complaint.id }, update);
    }
    if (apply && repaired) {
        await (0, engineerAssignments_1.rebuildTicketLoads)();
    }
    const client = await (0, mongo_1.getMongoClient)();
    await client.close();
    console.log(`\nScanned ${scanned} open onsite ticket(s).`);
    console.log(`${apply ? "Repaired" : "Would repair"} dispatch ownership on ${repaired} ticket(s).`);
    console.log(`${apply ? "Reassigned" : "Would reassign"} ${reassigned} returned ticket(s) back to the dispatching L2.`);
    if (!apply)
        console.log("\nDry run only — re-run with --apply to write these changes.");
}
main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
});
