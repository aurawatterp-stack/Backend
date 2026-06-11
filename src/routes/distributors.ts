import express, { type Request, type Response, type Router } from "express";

import { getCollections } from "../db/collections";
import { authenticate, requireAnyPermission } from "../middleware/auth";
import type { Customer, Distributor } from "../types";
import { fail, ok } from "../utils/http";
import { generateId } from "../utils/id";

const router: Router = express.Router();

type DistributorResponse = Distributor & {
  source: "customer" | "legacy";
  type: "Distributor";
  status: "Active" | "Inactive";
  phone: string;
  stateRegion?: string;
  registrationCode?: string;
  dateOfRegistration?: Date;
  gst?: string;
  cinNo?: string;
  pan?: string;
  tan?: string;
  contactPersonName?: string;
  billingAddress?: string;
  deliveryAddress1?: string;
  deliveryAddress2?: string;
  deliveryAddress3?: string;
  areaAllotted?: string;
  distributorshipType?: string;
  relevantSalesPerson?: string;
};

function normalizeEmail(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function customerToDistributor(customer: Customer, unitsSold = 0): DistributorResponse {
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
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
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

function legacyToDistributor(distributor: Distributor): DistributorResponse {
  return {
    ...distributor,
    source: "legacy",
    type: "Distributor",
    phone: distributor.mobile,
    status: distributor.isActive === false ? "Inactive" : "Active",
  };
}

/** GET /api/distributors */
router.get("/", authenticate, requireAnyPermission("distributors:manage"), async (req: Request, res: Response) => {
  const { q = "" } = req.query as Record<string, string>;
  const c = await getCollections();
  const query = normalizeText(q);
  const customerFilter: Record<string, unknown> = { type: "Distributor" };
  const legacyFilter: Record<string, unknown> = {};
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
      .aggregate<{ _id: string; unitsSold: number }>([
        { $match: { customerId: { $type: "string" } } },
        { $group: { _id: "$customerId", unitsSold: { $sum: { $ifNull: ["$quantity", 0] } } } },
      ])
      .toArray(),
  ]);

  const unitsByCustomerId = new Map(salesAgg.map((item) => [item._id, item.unitsSold]));
  const seenKeys = new Set<string>();
  const results: DistributorResponse[] = customers.map((customer) => {
    const emailKey = normalizeEmail(customer.email);
    const phoneKey = normalizeText(customer.phone);
    if (emailKey) seenKeys.add(`email:${emailKey}`);
    if (phoneKey) seenKeys.add(`phone:${phoneKey}`);
    return customerToDistributor(customer, unitsByCustomerId.get(customer.id) ?? 0);
  });

  for (const distributor of legacyDistributors) {
    const emailKey = normalizeEmail(distributor.email);
    const phoneKey = normalizeText(distributor.mobile);
    if ((emailKey && seenKeys.has(`email:${emailKey}`)) || (phoneKey && seenKeys.has(`phone:${phoneKey}`))) continue;
    results.push(legacyToDistributor(distributor));
  }

  return ok(res, results);
});

/** GET /api/distributors/:id */
router.get("/:id", authenticate, requireAnyPermission("distributors:manage"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const customer = await c.customers.findOne({ id: req.params.id, type: "Distributor" });
  if (customer) return ok(res, customerToDistributor(customer));

  const distributor = await c.distributors.findOne({ id: req.params.id });
  if (!distributor) return fail(res, "Distributor not found", 404);
  return ok(res, legacyToDistributor(distributor));
});

