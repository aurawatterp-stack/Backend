"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveIndiaStateName = resolveIndiaStateName;
exports.getIndiaStates = getIndiaStates;
exports.getIndiaStateDistrictEntries = getIndiaStateDistrictEntries;
exports.getIndiaDistrictsForState = getIndiaDistrictsForState;
exports.isIndiaState = isIndiaState;
exports.isIndiaDistrictForState = isIndiaDistrictForState;
exports.getIndiaGeography = getIndiaGeography;
const indiaGeographyData_json_1 = __importDefault(require("./indiaGeographyData.json"));
const DATA = indiaGeographyData_json_1.default;
const STATE_ALIAS_MAP = {
    "andaman and nicobar": "Andaman and Nicobar Islands",
    "andaman and nicobar islands": "Andaman and Nicobar Islands",
    "nct of delhi": "Delhi",
    "national capital territory of delhi": "Delhi",
    delhi: "Delhi",
};
function normalizeGeoText(value) {
    return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}
function resolveIndiaStateName(value) {
    const normalized = normalizeGeoText(value);
    if (!normalized)
        return "";
    return STATE_ALIAS_MAP[normalized] ?? DATA.states.find((entry) => normalizeGeoText(entry.state) === normalized)?.state ?? "";
}
function getIndiaStates() {
    return [...DATA.states.map((entry) => entry.state)].sort((a, b) => a.localeCompare(b));
}
function getIndiaStateDistrictEntries() {
    return [...DATA.states]
        .map((entry) => ({ state: entry.state, districts: [...entry.districts] }))
        .sort((a, b) => a.state.localeCompare(b.state));
}
function getIndiaDistrictsForState(state) {
    const resolvedState = resolveIndiaStateName(state);
    if (!resolvedState)
        return [];
    const match = DATA.states.find((entry) => entry.state === resolvedState);
    return match ? [...match.districts] : [];
}
function isIndiaState(value) {
    return Boolean(resolveIndiaStateName(value));
}
function isIndiaDistrictForState(state, district) {
    const districts = getIndiaDistrictsForState(state);
    const normalizedDistrict = normalizeGeoText(district);
    if (!normalizedDistrict || !districts.length)
        return false;
    return districts.some((item) => normalizeGeoText(item) === normalizedDistrict);
}
function getIndiaGeography() {
    const entries = getIndiaStateDistrictEntries();
    const districtsByState = Object.fromEntries(entries.map((entry) => [entry.state, entry.districts]));
    return {
        states: entries.map((entry) => entry.state),
        districtsByState,
        stateDistrictEntries: entries,
    };
}
