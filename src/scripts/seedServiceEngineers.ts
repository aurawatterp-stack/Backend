import bcrypt from "bcryptjs";

import { CONFIG } from "../config";
import { connectDatabase } from "../db/connect";
import { getCollections } from "../db/collections";
import { getMongoClient } from "../db/mongo";
import { engineerMasterId, rebuildTicketLoads, type EngineerRole } from "../services/engineerAssignments";
import type { User, UserRole } from "../types";

type SeedServiceEngineerAccount = {
  id: string;
  email: string;
  password: string;
  name: string;
  mobile: string;
  role: UserRole;
  engineerMasterName: string;
  engineerMasterRole: EngineerRole;
};

const l1Engineers: SeedServiceEngineerAccount[] = [
  {
    id: "u-l1-piyush",
    email: "l1.piyush@avavbusiness.com",
    password: "PiyushL1@123",
    name: "Piyush",
    mobile: "9380482101",
    role: "L1 Engineer" as UserRole,
    engineerMasterName: "Piyush",
    engineerMasterRole: "L1" as EngineerRole,
  },
  {
    id: "u-l1-neeraj",
    email: "l1.neeraj@avavbusiness.com",
    password: "NeerajL1@123",
    name: "Neeraj",
    mobile: "9380482102",
    role: "L1 Engineer" as UserRole,
    engineerMasterName: "Neeraj",
    engineerMasterRole: "L1" as EngineerRole,
  },
  {
    id: "u-l1-nitin",
    email: "l1.nitin@avavbusiness.com",
    password: "NitinL1@123",
    name: "Nitin",
    mobile: "9380482103",
    role: "L1 Engineer" as UserRole,
    engineerMasterName: "Nitin",
    engineerMasterRole: "L1" as EngineerRole,
  },
  {
    id: "u-l1-prashant-singh",
    email: "l1.prashant.singh@avavbusiness.com",
    password: "PrashantSinghL1@123",
    name: "Prashant Singh",
    mobile: "9380482104",
    role: "L1 Engineer" as UserRole,
    engineerMasterName: "Prashant Singh",
    engineerMasterRole: "L1" as EngineerRole,
  },
  {
    id: "u-l1-ashutosh",
    email: "l1.ashutosh@avavbusiness.com",
    password: "AshutoshL1@123",
    name: "Ashutosh",
    mobile: "9380482105",
    role: "L1 Engineer" as UserRole,
    engineerMasterName: "Ashutosh",
    engineerMasterRole: "L1" as EngineerRole,
  },
  {
    id: "u-l1-rajat",
    email: "l1.rajat@avavbusiness.com",
    password: "RajatL1@123",
    name: "Rajat",
    mobile: "9380482106",
    role: "L1 Engineer" as UserRole,
    engineerMasterName: "Rajat",
    engineerMasterRole: "L1" as EngineerRole,
  },
  {
    id: "u-l1-swastik",
    email: "l1.swastik@avavbusiness.com",
    password: "SwastikL1@123",
    name: "Swastik",
    mobile: "9380482107",
    role: "L1 Engineer" as UserRole,
    engineerMasterName: "Swastik",
    engineerMasterRole: "L1" as EngineerRole,
  },
  {
    id: "u-l1-pradeep",
    email: "l1.pradeep@avavbusiness.com",
    password: "PradeepL1@123",
    name: "Pradeep",
    mobile: "9380482108",
    role: "L1 Engineer" as UserRole,
    engineerMasterName: "Pradeep",
    engineerMasterRole: "L1" as EngineerRole,
  },
];

