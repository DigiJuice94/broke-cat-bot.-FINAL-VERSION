import { config } from './config.mjs';
import { analyzeRisk } from './risk.mjs';

const add=(breakdown,key,points,passed,detail)=>{breakdown[key]={points:passed?points:0,max:Math.max(points,0),passed,detail};return passed?points:0};
const adjust=(breakdown,key,points,detail)=>{breakdown[key]={points,max:points>0?points:0,passed:points>=0,detail};return points};

export async function scoreCandidate(c){
  let score=0;
  const reasons=[];
  const breakdown={};
  const ageMin=c.pairCreatedAt?(Date.now()-c.pairCreatedAt)/60000:Infinity;
  const buySell=c.sells5m>0?c.buys5m/c.sells5m:c.buys5m>0?99:0;
  const accel=c.volume1h>0?c.volume5m/(c.volume1h/12):0;
  const volLiq=c.liquidityUsd>0?c.volume5m/c.liquidityUsd:0;

  let pass=ageMin<=config.maxTokenAgeMinutes; score+=add(breakdown,'freshness',10,pass,Number.isFinite(ageMin)?`${ageMin.toFixed(1)}m old`:'age unknown'); if(pass)reasons.push(`fresh ${ageMin.toFixed(0)}m`);
  pass=c.liquidityUsd>=config.minLiquidity; score+=add(breakdown,'liquidity',15,pass,`$${c.liquidityUsd.toFixed(0)} vs min $${config.minLiquidity.toFixed(0)}`); if(pass)reasons.push('liquidity');
  pass=c.volume5m>=config.min5mVolume; score+=add(breakdown,'volume5m',15,pass,`$${c.volume5m.toFixed(0)} vs min $${config.min5mVolume.toFixed(0)}`); if(pass)reasons.push('5m volume');
  pass=accel>=1.5; score+=add(breakdown,'volumeAcceleration',15,pass,`${accel.toFixed(2)}x`); if(pass)reasons.push(`volume ${accel.toFixed(1)}x`);
  pass=buySell>=1.5; score+=add(breakdown,'buyPressure',15,pass,`${buySell.toFixed(2)}x (${c.buys5m}/${c.sells5m})`); if(pass)reasons.push(`buy/sell ${buySell.toFixed(1)}x`);
  pass=c.priceChange5m>0&&c.priceChange5m<=35; score+=add(breakdown,'momentum',10,pass,`${c.priceChange5m.toFixed(2)}% 5m`); if(pass)reasons.push('momentum');
  pass=c.marketCap>=config.minMarketCap&&c.marketCap<=config.maxMarketCap; score+=add(breakdown,'marketCap',10,pass,`$${c.marketCap.toFixed(0)} range $${config.minMarketCap.toFixed(0)}-$${config.maxMarketCap.toFixed(0)}`); if(pass)reasons.push('MC range');
  pass=c.volume5m>0&&c.liquidityUsd>0&&volLiq<=3; score+=add(breakdown,'volumeLiquidity',10,pass,`${volLiq.toFixed(2)}x`); if(pass)reasons.push('volume/liquidity');

  const risk=await analyzeRisk(c);
  let bundleAdj=0;if(risk.bundleRisk==='low'){bundleAdj=10;reasons.push('low bundle %')}else if(risk.bundleRisk==='medium')bundleAdj=-15;else if(risk.bundleRisk==='high')bundleAdj=-40;
  score+=adjust(breakdown,'bundleRisk',bundleAdj,Number.isFinite(risk.bundlePct)?`${risk.bundlePct.toFixed(2)}% ${risk.bundleRisk}`:`${risk.bundleRisk} (${risk.bundleStatus})`);
  const devAdj=risk.devRisk==='high'?-40:0;score+=adjust(breakdown,'devRisk',devAdj,risk.devRisk);
  const holderAdj=risk.holderRisk==='medium'?-10:risk.holderRisk==='high'?-30:0;score+=adjust(breakdown,'holderRisk',holderAdj,`${risk.holderRisk}${Number.isFinite(risk.top10Pct)?` top10 ${risk.top10Pct.toFixed(2)}%`:''}`);
  const rawScore=score;
  return{...c,score:Math.max(0,Math.min(100,score)),rawScore,risk,reasons,breakdown,metrics:{ageMin,buySellRatio:buySell,volumeAcceleration:accel,volumeLiquidityRatio:volLiq}};
}
export function entryAllowed(s){if(s.score<config.minScore)return{ok:false,why:`score ${s.score} < ${config.minScore}`};if(s.risk.bundleRisk==='high')return{ok:false,why:`high bundle risk (${Number.isFinite(s.risk.bundlePct)?s.risk.bundlePct.toFixed(1)+'%':'detected'})`};if(s.risk.devRisk==='high')return{ok:false,why:'high dev authority risk'};if(s.risk.holderRisk==='high')return{ok:false,why:'high holder concentration'};return{ok:true,why:s.risk.bundleRisk==='unknown'?'approved; bundle scanner has no data':'approved'};}
