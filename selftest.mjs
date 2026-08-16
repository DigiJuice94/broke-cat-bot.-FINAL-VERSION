import { parseBundlersResponse } from './solanatracker.mjs';
import assert from 'node:assert/strict';
import { classifyHolderRisk } from './risk.mjs';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { parseKey } from './live.mjs';

const low=classifyHolderRisk({totalSupply:1000,holders:[100,70,60,50,40,30,20,20,20,20].map((amount,i)=>({owner:`w${i}`,amount}))});
assert.equal(low.holderRisk,'medium');
assert.equal(low.top1Pct,10);
const high=classifyHolderRisk({totalSupply:1000,holders:[250,100,80,60,50,20].map((amount,i)=>({owner:`h${i}`,amount}))});
assert.equal(high.holderRisk,'high');
const kp=Keypair.generate();
const secret=Buffer.from(kp.secretKey);
const cases=[
  ['base58',bs58.encode(secret)],
  ['base64',secret.toString('base64')],
  ['hex',secret.toString('hex')],
  ['json',JSON.stringify([...secret])]
];
for(const [name,encoded] of cases){
  const parsed=parseKey(encoded);
  assert.equal(parsed.keypair.publicKey.toBase58(),kp.publicKey.toBase58(),`${name} key parser mismatch`);
}
console.log('Broke Cat V8.2 self-test passed');

const bund=parseBundlersResponse({totalBundlerPercentage:12.5,wallets:[{wallet:'a'},{wallet:'b'}]});
assert.equal(bund.totalBundlerPercentage,12.5); assert.equal(bund.walletCount,2);
const frac=parseBundlersResponse({data:{totalBundlerPercentage:0.08,wallets:[]}}); assert.equal(frac.totalBundlerPercentage,8);
