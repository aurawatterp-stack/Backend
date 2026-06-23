import * as xlsx from "xlsx";
import { getCollections } from "../db/collections";
import { updateSerialStatus } from "../utils/serialLifecycle";
import { generateId } from "../utils/id";
import * as dotenv from "dotenv";

dotenv.config();

function normalizeKey(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

async function run() {
  const c = await getCollections();
  console.log("Connected to MongoDB!");

  // 1. Delete Demo Data
  const demoPrefixes = [/^Acme Distributors/, /^Global Traders/, /^Southern Supplies/];
  for (const prefix of demoPrefixes) {
    const res1 = await c.customers.deleteMany({ name: { $regex: prefix } });
    const res2 = await c.pendingCustomerRegistrations.deleteMany({ name: { $regex: prefix } });
    console.log(`Deleted ${res1.deletedCount} customers and ${res2.deletedCount} pending requests matching ${prefix}`);
  }

  // 2. Read Excel Data
  const excelPath = "d:/bma/Aurawat/Aurawatt_15Mar2026_to_Last_Verified.xlsx";
  const workbook = xlsx.readFile(excelPath);
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
  
  if (!rows.length) {
    console.log("No data found in Excel");
    process.exit(0);
  }

  const headers = rows[0].map(h => normalizeKey(h));
  console.log("Parsed Headers:", headers);
  
  let salesAdded = 0;
  let rowsSkipped = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const data: Record<string, any> = {};
    headers.forEach((h, idx) => {
      data[h] = row[idx];
    });

    const customerName = String(data["customers info"] ?? "").trim();
    const serialNumber = String(data["s no"] ?? "").trim();
    const modelType = String(data["model type"] ?? "").trim();
    const rawSaleDate = data["sales date"];
    const documentType = String(data["document type ti"] ?? "TI").trim();
    const refNo = String(data["ref no"] ?? "").trim();

    if (!customerName || !modelType) {
      rowsSkipped++;
      console.log(`Row ${i} skipped: Missing Customer Name or Model Type`);
      continue;
    }

    // A. Match Customer strictly or CREATE if missing
    let customer = await c.customers.findOne({ name: { $regex: new RegExp(`^${customerName}$`, "i") } });
    if (!customer) {
      const newCustomer = {
        id: generateId(),
        name: customerName,
        type: "Distributor" as const,
        phone: "0000000000",
        status: "Active" as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await c.customers.insertOne(newCustomer);
      customer = newCustomer as any;
      console.log(`Row ${i}: Created new customer '${customerName}'`);
    }

    // B. Match Product to get Series
    let product = await c.products.findOne({ model: { $regex: new RegExp(`^${modelType}$`, "i") } });
    if (!product) {
      // Fallback to series match if exact model is missing
      product = await c.products.findOne({ series: { $regex: new RegExp(`^${modelType}`, "i") } });
    }

    if (!product) {
      rowsSkipped++;
      console.log(`Row ${i} skipped: Product/Model '${modelType}' not found in DB`);
      continue;
    }

    // Parse Excel date (serial format)
    let saleDate = new Date();
    if (typeof rawSaleDate === "number") {
      saleDate = new Date((rawSaleDate - (25567 + 2)) * 86400 * 1000); // Excel to JS date
    }

    // C. Create Sale Entry
    const saleId = generateId();
    await c.sales.insertOne({
      id: saleId,
      saleDate,
      serialNumber: serialNumber || undefined,
      documentType,
      referenceNo: refNo,
      customerId: customer!.id,
      customerName: customer!.name,
      materialName: product.model,
      quantity: 1, // default
      createdBy: "system_migration",
      createdAt: new Date(),
      paymentStatus: "Confirmed",
      dispatchStatus: "Dispatched",
      piWorkflowStatus: "Dispatched",
      piItems: [
        {
          materialName: product.model,
          hsnSac: product.hsnSac || "8504",
          quantity: 1,
          rate: product.dealerPrice || 0,
          gstRate: product.gstRate || 0
        }
      ]
    });
    salesAdded++;

    // D. Update Serial Status
    if (serialNumber) {
      const mfg = await c.manufactured.findOne({ serialNumber });
      if (mfg) {
        await c.manufactured.updateOne(
          { id: mfg.id },
          {
            $set: {
              status: "Sold",
              invoiceNo: refNo,
              customerId: customer!.id,
              soldDate: saleDate,
              paymentStatus: "Verified",
              updatedAt: new Date()
            }
          }
        );
        await updateSerialStatus(c, {
          serialNumber,
          status: "Sold"
        });
      } else {
        console.log(`Row ${i} warning: Serial '${serialNumber}' not found in manufactured inventory`);
      }
    }

    // E. Deduct Raw Materials based on BOM
    const bom = await c.boms.findOne({ series: product.series });
    if (bom && bom.items && bom.items.length > 0) {
      for (const item of bom.items) {
        let requiredQty = item.quantity;
        
        // Find raw material batches sorted by oldest first
        const rmBatches = await c.rawMaterials.find({
          materialName: item.materialName,
          quantityAvailable: { $gt: 0 }
        }).sort({ dateReceived: 1 }).toArray();

        let batchIdx = 0;
        while (requiredQty > 0 && batchIdx < rmBatches.length) {
          const batch = rmBatches[batchIdx];
          const deductAmt = Math.min(requiredQty, batch.quantityAvailable);
          
          await c.rawMaterials.updateOne(
            { id: batch.id },
            { 
              $inc: { quantityAvailable: -deductAmt },
              $set: { updatedAt: new Date() }
            }
          );

          // Log the deduction
          await c.inventoryLogs.insertOne({
            id: generateId(),
            type: "Sales Dispatch",
            itemId: batch.id,
            itemName: batch.materialName,
            quantityChange: -deductAmt,
            referenceId: saleId,
            notes: `Deducted for sale of ${product.model} (S No: ${serialNumber || 'N/A'})`,
            createdAt: new Date(),
            createdBy: "system_migration"
          });

          requiredQty -= deductAmt;
          batchIdx++;
        }

        if (requiredQty > 0) {
          console.log(`Row ${i} warning: Not enough inventory for RM '${item.materialName}'. Short by ${requiredQty}.`);
        }
      }
    } else {
      console.log(`Row ${i} warning: No BOM found for series '${product.series}'`);
    }
  }

  console.log(`Migration Complete! Sales added: ${salesAdded}, Rows skipped: ${rowsSkipped}`);
  process.exit(0);
}

run().catch(err => {
  console.error("Migration Error:", err);
  process.exit(1);
});
