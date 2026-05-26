"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ROLE_ALIASES = exports.DEFAULT_ROLE_PERMISSIONS = exports.SYSTEM_ROLES = exports.ALL_PERMISSIONS = void 0;
exports.normalizeRole = normalizeRole;
exports.roleMatchSet = roleMatchSet;
exports.isPermission = isPermission;
exports.sanitizePermissions = sanitizePermissions;
exports.ALL_PERMISSIONS = [
    "dashboard:view",
    "users:manage",
    "roles:manage",
    "customers:manage",
    "distributors:manage",
    "inventory:serials",
    "inventory:products",
    "inventory:raw-materials",
    "inventory:manufactured",
    "sales:entry",
    "complaints:consumer",
    "complaints:supplier",
];
exports.SYSTEM_ROLES = ["Admin", "Inventory", "Sales", "Service", "Distributor"];
exports.DEFAULT_ROLE_PERMISSIONS = {
    Admin: exports.ALL_PERMISSIONS,
    Inventory: ["dashboard:view", "inventory:serials", "inventory:products", "inventory:raw-materials", "inventory:manufactured"],
    Sales: ["dashboard:view", "sales:entry"],
    Service: ["dashboard:view", "complaints:consumer", "complaints:supplier"],
    Distributor: ["dashboard:view"],
};
exports.ROLE_ALIASES = {
    Admin: ["Admin"],
    Inventory: ["Inventory", "Inventory Manager"],
    Sales: ["Sales", "Sales Manager"],
    Service: ["Service"],
    Distributor: ["Distributor"],
};
function collapseSpaces(s) {
    return s.replace(/\s+/g, " ").trim();
}
function titleCaseWords(s) {
    return collapseSpaces(s)
        .split(" ")
        .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
        .join(" ");
}
function normalizeRole(input) {
    const raw = typeof input === "string" ? collapseSpaces(input) : "";
    const key = raw.toLowerCase();
    if (key === "admin")
        return "Admin";
    if (key === "inventory" || key === "inventory manager")
        return "Inventory";
    if (key === "sales" || key === "sales manager")
        return "Sales";
    if (key === "service" || key === "service manager")
        return "Service";
    if (key === "distributor")
        return "Distributor";
    // Custom role name: normalize spacing + title-case for consistency.
    const cleaned = raw.replace(/[^\w\s-]/g, "");
    return titleCaseWords(cleaned) || "Distributor";
}
function roleMatchSet(role) {
    const sys = exports.SYSTEM_ROLES.find((r) => r === role);
    return sys ? exports.ROLE_ALIASES[sys] : [role];
}
function isPermission(v) {
    return typeof v === "string" && exports.ALL_PERMISSIONS.includes(v);
}
function sanitizePermissions(perms) {
    if (!Array.isArray(perms))
        return [];
    const clean = perms.filter(isPermission);
    return [...new Set(clean)];
}
