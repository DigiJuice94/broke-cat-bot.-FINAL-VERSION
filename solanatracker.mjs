import { config } from './config.mjs';

const BASE = 'https://data.solanatracker.io';

async function getJson(path) {
  if (!config.solanaTrackerApiKey) throw new Error('SOLANA_TRACKER_API_KEY is not configured');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.solanaTrackerTimeoutMs);
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { 'x-api-key': config.solanaTrackerApiKey, 'accept': 'application/json' },
      signal: controller.signal
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Solana Tracker HTTP ${res.status}${text ? `: ${text.slice(0,180)}` : ''}`);
    return text ? JSON.parse(text) : {};
  } finally { clearTimeout(timer); }
}

function finiteNumber(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.replace('%','').trim());
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function firstFinite(...values) {
  for (const v of values) { const n = finiteNumber(v); if (n != null) return n; }
  return null;
}

function walkFind(obj, keys, depth=0) {
  if (!obj || typeof obj !== 'object' || depth > 5) return null;
  for (const k of keys) if (Object.prototype.hasOwnProperty.call(obj,k)) {
    const n = finiteNumber(obj[k]); if (n != null) return n;
  }
  for (const v of Object.values(obj)) if (v && typeof v === 'object') {
    const found = walkFind(v, keys, depth+1); if (found != null) return found;
  }
  return null;
}

export function parseBundlersResponse(data) {
  const wallets = Array.isArray(data?.wallets) ? data.wallets :
    Array.isArray(data?.bundlers) ? data.bundlers :
    Array.isArray(data?.data?.wallets) ? data.data.wallets :
    Array.isArray(data?.data?.bundlers) ? data.data.bundlers : [];

  let totalBundlerPercentage = firstFinite(
    data?.totalBundlerPercentage,
    data?.totalBundlerPct,
    data?.bundlerPercentage,
    data?.percentage,
    data?.data?.totalBundlerPercentage,
    data?.data?.totalBundlerPct,
    data?.data?.bundlerPercentage
  );
  if (totalBundlerPercentage == null) totalBundlerPercentage = walkFind(data,[
    'totalBundlerPercentage','totalBundlerPct','bundlerPercentage','bundledPercentage','bundlePercentage'
  ]);

  // Some APIs express percentages as fractions; normalize obvious 0..1 fractions.
  if (totalBundlerPercentage != null && totalBundlerPercentage > 0 && totalBundlerPercentage <= 1) totalBundlerPercentage *= 100;

  return {
    totalBundlerPercentage,
    walletCount: wallets.length,
    wallets,
    raw: data
  };
}

export async function getBundlers(tokenAddress) {
  const data = await getJson(`/tokens/${encodeURIComponent(tokenAddress)}/bundlers`);
  return parseBundlersResponse(data);
}
