import { config } from './config.mjs';
import { analyzeRisk } from './risk.mjs';

export async function scoreCandidate(c){
  let score=0;
  const reasons=[];
  const ageMin=c.pairCreatedAt?(Date.now()-c.pairCreatedAt)/60000:Infinity;
  const buySell=c.sells5m>0?c.buys5m/c.sells5m:c.buys5m>0?99:0;
  const accel=c.volume1h>0?c.volume5m/(c.volume1h/12):0;
  if(ageMin<=config.maxTokenAgeMinutes){score+=10;reasons.push(`fresh ${ageMin.toFixed(0)}m`)}
  if(c.liquidityUsd>=config.minLiquidity){score+=15;reasons.push('liquidity')}
  if(c.volume5m>=config.min5mVolume){score+=15;reasons.push('5m volume')}
  if(accel>=1.5){score+=15;reasons.push(`volume ${accel.toFixed(1)}x`)}
  if(buySell>=1.5){score+=15;reasons.push(`buy/sell ${buySell.toFixed(1)}x`)}
  if(c.priceChange5m>0&&c.priceChange5m<=35){score+=10;reasons.push('momentum')}
  if(c.marketCap>=config.minMarketCap&&c.marketCap<=config.maxMarketCap){score+=10;reasons.push('MC range')}
  if(c.volume5m>0&&c.liquidityUsd>0&&c.volume5m/c.liquidityUsd<=3){score+=10;reasons.push('volume/liquidity')}

  const risk=await analyzeRisk(c);
  const bundlePct=Number(risk.bundlePct);
  if(Number.isFinite(bundlePct)){
    if(bundlePct<config.bundleSupplyMediumPct){score+=5;reasons.push(`bundle ${bundlePct.toFixed(1)}% low`)}
    else if(bundlePct<config.bundleSupplyElevatedPct){score-=5;reasons.push(`bundle ${bundlePct.toFixed(1)}%`)}
    else if(bundlePct<config.bundleSupplyHighPct){score-=15;reasons.push(`bundle ${bundlePct.toFixed(1)}% elevated`)}
    else{score-=40;reasons.push(`bundle ${bundlePct.toFixed(1)}% high`)}
  } else if(risk.bundleRisk==='high') score-=40;
  else if(risk.bundleRisk==='medium') score-=10;
  // UNKNOWN bundle data is neutral in V8.4 and never blocks by itself.

  if(risk.devRisk==='high')score-=40;
  if(risk.holderRisk==='medium')score-=10;
  if(risk.holderRisk==='high')score-=30;
  return{...c,score:Math.max(0,Math.min(100,score)),risk,reasons};
}

export function entryAllowed(s){
  if(s.score<config.minScore)return{ok:false,why:`score ${s.score} < ${config.minScore}`};
  if(s.risk.bundleRisk==='high')return{ok:false,why:`high bundle risk${Number.isFinite(s.risk.bundlePct)?` (${s.risk.bundlePct.toFixed(1)}%)`:''}`};
  if(s.risk.devRisk==='high')return{ok:false,why:'high dev authority risk'};
  if(s.risk.holderRisk==='high')return{ok:false,why:'high holder concentration'};
  return{ok:true,why:s.risk.bundleRisk==='unknown'?'approved; bundle data unavailable (fail-open)':'approved'};
}
