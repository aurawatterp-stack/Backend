import type { Collection } from "mongodb";

import type {
  Complaint,
  Customer,
  Distributor,
  EngineerAssignment,
  EngineerAssignmentAudit,
  EngineerMaster,
  ManufacturedProduct,
  PendingRegistration,
  PendingCustomerRegistration,
  Product,
  RawMaterial,
  Sale,
  SerialEntry,
  TicketLoad,
  User,
  Notification,
  Role,
  TicketAssignmentLog,
  SeriesBOM,
  InventoryLog,
  SpareRequest,
  ReplacementRequest,
  InwardMaster,
  InwardItemDetail,
  Counter,
} from "../types";
import { getMongoDb } from "./mongo";

export type Collections = {
  users: Collection<User>;
  roles: Collection<Role>;
  engineerMasters: Collection<EngineerMaster>;
  engineerAssignments: Collection<EngineerAssignment>;
  ticketLoads: Collection<TicketLoad>;
  engineerAssignmentAudit: Collection<EngineerAssignmentAudit>;
  ticketAssignmentAudit: Collection<TicketAssignmentLog>;
  pendingRegistrations: Collection<PendingRegistration>;
  pendingCustomerRegistrations: Collection<PendingCustomerRegistration>;
  customers: Collection<Customer>;
  products: Collection<Product>;
  rawMaterials: Collection<RawMaterial>;
  manufactured: Collection<ManufacturedProduct>;
  serials: Collection<SerialEntry>;
  sales: Collection<Sale>;
  complaints: Collection<Complaint>;
  distributors: Collection<Distributor>;
  notifications: Collection<Notification>;
  boms: Collection<SeriesBOM>;
  inventoryLogs: Collection<InventoryLog>;
  spareRequests: Collection<SpareRequest>;
  replacementRequests: Collection<ReplacementRequest>;
  inwardMaster: Collection<InwardMaster>;
  inwardItemDetails: Collection<InwardItemDetail>;
  counters: Collection<Counter>;
};

export async function getCollections(): Promise<Collections> {
  const db = await getMongoDb();
  return {
    users: db.collection<User>("users"),
    roles: db.collection<Role>("roles"),
    engineerMasters: db.collection<EngineerMaster>("engineer_master"),
    engineerAssignments: db.collection<EngineerAssignment>("engineer_assignment"),
    ticketLoads: db.collection<TicketLoad>("ticket_load"),
    engineerAssignmentAudit: db.collection<EngineerAssignmentAudit>("engineer_assignment_audit"),
    ticketAssignmentAudit: db.collection<TicketAssignmentLog>("ticket_assignment_audit"),
    pendingRegistrations: db.collection<PendingRegistration>("pending_registrations"),
    pendingCustomerRegistrations: db.collection<PendingCustomerRegistration>("pending_customer_registrations"),
    customers: db.collection<Customer>("customers"),
    products: db.collection<Product>("products"),
    rawMaterials: db.collection<RawMaterial>("raw_materials"),
    manufactured: db.collection<ManufacturedProduct>("manufactured"),
    serials: db.collection<SerialEntry>("serials"),
    sales: db.collection<Sale>("sales"),
    complaints: db.collection<Complaint>("complaints"),
    distributors: db.collection<Distributor>("distributors"),
    notifications: db.collection<Notification>("notifications"),
    boms: db.collection<SeriesBOM>("boms"),
    inventoryLogs: db.collection<InventoryLog>("inventoryLogs"),
    spareRequests: db.collection<SpareRequest>("spareRequests"),
    replacementRequests: db.collection<ReplacementRequest>("replacementRequests"),
    inwardMaster: db.collection<InwardMaster>("inward_master"),
    inwardItemDetails: db.collection<InwardItemDetail>("inward_item_details"),
    counters: db.collection<Counter>("counters"),
  };
}
