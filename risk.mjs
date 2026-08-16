import { config } from './config.mjs';
import { getHolderSnapshot, getMintInfo } from './helius.mjs';
import { getBundlers } from './solanatracker.mjs';

const pct = (n,d) => d > 0 ? n / d * 100 : 0;

export function classifyHolderRisk(snapshot) {
  const { totalSupply, holders } = snapshot;
  const top1 = pct(holders[0]?.amount || 0,totalSupply);
  const top5 = pct(holders.slice(0,5).reduce((s,h)=>s+h.amount,0),totalSupply);
  const top10 = pct(holders.slice(0,10).reduce((s,h)=>s+h.amount,0),totalSupply);
  let holderRisk = 'low';
  if (top1 >= config.holderTop1HighPct || top5 >= config.holderTop5HighPct || top10 >= config.holderTop10HighPct) holderRisk='high';
  else if (top1 >= config.holderTop1MediumPct || top5 >= config.holderTop5MediumPct || top10 >= config.holderTop10MediumPct) holderRisk='medium';
  return { holderRisk, top1Pct:top1, top5Pct:top5, top10Pct:top10, topOwners:holders.slice(0,10) };
}

function classifyBundlePct(bundlePct) {
  if (!Number.isFinite(bundlePct)) return 'unknown';
  if (bundlePct >= config.bundleSupplyHighPct) return 'high';
  if (bundlePct >= config.bundleSupplyMediumPct) return 'medium';
  return 'low';
}

export async function analyzeRisk(c) {
  const notes=[];
  let holderRisk='unknown',devRisk='unknown';
  let top1Pct=null,top5Pct=null,top10Pct=null,mintAuthority=null,freezeAuthority=null;

  // Existing Helius source remains responsible for holder concentration + mint/freeze authority.
  if(config.heliusApiKey){
    try {
      const [mintInfo, holders] = await Promise.all([getMintInfo(c.tokenAddress), getHolderSnapshot(c.tokenAddress)]);
      const holder=classifyHolderRisk(holders);
      holderRisk=holder.holderRisk; top1Pct=holder.top1Pct; top5Pct=holder.top5Pct; top10Pct=holder.top10Pct;
      mintAuthority=mintInfo.mintAuthority; freezeAuthority=mintInfo.freezeAuthority;
      devRisk=(mintInfo.freezeAuthority||mintInfo.mintAuthority)?'high':'low';
      if(mintInfo.freezeAuthority)notes.push('Freeze authority is still enabled.');
      if(mintInfo.mintAuthority)notes.push('Mint authority is still enabled.');
    } catch(err){ notes.push(`Helius holder/dev scan failed safely: ${err.message}`); }
  } else notes.push('HELIUS_API_KEY missing: holder/dev scan unavailable.');

  // NEW external data source: Solana Tracker's dedicated bundlers endpoint.
  let bundleRisk='unknown',bundlePct=null,bundlerWalletCount=null,bundleSource='SOLANA_TRACKER',bundleStatus='NO_DATA';
  if(config.solanaTrackerApiKey){
    try {
      const b=await getBundlers(c.tokenAddress);
      bundlerWalletCount=b.walletCount;
      if(Number.isFinite(b.totalBundlerPercentage)){
        bundlePct=b.totalBundlerPercentage;
        bundleRisk=classifyBundlePct(bundlePct);
        bundleStatus='OK';
        notes.push(`Solana Tracker bundler scan: ${bundlePct.toFixed(2)}% across ${bundlerWalletCount} detected bundler wallet(s).`);
      } else {
        bundleStatus='NO_PERCENTAGE';
        notes.push(`Solana Tracker bundler endpoint returned ${bundlerWalletCount} wallet(s) but no total bundle percentage.`);
      }
    } catch(err){
      bundleStatus='ERROR';
      notes.push(`Solana Tracker bundler scan failed safely: ${err.message}`);
    }
  } else {
    bundleStatus='API_KEY_MISSING';
    notes.push('SOLANA_TRACKER_API_KEY missing: NEW bundle scanner is OFF.');
  }

  return {
    bundleRisk, bundlePct, totalBundlerPercentage:bundlePct, bundlerWalletCount, bundleSource, bundleStatus,
    holderRisk,devRisk,top1Pct,top5Pct,top10Pct,mintAuthority,freezeAuthority,notes
  };
}
