"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const collections_1 = require("../db/collections");
const auth_1 = require("../middleware/auth");
const http_1 = require("../utils/http");
const id_1 = require("../utils/id");
const router = express_1.default.Router();
/** GET /api/sales */
router.get("/", auth_1.authenticate, async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const { page = "1", limit = "20" } = req.query;
    const p = Math.max(1, parseInt(page));
    const l = Math.min(100, parseInt(limit));
    const total = await c.sales.countDocuments({});
    const data = await c.sales
        .find({})
        .sort({ saleDate: -1 })
        .skip((p - 1) * l)
        .limit(l)
        .toArray();
    return (0, http_1.ok)(res, { data, total, page: p, limit: l });
});
/**
 * POST /api/sales
 * Records a sale. Marks the manufactured product as Sold.
 * Body: { serialNumber, documentType, referenceNo, saleDate, customerId }
 */
router.post("/", auth_1.authenticate, (0, auth_1.authorize)("Admin", "Sales Manager", "Inventory Manager"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const { serialNumber, documentType, referenceNo, saleDate, customerId } = req.body;
    if (!serialNumber || !documentType || !referenceNo || !saleDate || !customerId) {
        return (0, http_1.fail)(res, "serialNumber, documentType, referenceNo, saleDate, customerId are required");
    }
    const mfg = await c.manufactured.findOne({ serialNumber });
    if (!mfg)
        return (0, http_1.fail)(res, "Serial number not found in manufactured products");
    if (mfg.status === "Sold")
        return (0, http_1.fail)(res, "This product is already sold");
    const customer = await c.customers.findOne({ id: customerId }, { projection: { id: 1 } });
    if (!customer)
        return (0, http_1.fail)(res, "Customer not found", 404);
    const user = req.user;
    const updatedAt = new Date();
    await c.manufactured.updateOne({ id: mfg.id }, {
        $set: {
            status: "Sold",
            invoiceNo: referenceNo,
            customerId,
            soldDate: new Date(saleDate),
            paymentStatus: "Pending",
            updatedAt,
        },
    });
    const sale = {
        id: (0, id_1.generateId)(),
        serialNumber,
        documentType,
        referenceNo,
        saleDate: new Date(saleDate),
        customerId,
        createdBy: user.userId,
        createdAt: new Date(),
    };
    await c.sales.insertOne(sale);
    return (0, http_1.ok)(res, sale, 201);
});
exports.default = router;
