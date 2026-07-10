import path from "node:path";
import * as xlsx from "xlsx";

import { getCollections, type Collections } from "../db/collections";
import { generateId } from "../utils/id";
import type { Product } from "../types";

type ImportedRow = {
  rowNumber: number;
  data: Record<string, unknown>;
};

type CustomerLike = {
  id: string;
  name: string;
};

type ImportCaches = {
  customersByName: Map<string, CustomerLike>;
  productsByKey: Map<string, Product>;
  manufacturedIdsBySerial: Map<string, string>;
};

const DEFAULT_EXCEL_PATH = "D:/bma/Aurawat/Aurawatt_15Mar2026_to_Last_Verified.xlsx";

function normalizeKey(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeComparable(value: unknown) {
  return normalizeKey(value).replace(/\s+/g, "");
}

function pickField(data: Record<string, unknown>, aliases: string[]) {
  for (const alias of aliases) {
    const value = data[normalizeKey(alias)];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return undefined;
}

function resolveExcelPaths() {
  const args = process.argv.slice(2).filter((arg) => arg && !arg.startsWith("-"));
  if (args.length) return args;

  if (process.env.SALES_EXCEL_PATH) {
    return process.env.SALES_EXCEL_PATH
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  }

  return [DEFAULT_EXCEL_PATH];
}

function readWorkbookRows(excelPath: string): ImportedRow[] {
  const workbook = xlsx.readFile(excelPath, { cellDates: false, cellNF: false, cellHTML: false });
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(worksheet, { header: 1, defval: "", blankrows: false }) as unknown[][];

  if (!rows.length) return [];

  const headers = rows[0].map((header) => normalizeKey(header));
  console.log(`${path.basename(excelPath)} headers:`, headers);

  return rows.slice(1).map((row, index) => {
    const data: Record<string, unknown> = {};
    headers.forEach((header, cellIndex) => {
      if (header) data[header] = row[cellIndex];
    });
    return { rowNumber: index + 2, data };
  });
}

function parseExcelDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;

  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = xlsx.SSF.parse_date_code(value);
    if (parsed) return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
    return new Date((value - 25569) * 86400 * 1000);
  }

  const text = String(value ?? "").trim();
  if (!text) return new Date();

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return parsed;

  return new Date();
}

function inferBatteryModelFromSerial(serialNumber: string) {
  const serial = serialNumber.toUpperCase();
  if (serial.startsWith("AW-LFP-256") || serial.startsWith("AW-LFP-25.6")) return "AW-LFP-25.6";
  if (serial.startsWith("AW-LFP-51.2")) return "AW-LFP-51.2";
  if (serial.startsWith("AW-LFP-48-60")) return "AW-LFP-48-60";
  if (serial.startsWith("AW-LFP-48-70")) return "AW-LFP-48-70";
  return "";
}

// 51.2V batteries share one description in the sheets but are actually 4 distinct BOM
// variants, distinguishable only by serial number suffix/prefix:
//   - contains "/0.5-"  -> "i" variant
//   - ends with "-10"   -> "10" variant
//   - ends with "-5"    -> "5" variant
//   - otherwise         -> "L" variant (plain serials, 16-Dec-2025..20-Mar-2026 batch)
function classify512Variant(serialNumber: string) {
  const s = (serialNumber || "").trim().toUpperCase();
  if (s.includes("/0.5")) return "i";
  if (/-10$/.test(s)) return "10";
  if (/-5$/.test(s)) return "5";
  return "L";
}

