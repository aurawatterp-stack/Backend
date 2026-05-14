import { getCollections } from "./collections";
import { db as mockDb } from "./mockDb";

export async function seedDatabaseIfEmpty() {
  const c = await getCollections();
  const existingUsers = await c.users.estimatedDocumentCount();
  if (existingUsers > 0) return;

  // Seed minimal baseline so the app can login and show initial lists.
  if (mockDb.users.length) await c.users.insertMany(mockDb.users);
  if (mockDb.customers.length) await c.customers.insertMany(mockDb.customers);
  if (mockDb.products.length) await c.products.insertMany(mockDb.products);
  if (mockDb.distributors.length) await c.distributors.insertMany(mockDb.distributors);
}

