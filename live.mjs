import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import bs58 from 'bs58';
import {Keypair,VersionedTransaction} from '@solana/web3.js';
import {config,SOL_MINT,liveConfigStatus} from './config.mjs';

const BASE='https://api.jup.ag/swap/v2';
const LAMPORTS_PER_SOL=1_000_000_000;
const statePath=path.resolve(config.dataDir,'broke-cat-live-state.json');
fs.mkdirSync(config.dataDir,{recursive:true});
const today=()=>new Date().toISOString().slice(0,10);

export function parseKey(raw){
  const value=String(raw||'').trim();
  if(!value)throw new Error('BS58_PRIVATE_KEY is empty');

  const makeKeypair=(bytes,format)=>{
    if(bytes.length===64)return {keypair:Keypair.fromSecretKey(Uint8Array.from(bytes)),format};
    if(bytes.length===32)return {keypair:Keypair.fromSeed(Uint8Array.from(bytes)),format};
    throw new Error(`Decoded ${format} private key is ${bytes.length} bytes; expected a 32-byte seed or 64-byte Solana secret key`);
  };

  // JSON byte array: [12,34,...]
  if(value.startsWith('[')){
    let arr;
    try{arr=JSON.parse(value)}catch{throw new Error('Private key looks like a JSON byte array but could not be parsed')}
    if(!Array.isArray(arr)||!arr.every(n=>Number.isInteger(n)&&n>=0&&n<=255))throw new Error('Private-key JSON array must contain only byte values 0-255');
    return makeKeypair(Uint8Array.from(arr),'json-array');
  }

  // Hex, with or without 0x.
  const hex=value.startsWith('0x')?value.slice(2):value;
  if(/^[0-9a-fA-F]+$/.test(hex)&&hex.length%2===0){
    const bytes=Uint8Array.from(Buffer.from(hex,'hex'));
    if(bytes.length===32||bytes.length===64)return makeKeypair(bytes,'hex');
  }

  // PEM PKCS#8 Ed25519 private key.
  const fromPkcs8=(der,format)=>{
    try{
      const obj=crypto.createPrivateKey({key:Buffer.from(der),format:'der',type:'pkcs8'});
      const jwk=obj.export({format:'jwk'});
      if(jwk?.kty!=='OKP'||jwk?.crv!=='Ed25519'||!jwk?.d)throw new Error('not an Ed25519 PKCS#8 key');
      const seed=Buffer.from(jwk.d.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-jwk.d.length%4)%4),'base64');
      if(seed.length!==32)throw new Error(`PKCS#8 Ed25519 seed is ${seed.length} bytes, expected 32`);
      return makeKeypair(seed,format);
    }catch{return null}
  };
  if(value.includes('BEGIN PRIVATE KEY')){
    try{
      const obj=crypto.createPrivateKey(value);
      const jwk=obj.export({format:'jwk'});
      if(jwk?.kty==='OKP'&&jwk?.crv==='Ed25519'&&jwk?.d){
        const d=jwk.d; const seed=Buffer.from(d.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-d.length%4)%4),'base64');
        return makeKeypair(seed,'pem-pkcs8');
      }
    }catch{}
  }

  // Standard/base64url. Trust Wallet exports may contain +, / and =.
  // Besides raw 32/64-byte keys, accept an Ed25519 PKCS#8 DER container.
  const looksBase64=/^[A-Za-z0-9+/_-]+={0,2}$/.test(value) && (/[+/=_-]/.test(value) || value.length%4===0);
  if(looksBase64){
    try{
      const normalized=value.replace(/-/g,'+').replace(/_/g,'/');
      const padded=normalized+'='.repeat((4-normalized.length%4)%4);
      const bytes=Uint8Array.from(Buffer.from(padded,'base64'));
      if(bytes.length===32||bytes.length===64)return makeKeypair(bytes,'base64');
      const pkcs8=fromPkcs8(bytes,'base64-pkcs8');
      if(pkcs8)return pkcs8;
      throw new Error(`base64 decoded to ${bytes.length} bytes, not a raw 32/64-byte key or Ed25519 PKCS#8 container`);
    }catch{}
  }

  // Base58 remains the normal Solana CLI/export format.
  try{
    const bytes=bs58.decode(value);
    return makeKeypair(bytes,'base58');
  }catch(err){
    throw new Error(`Unsupported Solana private-key format. V8.4 accepts base58, raw/base64url, hex, JSON byte arrays, and Ed25519 PKCS#8/PEM keys. ${err?.message||''}`.trim());
  }
}
function wallet(){
  const status=liveConfigStatus();
  if(!status.ready)throw new Error(`Live mode not armed: missing ${status.missing.join(', ')}`);
  return parseKey(config.bs58PrivateKey).keypair;
}
function rpcUrl(){return `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(config.heliusApiKey)}`}
const SOLANA_PUBLIC_RPC='https://api.mainnet-beta.solana.com';
async function rpcAt(url,label,method,params=[]){
  const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
  if(!r.ok)throw new Error(`${label} RPC ${r.status}: ${await r.text()}`);
  const j=await r.json();if(j.error)throw new Error(`${label} RPC ${method}: ${j.error.message||JSON.stringify(j.error)}`);return j.result;
}
async function rpc(method,params=[]){return rpcAt(rpcUrl(),'Helius',method,params)}
async function solBalanceCrossCheck(address){
  const params=[address,{commitment:'confirmed'}];
  const [helius,publicRpc]=await Promise.allSettled([rpcAt(rpcUrl(),'Helius','getBalance',params),rpcAt(SOLANA_PUBLIC_RPC,'Solana public','getBalance',params)]);
  const h=helius.status==='fulfilled'?Number(helius.value?.value||0):null;
  const p=publicRpc.status==='fulfilled'?Number(publicRpc.value?.value||0):null;
  const candidates=[['helius',h],['solana-public',p]].filter(([,v])=>Number.isFinite(v));
  if(!candidates.length)throw new Error(`Could not read SOL balance from Helius or Solana public RPC. Helius: ${helius.reason?.message||'failed'} | Public: ${publicRpc.reason?.message||'failed'}`);
  candidates.sort((a,b)=>b[1]-a[1]);
  return {lamports:candidates[0][1],source:candidates[0][0],heliusLamports:h,publicLamports:p};
}

