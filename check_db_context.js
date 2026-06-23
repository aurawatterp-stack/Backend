require('dotenv').config();
const { MongoClient } = require('mongodb');

async function check() {
  const uri = process.env.DATABASE_URL || 'mongodb://127.0.0.1:27017/aurawatt';
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();

  // 1. Check demo customers to delete
  const demoCusts = await db.collection('customers').find({
    name: { $in: [/^Acme Distributors/, /^Global Traders/, /^Southern Supplies/] }
  }).toArray();
  console.log("Demo Customers found:", demoCusts.length);

  // 2. Sample BOM mapping
  const products = await db.collection('products').find({ model: 'AW-SP-10000' }).toArray();
  console.log("Products matching AW-SP-10000:", products.map(p => ({ id: p.id, series: p.series, model: p.model })));

  if (products.length > 0) {
    const boms = await db.collection('boms').find({ series: products[0].series }).toArray();
    console.log("BOM for series", products[0].series, boms);
  } else {
    // If exact model match fails, maybe it's in series directly?
    const seriesProducts = await db.collection('products').find({ series: /AURAWATT SP SERIES/i }).limit(3).toArray();
    console.log("Fallback Series Products:", seriesProducts.map(p => ({ id: p.id, series: p.series, model: p.model })));
  }

  await client.close();
}
check().catch(console.error);
