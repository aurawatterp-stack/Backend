import { connectDatabase } from "../db/connect";
import { getCollections } from "../db/collections";
import { getMongoClient } from "../db/mongo";
import type { Complaint } from "../types";

const FLOW_TAG = "demo-l1-15-ticket-flow";

const engineers = {
  rohit: {
    id: "u-l1-rohit",
    name: "Rohit Sharma",
    backupName: "Amit Verma",
  },
  amit: {
    id: "u-l1-amit",
    name: "Amit Verma",
    backupName: "Rohit Sharma",
  },
};

function hoursAgo(hours: number) {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

function hoursFromNow(hours: number) {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

function buildAssignedTicket(input: {
  index: number;
  engineer: typeof engineers.rohit;
  activeTicketCountAtAssignment: number;
  customerName: string;
  city: string;
  issue: string;
  priority: Complaint["priority"];
}): Complaint {
  const now = new Date();
  const createdAt = hoursAgo(16 - input.index);
  return {
    id: `demo-l1-flow-assigned-${input.engineer.id}-${input.index}`,
    type: "Consumer",
    productSerialNo: `L1DEMO-${String(input.index).padStart(3, "0")}`,
    customerName: input.customerName,
    customerPhone: `90000010${String(input.index).padStart(2, "0")}`,
    customerEmail: `l1demo${input.index}@example.com`,
    dateOfSale: hoursAgo(24 * 40),
    dateOfComplaint: createdAt,
    issueDescription: input.issue,
    ticketSource: input.index % 2 === 0 ? "WhatsApp" : "Call",
    l1Sla: input.priority === "Emergency" ? "2 Hours" : "4 Hours",
    dealerName: "Demo Solar Dealer",
    siteLocation: input.city,
    region: "NCR",
    priority: input.priority,
    warrantyStatus: "In Warranty",
    productModel: "AW-LFP-240-52",
    assignmentStatus: "Assigned",
    assignedEngineerId: input.engineer.id,
    assignedEngineerName: input.engineer.name,
    backupEngineerName: input.engineer.backupName,
    activeTicketCountAtAssignment: input.activeTicketCountAtAssignment,
    slaStartedAt: createdAt,
    slaDueAt: hoursFromNow(2 + input.index),
    slaPaused: false,
    initialAction: "Demo seed: auto assigned to L1 engineer for 15-ticket flow.",
    trackingNotes: FLOW_TAG,
    escalationLevel: "L1",
    status: input.index % 3 === 0 ? "In Progress at Aurawatt" : "Assigned to Engineer",
    raisedBy: "seed:l1-demo-tickets",
    createdAt,
    updatedAt: now,
  };
}

function buildWaitingTicket(input: {
  queuePosition: number;
  overflowFromEngineer: typeof engineers.rohit;
  customerName: string;
  city: string;
  issue: string;
  priority: Complaint["priority"];
}): Complaint {
  const now = new Date();
  const createdAt = hoursAgo(5 - input.queuePosition);
  return {
    id: `demo-l1-flow-waiting-${input.queuePosition}`,
    type: "Consumer",
    productSerialNo: `L1WAIT-${String(input.queuePosition).padStart(3, "0")}`,
    productSerialNoKey: `l1wait-${String(input.queuePosition).padStart(3, "0")}`,
    customerName: input.customerName,
    customerPhone: `90000020${String(input.queuePosition).padStart(2, "0")}`,
    customerEmail: `l1wait${input.queuePosition}@example.com`,
    dateOfSale: hoursAgo(24 * 25),
    dateOfComplaint: createdAt,
    issueDescription: input.issue,
    ticketSource: input.queuePosition % 2 === 0 ? "Link" : "ERP",
    l1Sla: input.priority === "Emergency" ? "2 Hours" : "4 Hours",
    dealerName: "Demo Solar Dealer",
    siteLocation: input.city,
    region: "NCR",
    priority: input.priority,
    warrantyStatus: "In Warranty",
    productModel: "AW-LFP-240-52",
    assignmentStatus: "Waiting",
    assignedEngineerId: input.overflowFromEngineer.id,
    assignedEngineerName: input.overflowFromEngineer.name,
    backupEngineerName: input.overflowFromEngineer.backupName,
    waitingSince: createdAt,
    slaPaused: true,
    queuePosition: input.queuePosition,
    initialAction: `Demo seed: ${input.overflowFromEngineer.name} crossed 5 active tickets, so this ticket moved to Waiting Lobby.`,
    trackingNotes: FLOW_TAG,
    escalationLevel: "L1",
    status: "Waiting Lobby",
    raisedBy: "seed:l1-demo-tickets",
    createdAt,
    updatedAt: now,
  };
}

async function main() {
  const db = await connectDatabase();
  if (!db.connected) {
    console.error(db.message);
    process.exit(1);
  }

  const c = await getCollections();
  const now = new Date();

  await c.users.updateMany(
    { id: { $in: [engineers.rohit.id, engineers.amit.id] } },
    { $set: { isActive: true, updatedAt: now } }
  );

  const deleteResult = await c.complaints.deleteMany({ trackingNotes: FLOW_TAG });

  const rohitAssigned = [
    ["Om Solar Farm", "Noida", "Inverter trips during morning startup", "High"],
    ["Shakti Cold Storage", "Ghaziabad", "Battery charging is unstable", "Medium"],
    ["Greenline Foods", "Delhi", "Plant down after grid fluctuation", "Emergency"],
    ["Metro Warehousing", "Faridabad", "DC string mismatch alert", "Medium"],
    ["Suryam Residency", "Gurugram", "System not starting after reset", "High"],
  ].map(([customerName, city, issue, priority], index) => buildAssignedTicket({
    index: index + 1,
    engineer: engineers.rohit,
    activeTicketCountAtAssignment: index,
    customerName,
    city,
    issue,
    priority: priority as Complaint["priority"],
  }));

  const rohitWaiting = [
    ["Rudra Textiles", "Noida", "Export reading not updating", "Low"],
    ["Bright Hospital", "Delhi", "Repeated AC voltage alarm", "High"],
    ["Arya School", "Ghaziabad", "Battery backup lower than expected", "Medium"],
    ["NCR Logistics", "Gurugram", "Smoke smell near inverter cabinet", "Emergency"],
    ["City Mall", "Faridabad", "Hardware fault shown on display", "Medium"],
  ].map(([customerName, city, issue, priority], index) => buildWaitingTicket({
    queuePosition: index + 1,
    overflowFromEngineer: engineers.rohit,
    customerName,
    city,
    issue,
    priority: priority as Complaint["priority"],
  }));

  const amitAssigned = [
    ["Lotus Apartments", "Delhi", "Inverter showing grid relay error", "High"],
    ["Nexus Office Park", "Noida", "Battery communication warning", "Medium"],
    ["Kanha Dairy", "Ghaziabad", "System down after firmware update", "High"],
    ["Heritage Foods", "Faridabad", "String 2 input not detected", "Medium"],
    ["Alpha Residency", "Gurugram", "Remote monitoring offline", "Low"],
  ].map(([customerName, city, issue, priority], index) => buildAssignedTicket({
    index: index + 11,
    engineer: engineers.amit,
    activeTicketCountAtAssignment: index,
    customerName,
    city,
    issue,
    priority: priority as Complaint["priority"],
  }));

  const tickets = [...rohitAssigned, ...rohitWaiting, ...amitAssigned];
  await c.complaints.insertMany(tickets);

  console.log(`Deleted ${deleteResult.deletedCount} old L1 demo tickets.`);
  console.log("Inserted 15 L1 demo tickets:");
  console.log("- Rohit Sharma: 5 active assigned tickets");
  console.log("- Waiting Lobby: 5 overflow tickets from Rohit Sharma");
  console.log("- Amit Verma: 5 active assigned tickets");

  const client = await getMongoClient();
  await client.close();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
