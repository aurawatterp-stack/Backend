"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = __importDefault(require("path"));
const xlsx_1 = __importDefault(require("xlsx"));
const collections_1 = require("../db/collections");
const connect_1 = require("../db/connect");
const init_1 = require("../db/init");
const id_1 = require("../utils/id");
function normalize(val) {
    return String(val ?? "").trim();
}
async function runSeed() {
    console.log("=== Starting NEW FG017.xlsx Import Script ===");
    const filePath = path_1.default.resolve(process.cwd(), "..", "NEW FG017.xlsx");
    const fallbackPath = path_1.default.resolve(process.cwd(), "NEW FG017.xlsx");
    const targetPath = require("fs").existsSync(filePath) ? filePath : fallbackPath;
    console.log(`Reading Excel file from: ${targetPath}`);
    const workbook = xlsx_1.default.readFile(targetPath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rawRows = xlsx_1.default.utils.sheet_to_json(sheet, { header: 1 });
    console.log(`Loaded sheet "${sheetName}" with ${rawRows.length} total rows.`);
    const dataRows = [];
    for (let i = 1; i < rawRows.length; i++) {
        const row = (rawRows[i] || []);
        const series = normalize(row[5]); // Column 6: Product Series
        const model = normalize(row[6]); // Column 7: Product Models
        const serialNo = normalize(row[7]); // Column 8: Sr.No.
        if (series && model && serialNo) {
            dataRows.push({
                rowNum: i + 1,
                series,
                model,
                serialNo,
            });
        }
    }
    console.log(`Extracted ${dataRows.length} valid product & serial records from Excel.`);
    const db = await (0, connect_1.connectDatabase)();
    if (!db.connected) {
        console.error("Database connection failed:", db.message);
        process.exit(1);
    }
    await (0, init_1.initDatabase)();
    const c = await (0, collections_1.getCollections)();
    const now = new Date();
    let productsInserted = 0;
    let productsUpdated = 0;
    let serialsInserted = 0;
    let serialsUpdated = 0;
    let manufacturedInserted = 0;
    let manufacturedUpdated = 0;
    const productMap = new Map();
    for (const item of dataRows) {
        // 1. Upsert Product
        let product = productMap.get(item.model);
        if (!product) {
            const existingProduct = await c.products.findOne({ model: item.model });
            if (existingProduct) {
                if (existingProduct.series !== item.series) {
                    await c.products.updateOne({ id: existingProduct.id }, { $set: { series: item.series, updatedAt: now } });
                    existingProduct.series = item.series;
                    productsUpdated++;
                }
                product = existingProduct;
            }
            else {
                const newProduct = {
                    id: `prod-${item.model.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
                    series: item.series,
                    model: item.model,
                    hsnSac: "8504",
                    gstRate: 18,
                    createdAt: now,
                };
                await c.products.insertOne(newProduct);
                product = newProduct;
                productsInserted++;
            }
            productMap.set(item.model, product);
        }
        // 2. Upsert Serial Entry
        const existingSerial = await c.serials.findOne({ serialNumber: item.serialNo });
        if (!existingSerial) {
            const serialEntry = {
                id: (0, id_1.generateId)(),
                serialNumber: item.serialNo,
                productSeriesId: item.series,
                status: "Available",
                importFileName: "NEW FG017.xlsx",
                uploadedAt: now,
            };
            await c.serials.insertOne(serialEntry);
            serialsInserted++;
        }
        else if (existingSerial.productSeriesId !== item.series) {
            await c.serials.updateOne({ id: existingSerial.id }, { $set: { productSeriesId: item.series } });
            serialsUpdated++;
        }
        // 3. Upsert Manufactured Product Entry
        const existingMfg = await c.manufactured.findOne({ serialNumber: item.serialNo });
        if (!existingMfg) {
            const mfgEntry = {
                id: (0, id_1.generateId)(),
                productId: product.id,
                serialNumber: item.serialNo,
                mfgDate: now,
                status: "In Stock",
                paymentStatus: "Verified",
                createdAt: now,
                updatedAt: now,
            };
            await c.manufactured.insertOne(mfgEntry);
            manufacturedInserted++;
        }
        else if (existingMfg.productId !== product.id || existingMfg.status !== "In Stock") {
            await c.manufactured.updateOne({ id: existingMfg.id }, { $set: { productId: product.id, status: existingMfg.status || "In Stock", updatedAt: now } });
            manufacturedUpdated++;
        }
    }
    console.log("=== Import Summary ===");
    console.log(`Products: ${productsInserted} inserted, ${productsUpdated} updated`);
    console.log(`Serials Pool: ${serialsInserted} inserted, ${serialsUpdated} updated`);
    console.log(`Manufactured Inventory: ${manufacturedInserted} inserted, ${manufacturedUpdated} updated`);
    console.log("=== NEW FG017.xlsx Import Completed Successfully ===");
    process.exit(0);
}
runSeed().catch((err) => {
    console.error("Import failed:", err);
    process.exit(1);
});
