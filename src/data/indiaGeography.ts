import geography from "./indiaGeographyData.json";


export type IndiaStateDistrictEntry = {
  state: string;
  districts: string[];
};

type GeographyFile = {
  states: IndiaStateDistrictEntry[];
};

const DATA = geography as GeographyFile;

const STATE_ALIAS_MAP: Record<string, string> = {
  "andaman and nicobar": "Andaman and Nicobar Islands",
  "andaman and nicobar islands": "Andaman and Nicobar Islands",
  "nct of delhi": "Delhi",
  "national capital territory of delhi": "Delhi",
  delhi: "Delhi",
};

function normalizeGeoText(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function resolveIndiaStateName(value: unknown) {
  const normalized = normalizeGeoText(value);
  if (!normalized) return "";
  return STATE_ALIAS_MAP[normalized] ?? DATA.states.find((entry) => normalizeGeoText(entry.state) === normalized)?.state ?? "";
}

export function getIndiaStates() {
  return [...DATA.states.map((entry) => entry.state)].sort((a, b) => a.localeCompare(b));
}

export function getIndiaStateDistrictEntries() {
  return [...DATA.states]
    .map((entry) => ({ state: entry.state, districts: [...entry.districts] }))
    .sort((a, b) => a.state.localeCompare(b.state));
}

export function getIndiaDistrictsForState(state: unknown) {
  const resolvedState = resolveIndiaStateName(state);
  if (!resolvedState) return [] as string[];
  const match = DATA.states.find((entry) => entry.state === resolvedState);
  return match ? [...match.districts] : [];
}

export function isIndiaState(value: unknown) {
  return Boolean(resolveIndiaStateName(value));
}

export function isIndiaDistrictForState(state: unknown, district: unknown) {
  const districts = getIndiaDistrictsForState(state);
  const normalizedDistrict = normalizeGeoText(district);
  if (!normalizedDistrict || !districts.length) return false;
  return districts.some((item) => normalizeGeoText(item) === normalizedDistrict);
}

export function getIndiaGeography() {
  const entries = getIndiaStateDistrictEntries();
  const districtsByState = Object.fromEntries(entries.map((entry) => [entry.state, entry.districts]));
  return {
    states: entries.map((entry) => entry.state),
    districtsByState,
    stateDistrictEntries: entries,
  };
}
