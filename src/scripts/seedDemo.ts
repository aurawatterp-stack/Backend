import { connectDatabase } from "../db/connect";
import { initDatabase } from "../db/init";
import { getCollections } from "../db/collections";
import { db as mockDb } from "../db/mockDb";

async function main() {
  const db = await connectDatabase();
  if (!db.connected) {
    console.error(db.message);
    process.exit(1);
  }

  await initDatabase();

  const c = await getCollections();
  const existing = await c.users.find({}, { projection: { email: 1 } }).toArray();
  const existingEmails = new Set(existing.map((u) => String((u as any).email || "").toLowerCase()));
  const toInsert = mockDb.users.filter((u) => !existingEmails.has(u.email.toLowerCase()));
  if (toInsert.length) {
    await c.users.insertMany(toInsert);
    console.log(`Inserted ${toInsert.length} demo users.`);
  } else {
    console.log("No demo users to insert (already present).");
  }

  const roles = await c.roles.find({}).sort({ name: 1 }).toArray();
  console.log(`Roles in DB: ${roles.map((r) => r.name).join(", ")}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

