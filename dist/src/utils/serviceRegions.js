"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SERVICE_REGIONS = void 0;
exports.matchServiceRegion = matchServiceRegion;
exports.resolveRegionName = resolveRegionName;
exports.resolveComplaintRegionName = resolveComplaintRegionName;
/**
 * Service region labels.
 *
 * A region is only a label for reporting and queue filters — the engineer a ticket is routed to
 * always comes from the state/district mapping in `engineerAssignments`. The two must agree, so
 * the label is derived from the same district/state the routing uses.
 */
exports.SERVICE_REGIONS = [
    { name: "NCR", keywords: ["delhi", "noida", "gurgaon", "gurugram", "faridabad", "ghaziabad"] },
    { name: "UP", keywords: ["lucknow", "kanpur", "uttar pradesh", "varanasi", "prayagraj"] },
    { name: "Rajasthan", keywords: ["jaipur", "ajmer", "rajasthan", "udaipur", "jodhpur"] },
    { name: "Punjab", keywords: ["ludhiana", "amritsar", "punjab", "jalandhar", "patiala"] },
];
/** Region whose name or keywords match `input`, or undefined when nothing matches. */
function matchServiceRegion(input) {
    const text = String(input ?? "").trim().toLowerCase();
    if (!text)
        return undefined;
    return exports.SERVICE_REGIONS.find((region) => (region.name.toLowerCase() === text || region.keywords.some((keyword) => text.includes(keyword))));
}
/**
 * Region label for a ticket, read from the location fields that were actually captured.
 *
 * This never guesses: a location that matches no configured service region keeps the ticket's own
 * state name instead of collapsing to the first entry in SERVICE_REGIONS. That fallback is why
 * tickets from unmatched locations were all showing up labelled "NCR" while the state/district
 * mapping routed them to an engineer who does not cover NCR at all.
 */
function resolveRegionName(candidates, stateFallback) {
    for (const candidate of candidates) {
        const match = matchServiceRegion(candidate);
        if (match)
            return match.name;
    }
    return String(stateFallback ?? "").trim() || "Unassigned";
}
/** Region label for a complaint, derived from the district/state it is routed by. */
function resolveComplaintRegionName(complaint) {
    return resolveRegionName([complaint.district, complaint.state, complaint.region, complaint.siteLocation], complaint.state);
}
