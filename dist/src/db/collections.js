"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCollections = getCollections;
const mongo_1 = require("./mongo");
async function getCollections() {
    const db = await (0, mongo_1.getMongoDb)();
    return {
        users: db.collection("users"),
        roles: db.collection("roles"),
        engineerMasters: db.collection("engineer_master"),
        engineerAssignments: db.collection("engineer_assignment"),
        ticketLoads: db.collection("ticket_load"),
        engineerAssignmentAudit: db.collection("engineer_assignment_audit"),
        pendingRegistrations: db.collection("pending_registrations"),
        pendingCustomerRegistrations: db.collection("pending_customer_registrations"),
        customers: db.collection("customers"),
        products: db.collection("products"),
        rawMaterials: db.collection("raw_materials"),
        manufactured: db.collection("manufactured"),
        serials: db.collection("serials"),
        sales: db.collection("sales"),
        complaints: db.collection("complaints"),
        distributors: db.collection("distributors"),
        notifications: db.collection("notifications"),
        boms: db.collection("series_boms"),
        inventoryLogs: db.collection("inventory_logs"),
        spareRequests: db.collection("spare_requests"),
        replacementRequests: db.collection("replacement_requests"),
    };
}
