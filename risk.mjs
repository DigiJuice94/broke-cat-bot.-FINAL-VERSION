import { config } from './config.mjs';
import { enhancedTransactions, getHolderSnapshot, getMintInfo } from './helius.mjs';

const pct = (n,d) => d > 0 ? n / d * 100 : 0;
const uniq = xs => [...new Set(xs.filter(Boolean))];
const asWallet = x => typeof x === 'string' && x.length >= 32 ? x : null;

function txActors(tx) {
  const actors = [];
  if (asWallet(tx?.feePayer)) actors.push(tx.feePayer);
  for (const a of tx?.accountData || []) if (a?.nativeBalanceChange < 0 && asWallet(a.account)) actors.push(a.account);
  for (const t of tx?.tokenTransfers || []) {
    if (asWallet(t?.fromUserAccount)) actors.push(t.fromUserAccount);
    if (asWallet(t?.toUserAccount)) actors.push(t.toUserAccount);
  }
  return uniq(actors);
}

function detectLaunchClusters(txs, mint, pairCreatedAt) {
  const createdSec = pairCreatedAt ? Math.floor(pairCreatedAt / 1000) : null;
  const relevant = txs.filter(t => !createdSec || !t.timestamp || Math.abs(Number(t.timestamp)-createdSec) <= config.launchWindowSeconds);
  const slots = new Map();
  const actorCounts = new Map();
  const tokenBuyers = new Set();
  let mintTouchAmount = 0;
  for (const tx of relevant) {
    const actors = txActors(tx);
    for (const w of actors) actorCounts.set(w, (actorCounts.get(w)||0)+1);
    if (tx?.slot != null) {
      const arr = slots.get(tx.slot) || [];
      arr.push(...actors); slots.set(tx.slot, uniq(arr));
    }
    for (const tr of tx?.tokenTransfers || []) {
      if (tr?.mint !== mint) continue;
      const to = asWallet(tr?.toUserAccount);
      if (to) tokenBuyers.add(to);
      mintTouchAmount += Number(tr?.tokenAmount || 0) || 0;
    }
  }
  const crowdedSlots = [...slots.entries()].filter(([,ws]) => ws.length >= config.clusterWalletThreshold)
    .map(([slot, wallets]) => ({ slot, wallets }));
  const repeatedActors = [...actorCounts.entries()].filter(([,count])=>count >= config.clusterRepeatThreshold)
    .map(([wallet,count])=>({wallet,count})).sort((a,b)=>b.count-a.count);
  const clusterWallets = uniq(crowdedSlots.flatMap(x=>x.wallets));
  return { txCount: relevant.length, crowdedSlots, repeatedActors, clusterWallets, tokenBuyers:[...tokenBuyers], mintTouchAmount };
}

async function sharedFunders(wallets, launchTimeSec) {
  const capped = uniq(wallets).slice(0, config.maxFundingWalletChecks);
  const funderToWallets = new Map();
  for (const wallet of capped) {
    try {
      const txs = await enhancedTransactions(wallet, {
        limit: config.fundingHistoryLimit,
        sort: 'desc',
        lteTime: launchTimeSec || undefined,
        gteTime: launchTimeSec ? launchTimeSec - config.fundingLookbackSeconds : undefined,
        tokenAccounts:'none'
      });
      const funders = new Set();
      for (const tx of txs) for (const tr of tx?.nativeTransfers || []) {
        if (tr?.toUserAccount === wallet && asWallet(tr?.fromUserAccount) && Number(tr?.amount || 0) > 0) funders.add(tr.fromUserAccount);
      }
      for (const f of funders) {
        const arr = funderToWallets.get(f) || []; arr.push(wallet); funderToWallets.set(f, uniq(arr));
      }
    } catch { /* A failed wallet check should reduce confidence, not fabricate a link. */ }
  }
  return [...funderToWallets.entries()].filter(([,ws])=>ws.length >= 2)
    .map(([funder,wallets])=>({funder,wallets})).sort((a,b)=>b.wallets.length-a.wallets.length);
}

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

