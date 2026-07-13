import { getCollections } from "../db/collections";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function istDateKey(date: Date): string {
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  const yyyy = ist.getUTCFullYear();
  const mm = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(ist.getUTCDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

/** Generates the next `AW-YYYYMMDD-XXXX` ticket number, with XXXX resetting daily (IST). */
export async function generateTicketNumber(now: Date = new Date()): Promise<string> {
  const c = await getCollections();
  const dateKey = istDateKey(now);
  const sequenceDocument = await c.counters.findOneAndUpdate(
    { id: `ticket_${dateKey}` },
    { $inc: { seq: 1 } },
    { returnDocument: "after", upsert: true }
  );
  const seq = sequenceDocument!.seq;
  return `AW-${dateKey}-${String(seq).padStart(4, "0")}`;
}