function normalizeModelName(modelType: string, serialNumber: string) {
  const model = modelType.trim();
  const comparable = normalizeComparable(model);

  if (!model) return inferBatteryModelFromSerial(serialNumber);
  if (comparable.includes("lvlfp48v70ah")) return "AW-LFP-48-70";
  if (comparable.includes("lvlfp48v60ah")) return "AW-LFP-48-60";
  if (comparable.includes("lvlfp51.2v100ah") || comparable.includes("lvlfp512v100ah")) {
    const variant = classify512Variant(serialNumber);
    if (variant === "i") return "AW-LFP-51.2-i";
    if (variant === "10") return "AW-LFP-51.2 - 10";
    if (variant === "5") return "AW-LFP-51.2 - 5";
    return "AW-LFP-51.2 - L";
  }
  if (comparable.includes("lvlfp25.6v100ah") || comparable.includes("lvlfp256v100ah")) return "AW-LFP-25.6";
  if (comparable.includes("lvlfp240v52ah") || comparable.includes("240v52ah")) return "AW-LFP-240-52";
  if (comparable.includes("hvlfp153.6v100ah") || comparable.includes("1536v100ah")) return "AW-LFP-153.6";

  return model;
}

function inferSeriesForModel(model: string) {
  const upper = model.toUpperCase();
  if (upper.startsWith("AW-SP")) return "SP SERIES";
  if (upper.startsWith("AW-TP")) return "TP SERIES";
  if (upper.includes("25.6")) return "AURAWATT LFP SERIES(25.6V/100AH)";
  if (upper.includes("48-60")) return "AURAWATT LFP SERIES(48V/60AH)";
  if (upper.includes("48-70")) return "AURAWATT LFP SERIES(48V/70AH)";
  if (upper.includes("51.2")) {
    if (upper.includes("-I")) return "AURAWATT LFP SERIES(51.2V/100AH) - i";
    if (upper.includes("- L")) return "AURAWATT LFP SERIES(51.2V/100AH) - L";
    return "AURAWATT LFP SERIES(51.2V/100AH) - 5/10";
  }
  if (upper.includes("240-52")) return "AURAWATT LFP SERIES(12.4KW/240V/52AH)";
  if (upper.includes("153.6")) return "AURAWATT LFP SERIES(153.6V/100AH)";
  return "Imported Sales Products";
}

function cacheProduct(cache: ImportCaches, product: Product) {
  cache.productsByKey.set(normalizeComparable(product.model), product);
  cache.productsByKey.set(normalizeComparable(product.series), product);
}

async function loadCaches(c: Collections): Promise<ImportCaches> {
  const [customers, products, manufactured] = await Promise.all([
    c.customers.find({}, { projection: { id: 1, name: 1 } }).toArray(),
    c.products.find({}, { projection: { id: 1, series: 1, model: 1, hsnSac: 1, gstRate: 1, dealerPrice: 1, distributorPrice: 1, createdAt: 1 } }).toArray(),
    c.manufactured.find({}, { projection: { id: 1, serialNumber: 1 } }).toArray(),
  ]);

  const cache: ImportCaches = {
    customersByName: new Map(),
    productsByKey: new Map(),
    manufacturedIdsBySerial: new Map(),
  };

  for (const customer of customers) cache.customersByName.set(normalizeComparable(customer.name), customer);
  for (const product of products) cacheProduct(cache, product as Product);
  for (const item of manufactured) {
    if (item.serialNumber) cache.manufacturedIdsBySerial.set(String(item.serialNumber).trim(), item.id);
  }

  console.log(`Cached ${customers.length} customers, ${products.length} products, ${manufactured.length} manufactured serials.`);
  return cache;
}

async function resolveProduct(c: Collections, cache: ImportCaches, rawModelType: string, serialNumber: string): Promise<Product> {
  const model = normalizeModelName(rawModelType, serialNumber);
  if (!model) throw new Error("missing model");

  const normalized = normalizeComparable(model);
  const cached = cache.productsByKey.get(normalized);
  if (cached) return cached;

  const now = new Date();
  const product: Product = {
    id: generateId(),
    series: inferSeriesForModel(model),
    model,
    hsnSac: model.startsWith("AW-LFP") ? "8507" : "8504",
    gstRate: model.startsWith("AW-LFP") ? 18 : 5,
    dealerPrice: 0,
    distributorPrice: 0,
    createdAt: now,
  };

  await c.products.insertOne(product);
  cacheProduct(cache, product);
  console.log(`Created missing product '${product.model}' (${product.series})`);
  return product;
}

