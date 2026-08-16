import crypto from 'node:crypto';
import { config } from './config.mjs';
const enc=v=>encodeURIComponent(String(v)).replace(/[!'()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const enabled=()=>Boolean(config.xPostingEnabled&&config.xApiKey&&config.xApiSecret&&config.xAccessToken&&config.xAccessTokenSecret);
function authHeader(method,url){
  const oauth={oauth_consumer_key:config.xApiKey,oauth_nonce:crypto.randomBytes(18).toString('hex'),oauth_signature_method:'HMAC-SHA1',oauth_timestamp:String(Math.floor(Date.now()/1000)),oauth_token:config.xAccessToken,oauth_version:'1.0'};
  const paramString=Object.entries(oauth).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${enc(k)}=${enc(v)}`).join('&');
  const base=[method.toUpperCase(),enc(url),enc(paramString)].join('&');
  const signingKey=`${enc(config.xApiSecret)}&${enc(config.xAccessTokenSecret)}`;
  oauth.oauth_signature=crypto.createHmac('sha1',signingKey).update(base).digest('base64');
  return 'OAuth '+Object.entries(oauth).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${enc(k)}="${enc(v)}"`).join(', ');
}
export function xReady(){return enabled()}
export async function postToX(text){
  if(!enabled())return {ok:false,skipped:true};
  const url='https://api.x.com/2/tweets';
  try{const res=await fetch(url,{method:'POST',headers:{authorization:authHeader('POST',url),'content-type':'application/json'},body:JSON.stringify({text:String(text).slice(0,280)})});const raw=await res.text();let data;try{data=raw?JSON.parse(raw):{}}catch{data={raw}}if(!res.ok){console.error('X post failed',res.status,data);return {ok:false,status:res.status,data}}return {ok:true,data}}catch(error){console.error('X post error',error);return {ok:false,error:String(error?.message||error)}}
}
export function buyPost({mode='PAPER',symbol,sizeUsd,score,marketCap,risk,cash,walletLabel='Balance'}){const bundle=Number.isFinite(risk?.estimatedLinkedSupplyPct)?`${risk.estimatedLinkedSupplyPct.toFixed(1)}% est. linked`:String(risk?.bundleRisk||'unknown');return `🐱 BROKE CAT ${mode} BUY\n$${symbol} | ~$${sizeUsd.toFixed(2)}\nScore ${score}/100 | MC $${Math.round(marketCap).toLocaleString()}\nBundle ${bundle}\n${walletLabel} ~$${cash.toFixed(2)}\n\nAutomated experiment. High risk.`}
export function sellPost({mode='PAPER',symbol,reason,pnlUsd,cash,walletLabel='Balance'}){const sign=pnlUsd>=0?'+':'';return `🐱 BROKE CAT ${mode} EXIT\n$${symbol} | ${reason}\nP&L ${sign}$${pnlUsd.toFixed(2)}\n${walletLabel} ~$${cash.toFixed(2)}\n\nAutomated experiment. High risk.`}
export function dailyPost({mode='PAPER',cash,realizedPnl,dailyPnl,wins,losses,totalTrades,walletLabel='Balance'}){const t=realizedPnl>=0?'+':'',d=dailyPnl>=0?'+':'';return `🐱 BROKE CAT ${mode} DAILY\n${walletLabel} ~$${cash.toFixed(2)}\nTotal P&L ${t}$${realizedPnl.toFixed(2)} | Today ${d}$${dailyPnl.toFixed(2)}\nTrades ${totalTrades} | W ${wins} / L ${losses}\n\nAutomated experiment. High risk.`}
