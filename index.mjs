import http from 'node:http';
import {config,liveConfigStatus} from './config.mjs';
import {discoverCandidates,refreshPair} from './geckoterminal.mjs';
import {entryAllowed,scoreCandidate} from './scoring.mjs';
import {equityUsd,loadState,openPaper,saveState,stateFilePath,tradeStats,updatePaper} from './paper.mjs';
import {alert} from './telegram.mjs';
import {buyPost,dailyPost,postToX,sellPost,xReady} from './x.mjs';
import {assertLiveFunding,closeLive,exitReason,liveStateFilePath,loadLiveState,openLive,saveLiveState,tradeStatsLive,walletAddress,walletSnapshot,scanWalletPositions,recoverLivePosition,reconcileLivePosition} from './live.mjs';
import {auditEvent,auditPaths,auditScan,makeScanId} from './audit.mjs';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const entryCooldown=new Map();
const isLive=config.tradingMode==='live';
if(!['paper','live'].includes(config.tradingMode))throw new Error('TRADING_MODE must be paper or live');
if(isLive){const st=liveConfigStatus();if(!st.ready)throw new Error(`LIVE MODE NOT ARMED. Missing: ${st.missing.join(', ')}`)}
const state=isLive?loadLiveState():loadState();
let lastScanAt=null,lastError=null,scans=0,lastWallet=null,lastPositions=[],lastScanSummary=[];

const server=http.createServer(async(req,res)=>{
  if(req.url==='/health'){
    try{if(isLive)lastWallet=await walletSnapshot()}catch{}
    const payload=isLive?{ok:true,version:'v8.10',mode:'LIVE',wallet:walletAddress(),sol:lastWallet?.sol??null,solUsd:lastWallet?.solUsd??null,solValueUsd:lastWallet?.solValueUsd??null,dailyPnl:state.dailyPnl,realizedPnl:state.realizedPnl,hasPosition:Boolean(state.position),openPositions:lastPositions.length,positions:lastPositions,xPosting:xReady(),scans,lastScanAt,lastError,tradingPaused:Boolean(state.tradingPaused),pauseReason:state.pauseReason||null,lastBuyIncident:state.lastBuyIncident||null,stateFile:liveStateFilePath(),auditFiles:auditPaths(),lastScanSummary}:{ok:true,version:'v8.10',mode:'paper',cash:state.cash,equity:equityUsd(state),dailyPnl:state.dailyPnl,hasPosition:Boolean(state.position),openPositions:lastPositions.length,positions:lastPositions,xPosting:xReady(),scans,lastScanAt,lastError,stateFile:stateFilePath(),auditFiles:auditPaths(),lastScanSummary};
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(payload));return;
  }
  res.writeHead(200,{'content-type':'text/plain'});res.end(`Broke Cat Bot V8.10 ${isLive?'LIVE MODE':'PAPER MODE'} 🐱`);
});
server.listen(config.port,'0.0.0.0',()=>console.log(`Health server listening on :${config.port} | ${isLive?'LIVE':'PAPER'} MODE`));
const persist=()=>isLive?saveLiveState(state):saveState(state);
process.on('SIGTERM',()=>{persist();server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),5000).unref()});
process.on('SIGINT',()=>{persist();server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),5000).unref()});

async function maybeDailyX(){
  if(!xReady())return;
  const now=new Date(),day=now.toISOString().slice(0,10);
  if(now.getUTCHours()<config.xDailyReportHourUtc||state.lastXDailyReportDay===day)return;
  if(isLive){const snap=await walletSnapshot();const stats=tradeStatsLive(state);const result=await postToX(dailyPost({mode:'LIVE',cash:snap.solValueUsd,walletLabel:'SOL value',realizedPnl:state.realizedPnl,dailyPnl:state.dailyPnl,...stats}));if(result.ok){state.lastXDailyReportDay=day;persist()}}
  else{const stats=tradeStats(state);const result=await postToX(dailyPost({mode:'PAPER',cash:state.cash,realizedPnl:state.realizedPnl,dailyPnl:state.dailyPnl,...stats}));if(result.ok){state.lastXDailyReportDay=day;persist()}}
}

if(isLive){lastWallet=await walletSnapshot();const recovery=await reconcileLivePosition(state).catch(e=>({recovered:false,reason:e.message}));lastPositions=await scanWalletPositions(state).catch(()=>[]);if(recovery.recovered)await alert(`🐱 RECOVERED POSITION ${recovery.position.symbol} | mint ${recovery.position.tokenAddress} | raw ${recovery.position.tokenAmountRaw} | monitoring exits again`);else if(lastPositions.length)await alert(`🐱 WALLET POSITIONS FOUND: ${lastPositions.map(p=>`${p.symbol} ~$${p.currentValueUsd.toFixed(2)}`).join(' | ')} | recovery: ${recovery.reason}`);await alert(`🐱 Broke Cat Bot V8.10 STARTED | 🔴 LIVE MONEY | wallet ${walletAddress()} | SOL ${lastWallet.sol.toFixed(6)} (~$${lastWallet.solValueUsd.toFixed(2)}) | AUTO SIZE ${config.autoPositionSizing?'ON':'OFF'} | allowed wallet ${config.autoSizeMinWalletPct}-${config.autoSizeMaxWalletPct}% | network reserve ${config.minSolReserve} SOL | daily stop -$${config.maxDailyLoss.toFixed(2)}`)}
else await alert(`🐱 Broke Cat Bot V8.10 started | PAPER MODE | bankroll $${state.cash.toFixed(2)} | min score ${config.minScore} | Helius ${config.heliusApiKey?'ON':'OFF'} | SolanaTracker bundle scanner ${config.solanaTrackerApiKey?'ON':'OFF'} | X ${xReady()?'ON':'OFF'}`);

