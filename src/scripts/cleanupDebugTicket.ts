import { getCollections } from "../db/collections";

async function run() {
  const c = await getCollections();
  const result = await c.complaints.deleteMany({ issueDescription: { $regex: "DEBUGTEST" } });
  console.log(`Deleted ${result.deletedCount} debug complaint(s).`);
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
