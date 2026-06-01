/** Parse cloudflared version from `cloudflared --version` output (e.g. 2026.3.0). */
export function parseCloudflaredVersion(text) {
  if (!text) return null;
  const match =
    text.match(/(\d{4}\.\d+\.\d+)/) || text.match(/\b(\d+\.\d+\.\d+)\b/);
  return match ? match[1] : null;
}

/** @returns {-1|0|1} negative if a < b */
export function compareVersions(a, b) {
  if (!a || !b) return 0;
  const pa = a.split('.').map((n) => parseInt(n, 10));
  const pb = b.split('.').map((n) => parseInt(n, 10));
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da < db) return -1;
    if (da > db) return 1;
  }
  return 0;
}
