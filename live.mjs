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
    throw new Error(`Unsupported Solana private-key format. V8.3 accepts base58, raw/base64url, hex, JSON byte arrays, and Ed25519 PKCS#8/PEM keys. ${err?.message||''}`.trim());
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


async function tokenPairByMint(mint){
  const r=await fetch(`https://api.dexscreener.com/token-pairs/v1/solana/${mint}`,{headers:{accept:'application/json'}});
  if(!r.ok)return null;
  const rows=await r.json();
  return (Array.isArray(rows)?rows:[]).filter(x=>Number(x?.priceUsd)>0).sort((a,b)=>Number(b?.liquidity?.usd||0)-Number(a?.liquidity?.usd||0))[0]||null;
}

async function walletTokenBalances(){
  const owner=wallet().publicKey.toBase58();
  const programs=['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA','TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'];
  const results=await Promise.all(programs.map(programId=>rpc('getTokenAccountsByOwner',[owner,{programId},{encoding:'jsonParsed',commitment:'confirmed'}]).catch(()=>({value:[]}))));
  const out=[];
  for(const row of results.flatMap(x=>x?.value||[])){
    const info=row?.account?.data?.parsed?.info;
    const mint=info?.mint, a=info?.tokenAmount;
    const ui=Number(a?.uiAmountString??a?.uiAmount??0)||0;
    if(!mint||ui<=0)continue;
    out.push({mint,amount:ui,amountRaw:String(a?.amount||'0'),decimals:Number(a?.decimals||0)});
  }
  return out;
}

function rawBigInt(value){
  try{return BigInt(String(value||'0'))}catch{return 0n}
}
function rawToUi(raw,decimals){
  const n=Number(rawBigInt(raw));
  return Number.isFinite(n)?n/(10**Number(decimals||0)):0;
}
export async function walletTokenBalance(mint){
  const rows=(await walletTokenBalances()).filter(x=>x.mint===mint);
  if(!rows.length)return {mint,amount:0,amountRaw:'0',decimals:0};
  const decimals=Number(rows[0].decimals||0);
  const amountRaw=rows.reduce((sum,x)=>sum+rawBigInt(x.amountRaw),0n);
  return {mint,amount:rawToUi(amountRaw,decimals),amountRaw:String(amountRaw),decimals};
}
async function waitForTokenBalance(mint,predicate,{attempts=20,delayMs=1500}={}){
  let last=await walletTokenBalance(mint);
  for(let i=0;i<attempts;i++){
    if(predicate(last))return last;
    await new Promise(r=>setTimeout(r,delayMs));
    last=await walletTokenBalance(mint);
  }
  return last;
}

async function confirmedTransaction(signature,{attempts=20,delayMs=1000}={}){
  let lastError=null;
  for(let i=0;i<attempts;i++){
    try{
      const tx=await rpc('getTransaction',[signature,{encoding:'jsonParsed',commitment:'confirmed',maxSupportedTransactionVersion:0}]);
      if(tx?.meta)return tx;
    }catch(e){lastError=e}
    await new Promise(r=>setTimeout(r,delayMs));
  }
  if(lastError)console.error(`🐱 RECEIPT RPC warning ${signature}: ${lastError.message}`);
  return null;
}

function ownerTokenDeltas(tx,owner){
  const pre=new Map(),post=new Map(),decimals=new Map();
  const add=(map,row)=>{
    if(!row?.mint||row?.owner!==owner)return;
    const raw=rawBigInt(row?.uiTokenAmount?.amount||'0');
    map.set(row.mint,(map.get(row.mint)||0n)+raw);
    if(row?.uiTokenAmount?.decimals!=null)decimals.set(row.mint,Number(row.uiTokenAmount.decimals));
  };
  for(const row of tx?.meta?.preTokenBalances||[])add(pre,row);
  for(const row of tx?.meta?.postTokenBalances||[])add(post,row);
  const mints=new Set([...pre.keys(),...post.keys()]);
  return [...mints].map(mint=>{
    const before=pre.get(mint)||0n,after=post.get(mint)||0n;
    return {mint,beforeRaw:before,afterRaw:after,deltaRaw:after-before,decimals:Number(decimals.get(mint)||0)};
  }).filter(x=>x.deltaRaw!==0n);
}

