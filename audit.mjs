import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.mjs';

fs.mkdirSync(config.dataDir,{recursive:true});
const scansPath=path.resolve(config.dataDir,'broke-cat-scan-history.jsonl');
const eventsPath=path.resolve(config.dataDir,'broke-cat-event-history.jsonl');

const clean=v=>JSON.parse(JSON.stringify(v,(k,val)=>typeof val==='bigint'?String(val):val));
function append(file,row){
  try{fs.appendFileSync(file,JSON.stringify(clean(row))+'\n');}
  catch(err){console.error(`[AUDIT] Failed writing ${file}: ${err.message}`);}
}
export function auditScan(row){append(scansPath,{recordType:'SCAN',...row});}
export function auditEvent(type,data={}){append(eventsPath,{recordType:type,at:new Date().toISOString(),...data});}
export function auditPaths(){return {scansPath,eventsPath};}
export function makeScanId(scanNumber,index){return `SCAN-${new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14)}-${String(scanNumber).padStart(5,'0')}-${String(index+1).padStart(2,'0')}`;}
