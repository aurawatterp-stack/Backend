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
    "dispatch:manage",
    "accounts:manage",
    "complaints:consumer",
    "complaints:supplier",
];
exports.SYSTEM_ROLES = [
    "Admin",
    "Inventory",
    "Sales",
    "Dispatch",
    "Accounts",
    "Distributor",
    "L1 Engineer",
    "L2 Technical Team",
    "L3 Advanced OEM Support",
    "Warehouse Team",
    "Accounts Team",
    "Dealer",
];
exports.DEFAULT_ROLE_PERMISSIONS = {
    Admin: exports.ALL_PERMISSIONS,
    Inventory: ["dashboard:view", "inventory:serials", "inventory:products", "inventory:raw-materials", "inventory:manufactured"],
    Sales: ["dashboard:view", "sales:entry", "complaints:consumer"],
    Dispatch: ["dashboard:view", "dispatch:manage"],
    Accounts: ["dashboard:view", "accounts:manage"],
    Distributor: ["dashboard:view"],
    "L1 Engineer": ["dashboard:view", "complaints:consumer", "complaints:supplier"],
    "L2 Technical Team": ["dashboard:view", "complaints:consumer", "complaints:supplier", "inventory:products"],
    "L3 Advanced OEM Support": ["dashboard:view", "complaints:consumer", "complaints:supplier"],
    "Warehouse Team": ["dashboard:view", "inventory:serials", "inventory:products", "inventory:raw-materials", "inventory:manufactured", "dispatch:manage"],
    "Accounts Team": ["dashboard:view", "accounts:manage", "complaints:consumer", "complaints:supplier"],
    Dealer: ["dashboard:view", "complaints:consumer"],
};
exports.ROLE_ALIASES = {
    Admin: ["Admin"],
    Inventory: ["Inventory", "Inventory Manager"],
    Sales: ["Sales", "Sales Manager"],
    Dispatch: ["Dispatch", "Dispatch Team"],
    Accounts: ["Accounts", "Accounts Team", "Accounts Manager"],
    Distributor: ["Distributor"],
    "L1 Engineer": ["L1 Engineer", "Service", "Service Manager", "Support L1"],
    "L2 Technical Team": ["L2 Technical Team", "Support L2", "Technical Team"],
    "L3 Advanced OEM Support": ["L3 Advanced OEM Support", "Support L3", "OEM Support"],
    "Warehouse Team": ["Warehouse Team", "Warehouse", "Inventory Team"],
    "Accounts Team": ["Accounts Team", "Service Accounts"],
    Dealer: ["Dealer"],
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
    if (key === "dispatch" || key === "dispatch team")
        return "Dispatch";
    if (key === "accounts" || key === "accounts manager")
        return "Accounts";
    if (key === "accounts team")
        return "Accounts Team";
    if (key === "distributor")
        return "Distributor";
    if (key === "service" || key === "service manager" || key === "l1" || key === "l1 engineer" || key === "support l1")
        return "L1 Engineer";
    if (key === "l2" || key === "l2 technical team" || key === "support l2" || key === "technical team")
        return "L2 Technical Team";
    if (key === "l3" || key === "l3 advanced oem support" || key === "support l3" || key === "oem support")
        return "L3 Advanced OEM Support";
    if (key === "warehouse" || key === "warehouse team")
        return "Warehouse Team";
    if (key === "service accounts")
        return "Accounts Team";
    if (key === "dealer")
        return "Dealer";
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
