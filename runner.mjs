import {createHmac} from 'node:crypto';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {analyze, replay, start, step, SYMBOL} from './engine.mjs';

const host='https://testnet.binance.vision';
async function get(path, query={}, headers={}) {
  const url=new URL(path,host);
  url.search=new URLSearchParams(query);
  const response=await fetch(url,{headers,redirect:'error',signal:AbortSignal.timeout(18000)});
  if(!response.ok) throw new Error('HTTP '+response.status);
  return response.json();
}

async function verifyAccount(serverTime) {
  const {BINANCE_API_KEY:key,BINANCE_API_SECRET:secret}=process.env;
  if (!key || !secret) return 'sem chaves';
  if (!serverTime) return 'indisponível';
  const params={timestamp:serverTime,recvWindow:10000};
  params.signature=createHmac('sha256',secret).update(new URLSearchParams(params).toString()).digest('hex');
  try {
    const account=await get('/api/v3/account',params,{'X-MBX-APIKEY':key});
    return account.accountType==='SPOT' && Array.isArray(account.balances) ? 'ligada' : 'resposta inesperada';
  } catch (error) {
    return error.message==='HTTP 451' ? 'restrição regional (HTTP 451)' : 'falha na validação';
  }
}

async function read(path,fallback) {
  try {return JSON.parse(await readFile(path,'utf8'));}
  catch (error) {if (error.code!=='ENOENT') throw error; return fallback;}
}

if (process.argv.includes('--self-test')) {
  const c=Array.from({length:140},(_,i)=>({id:i+1,close:100+i,volume:i===29?200:100}));
  const f=Array.from({length:30},(_,i)=>({id:i+1,close:100,volume:100}));
  const a=start();
  assert.equal(analyze(f).signal,'WAIT');
  assert.equal(replay(c,a,1),1);
  assert.equal(a.latest.signal,'BUY');
  assert.equal(a.trades.length,1);
  step(a,c.slice(0,30));
  assert.equal(a.trades.length,1);
  step(a,[...c.slice(1,30),{id:31,close:60,volume:100}]);
  assert.equal(a.closed,1);
  assert.equal(a.latest.reason,'stop-loss de 1%');
  assert(a.losses>0);
  const b=start();
  assert.equal(replay(c,b,100),100);
  assert.equal(replay(c,b,100),11);
  assert.equal(replay(c,b,1),0);
  console.log('Testados: quatro sinais, consenso, Simular 1/100, stop-loss e duplicados.');
} else {
  await mkdir('data',{recursive:true});
  const old=await read('data/report.json',{state:start(),candles:[]});
  const previous=JSON.stringify({...old,updated:undefined});
  const state=old.state;
  let candles=old.candles, market='ligado', serverTime=0;
  try {
    const [time,rows]=await Promise.all([get('/api/v3/time'),get('/api/v3/klines',{symbol:SYMBOL,interval:'5m',limit:500})]);
    serverTime=time.serverTime;
    const fresh=rows.filter(row=>row[6]<serverTime).map(row=>({id:Number(row[6]),close:Number(row[4]),volume:Number(row[5])}));
    if (fresh.length<130 || fresh.some((c,i)=>!Number.isSafeInteger(c.id) || !Number.isFinite(c.close) || c.close<=0 || !Number.isFinite(c.volume) || c.volume<0 || (i && c.id<=fresh[i-1].id))) throw Error('Dados insuficientes');
    candles=fresh;
    if (!state.last) step(state,candles.slice(-30));
    else replay(candles,state,Infinity);
  } catch (error) {
    market=error.message==='HTTP 451' ? 'restrição regional (HTTP 451)' : 'indisponível';
  }
  const account=await verifyAccount(serverTime);
  console.log('Mercado Spot Testnet: '+market+' | autenticação: '+account);
  const report={symbol:SYMBOL,market,account,candles,state};
  if (JSON.stringify(report)!==previous) {
    await writeFile('data/report.json',JSON.stringify({...report,updated:new Date().toISOString()})+'\n');
  }
}