async function verifyBuyReceipt(signature,expectedMint){
  const owner=wallet().publicKey.toBase58();
  const tx=await confirmedTransaction(signature);
  if(!tx)return {ok:false,reason:'transaction-receipt-unavailable',deltas:[]};
  if(tx?.meta?.err)return {ok:false,reason:`transaction-meta-error ${JSON.stringify(tx.meta.err)}`,deltas:[]};
  const deltas=ownerTokenDeltas(tx,owner);
  const expected=deltas.find(x=>x.mint===expectedMint&&x.deltaRaw>0n)||null;
  const positive=deltas.filter(x=>x.deltaRaw>0n).sort((a,b)=>a.deltaRaw===b.deltaRaw?0:(a.deltaRaw>b.deltaRaw?-1:1));
  return {ok:Boolean(expected),expected,positive,deltas,tx};
}

export async function scanWalletPositions(s){
  const balances=await walletTokenBalances();
  const currentSolUsd=await solUsdPrice().catch(()=>null);
  const positions=[];
  for(const b of balances.slice(0,20)){
    const pair=await tokenPairByMint(b.mint).catch(()=>null); if(!pair)continue;
    const priceUsd=Number(pair.priceUsd||0), currentValueUsd=priceUsd*b.amount;
    if(currentValueUsd<0.05)continue;
    const managed=s?.position?.tokenAddress===b.mint;
    let pnlPct=null, entryPrice=null;
    if(managed){
      entryPrice=Number(s.position.entryPrice||0)||null;
      if(s.position.basisType==='SOL_RECOVERED'&&s.position.entryPriceSol&&currentSolUsd)pnlPct=((priceUsd/currentSolUsd)/s.position.entryPriceSol-1)*100;
      else if(entryPrice)pnlPct=(priceUsd/entryPrice-1)*100;
    }
    positions.push({symbol:pair.baseToken?.symbol||'?',tokenAddress:b.mint,pairAddress:pair.pairAddress,tokenAmount:b.amount,tokenAmountRaw:b.amountRaw,priceUsd,currentValueUsd,pnlPct,entryPrice,managed});
  }
  return positions.sort((a,b)=>b.currentValueUsd-a.currentValueUsd);
}

async function recentEnhancedWalletTxs(){
  const owner=wallet().publicKey.toBase58();
  const q=new URLSearchParams({'api-key':config.heliusApiKey,limit:'100','sort-order':'desc',commitment:'confirmed'});
  const r=await fetch(`https://api-mainnet.helius-rpc.com/v0/addresses/${owner}/transactions?${q}`,{headers:{accept:'application/json'}});
  if(!r.ok)throw new Error(`Helius recovery history ${r.status}`);
  return r.json();
}

function recoverySwapAmounts(tx,mint,owner){
  const swap=tx?.events?.swap||{};
  const nativeInput=Number(swap?.nativeInput?.amount||0);
  const swapTokenOut=(swap?.tokenOutputs||[]).filter(x=>x?.mint===mint).reduce((a,x)=>a+Number(x?.tokenAmount||x?.rawTokenAmount?.tokenAmount||0),0);
  const transferTokenOut=(tx?.tokenTransfers||[]).filter(x=>x?.mint===mint&&x?.toUserAccount===owner).reduce((a,x)=>a+Number(x?.tokenAmount||0),0);
  const transferNativeOut=(tx?.nativeTransfers||[]).reduce((sum,x)=>sum+(x?.fromUserAccount===owner&&x?.toUserAccount!==owner?Number(x?.amount||0):0),0);
  return {received:swapTokenOut||transferTokenOut,spentLamports:nativeInput||transferNativeOut};
}

