"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateSerialStatus = updateSerialStatus;
async function updateSerialStatus(c, input) {
    const serialNumber = String(input.serialNumber ?? "").trim();
    if (!serialNumber)
        return null;
    const filter = { serialNumber };
    if (input.productSeriesId) {
        filter.productSeriesId = input.productSeriesId;
    }
    const serial = await c.serials.findOne(filter);
    if (!serial)
        return null;
    if (serial.status !== input.status) {
        await c.serials.updateOne({ id: serial.id }, { $set: { status: input.status } });
    }
    return { ...serial, status: input.status };
}
