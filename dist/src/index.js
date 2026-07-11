"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = __importDefault(require("./app"));
const config_1 = require("./config");
const connect_1 = require("./db/connect");
const init_1 = require("./db/init");
const seed_1 = require("./db/seed");
const engineerAssignments_1 = require("./services/engineerAssignments");
async function start() {
    console.log(`🧩  Backend build: 2026-05-12T16:10Z`);
    const db = await (0, connect_1.connectDatabase)();
    if (db.connected) {
        console.log(`✅ ${db.message}`);
    }
    else {
        console.log(`⚠️  ${db.message}`);
    }
    if (db.connected) {
        await (0, init_1.initDatabase)();
        if (config_1.CONFIG.SEED_DB) {
            await (0, seed_1.seedDatabaseIfEmpty)();
            await (0, engineerAssignments_1.seedEngineerAssignmentsIfEmpty)();
            console.log("🌱  Seeded demo data (SEED_DB=true).");
        }
    }
    app_1.default.listen(config_1.CONFIG.PORT, () => {
        console.log(`\n🚀  Aurawatt IMS API running on http://localhost:${config_1.CONFIG.PORT}`);
        console.log(`📋  Health: http://localhost:${config_1.CONFIG.PORT}/health\n`);
    });
}
start().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Failed to start server:", message);
    process.exit(1);
});