export async function solUsdPrice(){
  const r=await fetch(`https://api.dexscreener.com/token-pairs/v1/solana/${SOL_MINT}`,{headers:{accept:'application/json'}});
  if(!r.ok)throw new Error(`Could not fetch SOL/USD price: DEX Screener ${r.status}`);
  const rows=await r.json();
  const pairs=(Array.isArray(rows)?rows:[]).filter(p=>Number(p?.priceUsd)>0).sort((a,b)=>Number(b?.liquidity?.usd||0)-Number(a?.liquidity?.usd||0));
  const price=Number(pairs[0]?.priceUsd||0);
  if(!price)throw new Error('Could not determine SOL/USD price');
  return price;
}
export function loadLiveState(){
  if(fs.existsSync(statePath)){
    const s=JSON.parse(fs.readFileSync(statePath,'utf8'));
    if(s.day!==today()){s.day=today();s.dailyPnl=0}
    return s;
  }
  return {day:today(),dailyPnl:0,realizedPnl:0,position:null,trades:[],lastXDailyReportDay:null};
}
export function saveLiveState(s){fs.writeFileSync(statePath,JSON.stringify(s,null,2))}
export function liveStateFilePath(){return statePath}
export function walletAddress(){try{return wallet().publicKey.toBase58()}catch{return null}}
export async function walletSnapshot(){
  const w=wallet().publicKey.toBase58();
  if(config.expectedWalletAddress && w!==config.expectedWalletAddress){
    throw new Error(`WALLET ADDRESS MISMATCH: key derives ${w}, but EXPECTED_WALLET_ADDRESS is ${config.expectedWalletAddress}. Live trading blocked.`);
  }
  const bal=await solBalanceCrossCheck(w);
  const sol=Number(bal.lamports||0)/LAMPORTS_PER_SOL;
  const solUsd=await solUsdPrice();
  return {address:w,sol,solUsd,solValueUsd:sol*solUsd,balanceSource:bal.source,heliusLamports:bal.heliusLamports,publicLamports:bal.publicLamports};
}
export async function assertLiveFunding(){
  const snap=await walletSnapshot();
  console.log(`Wallet diagnostic | derived ${snap.address} | Helius ${snap.heliusLamports==null?'ERR':(snap.heliusLamports/LAMPORTS_PER_SOL).toFixed(6)} SOL | Public RPC ${snap.publicLamports==null?'ERR':(snap.publicLamports/LAMPORTS_PER_SOL).toFixed(6)} SOL | using ${snap.balanceSource}`);
  const tradeSol=config.livePositionUsd/snap.solUsd;
  const needed=tradeSol+config.minSolReserve;
  if(snap.sol<needed)throw new Error(`Live wallet needs about ${needed.toFixed(6)} SOL (~$${config.livePositionUsd.toFixed(2)} trade + ${config.minSolReserve} SOL reserve). Found ${snap.sol.toFixed(6)} SOL (~$${snap.solValueUsd.toFixed(2)}).`);
  return {...snap,tradeSolRequired:tradeSol};
}
async function jupiterSwap(inputMint,outputMint,amountRaw){
  const signer=wallet();
  const params=new URLSearchParams({inputMint,outputMint,amount:String(amountRaw),taker:signer.publicKey.toBase58()});
  const orderRes=await fetch(`${BASE}/order?${params}`,{headers:{'x-api-key':config.jupiterApiKey}});
  if(!orderRes.ok)throw new Error(`Jupiter /order ${orderRes.status}: ${await orderRes.text()}`);
  const order=await orderRes.json();
  if(!order.transaction)throw new Error(`Jupiter could not build swap: ${order.errorMessage||order.errorCode||'no transaction'}`);
  const tx=VersionedTransaction.deserialize(Buffer.from(order.transaction,'base64'));
  tx.sign([signer]);
  const signedTransaction=Buffer.from(tx.serialize()).toString('base64');
  const execRes=await fetch(`${BASE}/execute`,{method:'POST',headers:{'content-type':'application/json','x-api-key':config.jupiterApiKey},body:JSON.stringify({signedTransaction,requestId:order.requestId})});
  if(!execRes.ok)throw new Error(`Jupiter /execute ${execRes.status}: ${await execRes.text()}`);
  const result=await execRes.json();
  if(result.status!=='Success')throw new Error(`Jupiter swap failed code ${result.code}: ${result.error||'unknown error'}${result.signature?` tx ${result.signature}`:''}`);
  return {order,result,inputRaw:String(result.inputAmountResult||amountRaw),outputRaw:String(result.outputAmountResult||order.outAmount),signature:result.signature};
}
export async function openLive(s,c){
  if(s.position)throw new Error('Live position already open');
  if(s.dailyPnl<=-config.maxDailyLoss)throw new Error('Daily loss limit reached');
  const snap=await assertLiveFunding();
  const spendableSol=Math.max(0,snap.sol-config.minSolReserve);
  const targetSol=config.livePositionUsd/snap.solUsd;
  const sizeSol=Math.min(targetSol,spendableSol);
  const sizeUsd=sizeSol*snap.solUsd;
  if(sizeUsd<0.50)throw new Error(`Not enough spendable SOL after reserve. Wallet has ${snap.sol.toFixed(6)} SOL (~$${snap.solValueUsd.toFixed(2)})`);
  const amountRaw=Math.floor(sizeSol*LAMPORTS_PER_SOL);
  const swap=await jupiterSwap(SOL_MINT,c.tokenAddress,amountRaw);
  const actualCostSol=Number(swap.inputRaw)/LAMPORTS_PER_SOL;
  const actualCostUsd=actualCostSol*snap.solUsd;
  s.position={pairAddress:c.pairAddress,tokenAddress:c.tokenAddress,symbol:c.symbol,entryPrice:c.priceUsd,highPrice:c.priceUsd,lastPrice:c.priceUsd,costSol:actualCostSol,costUsd:actualCostUsd,entrySolUsd:snap.solUsd,tokenAmountRaw:swap.outputRaw,openedAt:new Date().toISOString(),buySignature:swap.signature,score:c.score};
  s.trades.push({type:'BUY',mode:'LIVE',symbol:c.symbol,tokenAddress:c.tokenAddress,costSol:actualCostSol,costUsd:actualCostUsd,tokenAmountRaw:swap.outputRaw,price:c.priceUsd,score:c.score,signature:swap.signature,at:new Date().toISOString()});
  saveLiveState(s);
  return {message:`LIVE BUY ~${actualCostSol.toFixed(6)} SOL (~$${actualCostUsd.toFixed(2)}) ${c.symbol} | tx ${swap.signature}`,signature:swap.signature};
}
export function exitReason(s,price){
  const p=s.position;if(!p||price<=0)return null;
  p.highPrice=Math.max(Number(p.highPrice)||p.entryPrice,price);p.lastPrice=price;
  const retPct=(price/p.entryPrice-1)*100;
  if(retPct<=-config.stopLossPct)return `STOP -${config.stopLossPct}%`;
  if(retPct>=config.takeProfitPct)return `TAKE PROFIT +${config.takeProfitPct}%`;
  if((p.highPrice/p.entryPrice-1)*100>=config.trailArmPct && (1-price/p.highPrice)*100>=config.trailDrawdownPct)return `TRAIL after +${config.trailArmPct}%`;
  saveLiveState(s);return null;
}
export async function closeLive(s,reason){
  const p=s.position;if(!p)throw new Error('No live position');
  const swap=await jupiterSwap(p.tokenAddress,SOL_MINT,p.tokenAmountRaw);
  const receivedSol=Number(swap.outputRaw)/LAMPORTS_PER_SOL;
  const currentSolUsd=await solUsdPrice();
  const receivedUsd=receivedSol*currentSolUsd;
  const pnlUsd=receivedUsd-p.costUsd;
  const pnlSol=receivedSol-p.costSol;
  s.realizedPnl+=pnlUsd;s.dailyPnl+=pnlUsd;
  s.trades.push({type:'SELL',mode:'LIVE',symbol:p.symbol,tokenAddress:p.tokenAddress,receivedSol,receivedUsd,pnlUsd,pnlSol,reason,signature:swap.signature,at:new Date().toISOString()});
  s.position=null;saveLiveState(s);
  return {message:`LIVE SELL ${p.symbol}: ${reason} | received ${receivedSol.toFixed(6)} SOL (~$${receivedUsd.toFixed(2)}) | P&L ${pnlUsd>=0?'+':''}$${pnlUsd.toFixed(2)} | tx ${swap.signature}`,pnlUsd,pnlSol,receivedSol,receivedUsd,signature:swap.signature,symbol:p.symbol};
}
export function tradeStatsLive(s){const sells=s.trades.filter(t=>t.type==='SELL');return{totalTrades:sells.length,wins:sells.filter(t=>Number(t.pnlUsd)>0).length,losses:sells.filter(t=>Number(t.pnlUsd)<0).length}}
