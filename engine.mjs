export const INITIAL = 1000;
export const SYMBOL = 'BTCUSDT';
export const FEE = 0.001;
export const WARMUP = 30;
export const start = () => ({cash:INITIAL, qty:0, entry:0, spent:0, equity:INITIAL, last:0, trades:[], gains:0, losses:0, wins:0, closed:0});
const mean = values => values.reduce((sum, n) => sum+n, 0)/values.length;

export function analyze(candles) {
  const p = candles.map(c => c.close);
  const v = candles.map(c => c.volume);
  const price = p.at(-1), change = price-p.at(-2);
  const trend = mean(p.slice(-10))-mean(p.slice(-30));
  const direction = n => n>0 ? 'BUY' : n<0 ? 'SELL' : 'WAIT';
  const changes = p.slice(-14).map((n,i) => n-p.at(i-15));
  const up = mean(changes.map(n=>Math.max(0,n))), down = mean(changes.map(n=>Math.max(0,-n)));
  const rsi = down ? 100-100/(1+up/down) : up ? 100 : 50;
  const reference = p.slice(-21,-1);
  const votes = {
    trend:direction(trend),
    momentum:rsi>55 ? 'BUY' : rsi<45 ? 'SELL' : 'WAIT',
    breakout:price>Math.max(...reference) ? 'BUY' : price<Math.min(...reference) ? 'SELL' : 'WAIT',
    volume:v.at(-1)>1.1*mean(v.slice(-21,-1)) ? direction(change) : 'WAIT',
  };
  const list = Object.values(votes);
  return {votes, signal:list.every(vote=>vote===list[0]) ? list[0] : 'WAIT'};
}

export function step(state, candles) {
  if (candles.length<WARMUP) throw Error('Histórico insuficiente');
  const {id, close:price} = candles.at(-1);
  if (id<=state.last) return state;
  const {votes, signal} = analyze(candles);
  let action='HOLD', pnl=null, reason='';
  if (state.qty && (price<=state.entry*0.99 || signal==='SELL')) {
    reason=price<=state.entry*0.99 ? 'stop-loss de 1%' : 'consenso 4/4';
    const proceeds=state.qty*price*(1-FEE);
    pnl=proceeds-state.spent;
    state.gains+=Math.max(0,pnl);
    state.losses+=Math.max(0,-pnl);
    state.wins+=Number(pnl>0);
    state.closed++;
    state.cash+=proceeds;
    state.qty=state.entry=state.spent=0;
    action='SELL';
  } else if (!state.qty && signal==='BUY' && state.cash>=10) {
    state.spent=Math.min(100,state.cash*0.1);
    state.cash-=state.spent;
    state.entry=price;
    state.qty=state.spent*(1-FEE)/price;
    action='BUY';
    reason='consenso 4/4';
  }
  state.equity=state.cash+state.qty*price;
  state.last=id;
  state.latest={id,price,votes,signal,action,pnl,reason};
  if (action!=='HOLD') state.trades.push(state.latest);
  return state;
}

export function replay(candles, state, count) {
  const index = candles.findIndex(c=>c.id>state.last);
  if (index<0) return 0;
  const first=Math.max(WARMUP-1,index);
  const end=Math.min(first+count,candles.length);
  for (let i=first;i<end;i++) step(state,candles.slice(i-WARMUP+1,i+1));
  return Math.max(0,end-first);
}