export async function recoverLivePosition(s){
  if(s.position)return {recovered:false,reason:'state-position-present'};
  const owner=wallet().publicKey.toBase58();
  const balances=await walletTokenBalances();
  if(!balances.length)return {recovered:false,reason:'no-token-balances'};
  const txs=await recentEnhancedWalletTxs();
  const cutoff=Date.now()-config.recoveryLookbackHours*3600_000;
  const candidates=[];
  for(const b of balances){
    const tx=(Array.isArray(txs)?txs:[]).find(t=>{
      const ts=Number(t?.timestamp||0)*1000;if(!ts||ts<cutoff)return false;
      const amounts=recoverySwapAmounts(t,b.mint,owner);
      return amounts.received>0&&amounts.spentLamports>100000;
    });
    if(!tx)continue;
    const pair=await tokenPairByMint(b.mint).catch(()=>null);if(!pair)continue;
    const {received,spentLamports}=recoverySwapAmounts(tx,b.mint,owner);
    if(received<=0||spentLamports<=0)continue;
    const costSol=spentLamports/LAMPORTS_PER_SOL;
    const entryPriceSol=costSol/received;
    candidates.push({b,tx,pair,received,costSol,entryPriceSol,ts:Number(tx.timestamp||0)});
  }
  candidates.sort((a,b)=>b.ts-a.ts);
  const c=candidates[0];if(!c)return {recovered:false,reason:'no-recent-broke-cat-like-buy-found'};
  const exact=await walletTokenBalance(c.b.mint);
  if(rawBigInt(exact.amountRaw)<=0n)return {recovered:false,reason:'matched-buy-but-wallet-balance-is-zero'};
  const solUsd=await solUsdPrice();
  const entryPrice=c.entryPriceSol*solUsd;
  s.position={pairAddress:c.pair.pairAddress,tokenAddress:c.b.mint,symbol:c.pair.baseToken?.symbol||'?',entryPrice,entryPriceSol:c.entryPriceSol,basisType:'SOL_RECOVERED',highPrice:Number(c.pair.priceUsd||entryPrice),highPriceSol:Number(c.pair.priceUsd||entryPrice)/solUsd,lastPrice:Number(c.pair.priceUsd||entryPrice),costSol:c.costSol,costUsd:c.costSol*solUsd,entrySolUsd:solUsd,tokenAmountRaw:exact.amountRaw,walletBalanceRaw:exact.amountRaw,tokenDecimals:exact.decimals,preExistingRaw:'0',openedAt:new Date(c.ts*1000).toISOString(),buySignature:c.tx.signature,score:null,recoveredAt:new Date().toISOString()};
  s.trades.push({type:'RECOVER',mode:'LIVE',symbol:s.position.symbol,tokenAddress:c.b.mint,costSol:c.costSol,tokenAmountRaw:exact.amountRaw,signature:c.tx.signature,at:new Date().toISOString()});
  saveLiveState(s);
  return {recovered:true,position:s.position};
}

export async function reconcileLivePosition(s){
  if(!s.position)return recoverLivePosition(s);
  const p=s.position;
  const exact=await walletTokenBalance(p.tokenAddress);
  const currentRaw=rawBigInt(exact.amountRaw);
  const preExistingRaw=rawBigInt(p.preExistingRaw||'0');
  if(currentRaw<=preExistingRaw){
    const openedMs=Date.parse(p.openedAt||'');
    const receiptGrace=Number.isFinite(openedMs)&&Date.now()-openedMs<90000&&String(p.mintVerifiedSource||'').startsWith('transaction');
    if(receiptGrace){
      console.log(`🐱 POSITION RECONCILE WAIT | ${p.symbol} receipt verified on-chain but wallet RPC has not exposed the token account yet; keeping position managed during 90s grace window`);
      return {recovered:false,managed:true,pendingWalletVisibility:true,position:p};
    }
    s.trades.push({type:'POSITION_GONE',mode:'LIVE',symbol:p.symbol,tokenAddress:p.tokenAddress,lastKnownRaw:p.tokenAmountRaw||'0',walletRaw:exact.amountRaw,at:new Date().toISOString()});
    s.position=null;saveLiveState(s);
    return {recovered:false,cleared:true,reason:'wallet-balance-zero-or-only-preexisting'};
  }
  const managedRaw=currentRaw-preExistingRaw;
  p.tokenAmountRaw=String(managedRaw);
  p.walletBalanceRaw=exact.amountRaw;
  p.tokenDecimals=exact.decimals;
  p.lastReconciledAt=new Date().toISOString();
  saveLiveState(s);
  return {recovered:false,managed:true,position:p};
}

