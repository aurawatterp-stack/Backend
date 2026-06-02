import type { Collection, Document } from "mongodb";

import { getCollections } from "./collections";
import { DEFAULT_ROLE_PERMISSIONS } from "../rbac";
import { generateId } from "../utils/id";
import type { SystemRoleName } from "../types";

async function ensureUniqueIndex<T extends Document>(col: Collection<T>, fields: Record<string, 1 | -1>) {
  await col.createIndex(fields as any, { unique: true, background: true });
}

async function ensureIndex<T extends Document>(col: Collection<T>, fields: Record<string, 1 | -1>) {
  await col.createIndex(fields as any, { background: true });
}

export async function initDatabase() {
  const c = await getCollections();

  await ensureUniqueIndex(c.users, { id: 1 });
  await ensureUniqueIndex(c.users, { email: 1 });
  await ensureIndex(c.users, { role: 1 });

  await ensureUniqueIndex(c.roles, { id: 1 });
  await ensureUniqueIndex(c.roles, { name: 1 });
  await ensureIndex(c.roles, { updatedAt: -1 });

  await ensureUniqueIndex(c.pendingRegistrations, { id: 1 });
  await ensureUniqueIndex(c.pendingRegistrations, { email: 1 });
  await ensureUniqueIndex(c.pendingCustomerRegistrations, { id: 1 });
  await ensureUniqueIndex(c.pendingCustomerRegistrations, { email: 1 });

  for (const col of [
    c.customers,
    c.products,
    c.rawMaterials,
    c.manufactured,
    c.serials,
    c.sales,
    c.complaints,
    c.distributors,
    c.notifications,
  ]) {
    await ensureUniqueIndex(col as any, { id: 1 });
  }

  await ensureIndex(c.serials, { serialNumber: 1 });
  await ensureIndex(c.manufactured, { serialNumber: 1 });
  await ensureIndex(c.notifications, { createdAt: -1 });
  await ensureIndex(c.notifications, { audienceRoles: 1 });
  await ensureIndex(c.notifications, { audienceUserIds: 1 });

  // Seed system roles (insert-only; never overwrite admin customizations).
  const now = new Date();
  for (const name of Object.keys(DEFAULT_ROLE_PERMISSIONS) as SystemRoleName[]) {
    const permissions = DEFAULT_ROLE_PERMISSIONS[name];
    await c.roles.updateOne(
      { name },
      {
        $setOnInsert: {
          id: generateId(),
          name,
          permissions,
          isSystem: true,
          createdAt: now,
          updatedAt: now,
        },
      },
      { upsert: true }
    );
  }
}
