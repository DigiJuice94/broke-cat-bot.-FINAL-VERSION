import {config} from './config.mjs';
import {discoverCandidates as discoverDexCandidates, refreshPair as refreshDexPair} from './dexscreener.mjs';

const API='https://api.geckoterminal.com/api/v2';
const NETWORK='solana';
const num=v=>Number(v??0)||0;

async function json(path){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),config.geckoTerminalTimeoutMs);
  try{
    const r=await fetch(`${API}${path}`,{
      headers:{Accept:'application/json;version=20230302'},
      signal:controller.signal
    });
    if(!r.ok)throw new Error(`GeckoTerminal ${r.status}`);
    return await r.json();
  }finally{clearTimeout(timer)}
}

function includedMap(payload){
  const map=new Map();
  for(const row of payload?.included||[])if(row?.id)map.set(row.id,row);
  return map;
}
function relId(row,name){return row?.relationships?.[name]?.data?.id||null}
function tokenMeta(map,id){
  const x=id?map.get(id):null,a=x?.attributes||{};
  return {address:a.address||String(id||'').split('_').slice(1).join('_')||null,name:a.name||null,symbol:a.symbol||null};
}
function normalizePool(row,map=new Map()){
  const a=row?.attributes||{};
  const base=tokenMeta(map,relId(row,'base_token'));
  const quote=tokenMeta(map,relId(row,'quote_token'));
  const dexId=relId(row,'dex')?.replace(`${NETWORK}_`,'')||'unknown';
  const pairAddress=a.address||String(row?.id||'').replace(`${NETWORK}_`,'');
  if(!pairAddress||!base.address)return null;
  const t=a.transactions||{},v=a.volume_usd||{},pc=a.price_change_percentage||{};
  const m5=t.m5||{},h1=t.h1||{};
  const created=a.pool_created_at?Date.parse(a.pool_created_at):undefined;
  return {
    chainId:'solana',tokenAddress:base.address,pairAddress,
    symbol:base.symbol||String(a.name||'').split('/')[0]?.trim()||'?',
    name:base.name||base.symbol||String(a.name||'').split('/')[0]?.trim()||'Unknown',
    quoteSymbol:quote.symbol||null,dexId,url:`https://www.geckoterminal.com/solana/pools/${pairAddress}`,
    priceUsd:num(a.base_token_price_usd),liquidityUsd:num(a.reserve_in_usd),
    marketCap:num(a.market_cap_usd)||num(a.fdv_usd),pairCreatedAt:Number.isFinite(created)?created:undefined,
    volume5m:num(v.m5),volume1h:num(v.h1),
    buys5m:num(m5.buys),sells5m:num(m5.sells),buyers5m:num(m5.buyers),sellers5m:num(m5.sellers),
    buys1h:num(h1.buys),sells1h:num(h1.sells),
    priceChange5m:num(pc.m5),priceChange1h:num(pc.h1),
    dataSource:'GeckoTerminal'
  };
}
function parsePools(payload){const map=includedMap(payload);return (payload?.data||[]).map(x=>normalizePool(x,map)).filter(Boolean)}
function dedupeBest(rows){
  const best=new Map();
  for(const r of rows){const old=best.get(r.tokenAddress);if(!old||r.liquidityUsd>old.liquidityUsd)best.set(r.tokenAddress,r)}
  return [...best.values()];
}

export async function discoverCandidates(){
  if(!config.geckoTerminalEnabled)return discoverDexCandidates();
  try{
    const pages=Math.max(1,Math.min(5,config.geckoTerminalPages));
    const all=[];
    for(let page=1;page<=pages;page++){
      const payload=await json(`/networks/${NETWORK}/new_pools?include=base_token,quote_token,dex&page=${page}`);
      all.push(...parsePools(payload));
      if((payload?.data||[]).length===0)break;
    }
    const rows=dedupeBest(all).slice(0,config.geckoTerminalCandidateLimit);
    if(rows.length){console.log(`🐱 DATA SOURCE | GeckoTerminal NEW POOLS | ${rows.length} Solana candidates`);return rows}
    throw new Error('GeckoTerminal returned 0 usable Solana pools');
  }catch(e){
    console.error(`🐱 GeckoTerminal discovery failed: ${e.message}`);
    if(!config.dexScreenerFallback)throw e;
    console.log('🐱 DATA FALLBACK | using DEX Screener discovery for this scan');
    const rows=await discoverDexCandidates();return rows.map(x=>({...x,dataSource:'DEX Screener fallback'}));
  }
}

export async function refreshPair(pairAddress){
  if(config.geckoTerminalEnabled){
    try{
      const payload=await json(`/networks/${NETWORK}/pools/${pairAddress}?include=base_token,quote_token,dex`);
      const rows=parsePools({data:Array.isArray(payload?.data)?payload.data:[payload?.data].filter(Boolean),included:payload?.included||[]});
      if(rows[0])return rows[0];
      throw new Error('GeckoTerminal pool refresh returned no usable data');
    }catch(e){
      console.error(`🐱 GeckoTerminal refresh failed for ${pairAddress}: ${e.message}`);
      if(!config.dexScreenerFallback)throw e;
    }
  }
  const x=await refreshDexPair(pairAddress);return x?{...x,dataSource:'DEX Screener fallback'}:null;
}