/** POST /api/distributors */
router.post("/", authenticate, requireAnyPermission("distributors:manage"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const { name, email, mobile, phone, address } = req.body;
  const normalizedName = normalizeText(name);
  const normalizedEmail = normalizeEmail(email);
  const normalizedPhone = normalizeText(phone || mobile);
  const normalizedAddress = normalizeText(address);
  if (!normalizedName || !normalizedEmail || !normalizedPhone || !normalizedAddress) {
    return fail(res, "name, email, mobile, address are required");
  }

  const duplicate = await c.customers.findOne({
    $or: [{ email: normalizedEmail }, { phone: normalizedPhone }],
  });
  if (duplicate) return fail(res, "This distributor/customer is already registered");

  const now = new Date();
  const customer: Customer = {
    id: generateId(),
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
  return ok(res, customerToDistributor(customer), 201);
});

/** PUT /api/distributors/:id */
router.put("/:id", authenticate, requireAnyPermission("distributors:manage"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const id = req.params.id;
  const existingCustomer = await c.customers.findOne({ id, type: "Distributor" });
  const updatedAt = new Date();
  if (existingCustomer) {
    const update: Partial<Customer> = {};
    if ("name" in req.body) update.name = normalizeText(req.body.name);
    if ("email" in req.body) update.email = normalizeEmail(req.body.email) || undefined;
    if ("mobile" in req.body || "phone" in req.body) update.phone = normalizeText(req.body.phone || req.body.mobile);
    if ("address" in req.body) update.address = normalizeText(req.body.address) || undefined;
    if ("isActive" in req.body) update.status = req.body.isActive === false ? "Inactive" : "Active";
    if ("status" in req.body) update.status = req.body.status === "Inactive" ? "Inactive" : "Active";
    if ("distributorshipType" in req.body) update.distributorshipType = normalizeText(req.body.distributorshipType) || undefined;
    if ("stateRegion" in req.body) update.stateRegion = normalizeText(req.body.stateRegion) || undefined;
    if ("dateOfRegistration" in req.body) {
      const date = normalizeText(req.body.dateOfRegistration);
      update.dateOfRegistration = date ? new Date(date) : undefined;
    }
    if ("gst" in req.body) update.gst = normalizeText(req.body.gst) || undefined;
    if ("cinNo" in req.body) update.cinNo = normalizeText(req.body.cinNo) || undefined;
    if ("pan" in req.body) update.pan = normalizeText(req.body.pan) || undefined;
    if ("tan" in req.body) update.tan = normalizeText(req.body.tan) || undefined;
    if ("contactPersonName" in req.body) update.contactPersonName = normalizeText(req.body.contactPersonName) || undefined;
    if ("billingAddress" in req.body) update.billingAddress = normalizeText(req.body.billingAddress) || undefined;
    if ("deliveryAddress1" in req.body) update.deliveryAddress1 = normalizeText(req.body.deliveryAddress1) || undefined;
    if ("deliveryAddress2" in req.body) update.deliveryAddress2 = normalizeText(req.body.deliveryAddress2) || undefined;
    if ("deliveryAddress3" in req.body) update.deliveryAddress3 = normalizeText(req.body.deliveryAddress3) || undefined;
    if ("areaAllotted" in req.body) update.areaAllotted = normalizeText(req.body.areaAllotted) || undefined;
    if ("relevantSalesPerson" in req.body) update.relevantSalesPerson = normalizeText(req.body.relevantSalesPerson) || undefined;
    update.updatedAt = updatedAt;
    await c.customers.updateOne({ id }, { $set: update });
    return ok(res, customerToDistributor({ ...existingCustomer, ...update }));
  }

  const existingLegacy = await c.distributors.findOne({ id });
  if (!existingLegacy) return fail(res, "Distributor not found", 404);
  await c.distributors.updateOne({ id }, { $set: { ...req.body, updatedAt } });
  return ok(res, legacyToDistributor({ ...existingLegacy, ...req.body, updatedAt }));
});

/** DELETE /api/distributors/:id */
router.delete("/:id", authenticate, requireAnyPermission("distributors:manage"), async (req: Request, res: Response) => {
  const c = await getCollections();
  const customerResult = await c.customers.deleteOne({ id: req.params.id, type: "Distributor" });
  if (customerResult.deletedCount) return ok(res, { message: "Distributor deleted" });

  const result = await c.distributors.deleteOne({ id: req.params.id });
  if (!result.deletedCount) return fail(res, "Distributor not found", 404);
  return ok(res, { message: "Distributor deleted" });
});

export default router;