const serviceEngineers: SeedServiceEngineerAccount[] = [
  ...l1Engineers,
  ...l1Engineers.map((account) => {
    const localPart = account.email.split("@")[0].replace(/^l1\./i, "");
    const backupLocalPart = `${localPart}.backup`;
    const backupEmail = `${backupLocalPart}@avavbusiness.com`;
    return {
      id: `u-l1-${backupLocalPart.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "")}`,
      email: backupEmail,
      password: `${account.name.replace(/\s+/g, "")}Backup@123`,
      name: `${account.name} Backup`,
      mobile: account.mobile,
      role: "L1 Engineer" as UserRole,
      engineerMasterName: `${account.name} Backup`,
      engineerMasterRole: "Backup" as EngineerRole,
    };
  }),
  {
    id: "u-l2-naveen-maurya",
    email: "l2.naveen.maurya@avavbusiness.com",
    password: "NaveenMauryaL2@123",
    name: "Naveen Maurya",
    mobile: "9380482201",
    role: "L2 Technical Team" as UserRole,
    engineerMasterName: "Naveen Maurya",
    engineerMasterRole: "L2" as EngineerRole,
  },
  {
    id: "u-l2-prashant-noida",
    email: "l2.prashant.noida@avavbusiness.com",
    password: "PrashantNoidaL2@123",
    name: "Prashant Noida",
    mobile: "9380482202",
    role: "L2 Technical Team" as UserRole,
    engineerMasterName: "Prashant Noida",
    engineerMasterRole: "L2" as EngineerRole,
  },
  {
    id: "u-l3-mahesh",
    email: "l3.mahesh@avavbusiness.com",
    password: "MaheshL3@123",
    name: "Mahesh Choudhary",
    mobile: "9380482301",
    role: "L3 Advanced OEM Support" as UserRole,
    engineerMasterName: "Mahesh Choudhary",
    engineerMasterRole: "L3" as EngineerRole,
  },
];

const oldGenericEmails = ["l1@avavbusiness.com", "l2@avavbusiness.com", "l3@avavbusiness.com"];
const oldGenericIds = ["u-l1-demo", "u-l2-demo", "u-l3-demo"];
const serviceRoles = ["L1 Engineer", "L2 Technical Team", "L3 Advanced OEM Support"];

async function main() {
  const db = await connectDatabase();
  if (!db.connected) {
    console.error(db.message);
    process.exit(1);
  }

  const c = await getCollections();
  const now = new Date();

  const disabled = await c.users.updateMany(
    {
      $or: [
        { email: { $in: oldGenericEmails } },
        { id: { $in: oldGenericIds } },
        {
          role: { $in: serviceRoles },
          email: { $nin: serviceEngineers.map((account) => account.email) },
        },
      ],
    },
    { $set: { isActive: false, updatedAt: now } }
  );

  let userUpserted = 0;
  for (const account of serviceEngineers) {
    const passwordHash = await bcrypt.hash(account.password, CONFIG.BCRYPT_ROUNDS);
    const update: Partial<User> = {
      email: account.email,
      passwordHash,
      name: account.name,
      mobile: account.mobile,
      role: account.role,
      isActive: true,
      updatedAt: now,
    };
    const result = await c.users.updateOne(
      { email: account.email },
      {
        $set: update,
        $setOnInsert: {
          id: account.id,
          createdAt: now,
        },
      },
      { upsert: true }
    );
    if (result.upsertedCount || result.modifiedCount) userUpserted += 1;
  }

  let masterUpserted = 0;
  for (const account of serviceEngineers) {
    const result = await c.engineerMasters.updateOne(
      { id: engineerMasterId(account.engineerMasterName, account.engineerMasterRole) },
      {
        $set: {
          id: engineerMasterId(account.engineerMasterName, account.engineerMasterRole),
          name: account.engineerMasterName,
          email: account.email,
          mobile: account.mobile,
          role: account.engineerMasterRole,
          isActive: true,
          updatedAt: now,
        },
        $setOnInsert: {
          createdAt: now,
        },
      },
      { upsert: true }
    );
    if (result.upsertedCount || result.modifiedCount) masterUpserted += 1;
  }

  console.log(`Disabled ${disabled.modifiedCount} old generic service accounts.`);
  console.log(`Upserted ${userUpserted} service engineer accounts.`);
  console.log(`Upserted ${masterUpserted} engineer master records.`);
  await rebuildTicketLoads();
  const client = await getMongoClient();
  await client.close();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
