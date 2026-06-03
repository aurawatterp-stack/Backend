import type { Permission, RoleName, SystemRoleName, UserRole } from "./types";

export const ALL_PERMISSIONS: Permission[] = [
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
  "complaints:consumer",
  "complaints:supplier",
];

export const SYSTEM_ROLES: SystemRoleName[] = ["Admin", "Inventory", "Sales", "Dispatch", "Service", "Distributor"];

export const DEFAULT_ROLE_PERMISSIONS: Record<SystemRoleName, Permission[]> = {
  Admin: ALL_PERMISSIONS,
  Inventory: ["dashboard:view", "inventory:serials", "inventory:products", "inventory:raw-materials", "inventory:manufactured"],
  Sales: ["dashboard:view", "sales:entry"],
  Dispatch: ["dashboard:view", "dispatch:manage"],
  Service: ["dashboard:view", "complaints:consumer", "complaints:supplier"],
  Distributor: ["dashboard:view"],
};

export const ROLE_ALIASES: Record<SystemRoleName, UserRole[]> = {
  Admin: ["Admin"],
  Inventory: ["Inventory", "Inventory Manager"],
  Sales: ["Sales", "Sales Manager"],
  Dispatch: ["Dispatch", "Dispatch Team"],
  Service: ["Service"],
  Distributor: ["Distributor"],
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
  if (key === "inventory" || key === "inventory manager") return "Inventory";
  if (key === "sales" || key === "sales manager") return "Sales";
  if (key === "dispatch" || key === "dispatch team") return "Dispatch";
  if (key === "service" || key === "service manager") return "Service";
  if (key === "distributor") return "Distributor";

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
