import type { Collection } from "mongodb";

import type {
  Complaint,
  Customer,
  Distributor,
  ManufacturedProduct,
  PendingRegistration,
  PendingCustomerRegistration,
  Product,
  RawMaterial,
  Sale,
  SerialEntry,
  User,
  Notification,
  Role,
} from "../types";
import { getMongoDb } from "./mongo";

export type Collections = {
  users: Collection<User>;
  roles: Collection<Role>;
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
};

export async function getCollections(): Promise<Collections> {
  const db = await getMongoDb();
  return {
    users: db.collection<User>("users"),
    roles: db.collection<Role>("roles"),
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
  };
}
