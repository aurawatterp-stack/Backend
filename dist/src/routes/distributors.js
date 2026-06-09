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
function normalizeEmail(value) {
    return String(value ?? "").trim().toLowerCase();
}
function normalizeText(value) {
    return String(value ?? "").trim();
}
function customerToDistributor(customer, unitsSold = 0) {
    const address = customer.address || customer.billingAddress || customer.deliveryAddress1 || "";
    return {
        id: customer.id,
        source: "customer",
        type: "Distributor",
        name: customer.name,
        email: customer.email ?? "",
        mobile: customer.phone,
        phone: customer.phone,
        address,
        unitsSold,
        isActive: customer.status !== "Inactive",
        status: customer.status,
        stateRegion: customer.stateRegion,
        registrationCode: customer.registrationCode,
        dateOfRegistration: customer.dateOfRegistration,
        gst: customer.gst,
        cinNo: customer.cinNo,
        pan: customer.pan,
        tan: customer.tan,
        contactPersonName: customer.contactPersonName,
        billingAddress: customer.billingAddress,
        deliveryAddress1: customer.deliveryAddress1,
        deliveryAddress2: customer.deliveryAddress2,
        deliveryAddress3: customer.deliveryAddress3,
        areaAllotted: customer.areaAllotted,
        distributorshipType: customer.distributorshipType,
        relevantSalesPerson: customer.relevantSalesPerson,
    };
}
function legacyToDistributor(distributor) {
    return {
        ...distributor,
        source: "legacy",
        type: "Distributor",
        phone: distributor.mobile,
        status: distributor.isActive === false ? "Inactive" : "Active",
    };
}
/** GET /api/distributors */
router.get("/", auth_1.authenticate, (0, auth_1.requireAnyPermission)("distributors:manage"), async (req, res) => {
    const { q = "" } = req.query;
    const c = await (0, collections_1.getCollections)();
    const query = normalizeText(q);
    const customerFilter = { type: "Distributor" };
    const legacyFilter = {};
    if (query) {
        customerFilter.$or = [
            { name: { $regex: query, $options: "i" } },
            { email: { $regex: query, $options: "i" } },
            { phone: { $regex: query, $options: "i" } },
            { gst: { $regex: query, $options: "i" } },
            { pan: { $regex: query, $options: "i" } },
        ];
        legacyFilter.$or = [
            { name: { $regex: query, $options: "i" } },
            { email: { $regex: query, $options: "i" } },
            { mobile: { $regex: query, $options: "i" } },
        ];
    }
    const [customers, legacyDistributors, salesAgg] = await Promise.all([
        c.customers.find(customerFilter).toArray(),
        c.distributors.find(legacyFilter).toArray(),
        c.sales
            .aggregate([
            { $match: { customerId: { $type: "string" } } },
            { $group: { _id: "$customerId", unitsSold: { $sum: { $ifNull: ["$quantity", 0] } } } },
        ])
            .toArray(),
    ]);
    const unitsByCustomerId = new Map(salesAgg.map((item) => [item._id, item.unitsSold]));
    const seenKeys = new Set();
    const results = customers.map((customer) => {
        const emailKey = normalizeEmail(customer.email);
        const phoneKey = normalizeText(customer.phone);
        if (emailKey)
            seenKeys.add(`email:${emailKey}`);
        if (phoneKey)
            seenKeys.add(`phone:${phoneKey}`);
        return customerToDistributor(customer, unitsByCustomerId.get(customer.id) ?? 0);
    });
    for (const distributor of legacyDistributors) {
        const emailKey = normalizeEmail(distributor.email);
        const phoneKey = normalizeText(distributor.mobile);
        if ((emailKey && seenKeys.has(`email:${emailKey}`)) || (phoneKey && seenKeys.has(`phone:${phoneKey}`)))
            continue;
        results.push(legacyToDistributor(distributor));
    }
    return (0, http_1.ok)(res, results);
});
/** GET /api/distributors/:id */
router.get("/:id", auth_1.authenticate, (0, auth_1.requireAnyPermission)("distributors:manage"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const customer = await c.customers.findOne({ id: req.params.id, type: "Distributor" });
    if (customer)
        return (0, http_1.ok)(res, customerToDistributor(customer));
    const distributor = await c.distributors.findOne({ id: req.params.id });
    if (!distributor)
        return (0, http_1.fail)(res, "Distributor not found", 404);
    return (0, http_1.ok)(res, legacyToDistributor(distributor));
});
/** POST /api/distributors */
router.post("/", auth_1.authenticate, (0, auth_1.requireAnyPermission)("distributors:manage"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const { name, email, mobile, phone, address } = req.body;
    const normalizedName = normalizeText(name);
    const normalizedEmail = normalizeEmail(email);
    const normalizedPhone = normalizeText(phone || mobile);
    const normalizedAddress = normalizeText(address);
    if (!normalizedName || !normalizedEmail || !normalizedPhone || !normalizedAddress) {
        return (0, http_1.fail)(res, "name, email, mobile, address are required");
    }
    const duplicate = await c.customers.findOne({
        $or: [{ email: normalizedEmail }, { phone: normalizedPhone }],
    });
    if (duplicate)
        return (0, http_1.fail)(res, "This distributor/customer is already registered");
    const now = new Date();
    const customer = {
        id: (0, id_1.generateId)(),
        name: normalizedName,
        type: "Distributor",
        email: normalizedEmail,
        phone: normalizedPhone,
        address: normalizedAddress,
        stateRegion: req.body.stateRegion ? normalizeText(req.body.stateRegion) : undefined,
        dateOfRegistration: req.body.dateOfRegistration ? new Date(req.body.dateOfRegistration) : undefined,
        gst: req.body.gst ? normalizeText(req.body.gst) : undefined,
        cinNo: req.body.cinNo ? normalizeText(req.body.cinNo) : undefined,
        pan: req.body.pan ? normalizeText(req.body.pan) : undefined,
        tan: req.body.tan ? normalizeText(req.body.tan) : undefined,
        contactPersonName: req.body.contactPersonName ? normalizeText(req.body.contactPersonName) : undefined,
        billingAddress: req.body.billingAddress ? normalizeText(req.body.billingAddress) : undefined,
        deliveryAddress1: req.body.deliveryAddress1 ? normalizeText(req.body.deliveryAddress1) : undefined,
        deliveryAddress2: req.body.deliveryAddress2 ? normalizeText(req.body.deliveryAddress2) : undefined,
        deliveryAddress3: req.body.deliveryAddress3 ? normalizeText(req.body.deliveryAddress3) : undefined,
        areaAllotted: req.body.areaAllotted ? normalizeText(req.body.areaAllotted) : undefined,
        distributorshipType: req.body.distributorshipType ? normalizeText(req.body.distributorshipType) : undefined,
        relevantSalesPerson: req.body.relevantSalesPerson ? normalizeText(req.body.relevantSalesPerson) : undefined,
        status: "Active",
        createdAt: now,
        updatedAt: now,
    };
    await c.customers.insertOne(customer);
    return (0, http_1.ok)(res, customerToDistributor(customer), 201);
});
/** PUT /api/distributors/:id */
router.put("/:id", auth_1.authenticate, (0, auth_1.requireAnyPermission)("distributors:manage"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const id = req.params.id;
    const existingCustomer = await c.customers.findOne({ id, type: "Distributor" });
    const updatedAt = new Date();
    if (existingCustomer) {
        const update = {};
        if ("name" in req.body)
            update.name = normalizeText(req.body.name);
        if ("email" in req.body)
            update.email = normalizeEmail(req.body.email) || undefined;
        if ("mobile" in req.body || "phone" in req.body)
            update.phone = normalizeText(req.body.phone || req.body.mobile);
        if ("address" in req.body)
            update.address = normalizeText(req.body.address) || undefined;
        if ("isActive" in req.body)
            update.status = req.body.isActive === false ? "Inactive" : "Active";
        if ("status" in req.body)
            update.status = req.body.status === "Inactive" ? "Inactive" : "Active";
        if ("distributorshipType" in req.body)
            update.distributorshipType = normalizeText(req.body.distributorshipType) || undefined;
        if ("stateRegion" in req.body)
            update.stateRegion = normalizeText(req.body.stateRegion) || undefined;
        if ("dateOfRegistration" in req.body) {
            const date = normalizeText(req.body.dateOfRegistration);
            update.dateOfRegistration = date ? new Date(date) : undefined;
        }
        if ("gst" in req.body)
            update.gst = normalizeText(req.body.gst) || undefined;
        if ("cinNo" in req.body)
            update.cinNo = normalizeText(req.body.cinNo) || undefined;
        if ("pan" in req.body)
            update.pan = normalizeText(req.body.pan) || undefined;
        if ("tan" in req.body)
            update.tan = normalizeText(req.body.tan) || undefined;
        if ("contactPersonName" in req.body)
            update.contactPersonName = normalizeText(req.body.contactPersonName) || undefined;
        if ("billingAddress" in req.body)
            update.billingAddress = normalizeText(req.body.billingAddress) || undefined;
        if ("deliveryAddress1" in req.body)
            update.deliveryAddress1 = normalizeText(req.body.deliveryAddress1) || undefined;
        if ("deliveryAddress2" in req.body)
            update.deliveryAddress2 = normalizeText(req.body.deliveryAddress2) || undefined;
        if ("deliveryAddress3" in req.body)
            update.deliveryAddress3 = normalizeText(req.body.deliveryAddress3) || undefined;
        if ("areaAllotted" in req.body)
            update.areaAllotted = normalizeText(req.body.areaAllotted) || undefined;
        if ("relevantSalesPerson" in req.body)
            update.relevantSalesPerson = normalizeText(req.body.relevantSalesPerson) || undefined;
        update.updatedAt = updatedAt;
        await c.customers.updateOne({ id }, { $set: update });
        return (0, http_1.ok)(res, customerToDistributor({ ...existingCustomer, ...update }));
    }
    const existingLegacy = await c.distributors.findOne({ id });
    if (!existingLegacy)
        return (0, http_1.fail)(res, "Distributor not found", 404);
    await c.distributors.updateOne({ id }, { $set: { ...req.body, updatedAt } });
    return (0, http_1.ok)(res, legacyToDistributor({ ...existingLegacy, ...req.body, updatedAt }));
});
/** DELETE /api/distributors/:id */
router.delete("/:id", auth_1.authenticate, (0, auth_1.requireAnyPermission)("distributors:manage"), async (req, res) => {
    const c = await (0, collections_1.getCollections)();
    const customerResult = await c.customers.deleteOne({ id: req.params.id, type: "Distributor" });
    if (customerResult.deletedCount)
        return (0, http_1.ok)(res, { message: "Distributor deleted" });
    const result = await c.distributors.deleteOne({ id: req.params.id });
    if (!result.deletedCount)
        return (0, http_1.fail)(res, "Distributor not found", 404);
    return (0, http_1.ok)(res, { message: "Distributor deleted" });
});
exports.default = router;