export async function assertLiveFunding(){
  const snap=await walletSnapshot();
  console.log(`Wallet diagnostic | derived ${snap.address} | Helius ${snap.heliusLamports==null?'ERR':(snap.heliusLamports/LAMPORTS_PER_SOL).toFixed(6)} SOL | Public RPC ${snap.publicLamports==null?'ERR':(snap.publicLamports/LAMPORTS_PER_SOL).toFixed(6)} SOL | using ${snap.balanceSource}`);
  const spendableSol=Math.max(0,snap.sol-config.minSolReserve);
  if(spendableSol<=0)throw new Error(`Live wallet has no spendable SOL after the ${config.minSolReserve} SOL network reserve. Found ${snap.sol.toFixed(6)} SOL.`);
  return {...snap,spendableSol};
}

export function chooseLivePositionSize(c,snap){
  const spendableSol=Math.max(0,snap.sol-config.minSolReserve);
  if(spendableSol<=0)return {sizeSol:0,sizeUsd:0,walletPct:0,confidence:0,reasons:['no spendable SOL']};
  if(!config.autoPositionSizing){
    const sizeSol=Math.min(config.livePositionUsd/snap.solUsd,spendableSol);
    return {sizeSol,sizeUsd:sizeSol*snap.solUsd,walletPct:snap.sol>0?sizeSol/snap.sol*100:0,confidence:null,reasons:['fixed LIVE_POSITION_USD mode']};
  }

  // Autonomous sizing: score is the main signal, then verified risk/market quality nudges the allocation.
  // The configured max can be 100%, but MIN_SOL_RESERVE is always retained for network fees / a future exit.
  let confidence=Math.max(0,Math.min(100,Number(c?.score||0)));
  const reasons=[`score ${confidence.toFixed(0)}`];
  const r=c?.risk||{};
  if(r.bundleRisk==='low'){confidence+=4;reasons.push('low bundle risk');}
  else if(r.bundleRisk==='unknown'){confidence-=5;reasons.push('bundle unknown');}
  if(r.holderRisk==='low'){confidence+=3;reasons.push('holder risk low');}
  else if(r.holderRisk==='unknown'){confidence-=3;reasons.push('holders unknown');}
  if(r.devRisk==='low'){confidence+=3;reasons.push('dev risk low');}
  else if(r.devRisk==='unknown'){confidence-=3;reasons.push('dev unknown');}
  if(Number(c?.liquidityUsd)>=100000){confidence+=4;reasons.push('liq >= $100k');}
  if(Number(c?.volume5m)>=50000){confidence+=3;reasons.push('5m vol >= $50k');}
  confidence=Math.max(0,Math.min(100,confidence));

  const minPct=Math.max(0,Math.min(100,config.autoSizeMinWalletPct));
  const maxPct=Math.max(minPct,Math.min(100,config.autoSizeMaxWalletPct));
  // Map entry-quality confidence from the entry threshold..100 into the configured wallet range.
  const floor=Math.max(1,Math.min(99,config.minScore));
  const normalized=Math.max(0,Math.min(1,(confidence-floor)/(100-floor)));
  // Squared curve keeps marginal setups smaller while allowing the strongest setups to use most/all spendable funds.
  const walletPct=minPct+(maxPct-minPct)*(normalized**2);
  const pctOfWalletSol=snap.sol*(walletPct/100);
  const sizeSol=Math.min(spendableSol,pctOfWalletSol);
  const sizeUsd=sizeSol*snap.solUsd;
  return {sizeSol,sizeUsd,walletPct:snap.sol>0?sizeSol/snap.sol*100:0,confidence,reasons};
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
  if(s.tradingPaused)throw new Error(`Live trading paused: ${s.pauseReason||'manual/safety pause'}`);
  if(s.dailyPnl<=-config.maxDailyLoss)throw new Error('Daily loss limit reached');
  const snap=await assertLiveFunding();
  const sizing=chooseLivePositionSize(c,snap);
  const {sizeSol,sizeUsd}=sizing;
  if(sizeUsd<config.autoSizeMinTradeUsd)throw new Error(`Autonomous size was only $${sizeUsd.toFixed(2)}, below minimum $${config.autoSizeMinTradeUsd.toFixed(2)}. Wallet has ${snap.sol.toFixed(6)} SOL (~$${snap.solValueUsd.toFixed(2)}).`);
  console.log(`🐱 AUTO SIZE ${c.symbol} | confidence ${sizing.confidence==null?'FIXED':sizing.confidence.toFixed(0)}/100 | using ${sizing.walletPct.toFixed(1)}% of wallet = ${sizeSol.toFixed(6)} SOL (~$${sizeUsd.toFixed(2)}) | reserve ${config.minSolReserve} SOL | ${sizing.reasons.join(', ')}`);
  const before=await walletTokenBalance(c.tokenAddress);
  const beforeRaw=rawBigInt(before.amountRaw);
  const amountRaw=Math.floor(sizeSol*LAMPORTS_PER_SOL);
  console.log(`🐱 BUY VERIFY ${c.symbol} | scanner mint ${c.tokenAddress} | wallet before ${before.amountRaw} raw`);
  const swap=await jupiterSwap(SOL_MINT,c.tokenAddress,amountRaw);
  console.log(`🐱 BUY CHAIN CONFIRMED ${c.symbol} | tx ${swap.signature} | waiting for token-account visibility + transaction receipt`);

  // Wallet RPC visibility can lag after a successful swap. First wait up to ~30s for the expected mint.
  let after=await waitForTokenBalance(c.tokenAddress,x=>rawBigInt(x.amountRaw)>beforeRaw,{attempts:20,delayMs:1500});
  let afterRaw=rawBigInt(after.amountRaw);
  let receivedRaw=afterRaw-beforeRaw;
  let receipt=null;
  let verificationSource='wallet-rpc';

  // If the token account is still invisible, inspect the confirmed transaction itself.
  // preTokenBalances/postTokenBalances are authoritative for what mint the wallet actually received.
  if(receivedRaw<=0n){
    receipt=await verifyBuyReceipt(swap.signature,c.tokenAddress);
    if(receipt.ok&&receipt.expected){
      receivedRaw=receipt.expected.deltaRaw;
      const txAfterRaw=receipt.expected.afterRaw;
      after={mint:c.tokenAddress,amount:rawToUi(txAfterRaw,receipt.expected.decimals),amountRaw:String(txAfterRaw),decimals:receipt.expected.decimals};
      afterRaw=txAfterRaw;
      verificationSource='transaction-token-balance-delta';
      console.log(`🐱 BUY RECEIPT VERIFIED ${c.symbol} | expected mint ${c.tokenAddress} | +${receivedRaw} raw from confirmed transaction; wallet RPC visibility is delayed`);
    }else{
      const actual=(receipt?.positive||[]).filter(x=>x.mint!==SOL_MINT)[0]||null;
      const positiveText=(receipt?.positive||[]).map(x=>`${x.mint} +${x.deltaRaw}`).join(' | ')||'none';
      s.tradingPaused=true;
      s.pauseReason=`Unresolved buy receipt ${swap.signature}: expected mint ${c.tokenAddress} not received`;
      s.lastBuyIncident={at:new Date().toISOString(),symbol:c.symbol,expectedMint:c.tokenAddress,actualPositiveMint:actual?.mint||null,actualPositiveRaw:actual?String(actual.deltaRaw):null,signature:swap.signature,receiptReason:receipt?.reason||'expected-mint-missing',positiveDeltas:positiveText};
      s.trades.push({type:'BUY_RECONCILE_FAILED',mode:'LIVE',symbol:c.symbol,expectedMint:c.tokenAddress,actualMint:actual?.mint||null,actualRaw:actual?String(actual.deltaRaw):null,signature:swap.signature,positiveDeltas:positiveText,at:new Date().toISOString()});
      saveLiveState(s);
      throw new Error(`BUY CONFIRMED BUT EXPECTED MINT NOT VERIFIED: ${c.symbol} ${c.tokenAddress} | tx ${swap.signature} | positive wallet deltas: ${positiveText} | NEW BUYS PAUSED for safety. The transaction is documented in live state.`);
    }
  }

  const receivedUi=rawToUi(receivedRaw,after.decimals);
  const actualCostSol=Number(swap.inputRaw)/LAMPORTS_PER_SOL;
  const actualCostUsd=actualCostSol*snap.solUsd;
  const verifiedEntryPrice=receivedUi>0?actualCostUsd/receivedUi:c.priceUsd;
  s.position={pairAddress:c.pairAddress,tokenAddress:c.tokenAddress,symbol:c.symbol,entryPrice:verifiedEntryPrice,highPrice:Math.max(Number(c.priceUsd||0),verifiedEntryPrice),lastPrice:c.priceUsd,costSol:actualCostSol,costUsd:actualCostUsd,entrySolUsd:snap.solUsd,tokenAmountRaw:String(receivedRaw),walletBalanceRaw:String(afterRaw),tokenDecimals:after.decimals,preExistingRaw:String(beforeRaw),openedAt:new Date().toISOString(),buySignature:swap.signature,score:c.score,mintVerified:true,mintVerifiedSource:verificationSource,autoSized:config.autoPositionSizing,sizingWalletPct:sizing.walletPct,sizingConfidence:sizing.confidence};
  s.trades.push({type:'BUY',mode:'LIVE',symbol:c.symbol,tokenAddress:c.tokenAddress,costSol:actualCostSol,costUsd:actualCostUsd,tokenAmountRaw:String(receivedRaw),walletBalanceRaw:String(afterRaw),tokenDecimals:after.decimals,preExistingRaw:String(beforeRaw),price:verifiedEntryPrice,score:c.score,mintVerifiedSource:verificationSource,autoSized:config.autoPositionSizing,sizingWalletPct:sizing.walletPct,sizingConfidence:sizing.confidence,signature:swap.signature,at:new Date().toISOString()});
  saveLiveState(s);
  return {message:`LIVE BUY ~${actualCostSol.toFixed(6)} SOL (~$${actualCostUsd.toFixed(2)}) ${c.symbol} | mint VERIFIED via ${verificationSource} ${c.tokenAddress} | received ${receivedUi} ${c.symbol} | tx ${swap.signature}`,signature:swap.signature};
}