async function upsertCustomer(c: Collections, cache: ImportCaches, customerName: string) {
  const key = normalizeComparable(customerName);
  const cached = cache.customersByName.get(key);
  if (cached) return cached;

  const now = new Date();
  const customer = {
    id: generateId(),
    name: customerName,
    type: "Distributor" as const,
    phone: "0000000000",
    status: "Active" as const,
    createdAt: now,
    updatedAt: now,
  };

  await c.customers.insertOne(customer);
  cache.customersByName.set(key, customer);
  console.log(`Created new customer '${customerName}'`);
  return customer;
}

async function deductRawMaterialsForSale(c: Collections, product: Product, saleId: string, serialNumber: string) {
  const bom = await c.boms.findOne({ series: product.series });
  if (!bom?.items?.length) {
    console.log(`Warning: no BOM found for series '${product.series}'`);
    return;
  }

  for (const item of bom.items) {
    let requiredQty = item.quantity;
    const rmBatches = await c.rawMaterials
      .find({ materialName: item.materialName, quantityAvailable: { $gt: 0 } })
      .sort({ dateReceived: 1 })
      .toArray();

    let batchIdx = 0;
    while (requiredQty > 0 && batchIdx < rmBatches.length) {
      const batch = rmBatches[batchIdx];
      const deductAmt = Math.min(requiredQty, batch.quantityAvailable);

      await c.rawMaterials.updateOne(
        { id: batch.id },
        {
          $inc: { quantityAvailable: -deductAmt },
          $set: { updatedAt: new Date() },
        }
      );

      await c.inventoryLogs.insertOne({
        id: generateId(),
        type: "Sales Dispatch",
        itemId: batch.id,
        itemName: batch.materialName,
        quantityChange: -deductAmt,
        referenceId: saleId,
        notes: `Deducted for sale of ${product.model} (S No: ${serialNumber || "N/A"})`,
        createdAt: new Date(),
        createdBy: "system_migration",
      });

      requiredQty -= deductAmt;
      batchIdx += 1;
    }

    if (requiredQty > 0) {
      console.log(`Warning: not enough inventory for RM '${item.materialName}'. Short by ${requiredQty}.`);
    }
  }
}

