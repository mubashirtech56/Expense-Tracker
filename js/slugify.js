// ============================================================================
// Shared Login ID Slugifier (Client & Edge Functions)
// ============================================================================

export function slugifyLoginId(value) {
  const clean = String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);

  if (!clean) {
    throw new Error('Login ID cannot be empty and must contain alphanumeric characters.');
  }

  return clean;
}
