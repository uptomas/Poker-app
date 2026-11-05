const P = require('../engine.js');
const assert = require('assert');
const h = (s) => s.split(' ').map(P.parseCard);
const cat = (s) => P.categoryOf(P.evaluate(h(s)));
assert.strictEqual(cat('Ah Kh Qh Jh Th 2c 3d'), 8);
assert.strictEqual(cat('As 2s 3s 4s 5s Kd Kc'), 8);
assert.strictEqual(cat('Ah Ad Ac As 2c 3d 4h'), 7);
assert.strictEqual(cat('Ah Ad Ac Ks Kc Kd 4h'), 6);
assert.strictEqual(cat('2h 7h 9h Jh Kh Ac Ad'), 5);
assert.strictEqual(cat('Ah 2d 3c 4s 5h 9c Kd'), 4);
assert.strictEqual(cat('7h 7d 7c 2s 5h 9c Kd'), 3);
assert.strictEqual(cat('7h 7d 5c 5s 2h 2c Kd'), 2);
assert.strictEqual(cat('7h 7d 5c 3s 2h 9c Kd'), 1);
assert.strictEqual(cat('7h 8d 5c 3s 2h Jc Kd'), 0);
// comparisons
const s = (x) => P.evaluate(h(x));
assert(s('Ah 2d 3c 4s 5h 9c Kd') < s('2h 3d 4c 5s 6h 9c Kd'), 'wheel < 6-high');
assert(s('Ah Ad 5c 5s 2h 2c Kd') > s('Ah Ad 5c 5s 2h 2c Qd'), 'two pair kicker');
assert(s('Ah Ad Kc 9s 7h 4c 2d') > s('Ah Ad Kc 9s 6h 4c 2d'), 'pair kickers');
assert.strictEqual(s('Ah Ad Ac Kd Kc Qh Qs'), s('Ah Ad Ac Kd Kc 2h 3s'));
console.log(P.describe(s('Ah Ad Ac Kd Kc Qh Qs')), '|', P.describe(s('Th Jh Qh Kh Ah 2c 3d')));

// exact: flop heads-up
let t = Date.now();
let st = P.runEquity(h('Ah Kh'), h('Qh 7h 2c'), 1);
console.log('AhKh on Qh7h2c exact', st.exact, st.trials, (st.equity / st.trials * 100).toFixed(2), Date.now() - t, 'ms');
// preflop MC
t = Date.now();
st = P.runEquity(h('As Ad'), [], 1);
console.log('AA vs random', (st.equity / st.trials * 100).toFixed(2), '(~85.2)', Date.now() - t, 'ms');
st = P.runEquity(h('As Ad'), [], 9);
console.log('AA vs 9', (st.equity / st.trials * 100).toFixed(2), '(~31)');
st = P.runEquity(h('7s 2d'), [], 1);
console.log('72o vs 1', (st.equity / st.trials * 100).toFixed(2), '(~34.6)');
// river exact
st = P.runEquity(h('As Ad'), h('Ks Kd 2c 7h 9s'), 1);
console.log('river', st.exact, st.trials);
const o = P.computeOuts(h('Ah Kh'), h('Qh 7h 2c'));
console.log('outs', o.outs.length, o.groups.map(g => g.cat + ':' + g.cards.map(P.cardLabel).join(',')).join(' | '), (o.byRiver*100).toFixed(1));
const o2 = P.computeOuts(h('9s 8s'), h('7d 6c 2h'));
console.log('OESD outs', o2.outs.length, o2.groups.map(g => g.cat + ':' + g.cards.length).join(' '));
// ranges: a bettor with no bluffs beats an underpair far more often than a random hand
const rnd = P.runEquity(h('Ts Td'), h('Kc 7d 2s'), 1);
const vsBet = P.runEquity(h('Ts Td'), h('Kc 7d 2s'), 1, { bettors: 1, bluff: 0 });
const vsBluff = P.runEquity(h('Ts Td'), h('Kc 7d 2s'), 1, { bettors: 1, bluff: 1 });
assert(vsBet.equity / vsBet.trials < rnd.equity / rnd.trials - 0.3, 'value range is stronger');
assert(vsBluff.equity / vsBluff.trials > rnd.equity / rnd.trials, 'bluff range is weaker');
assert(P.isStrong(h('Ks Qd'), h('Kc 7d 2s')) && !P.isStrong(h('9s 8d'), h('Kc 7d 2s')));
assert(P.isStrong(h('Ah 5h'), h('Kh 7h 2s')), 'flush draw counts as strong');
console.log('all tests passed');
