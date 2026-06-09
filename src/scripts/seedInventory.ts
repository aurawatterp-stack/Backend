import { readFileSync } from "node:fs";
import path from "node:path";

import { connectDatabase } from "../db/connect";
import { getCollections } from "../db/collections";
import { initDatabase } from "../db/init";
import type { Customer, ManufacturedProduct, Product, Sale, SerialEntry } from "../types";
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

type DemoInventoryRow = {
  serial: string;
  productModel?: string;
  customerName?: string;
  dealerName?: string;
  cityLocation?: string;
  region?: string;
  dateOfSale?: string;
  customerPhone?: string;
  customerEmail?: string;
  customerAddress?: string;
};

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"' && next === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function loadDemoInventoryRows(): DemoInventoryRow[] {
  const filePath = path.resolve(process.cwd(), "demo-inventory-serials.csv");
  const text = readFileSync(filePath, "utf8").trim();
  const [headerLine, ...lines] = text.split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(headerLine).map((header) => header.trim());
  return lines.map((line) => {
    const cells = parseCsvLine(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
    return {
      serial: row.serial,
      productModel: row.productModel,
      customerName: row.customerName,
      dealerName: row.dealerName,
      cityLocation: row.cityLocation,
      region: row.region,
      dateOfSale: row.dateOfSale,
      customerPhone: row.customerPhone,
      customerEmail: row.customerEmail,
      customerAddress: row.customerAddress,
    };
  }).filter((row) => row.serial);
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60) || generateId();
}

function productForSerial(serialNumber: string) {
  return demoProducts.find((product) => serialNumber.startsWith(product.prefix));
}

async function upsertDemoCustomer(row: DemoInventoryRow): Promise<Customer | undefined> {
  const c = await getCollections();
  const name = row.dealerName || row.customerName;
  if (!name) return undefined;

  const now = new Date();
  const id = `demo-customer-${slug(name)}`;
  const customer: Customer = {
    id,
    name,
    type: "Distributor",
    email: row.customerEmail || `${slug(name)}@demo.aurawatt.in`,
    phone: row.customerPhone || "0000000000",
    status: "Active",
    address: row.customerAddress || row.cityLocation,
    stateRegion: row.region,
    createdAt: now,
    updatedAt: now,
  };

  await c.customers.updateOne(
    { id },
    {
      $set: {
        name: customer.name,
        type: customer.type,
        email: customer.email,
        phone: customer.phone,
        status: customer.status,
        address: customer.address,
        stateRegion: customer.stateRegion,
        updatedAt: now,
      },
      $setOnInsert: {
        id: customer.id,
        createdAt: now,
      },
    },
    { upsert: true }
  );

  const saved = await c.customers.findOne({ id });
  return saved ?? customer;
}

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
  const demoRows = loadDemoInventoryRows();
  let productsReady = 0;
  let serialsInserted = 0;
  let manufacturedInserted = 0;
  let manufacturedUpdated = 0;
  let salesUpserted = 0;
  let customersUpserted = 0;
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

  for (const row of demoRows) {
    const demoProduct = demoProducts.find((product) => product.model === row.productModel) ?? productForSerial(row.serial);
    if (!demoProduct) continue;
    const product = await upsertProduct(demoProduct);
    const customer = await upsertDemoCustomer(row);
    if (customer) customersUpserted += 1;

    const saleDate = row.dateOfSale ? new Date(`${row.dateOfSale}T00:00:00.000Z`) : new Date("2026-06-06T00:00:00.000Z");
    const referenceNo = `DEMO-SALE-${row.serial}`;
    const sale: Sale = {
      id: `demo-sale-${slug(row.serial)}`,
      serialNumber: row.serial,
      documentType: "Sales Invoice",
      referenceNo,
      saleDate,
      customerId: customer?.id,
      customerName: row.customerName,
      dealerName: row.dealerName,
      unregisteredCustomerName: row.dealerName || row.customerName,
      unregisteredCustomerAddress: row.customerAddress || row.cityLocation,
      materialName: product.model,
      quantity: 1,
      stateRegion: row.region,
      dealerRegistered: Boolean(customer),
      priceCategory: "Dealer Price",
      inventoryStatus: "Available",
      dispatchStatus: "Delivered",
      paymentStatus: "Confirmed",
      createdBy: "seed:inventory",
      createdAt: now,
    };

    await c.sales.updateOne(
      { referenceNo },
      {
        $set: {
          serialNumber: sale.serialNumber,
          documentType: sale.documentType,
          saleDate: sale.saleDate,
          customerId: sale.customerId,
          customerName: sale.customerName,
          dealerName: sale.dealerName,
          unregisteredCustomerName: sale.unregisteredCustomerName,
          unregisteredCustomerAddress: sale.unregisteredCustomerAddress,
          materialName: sale.materialName,
          quantity: sale.quantity,
          stateRegion: sale.stateRegion,
          dealerRegistered: sale.dealerRegistered,
          priceCategory: sale.priceCategory,
          inventoryStatus: sale.inventoryStatus,
          dispatchStatus: sale.dispatchStatus,
          paymentStatus: sale.paymentStatus,
        },
        $setOnInsert: {
          id: sale.id,
          referenceNo: sale.referenceNo,
          createdBy: sale.createdBy,
          createdAt: sale.createdAt,
        },
      },
      { upsert: true }
    );
    salesUpserted += 1;

    const result = await c.manufactured.updateOne(
      { serialNumber: row.serial },
      {
        $set: {
          productId: product.id,
          status: "Sold",
          invoiceNo: referenceNo,
          paymentStatus: "Verified",
          customerId: customer?.id,
          soldDate: saleDate,
          updatedAt: now,
        },
        $setOnInsert: {
          id: generateId(),
          serialNumber: row.serial,
          mfgDate,
          createdAt: now,
        },
      },
      { upsert: true }
    );
    if (result.upsertedCount) manufacturedInserted += 1;
    if (result.modifiedCount) manufacturedUpdated += 1;
  }

  console.log(`Products ready: ${productsReady}`);
  console.log(`Serial pool entries inserted: ${serialsInserted}`);
  console.log(`Manufactured In Stock entries inserted: ${manufacturedInserted}`);
  console.log(`Manufactured sold links updated: ${manufacturedUpdated}`);
  console.log(`Demo customers upserted: ${customersUpserted}`);
  console.log(`Demo sales upserted: ${salesUpserted}`);
  console.log(`Duplicate manufactured serials skipped: ${duplicatesSkipped}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
