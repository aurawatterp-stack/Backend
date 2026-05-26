import { getCollections } from "./collections";
import { db as mockDb } from "./mockDb";

export async function seedDatabaseIfEmpty() {
  const c = await getCollections();
  const existingUsers = await c.users.find({}, { projection: { email: 1 } }).toArray();
  const existingEmails = new Set(existingUsers.map((u) => String((u as any).email || "").toLowerCase()));

  const usersToInsert = mockDb.users.filter((u) => !existingEmails.has(u.email.toLowerCase()));
  if (usersToInsert.length) await c.users.insertMany(usersToInsert);

  // Seed minimal baseline for first-time DB only (keep non-user collections stable).
  const usersCount = await c.users.estimatedDocumentCount();
  if (usersCount === usersToInsert.length) {
    if (mockDb.customers.length) await c.customers.insertMany(mockDb.customers);
    if (mockDb.products.length) await c.products.insertMany(mockDb.products);
    if (mockDb.distributors.length) await c.distributors.insertMany(mockDb.distributors);
  }
}
