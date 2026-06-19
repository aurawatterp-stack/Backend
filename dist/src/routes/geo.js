"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const indiaGeography_1 = require("../data/indiaGeography");
const http_1 = require("../utils/http");
const router = express_1.default.Router();
router.get("/", (_req, res) => {
    return (0, http_1.ok)(res, (0, indiaGeography_1.getIndiaGeography)());
});
router.get("/states", (_req, res) => {
    const { states } = (0, indiaGeography_1.getIndiaGeography)();
    return (0, http_1.ok)(res, { states });
});
router.get("/districts", (req, res) => {
    const state = (0, indiaGeography_1.resolveIndiaStateName)(req.query.state);
    if (!state) {
        return (0, http_1.fail)(res, "state is required", 400);
    }
    return (0, http_1.ok)(res, { state, districts: (0, indiaGeography_1.getIndiaDistrictsForState)(state) });
});
exports.default = router;
