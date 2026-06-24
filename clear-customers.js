const { MongoClient } = require("mongodb");
require("dotenv").config();

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("No MONGODB_URI found");
    process.exit(1);
  }
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db();
    const result = await db.collection("customers").deleteMany({});
    console.log(`Deleted ${result.deletedCount} customers.`);
  } finally {
    await client.close();
  }
}

main().catch(console.error);
