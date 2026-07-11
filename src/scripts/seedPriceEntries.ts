import { connectDatabase } from "../db/connect";
import { getCollections } from "../db/collections";
import { initDatabase } from "../db/init";
import type { PriceEntry, PriceStatePoint } from "../types";
import { generateId } from "../utils/id";

type KnownPriceSeed = {
  srNo: number;
  description: string;
  prices: Record<string, PriceStatePoint>;
};

function point(distributor: number, dealer: number, msp: number): PriceStatePoint {
  return { distributor, dealer, msp };
}

function prices(
  up: PriceStatePoint,
  bihar: PriceStatePoint,
  mp: PriceStatePoint,
  haryanaRajasthan: PriceStatePoint
): Record<string, PriceStatePoint> {
  return {
    UP: up,
    Bihar: bihar,
    MP: mp,
    Haryana: haryanaRajasthan,
    Rajasthan: haryanaRajasthan,
    Punjab: haryanaRajasthan,
  };
}

/**
 * The 51.2V LFP variants and the IP66 SP variants share description text with a sibling product
 * (different warranty/IP rating, same "51.2V/100AH" or "8/10/12KW" text), so the frontend's fuzzy
 * PI-pricing matcher (inferAurawattPriceModelKey in aurawattPricing.ts) needs a distinct, explicit
 * key for each one — these overrides must match the keys returned there exactly, or PI auto-fill
 * will silently pull the wrong sibling's price (or none at all).
 */
const MODEL_KEY_OVERRIDES: Record<string, string> = {
  "AW-LFP-51.2 - 10": "AW-LFP-51.2-10",
  "AW-LFP-51.2 - 5": "AW-LFP-51.2-5",
  "AW-LFP-51.2 - i": "AW-LFP-51.2-i",
  "AW-LFP-51.2 - L": "AW-LFP-51.2-L",
  "AW-SP-8000 (IP 66)": "AW-SP-8000-IP66",
  "AW-SP-10000 (IP 66)": "AW-SP-10000-IP66",
  "AW-SP-12000 (IP 66)": "AW-SP-12000-IP66",
};

/** matches deriveModelKey() in app/components/ims/pages.tsx (plus MODEL_KEY_OVERRIDES above) — keep in sync so an entry created here lines up with one the "Add Entry" UI would generate for the same product. */
function deriveModelKey(modelNo: string): string {
  const trimmed = modelNo.trim();
  return MODEL_KEY_OVERRIDES[trimmed] ?? trimmed.replace(/\s+/g, "-");
}

/**
 * Keyed by the product's exact `model` field (as it appears in Manage Products), per the
 * client-provided "corresponding series.xlsx" mapping between the price list and the ERP catalog.
 * Only 18 of the 26 catalog products have a known price as of this seed; the rest are left
 * unpriced (empty `prices`) until the client supplies them.
 */
