import path from "path";
import XLSX from "xlsx";
import { getCollections } from "../db/collections";
import { connectDatabase } from "../db/connect";
import { initDatabase } from "../db/init";
import type { Product } from "../types";

interface HsnRecord {
  series: string;
  model: string;
  hsnSac: string;
  gstRate: number;
}

function normalize(val: unknown): string {
  return String(val ?? "").trim();
}

async function runSeed() {
  console.log("=== Starting Untitled spreadsheet (4).xlsx HSN/GST Seed Script ===");

  const filePath = path.resolve(process.cwd(), "..", "Untitled spreadsheet (4).xlsx");
  const fallbackPath = path.resolve(process.cwd(), "Untitled spreadsheet (4).xlsx");
  const targetPath = require("fs").existsSync(filePath) ? filePath : fallbackPath;

  console.log(`Reading Excel file from: ${targetPath}`);

  const workbook = XLSX.readFile(targetPath);
  
  // Sheet 1: HSN CODE
  const hsnSheet = workbook.Sheets["HSN CODE"] || workbook.Sheets[workbook.SheetNames[0]];
  const rawHsnRows = XLSX.utils.sheet_to_json<unknown[]>(hsnSheet, { header: 1 });

  // Sheet 2: RATE
  const rateSheet = workbook.Sheets["RATE"];
  const rateMap = new Map<string, number>();
  rateMap.set("850440", 5);
  rateMap.set("8504", 5);
  rateMap.set("850760", 18);
  rateMap.set("8507", 18);
  rateMap.set("996511", 18);

  if (rateSheet) {
    const rawRateRows = XLSX.utils.sheet_to_json<unknown[]>(rateSheet, { header: 1 });
    for (let i = 1; i < rawRateRows.length; i++) {
      const row = (rawRateRows[i] || []) as unknown[];
      const code = normalize(row[0]).replace(/\.0$/, "");
      const rateVal = Number(row[1]);
      if (code && !isNaN(rateVal)) {
        // e.g. 0.05 -> 5, 0.18 -> 18
        const ratePercent = rateVal < 1 ? Math.round(rateVal * 100) : rateVal;
        rateMap.set(code, ratePercent);
      }
    }
  }

  console.log("Rate mapping:", Object.fromEntries(rateMap));

  const hsnRecords: HsnRecord[] = [];

  for (let i = 1; i < rawHsnRows.length; i++) {
    const row = (rawHsnRows[i] || []) as unknown[];
    const series = normalize(row[0]);
    const model = normalize(row[1]);
    let hsnSac = normalize(row[2]).replace(/\.0$/, "");

    if (series && model && hsnSac) {
      const gstRate = rateMap.get(hsnSac) ?? (hsnSac.startsWith("8507") ? 18 : 5);
      hsnRecords.push({ series, model, hsnSac, gstRate });
    }
  }

  console.log(`Extracted ${hsnRecords.length} HSN & GST rate records from Excel.`);

  const db = await connectDatabase();
  if (!db.connected) {
    console.error("Database connection failed:", db.message);
    process.exit(1);
  }
  await initDatabase();
  const c = await getCollections();
  const now = new Date();

  let productsInserted = 0;
  let productsUpdated = 0;

  for (const item of hsnRecords) {
    const existing = await c.products.findOne({ model: item.model });
    if (existing) {
      await c.products.updateOne(
        { id: existing.id },
        {
          $set: {
            series: item.series,
            hsnSac: item.hsnSac,
            gstRate: item.gstRate,
            updatedAt: now,
          },
        }
      );
      productsUpdated++;
    } else {
      const newProd: Product = {
        id: `prod-${item.model.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        series: item.series,
        model: item.model,
        hsnSac: item.hsnSac,
        gstRate: item.gstRate,
        createdAt: now,
      };
      await c.products.insertOne(newProd);
      productsInserted++;
    }
  }

  console.log("=== HSN Import Summary ===");
  console.log(`Products: ${productsInserted} inserted, ${productsUpdated} updated`);
  console.log("=== HSN / GST Seeding Completed Successfully ===");
  process.exit(0);
}

runSeed().catch((err) => {
  console.error("HSN Seed failed:", err);
  process.exit(1);
});
