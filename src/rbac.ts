import type { Permission, RoleName, SystemRoleName, UserRole } from "./types";

export const ALL_PERMISSIONS: Permission[] = [
  "dashboard:view",
  "users:manage",
  "roles:manage",
  "customers:manage",
  "distributors:manage",
  "inventory:serials",
  "inventory:products",
  "inventory:bom",
  "inventory:raw-materials",
  "inventory:manufactured",
  "sales:entry",
  "dispatch:manage",
  "accounts:manage",
  "complaints:consumer",
  "complaints:supplier",
];

export const SYSTEM_ROLES: SystemRoleName[] = [
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

export const DEFAULT_ROLE_PERMISSIONS: Record<SystemRoleName, Permission[]> = {
  Admin: ALL_PERMISSIONS,
  Inventory: ["dashboard:view", "inventory:serials", "inventory:products", "inventory:bom", "inventory:raw-materials", "inventory:manufactured"],
  Sales: ["dashboard:view", "sales:entry"],
  Dispatch: ["dashboard:view", "dispatch:manage"],
  Accounts: ["dashboard:view", "accounts:manage"],
  Distributor: ["dashboard:view"],
  "L1 Engineer": ["dashboard:view", "complaints:consumer"],

  "L2 Technical Team": ["dashboard:view", "complaints:consumer"],
  "L3 Advanced OEM Support": ["dashboard:view", "complaints:consumer", "complaints:supplier"],
  "Warehouse Team": ["dashboard:view", "inventory:serials", "inventory:products", "inventory:bom", "inventory:raw-materials", "inventory:manufactured", "dispatch:manage"],
  "Accounts Team": ["dashboard:view", "accounts:manage", "complaints:consumer", "complaints:supplier"],
  Dealer: ["dashboard:view", "complaints:consumer"],
};

export const ROLE_ALIASES: Record<SystemRoleName, UserRole[]> = {
  Admin: ["Admin"],
  Inventory: ["Inventory", "Inventory Team", "Inventory Manager"],
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

function collapseSpaces(s: string) {
  return s.replace(/\s+/g, " ").trim();
}

function titleCaseWords(s: string) {
  return collapseSpaces(s)
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ");
}

export function normalizeRole(input: unknown): RoleName {
  const raw = typeof input === "string" ? collapseSpaces(input) : "";
  const key = raw.toLowerCase();

  if (key === "admin") return "Admin";
  if (key === "inventory" || key === "inventory team" || key === "inventory manager") return "Inventory";
  if (key === "sales" || key === "sales manager") return "Sales";
  if (key === "dispatch" || key === "dispatch team") return "Dispatch";
  if (key === "accounts" || key === "accounts manager") return "Accounts";
  if (key === "accounts team") return "Accounts Team";
  if (key === "distributor") return "Distributor";
  if (key === "service" || key === "service manager" || key === "l1" || key === "l1 engineer" || key === "support l1") return "L1 Engineer";
  if (key === "backup" || key === "l1 backup engineer" || key === "l1 backup" || key === "backup engineer") return "L1 Engineer";
  if (key === "l2" || key === "l2 technical team" || key === "support l2" || key === "technical team") return "L2 Technical Team";
  if (key === "l3" || key === "l3 advanced oem support" || key === "support l3" || key === "oem support") return "L3 Advanced OEM Support";
  if (key === "warehouse" || key === "warehouse team") return "Warehouse Team";
  if (key === "service accounts") return "Accounts Team";
  if (key === "dealer") return "Dealer";

  // Custom role name: normalize spacing + title-case for consistency.
  const cleaned = raw.replace(/[^\w\s-]/g, "");
  return titleCaseWords(cleaned) || "Distributor";
}

export function roleMatchSet(role: RoleName): UserRole[] {
  const sys = SYSTEM_ROLES.find((r) => r === role);
  return sys ? ROLE_ALIASES[sys] : [role];
}

export function isPermission(v: unknown): v is Permission {
  return typeof v === "string" && (ALL_PERMISSIONS as string[]).includes(v);
}

export function sanitizePermissions(perms: unknown): Permission[] {
  if (!Array.isArray(perms)) return [];
  const clean = perms.filter(isPermission) as Permission[];
  return [...new Set(clean)];
}