const KNOWN: Record<string, KnownPriceSeed> = {
  "AW-SP-3600": {
    srNo: 1,
    description: "3.6 KW Hybrid Aurawatt 24V/Single Phase/IP20*",
    prices: prices(point(34200, 37620, 45144), point(34200, 37620, 45144), point(34800, 38280, 45936), point(34500, 37950, 45540)),
  },
  "AW-SP-3000": {
    srNo: 2,
    description: "3KW Hybrid Aurawatt 48V/ Single Phase/IP66",
    prices: prices(point(48580, 53438, 66798), point(48580, 53438, 66798), point(48580, 53438, 66798), point(48900, 53790, 67238)),
  },
  "AW-SP-4000": {
    srNo: 3,
    description: "4KW Hybrid Aurawatt 48V/ Single Phase/IP66",
    prices: prices(point(51040, 56144, 70180), point(51040, 56144, 70180), point(51040, 56144, 70180), point(53040, 58344, 72930)),
  },
  "AW-SP-5000": {
    srNo: 4,
    description: "5KW Hybrid Aurawatt 48V/ Single Phase/IP66",
    prices: prices(point(57890, 63679, 79599), point(57890, 63679, 79599), point(57890, 63679, 79599), point(58900, 64790, 80988)),
  },
  "AW-SP-6000": {
    srNo: 5,
    description: "6KW Hybrid Aurawatt 48V/Single Phase/IP66",
    prices: prices(point(61400, 68768, 89398), point(61400, 68768, 89398), point(61400, 68768, 89398), point(61400, 68768, 89398)),
  },
  "AW-SP-8000": {
    srNo: 6,
    description: "8KW Hybrid Aurawatt 48V/Single Phase/IP21*",
    prices: prices(point(76500, 84150, 105188), point(76500, 84150, 105188), point(76500, 84150, 105188), point(76500, 84150, 105188)),
  },
  "AW-SP-10000": {
    srNo: 7,
    description: "10KW Hybrid Aurawatt 48V/Single Phase/IP21*",
    prices: prices(point(84200, 92620, 115775), point(84200, 92620, 115775), point(84200, 92620, 115775), point(87200, 95920, 119900)),
  },
  "AW-SP-11000": {
    srNo: 8,
    description: "11KW Hybrid Aurawatt 48V/Single Phase/IP21*",
    prices: prices(point(94800, 106176, 138029), point(94800, 106176, 138029), point(94800, 106176, 138029), point(95200, 106624, 138611)),
  },
  "AW-TP-8000-L": {
    srNo: 9,
    description: "8KW Hybrid Aurawatt 135-800V/3Phase/IP66",
    prices: prices(point(137800, 150202, 177238), point(137800, 150202, 177238), point(137800, 150202, 177238), point(137800, 150202, 177238)),
  },
  "AW-TP-10000-L": {
    srNo: 10,
    description: "10KW Hybrid Aurawatt 135-800V/3Phase/IP66",
    prices: prices(point(146440, 159620, 188351), point(146440, 159620, 188351), point(146440, 159620, 188351), point(146440, 159619.6, 188351)),
  },
  "AW-TP-12000-L": {
    srNo: 11,
    description: "12KW Hybrid Aurawatt 135-800V/3Phase/IP66",
    prices: prices(point(156880, 170999, 201779), point(156880, 170999, 201779), point(156880, 170999, 201779), point(156880, 170999.2, 201779)),
  },
  "AW-TP-15000-H": {
    srNo: 12,
    description: "15KW Hybrid Aurawatt 240V/400V/ 3-Phase/IP66",
    prices: prices(point(181000, 197290, 232802), point(181000, 197290, 232802), point(181000, 197290, 232802), point(181000, 197290, 232802)),
  },
  "AW-TP-20000-H": {
    srNo: 13,
    description: "20KW Hybrid Aurawatt 240V/400V/ 3-Phase/IP66",
    prices: prices(point(223000, 243070, 286823), point(223000, 243070, 286823), point(223000, 243070, 286823), point(201000, 219090, 258526)),
  },
  "AW-TP-50000-H": {
    srNo: 14,
    description: "50KW Hybrid Aurawatt 240V/400V/ 3-Phase/IP66",
    prices: prices(point(465820, 493769, 567835), point(465820, 493769, 567835), point(465820, 493769, 567835), point(465820, 493769.2, 567835)),
  },
  "AW-LFP-51.2 - 10": {
    srNo: 15,
    description: "51.2V / 100 AH LFP Battery (10 Yrs/1c)",
    prices: prices(point(88300, 96247, 115496), point(88300, 96247, 115496), point(88300, 96247, 115496), point(88300, 96247, 115496)),
  },
  "AW-LFP-51.2 - 5": {
    srNo: 16,
    description: "51.2V / 100 AH LFP Battery (5 Yrs/1c)*",
    prices: prices(point(59900, 65291, 78349), point(59900, 65291, 78349), point(59900, 65291, 78349), point(61800, 67362, 80834)),
  },
  "AW-LFP-51.2 - i": {
    srNo: 17,
    description: "51.2V / 100 AH LFP Battery (5 Yrs/0.5c)*",
    prices: prices(point(53800, 58642, 70370), point(53800, 58642, 70370), point(53800, 58642, 70370), point(53800, 58642, 70370)),
  },
  "AW-LFP-25.6": {
    srNo: 18,
    description: "25.6V/100AH LFP Battery (5 Yrs)",
    prices: prices(point(32900, 35861, 43033), point(32900, 35861, 43033), point(32900, 35861, 43033), point(32900, 35861, 43033)),
  },
};

async function main() {
  const connection = await connectDatabase();
  if (!connection.connected) throw new Error(connection.message);

  await initDatabase();
  const c = await getCollections();
  const now = new Date();
  let inserted = 0;
  let updated = 0;
  let unpriced = 0;

  // Drives off the live Manage Products catalog, so every product gets exactly one price
  // entry — known prices from KNOWN, everything else left blank for the client to fill in later.
  const products = await c.products.find({}).sort({ series: 1, model: 1 }).toArray();
  let nextSrNo = Object.keys(KNOWN).length + 1;

  for (const productDoc of products) {
    const known = KNOWN[productDoc.model];
    const description = known?.description ?? [productDoc.series, productDoc.model].filter(Boolean).join(" ").trim();
    const srNo = known?.srNo ?? nextSrNo++;
    const modelKey = deriveModelKey(productDoc.model);
    const entryPrices = known?.prices ?? {};
    if (!known) unpriced += 1;

    const existing = await c.priceEntries.findOne({ modelNo: productDoc.model }, { projection: { id: 1, createdAt: 1 } });
    const doc: PriceEntry = {
      id: existing?.id ?? generateId(),
      srNo,
      description,
      modelNo: productDoc.model,
      modelKey,
      prices: entryPrices,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    const result = await c.priceEntries.updateOne(
      { modelNo: productDoc.model },
      { $set: doc },
      { upsert: true }
    );
    if (result.upsertedCount) inserted += 1;
    else updated += 1;
  }

  console.log(`Seeded price entries: ${inserted} inserted, ${updated} updated, ${products.length} total (${unpriced} left unpriced, pending client data).`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