do{
  try{
    lastError=null;
    if(isLive){
      const rec=await reconcileLivePosition(state).catch(e=>{console.error('Position reconcile:',e.message);return {recovered:false,reason:e.message}});
      if(rec?.recovered)await alert(`🐱 RECOVERED POSITION ${rec.position.symbol} | mint ${rec.position.tokenAddress} | monitoring exits`);
      lastPositions=await scanWalletPositions(state).catch(e=>{console.error('Wallet position scan:',e.message);return lastPositions});
    }
    if(state.position){
      const p=await refreshPair(state.position.pairAddress);
      if(p){
        if(isLive){lastWallet=await walletSnapshot();const reason=exitReason(state,p.priceUsd,lastWallet.solUsd);if(reason){const closed=await closeLive(state,reason);auditEvent('SELL',{mode:'LIVE',reason,...closed});await alert(`🐱 ${closed.message}`);const snap=await walletSnapshot();await postToX(sellPost({mode:'LIVE',symbol:closed.symbol,reason,pnlUsd:closed.pnlUsd,cash:snap.solValueUsd,walletLabel:'SOL value'}))}}
        else{const before={...state.position};const msg=updatePaper(state,p.priceUsd);if(msg){const lastSell=[...state.trades].reverse().find(t=>t.type==='SELL');auditEvent('SELL',{mode:'PAPER',trade:lastSell,message:msg});await alert(`🐱 ${msg}`);if(lastSell)await postToX(sellPost({mode:'PAPER',symbol:before.symbol,reason:lastSell.reason,pnlUsd:lastSell.pnlUsd,cash:state.cash}))}}
      }
    }
    const unmanagedBlock=isLive&&!state.position&&lastPositions.some(p=>!p.managed&&p.currentValueUsd>=config.orphanHoldingBlockUsd);
    const safetyPaused=isLive&&Boolean(state.tradingPaused);
    if(unmanagedBlock)console.log(`🐱 NEW BUYS PAUSED | unmanaged wallet holding >= $${config.orphanHoldingBlockUsd.toFixed(2)} detected | recover/clear it before opening another trade`);
    if(safetyPaused)console.log(`🐱 SAFETY PAUSE ACTIVE | ${state.pauseReason||'unresolved trade reconciliation incident'} | existing positions will still be monitored/sold, but no new buys will be submitted`);
    if(!state.position&&!unmanagedBlock&&!safetyPaused&&state.dailyPnl>-config.maxDailyLoss){
      const candidates=await discoverCandidates();scans++;lastScanAt=new Date().toISOString();lastScanSummary=[];
      console.log(`\n🐱 ===== SCAN CYCLE #${scans} | ${lastScanAt} | ${candidates.length} COINS =====`);
      auditEvent('SCAN_CYCLE_START',{scanNumber:scans,candidateCount:candidates.length,mode:isLive?'LIVE':'PAPER'});
      for(let i=0;i<candidates.length;i++){
        const c=candidates[i];
        const scanId=makeScanId(scans,i);
        const s=await scoreCandidate(c),gate=entryAllowed(s);
        const r=s.risk;
        const lastEntry=entryCooldown.get(c.tokenAddress)||0;
        const onCooldown=Date.now()-lastEntry<600000;
        const decision=gate.ok?(onCooldown?'ENTRY COOLDOWN':'ENTRY OK'):'REJECTED';
        const age=Number.isFinite(s.metrics.ageMin)?`${s.metrics.ageMin.toFixed(1)}m`:'n/a';
        console.log(`\n[${scanId}] ${s.name} (${s.symbol}) | SCORE ${s.score}/100 | ${decision}`);
        console.log(`  Mint ${s.tokenAddress} | SOURCE ${s.dataSource||'unknown'} | DEX ${s.dexId} | Age ${age}`);
        console.log(`  Price $${s.priceUsd} | MC $${s.marketCap.toFixed(0)} | LIQ $${s.liquidityUsd.toFixed(0)} | 5m VOL $${s.volume5m.toFixed(0)}`);
        console.log(`  5m TX buys ${s.buys5m} / sells ${s.sells5m} | buy/sell ${s.metrics.buySellRatio.toFixed(2)}x | vol accel ${s.metrics.volumeAcceleration.toFixed(2)}x | price ${s.priceChange5m>=0?'+':''}${s.priceChange5m.toFixed(2)}%`);
        console.log(`  Risk bundle ${Number.isFinite(r.bundlePct)?r.bundlePct.toFixed(2)+'%':r.bundleStatus} (${String(r.bundleRisk).toUpperCase()}) | holders ${String(r.holderRisk).toUpperCase()}${Number.isFinite(r.top10Pct)?` top10 ${r.top10Pct.toFixed(2)}%`:''} | dev ${String(r.devRisk).toUpperCase()}`);
        console.log(`  Score parts: ${Object.entries(s.breakdown).map(([k,v])=>`${k} ${v.points>=0?'+':''}${v.points}`).join(' | ')}`);
        console.log(`  Decision: ${decision}${gate.ok?'':` | ${gate.why}`}`);
        const record={scanId,scanNumber:scans,index:i+1,at:new Date().toISOString(),mode:isLive?'LIVE':'PAPER',token:{name:s.name,symbol:s.symbol,mint:s.tokenAddress,pairAddress:s.pairAddress,dexId:s.dexId,url:s.url,dataSource:s.dataSource||'unknown'},market:{priceUsd:s.priceUsd,marketCap:s.marketCap,liquidityUsd:s.liquidityUsd,volume5m:s.volume5m,volume1h:s.volume1h,buys5m:s.buys5m,sells5m:s.sells5m,priceChange5m:s.priceChange5m,priceChange1h:s.priceChange1h,...s.metrics},score:s.score,rawScore:s.rawScore,scoreBreakdown:s.breakdown,scoreReasons:s.reasons,risk:r,gate,decision};
        auditScan(record);
        lastScanSummary.push({scanId,symbol:s.symbol,name:s.name,score:s.score,decision,why:gate.why});
        if(lastScanSummary.length>20)lastScanSummary.shift();
        if(s.score>=60)await alert(`🐱 ${s.name} (${s.symbol}) ${s.score}/100 | MC $${s.marketCap.toFixed(0)} | liq $${s.liquidityUsd.toFixed(0)} | 5m vol $${s.volume5m.toFixed(0)} | bundle ${Number.isFinite(r.bundlePct)?`${r.bundlePct.toFixed(1)}% ${String(r.bundleRisk).toUpperCase()}`:`${String(r.bundleRisk).toUpperCase()} [${r.bundleStatus}]`} (${r.bundleSource}) | holders ${String(r.holderRisk).toUpperCase()}${Number.isFinite(r.top10Pct)?` (top10 ${r.top10Pct.toFixed(1)}%)`:''} | dev ${String(r.devRisk).toUpperCase()} | ${decision}${gate.ok&&!onCooldown?'':` ${gate.why||''}`}`);
        if(gate.ok&&!onCooldown){
          entryCooldown.set(c.tokenAddress,Date.now());
          if(isLive){const opened=await openLive(state,s);auditEvent('BUY',{mode:'LIVE',scanId,symbol:s.symbol,name:s.name,mint:s.tokenAddress,score:s.score,message:opened.message,position:state.position});await alert(`🐱 ${opened.message}`);const snap=await walletSnapshot();await postToX(buyPost({mode:'LIVE',symbol:s.symbol,sizeUsd:state.position.costUsd,score:s.score,marketCap:s.marketCap,risk:s.risk,cash:snap.solValueUsd,walletLabel:'SOL value'}))}
          else{const msg=openPaper(state,s);auditEvent('BUY',{mode:'PAPER',scanId,symbol:s.symbol,name:s.name,mint:s.tokenAddress,score:s.score,message:msg,position:state.position});await alert(`🐱 ${msg}`);if(state.position)await postToX(buyPost({mode:'PAPER',symbol:s.symbol,sizeUsd:state.position.sizeUsd,score:s.score,marketCap:s.marketCap,risk:s.risk,cash:state.cash}))}
          break;
        }
      }
      console.log(`\n🐱 ===== END SCAN #${scans} =====\n`);
      auditEvent('SCAN_CYCLE_END',{scanNumber:scans,scoredCount:lastScanSummary.length});
    }
    if(isLive&&lastPositions.length){for(const wp of lastPositions){const managed=state.position?.tokenAddress===wp.tokenAddress;const pnl=wp.pnlPct;console.log(`🐱 POSITION ${wp.symbol} | mint ${wp.tokenAddress} | value $${wp.currentValueUsd.toFixed(2)} | price $${wp.priceUsd} | raw ${wp.tokenAmountRaw} | ${Number.isFinite(pnl)?`P&L ${pnl>=0?'+':''}${pnl.toFixed(1)}%`:'P&L n/a'} | ${managed?'MONITORED':'WALLET HOLDING'}`)}}
    await maybeDailyX();persist();
  }catch(err){lastError=err?.message||String(err);auditEvent('ERROR',{message:lastError,stack:err?.stack||null});console.error(new Date().toISOString(),err);await alert(`🐱 Broke Cat error: ${lastError}`).catch(()=>{})}
  if(!config.runOnce)await sleep(config.pollSeconds*1000);
}while(!config.runOnce);
server.close();