async function run() {
  const c = await getCollections();
  console.log("Connected to MongoDB!");

  const resetSales = String(process.env.RESET_SALES_COLLECTION ?? "true").toLowerCase() !== "false";
  const deductRawMaterials = String(process.env.DEDUCT_RAW_MATERIALS ?? "false").toLowerCase() === "true";

  if (resetSales) {
    const cleared = await c.sales.deleteMany({});
    console.log(`Cleared ${cleared.deletedCount} existing sales record(s).`);
  }

  const demoPrefixes = [/^Acme Distributors/, /^Global Traders/, /^Southern Supplies/];
  for (const prefix of demoPrefixes) {
    const customers = await c.customers.deleteMany({ name: { $regex: prefix } });
    const pending = await c.pendingCustomerRegistrations.deleteMany({ name: { $regex: prefix } });
    console.log(`Deleted ${customers.deletedCount} customers and ${pending.deletedCount} pending requests matching ${prefix}`);
  }

  let salesAdded = 0;
  let rowsSkipped = 0;
  let blankRowsSkipped = 0;
  let manufacturedLinked = 0;
  let missingManufactured = 0;
  const cache = await loadCaches(c);

  for (const excelPath of resolveExcelPaths()) {
    console.log(`\nImporting ${excelPath}`);
    const rows = readWorkbookRows(excelPath);
    if (!rows.length) {
      console.log("No data found in Excel");
      continue;
    }

    for (const { rowNumber, data } of rows) {
      const customerName = String(pickField(data, ["customers info", "customer name", "customer_name"]) ?? "").trim();
      const serialNumber = String(pickField(data, ["s no", "serial number", "serial_number"]) ?? "").trim();
      const rawModelType = String(pickField(data, ["model type", "model_type", "model number", "model_number"]) ?? "").trim();
      const rawSaleDate = pickField(data, ["sales date", "sales_date", "sale date"]);
      const documentType = String(pickField(data, ["document type ti", "document type", "document_type"]) ?? "TI").trim() || "TI";
      const referenceNo = String(pickField(data, ["ref no", "invoice no", "invoice_no", "reference no"]) ?? "").trim();

      if (!customerName && !serialNumber && !rawModelType && !referenceNo && !rawSaleDate) {
        blankRowsSkipped += 1;
        continue;
      }

      const modelType = normalizeModelName(rawModelType, serialNumber);

      let effectiveCustomerName = customerName;
      if (!effectiveCustomerName && modelType) {
        effectiveCustomerName = `Unknown Customer - ${referenceNo || serialNumber || `ROW-${rowNumber}`}`;
        console.log(`Row ${rowNumber}: customer name missing, using placeholder '${effectiveCustomerName}' (fix via Manage Customer).`);
      }

      if (!effectiveCustomerName || !modelType) {
        rowsSkipped += 1;
        console.log(`Row ${rowNumber} skipped: missing customer or model (customer='${customerName}', model='${rawModelType}', serial='${serialNumber}')`);
        continue;
      }

      const customer = await upsertCustomer(c, cache, effectiveCustomerName);
      const product = await resolveProduct(c, cache, modelType, serialNumber);
      const saleDate = parseExcelDate(rawSaleDate);
      const saleId = generateId();

      await c.sales.insertOne({
        id: saleId,
        saleDate,
        serialNumber: serialNumber || undefined,
        documentType,
        referenceNo: referenceNo || `IMPORT-${saleId}`,
        customerId: customer.id,
        customerName: customer.name,
        materialName: product.model,
        quantity: 1,
        dealerRegistered: true,
        inventoryStatus: "Available",
        priceCategory: "Dealer Price",
        createdBy: "system_migration",
        createdAt: new Date(),
        paymentStatus: "Confirmed",
        dispatchStatus: "Dispatched",
        piWorkflowStatus: "Dispatched",
        piItems: [
          {
            materialName: product.model,
            hsnSac: product.hsnSac || (product.model.startsWith("AW-LFP") ? "8507" : "8504"),
            quantity: 1,
            rate: product.dealerPrice || 0,
            gstRate: product.gstRate || 0,
            serialNumbers: serialNumber ? [serialNumber] : undefined,
          },
        ],
      });
      salesAdded += 1;

      if (serialNumber) {
        const manufacturedId = cache.manufacturedIdsBySerial.get(serialNumber);
        if (manufacturedId) {
          await c.manufactured.updateOne(
            { id: manufacturedId },
            {
              $set: {
                productId: product.id,
                status: "Sold",
                invoiceNo: referenceNo,
                customerId: customer.id,
                soldDate: saleDate,
                paymentStatus: "Verified",
                updatedAt: new Date(),
              },
            }
          );
          await c.serials.updateOne({ serialNumber }, { $set: { status: "Sold" } });
          manufacturedLinked += 1;
        } else {
          missingManufactured += 1;
        }
      }

      if (deductRawMaterials) {
        await deductRawMaterialsForSale(c, product, saleId, serialNumber);
      }
    }
  }

  console.log("\nMigration complete!");
  console.log(`Sales added: ${salesAdded}`);
  console.log(`Rows skipped: ${rowsSkipped}`);
  console.log(`Blank rows skipped: ${blankRowsSkipped}`);
  console.log(`Manufactured serials linked: ${manufacturedLinked}`);
  console.log(`Missing manufactured serials: ${missingManufactured}`);
  console.log(`Raw material deduction: ${deductRawMaterials ? "enabled" : "disabled"}`);
  process.exit(0);
}

run().catch((err) => {
  console.error("Migration Error:", err);
  process.exit(1);
});
