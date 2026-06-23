import { getCollections } from "../db/collections";
import { generateId } from "../utils/id";

async function sync() {
  const c = await getCollections();
  
  const sales = await c.sales.find({}).toArray();
  console.log(`Found ${sales.length} sales to check...`);

  let newManufactured = 0;
  let newSerials = 0;
  let updatedSerials = 0;

  for (const sale of sales) {
    if (!sale.serialNumber) continue;
    
    const product = await c.products.findOne({ model: sale.materialName });
    const seriesName = product?.series || "Unknown";

    // 1. Ensure SerialEntry exists and is marked as "Sold"
    const serialEntry = await c.serials.findOne({ serialNumber: sale.serialNumber });
    if (!serialEntry) {
      await c.serials.insertOne({
        id: generateId(),
        serialNumber: sale.serialNumber,
        productSeriesId: seriesName,
        status: "Sold",
        importFileName: "Migrated from Sales",
        uploadedAt: new Date()
      });
      newSerials++;
    } else if (serialEntry.status !== "Sold") {
      await c.serials.updateOne(
        { id: serialEntry.id },
        { $set: { status: "Sold" } }
      );
      updatedSerials++;
    }

    // 2. Ensure ManufacturedProduct exists
    const mfg = await c.manufactured.findOne({ serialNumber: sale.serialNumber });
    if (!mfg) {
      await c.manufactured.insertOne({
        id: generateId(),
        serialNumber: sale.serialNumber,
        productId: product?.id || "",
        status: "Sold",
        customerId: sale.customerId,
        invoiceNo: sale.referenceNo,
        soldDate: sale.saleDate,
        paymentStatus: "Verified",
        mfgDate: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      });
      newManufactured++;
    } else if (mfg.status !== "Sold") {
      await c.manufactured.updateOne(
        { id: mfg.id },
        { $set: { status: "Sold", invoiceNo: sale.referenceNo, customerId: sale.customerId, soldDate: sale.saleDate } }
      );
    }
  }

  console.log(`Sync complete!`);
  console.log(`New Manufactured records created: ${newManufactured}`);
  console.log(`New Serials created: ${newSerials}`);
  console.log(`Serials updated to Sold: ${updatedSerials}`);
  process.exit(0);
}

sync().catch(console.error);
