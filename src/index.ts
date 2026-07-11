import app from "./app";
import { CONFIG } from "./config";
import { connectDatabase } from "./db/connect";
import { initDatabase } from "./db/init";
import { seedDatabaseIfEmpty } from "./db/seed";
import { seedEngineerAssignmentsIfEmpty } from "./services/engineerAssignments";

async function start() {
  console.log(`🧩  Backend build: 2026-05-12T16:10Z`);
  const db = await connectDatabase();
  if (db.connected) {
    console.log(`✅ ${db.message}`);
  } else {
    console.log(`⚠️  ${db.message}`);
  }

  if (db.connected) {
    await initDatabase();
    if (CONFIG.SEED_DB) {
      await seedDatabaseIfEmpty();
      await seedEngineerAssignmentsIfEmpty();
      console.log("🌱  Seeded demo data (SEED_DB=true).");
    }
  }

  app.listen(CONFIG.PORT, () => {
    console.log(`\n🚀  Aurawatt IMS API running on http://localhost:${CONFIG.PORT}`);
    console.log(`📋  Health: http://localhost:${CONFIG.PORT}/health\n`);
  });
}

start().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("Failed to start server:", message);
  process.exit(1);
});