export async function analyzeRisk(c) {
  const notes=[];
  if(!config.heliusApiKey) return {bundleRisk:'unknown',holderRisk:'unknown',devRisk:'unknown',confidence:'none',notes:['Add HELIUS_API_KEY to enable V2 on-chain risk analysis.']};
  try {
    const [mintInfo, holders, launchTxs] = await Promise.all([
      getMintInfo(c.tokenAddress),
      getHolderSnapshot(c.tokenAddress),
      enhancedTransactions(c.tokenAddress,{limit:config.launchTxLimit,sort:'asc',tokenAccounts:'all'})
    ]);
    const holder = classifyHolderRisk(holders);
    const cluster = detectLaunchClusters(launchTxs,c.tokenAddress,c.pairCreatedAt);
    const launchTimeSec = c.pairCreatedAt ? Math.floor(c.pairCreatedAt/1000) : (launchTxs[0]?.timestamp || null);
    const shared = await sharedFunders(cluster.tokenBuyers.length ? cluster.tokenBuyers : cluster.clusterWallets, launchTimeSec);
    const linkedWallets = uniq([...cluster.clusterWallets, ...shared.flatMap(x=>x.wallets)]);
    const linkedHeld = holders.holders.filter(h=>linkedWallets.includes(h.owner)).reduce((s,h)=>s+h.amount,0);
    const estimatedLinkedSupplyPct = pct(linkedHeld,holders.totalSupply);

    let bundleRisk='low';
    if (shared.some(x=>x.wallets.length>=config.sharedFunderHighWallets) || estimatedLinkedSupplyPct>=config.bundleSupplyHighPct || cluster.crowdedSlots.length>=config.crowdedSlotsHigh) bundleRisk='high';
    else if (shared.length || estimatedLinkedSupplyPct>=config.bundleSupplyMediumPct || cluster.crowdedSlots.length) bundleRisk='medium';

    let devRisk='low';
    if (mintInfo.freezeAuthority) {devRisk='high';notes.push('Freeze authority is still enabled.');}
    if (mintInfo.mintAuthority) {devRisk='high';notes.push('Mint authority is still enabled.');}
    if (!mintInfo.freezeAuthority && !mintInfo.mintAuthority) notes.push('Mint and freeze authorities are disabled.');
    if (shared.length) notes.push(`${shared.length} shared-funder cluster(s) detected in checked early wallets.`);
    if (cluster.crowdedSlots.length) notes.push(`${cluster.crowdedSlots.length} launch-window slot(s) had ${config.clusterWalletThreshold}+ observed actors.`);
    notes.push(`Estimated currently-held supply among detected linked wallets: ${estimatedLinkedSupplyPct.toFixed(2)}%.`);

    const enoughLaunchData = launchTxs.length >= config.minLaunchTxForConfidence;
    const confidence = enoughLaunchData ? 'medium' : 'low';
    if(!enoughLaunchData) notes.push(`Only ${launchTxs.length} mint-address transactions were available; bundle confidence is low.`);
    if(confidence==='low' && config.blockLowBundleConfidence) bundleRisk='unknown';

    return {bundleRisk,holderRisk:holder.holderRisk,devRisk,confidence,estimatedLinkedSupplyPct,
      linkedWalletCount:linkedWallets.length,sharedFunderClusters:shared.length,crowdedLaunchSlots:cluster.crowdedSlots.length,
      top1Pct:holder.top1Pct,top5Pct:holder.top5Pct,top10Pct:holder.top10Pct,mintAuthority:mintInfo.mintAuthority,freezeAuthority:mintInfo.freezeAuthority,notes};
  } catch (err) {
    return {bundleRisk:'unknown',holderRisk:'unknown',devRisk:'unknown',confidence:'error',notes:[`V2 risk analysis failed safely: ${err.message}`]};
  }
}
