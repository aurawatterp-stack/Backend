import type { Collection } from "mongodb";

import type {
  Complaint,
  Customer,
  Distributor,
  ManufacturedProduct,
  PendingRegistration,
  Product,
  RawMaterial,
  Sale,
  SerialEntry,
  User,
} from "../types";
import { getMongoDb } from "./mongo";

export type Collections = {
  users: Collection<User>;
  pendingRegistrations: Collection<PendingRegistration>;
  customers: Collection<Customer>;
  products: Collection<Product>;
  rawMaterials: Collection<RawMaterial>;
  manufactured: Collection<ManufacturedProduct>;
  serials: Collection<SerialEntry>;
  sales: Collection<Sale>;
  complaints: Collection<Complaint>;
  distributors: Collection<Distributor>;
};

export async function getCollections(): Promise<Collections> {
  const db = await getMongoDb();
  return {
    users: db.collection<User>("users"),
    pendingRegistrations: db.collection<PendingRegistration>("pending_registrations"),
    customers: db.collection<Customer>("customers"),
    products: db.collection<Product>("products"),
    rawMaterials: db.collection<RawMaterial>("raw_materials"),
    manufactured: db.collection<ManufacturedProduct>("manufactured"),
    serials: db.collection<SerialEntry>("serials"),
    sales: db.collection<Sale>("sales"),
    complaints: db.collection<Complaint>("complaints"),
    distributors: db.collection<Distributor>("distributors"),
  };
}

