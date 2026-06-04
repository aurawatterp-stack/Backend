import { connectDatabase } from "../db/connect";
import { getCollections } from "../db/collections";
import { initDatabase } from "../db/init";
import type { ManufacturedProduct, Product, SerialEntry } from "../types";
import { generateId } from "../utils/id";

const demoProducts = [
  {
    series: "Aurawatt SP Series",
    model: "AW-SP-4KW/48V Inverter",
    hsnSac: "8504",
    gstRate: 5,
    dealerPrice: 120,
    distributorPrice: 100,
    qty: 8,
    prefix: "AW-SP4-26",
  },
  {
    series: "Aurawatt SP Series",
    model: "AW-SP-5KW/48V Inverter",
    hsnSac: "8504",
    gstRate: 5,
    dealerPrice: 240,
    distributorPrice: 200,
    qty: 15,
    prefix: "AW-SP5-26",
  },
  {
    series: "Aurawatt SP Series",
    model: "AW-SP-10KW/48V Inverter",
    hsnSac: "8504",
    gstRate: 5,
    dealerPrice: 240,
    distributorPrice: 200,
    qty: 6,
    prefix: "AW-SP10-26",
  },
  {
    series: "Li-ion (LFP) Battery - AW LVLFP",
    model: "51.2V/100AH",
    hsnSac: "8504",
    gstRate: 18,
    dealerPrice: 360,
    distributorPrice: 300,
    qty: 10,
    prefix: "AW-LFP8504-26",
  },
  {
    series: "Li-ion (LFP) Battery - AW LVLFP",
    model: "51.2V/100AH - HSN 8507",
    hsnSac: "8507",
    gstRate: 18,
    dealerPrice: 480,
    distributorPrice: 400,
    qty: 7,
    prefix: "AW-LFP8507-26",
  },
] as const;

async function upsertProduct(product: (typeof demoProducts)[number]): Promise<Product> {
  const c = await getCollections();
  const now = new Date();
  const existing = await c.products.findOne({ model: product.model });
  const base: Product = {
    id: existing?.id ?? `demo-${product.prefix.toLowerCase()}`,
    series: product.series,
    model: product.model,
    hsnSac: product.hsnSac,
    gstRate: product.gstRate,
    dealerPrice: product.dealerPrice,
    distributorPrice: product.distributorPrice,
    createdAt: existing?.createdAt ?? now,
  };

  await c.products.updateOne(
    { model: product.model },
    {
      $set: {
        series: base.series,
        hsnSac: base.hsnSac,
        gstRate: base.gstRate,
        dealerPrice: base.dealerPrice,
        distributorPrice: base.distributorPrice,
        updatedAt: now,
      },
      $setOnInsert: {
        id: base.id,
        model: base.model,
        createdAt: base.createdAt,
      },
    },
    { upsert: true }
  );

  const saved = await c.products.findOne({ model: product.model });
  if (!saved) throw new Error(`Failed to upsert product ${product.model}`);
  return saved;
}

async function main() {
  const db = await connectDatabase();
  if (!db.connected) {
    console.error(db.message);
    process.exit(1);
  }

  await initDatabase();
  const c = await getCollections();
  const now = new Date();
  const mfgDate = new Date("2026-06-04T00:00:00.000Z");
  let productsReady = 0;
  let serialsInserted = 0;
  let manufacturedInserted = 0;
  let duplicatesSkipped = 0;

  for (const demoProduct of demoProducts) {
    const product = await upsertProduct(demoProduct);
    productsReady += 1;

    for (let i = 1; i <= demoProduct.qty; i += 1) {
      const serialNumber = `${demoProduct.prefix}-${String(i).padStart(4, "0")}`;
      const existingManufactured = await c.manufactured.findOne({ serialNumber }, { projection: { id: 1 } });
      if (existingManufactured) {
        duplicatesSkipped += 1;
        continue;
      }

      const existingSerial = await c.serials.findOne({ serialNumber }, { projection: { id: 1 } });
      if (!existingSerial) {
        const serialEntry: SerialEntry = {
          id: generateId(),
          serialNumber,
          productSeriesId: product.series,
          status: "Used",
          importFileName: "demo-inventory-serials.csv",
          uploadedAt: now,
        };
        await c.serials.insertOne(serialEntry);
        serialsInserted += 1;
      }

      const manufacturedEntry: ManufacturedProduct = {
        id: generateId(),
        productId: product.id,
        serialNumber,
        mfgDate,
        status: "In Stock",
        invoiceNo: "DEMO-STOCK",
        paymentStatus: "N/A",
        createdAt: now,
        updatedAt: now,
      };
      await c.manufactured.insertOne(manufacturedEntry);
      manufacturedInserted += 1;
    }
  }

  console.log(`Products ready: ${productsReady}`);
  console.log(`Serial pool entries inserted: ${serialsInserted}`);
  console.log(`Manufactured In Stock entries inserted: ${manufacturedInserted}`);
  console.log(`Duplicate manufactured serials skipped: ${duplicatesSkipped}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
