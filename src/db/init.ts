import type { Collection, Document } from "mongodb";

import { getCollections } from "./collections";

async function ensureUniqueIndex<T extends Document>(col: Collection<T>, fields: Record<string, 1>) {
  await col.createIndex(fields as any, { unique: true, background: true });
}

async function ensureIndex<T extends Document>(col: Collection<T>, fields: Record<string, 1>) {
  await col.createIndex(fields as any, { background: true });
}

export async function initDatabase() {
  const c = await getCollections();

  await ensureUniqueIndex(c.users, { id: 1 });
  await ensureUniqueIndex(c.users, { email: 1 });
  await ensureIndex(c.users, { role: 1 });

  await ensureUniqueIndex(c.pendingRegistrations, { id: 1 });
  await ensureUniqueIndex(c.pendingRegistrations, { email: 1 });

  for (const col of [
    c.customers,
    c.products,
    c.rawMaterials,
    c.manufactured,
    c.serials,
    c.sales,
    c.complaints,
    c.distributors,
  ]) {
    await ensureUniqueIndex(col as any, { id: 1 });
  }

  await ensureIndex(c.serials, { serialNumber: 1 });
  await ensureIndex(c.manufactured, { serialNumber: 1 });
}