export function exitReason(s,price,currentSolUsd=null){
  const p=s.position;if(!p||price<=0)return null;
  if(p.forceExitReason)return p.forceExitReason;
  p.highPrice=Math.max(Number(p.highPrice)||p.entryPrice,price);p.lastPrice=price;
  const recovered=p.basisType==='SOL_RECOVERED'&&p.entryPriceSol&&currentSolUsd;
  const currentBasis=recovered?price/currentSolUsd:price;
  const entryBasis=recovered?p.entryPriceSol:p.entryPrice;
  if(recovered)p.highPriceSol=Math.max(Number(p.highPriceSol)||entryBasis,currentBasis);
  const highBasis=recovered?p.highPriceSol:p.highPrice;
  const retPct=(currentBasis/entryBasis-1)*100;
  if(retPct<=-config.stopLossPct)return `STOP -${config.stopLossPct}%`;
  if(retPct>=config.takeProfitPct)return `TAKE PROFIT +${config.takeProfitPct}%`;
  if((highBasis/entryBasis-1)*100>=config.trailArmPct && (1-currentBasis/highBasis)*100>=config.trailDrawdownPct)return `TRAIL after +${config.trailArmPct}%`;
  saveLiveState(s);return null;
}
export async function closeLive(s,reason){
  const p=s.position;if(!p)throw new Error('No live position');
  const before=await walletTokenBalance(p.tokenAddress);
  const currentRaw=rawBigInt(before.amountRaw);
  const preExistingRaw=rawBigInt(p.preExistingRaw||'0');
  const managedRaw=currentRaw>preExistingRaw?currentRaw-preExistingRaw:0n;
  if(managedRaw<=0n){
    s.trades.push({type:'POSITION_GONE',mode:'LIVE',symbol:p.symbol,tokenAddress:p.tokenAddress,reason:'wallet-balance-zero-before-sell',at:new Date().toISOString()});
    s.position=null;saveLiveState(s);
    return {message:`${p.symbol} no longer exists in the wallet; no sell submitted`,pnlUsd:0,pnlSol:0,receivedSol:0,receivedUsd:0,signature:null,symbol:p.symbol};
  }
  console.log(`🐱 SELL VERIFY ${p.symbol} | mint ${p.tokenAddress} | selling ${managedRaw} raw from wallet balance ${before.amountRaw}`);
  const swap=await jupiterSwap(p.tokenAddress,SOL_MINT,String(managedRaw));
  const expectedMax=preExistingRaw;
  const after=await waitForTokenBalance(p.tokenAddress,x=>rawBigInt(x.amountRaw)<=expectedMax,{attempts:16,delayMs:1500});
  const afterRaw=rawBigInt(after.amountRaw);
  const sellConfirmed=afterRaw<currentRaw;
  if(!sellConfirmed)throw new Error(`SELL RETURNED SUCCESS BUT TOKEN BALANCE DID NOT DECREASE for ${p.symbol} ${p.tokenAddress} | tx ${swap.signature}. Position kept active.`);
  const receivedSol=Number(swap.outputRaw)/LAMPORTS_PER_SOL;
  const currentSolUsd=await solUsdPrice();
  const receivedUsd=receivedSol*currentSolUsd;
  const pnlUsd=receivedUsd-p.costUsd;
  const pnlSol=receivedSol-p.costSol;
  s.realizedPnl+=pnlUsd;s.dailyPnl+=pnlUsd;
  s.trades.push({type:'SELL',mode:'LIVE',symbol:p.symbol,tokenAddress:p.tokenAddress,soldRaw:String(managedRaw),walletRawBefore:String(currentRaw),walletRawAfter:String(afterRaw),receivedSol,receivedUsd,pnlUsd,pnlSol,reason,signature:swap.signature,at:new Date().toISOString()});
  if(afterRaw>preExistingRaw){
    p.tokenAmountRaw=String(afterRaw-preExistingRaw);p.walletBalanceRaw=String(afterRaw);p.lastSellSignature=swap.signature;p.lastReconciledAt=new Date().toISOString();
  }else s.position=null;
  saveLiveState(s);
  return {message:`LIVE SELL ${p.symbol}: ${reason} | received ${receivedSol.toFixed(6)} SOL (~$${receivedUsd.toFixed(2)}) | P&L ${pnlUsd>=0?'+':''}$${pnlUsd.toFixed(2)} | wallet balance verified | tx ${swap.signature}`,pnlUsd,pnlSol,receivedSol,receivedUsd,signature:swap.signature,symbol:p.symbol};
}

export function tradeStatsLive(s){const sells=s.trades.filter(t=>t.type==='SELL');return{totalTrades:sells.length,wins:sells.filter(t=>Number(t.pnlUsd)>0).length,losses:sells.filter(t=>Number(t.pnlUsd)<0).length}}
