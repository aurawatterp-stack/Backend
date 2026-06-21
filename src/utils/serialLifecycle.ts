import type { Collections } from "../db/collections";
import type { SerialStatus } from "../types";

export async function updateSerialStatus(
  c: Collections,
  input: {
    serialNumber: string;
    status: SerialStatus;
    productSeriesId?: string;
  }
) {
  const serialNumber = String(input.serialNumber ?? "").trim();
  if (!serialNumber) return null;

  const filter: Record<string, unknown> = { serialNumber };
  if (input.productSeriesId) {
    filter.productSeriesId = input.productSeriesId;
  }

  const serial = await c.serials.findOne(filter);
  if (!serial) return null;

  if (serial.status !== input.status) {
    await c.serials.updateOne(
      { id: serial.id },
      { $set: { status: input.status } }
    );
  }

  return { ...serial, status: input.status };
}
