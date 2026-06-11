"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const config_1 = require("../config");
const connect_1 = require("../db/connect");
const collections_1 = require("../db/collections");
const mongo_1 = require("../db/mongo");
const serviceEngineers = [
    {
        id: "u-l1-rohit",
        email: "l1.rohit@avavbusiness.com",
        password: "RohitL1@123",
        name: "Rohit Sharma",
        mobile: "9380482101",
        role: "L1 Engineer",
    },
    {
        id: "u-l1-amit",
        email: "l1.amit@avavbusiness.com",
        password: "AmitL1@123",
        name: "Amit Verma",
        mobile: "9380482102",
        role: "L1 Engineer",
    },
    {
        id: "u-l2-vikas",
        email: "l2.vikas@avavbusiness.com",
        password: "VikasL2@123",
        name: "Vikas Yadav",
        mobile: "9380482201",
        role: "L2 Technical Team",
    },
    {
        id: "u-l2-sandeep",
        email: "l2.sandeep@avavbusiness.com",
        password: "SandeepL2@123",
        name: "Sandeep Singh",
        mobile: "9380482202",
        role: "L2 Technical Team",
    },
    {
        id: "u-l3-mahesh",
        email: "l3.mahesh@avavbusiness.com",
        password: "MaheshL3@123",
        name: "Mahesh Choudhary",
        mobile: "9380482301",
        role: "L3 Advanced OEM Support",
    },
    {
        id: "u-l3-deepak",
        email: "l3.deepak@avavbusiness.com",
        password: "DeepakL3@123",
        name: "Deepak Meena",
        mobile: "9380482302",
        role: "L3 Advanced OEM Support",
    },
];
const oldGenericEmails = ["l1@avavbusiness.com", "l2@avavbusiness.com", "l3@avavbusiness.com"];
const oldGenericIds = ["u-l1-demo", "u-l2-demo", "u-l3-demo"];
const serviceRoles = ["L1 Engineer", "L2 Technical Team", "L3 Advanced OEM Support"];
async function main() {
    const db = await (0, connect_1.connectDatabase)();
    if (!db.connected) {
        console.error(db.message);
        process.exit(1);
    }
    const c = await (0, collections_1.getCollections)();
    const now = new Date();
    const disabled = await c.users.updateMany({
        $or: [
            { email: { $in: oldGenericEmails } },
            { id: { $in: oldGenericIds } },
            {
                role: { $in: serviceRoles },
                email: { $nin: serviceEngineers.map((account) => account.email) },
            },
        ],
    }, { $set: { isActive: false, updatedAt: now } });
    let upserted = 0;
    for (const account of serviceEngineers) {
        const passwordHash = await bcryptjs_1.default.hash(account.password, config_1.CONFIG.BCRYPT_ROUNDS);
        const update = {
            email: account.email,
            passwordHash,
            name: account.name,
            mobile: account.mobile,
            role: account.role,
            isActive: true,
            updatedAt: now,
        };
        const result = await c.users.updateOne({ email: account.email }, {
            $set: update,
            $setOnInsert: {
                id: account.id,
                createdAt: now,
            },
        }, { upsert: true });
        if (result.upsertedCount || result.modifiedCount)
            upserted += 1;
    }
    console.log(`Disabled ${disabled.modifiedCount} old generic service accounts.`);
    console.log(`Upserted ${upserted} service engineer accounts.`);
    const client = await (0, mongo_1.getMongoClient)();
    await client.close();
}
main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
});
