export function isValidEmailAddress(value: unknown) {
  const email = String(value ?? "").trim();
  if (!email) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function normalizeEmailAddress(value: unknown) {
  const email = String(value ?? "").trim().toLowerCase();
  return email || "";
}

