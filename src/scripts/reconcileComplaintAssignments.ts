import { connectDatabase } from "../db/connect";
import { getCollections } from "../db/collections";
import { getMongoClient } from "../db/mongo";
import { rebuildTicketLoads, resolveAssignmentByStateDistrict } from "../services/engineerAssignments";
import type { Complaint } from "../types";

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeServiceLevel(complaint: Complaint): "L1" | "L2" | "L3" {
  const explicit = normalizeText(complaint.escalationLevel).toUpperCase();
  if (explicit === "L2") return "L2";
  if (explicit === "L3") return "L3";
  if (complaint.status === "Escalated to L2") return "L2";
  if (complaint.status === "Escalated to L3" || complaint.status === "Pending L3 Approval") return "L3";
  return "L1";
}

function currentEngineName(complaint: Complaint) {
  return normalizeText(complaint.assignedEngineerName || complaint.engineerName);
}

async function main() {
  const connectivity = await connectDatabase();
  if (!connectivity.connected) {
    console.error(connectivity.message);
    process.exit(1);
  }

  const c = await getCollections();
  const complaints = await c.complaints.find({
    type: "Consumer",
    state: { $type: "string" },
    district: { $type: "string" },
    status: { $nin: ["Resolved by Aurawatt", "Resolved by Suppliers"] },
  }).toArray();

  let scanned = 0;
  let updated = 0;
  let missingMapping = 0;

  for (const complaint of complaints) {
    scanned += 1;
    const level = normalizeServiceLevel(complaint);
    if (level !== "L2") continue;

    const state = normalizeText(complaint.state);
    const district = normalizeText(complaint.district);
    const mapping = await resolveAssignmentByStateDistrict(state, district);
    const target = mapping?.l2Engineer;
    if (!target) {
      missingMapping += 1;
      continue;
    }

    const currentId = normalizeText(complaint.assignedEngineerId);
    const currentName = currentEngineName(complaint);
    if (currentId === target.id && currentName.toLowerCase() === target.name.toLowerCase()) {
      continue;
    }

    await c.complaints.updateOne(
      { id: complaint.id },
      {
        $set: {
          assignedEngineerId: target.id,
          assignedEngineerName: target.name,
          engineerName: target.name,
          backupEngineerName: mapping.backupEngineer?.name ?? complaint.backupEngineerName,
          updatedAt: new Date(),
        },
      }
    );

    updated += 1;
    console.log(
      `Reassigned ${complaint.id} (${complaint.productSerialNo || "no-serial"}) ${state} / ${district}: ${currentName || currentId || "unassigned"} -> ${target.name}`
    );
  }

  await rebuildTicketLoads();
  const client = await getMongoClient();
  await client.close();
  console.log(`Scanned ${scanned} consumer complaints.`);
  console.log(`Updated ${updated} complaint(s).`);
  console.log(`Missing mapping for ${missingMapping} complaint(s).`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
