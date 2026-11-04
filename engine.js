/* Poker engine: card model, hand evaluator, equity (exact + Monte Carlo) and outs.
 * Cards are integers 0..51: rank = c >> 2 (0 = 2 ... 12 = A), suit = c & 3.
 */
(function (root) {
  'use strict';

  const RANKS = '23456789TJQKA';
  const SUITS = ['s', 'h', 'd', 'c'];
  const SUIT_SYMBOL = { s: '♠', h: '♥', d: '♦', c: '♣' };
  const RANK_NAME_PT = ['Dois', 'Três', 'Quatro', 'Cinco', 'Seis', 'Sete', 'Oito', 'Nove', 'Dez', 'Valete', 'Dama', 'Rei', 'Ás'];
  const RANK_PLURAL_PT = ['Duques', 'Três', 'Quatros', 'Cincos', 'Seis', 'Setes', 'Oitos', 'Noves', 'Dezes', 'Valetes', 'Damas', 'Reis', 'Ases'];

  const CATEGORIES = [
    { key: 'high', name: 'Carta Alta' },
    { key: 'pair', name: 'Par' },
    { key: 'twopair', name: 'Dois Pares' },
    { key: 'trips', name: 'Trio' },
    { key: 'straight', name: 'Sequência' },
    { key: 'flush', name: 'Cor' },
    { key: 'fullhouse', name: 'Full House' },
    { key: 'quads', name: 'Poker (Quadra)' },
    { key: 'straightflush', name: 'Straight Flush' },
  ];

  const card = (rank, suit) => (rank << 2) | suit;
  const rankOf = (c) => c >> 2;
  const suitOf = (c) => c & 3;
  const cardLabel = (c) => RANKS[rankOf(c)] + SUITS[suitOf(c)];

  function parseCard(str) {
    const r = RANKS.indexOf(str[0].toUpperCase());
    const s = SUITS.indexOf(str[1].toLowerCase());
    if (r < 0 || s < 0) throw new Error('Carta inválida: ' + str);
    return card(r, s);
  }

  // Highest rank of a 5-card straight inside a 13-bit rank mask, or -1.
  function straightHigh(mask) {
    // bit 0 = ace-low, bits 1..13 = 2..A
    const ext = (mask << 1) | ((mask >> 12) & 1);
    for (let h = 13; h >= 4; h--) {
      if (((ext >> (h - 4)) & 31) === 31) return h - 1;
    }
    return -1;
  }

  const counts = new Int8Array(13);
  const suitCounts = new Int8Array(4);
  const suitMasks = new Int32Array(4);

  /** Evaluates 1..7 cards. Returns a comparable score: category << 20 | kickers. */
  function evaluate(cards, n) {
    if (n === undefined) n = cards.length;
    counts.fill(0); suitCounts.fill(0); suitMasks.fill(0);
    let mask = 0;
    for (let i = 0; i < n; i++) {
      const c = cards[i], r = c >> 2, s = c & 3;
      counts[r]++; suitCounts[s]++; suitMasks[s] |= 1 << r; mask |= 1 << r;
    }

    // Flush / straight flush
    let flushSuit = -1;
    for (let s = 0; s < 4; s++) if (suitCounts[s] >= 5) flushSuit = s;
    if (flushSuit >= 0) {
      const sh = straightHigh(suitMasks[flushSuit]);
      if (sh >= 0) return (8 << 20) | (sh << 16);
    }

    let quad = -1, trip1 = -1, trip2 = -1, pair1 = -1, pair2 = -1;
    for (let r = 12; r >= 0; r--) {
      const k = counts[r];
      if (k === 4) { if (quad < 0) quad = r; }
      else if (k === 3) { if (trip1 < 0) trip1 = r; else if (trip2 < 0) trip2 = r; }
      else if (k === 2) { if (pair1 < 0) pair1 = r; else if (pair2 < 0) pair2 = r; }
    }

    if (quad >= 0) {
      let kick = 0;
      for (let r = 12; r >= 0; r--) if (r !== quad && counts[r]) { kick = r; break; }
      return (7 << 20) | (quad << 16) | (kick << 12);
    }
    if (trip1 >= 0 && (trip2 >= 0 || pair1 >= 0)) {
      const p = Math.max(trip2, pair1);
      return (6 << 20) | (trip1 << 16) | (p << 12);
    }
    if (flushSuit >= 0) {
      let m = suitMasks[flushSuit], score = 5 << 20, shift = 16;
      for (let r = 12; r >= 0 && shift >= 0; r--) if (m & (1 << r)) { score |= r << shift; shift -= 4; }
      return score;
    }
    const sh = straightHigh(mask);
    if (sh >= 0) return (4 << 20) | (sh << 16);

    // Kickers helper: up to `need` highest ranks not in `excl`
    function kickers(score, shift, need, e1, e2) {
      for (let r = 12; r >= 0 && need > 0; r--) {
        if (counts[r] && r !== e1 && r !== e2) { score |= r << shift; shift -= 4; need--; }
      }
      return score;
    }
    if (trip1 >= 0) return kickers((3 << 20) | (trip1 << 16), 12, 2, trip1, -1);
    if (pair1 >= 0 && pair2 >= 0) return kickers((2 << 20) | (pair1 << 16) | (pair2 << 12), 8, 1, pair1, pair2);
    if (pair1 >= 0) return kickers((1 << 20) | (pair1 << 16), 12, 3, pair1, -1);
    return kickers(0, 16, 5, -1, -1);
  }

  const categoryOf = (score) => score >> 20;

  function describe(score) {
    const cat = score >> 20;
    const a = (score >> 16) & 15, b = (score >> 12) & 15;
    switch (cat) {
      case 8: return a === 12 ? 'Royal Flush' : `Straight Flush até ${RANK_NAME_PT[a]}`;
      case 7: return `Poker de ${RANK_PLURAL_PT[a]}`;
      case 6: return `Full House: ${RANK_PLURAL_PT[a]} com ${RANK_PLURAL_PT[b]}`;
      case 5: return `Cor com ${RANK_NAME_PT[a]} alto`;
      case 4: return `Sequência até ${RANK_NAME_PT[a]}`;
      case 3: return `Trio de ${RANK_PLURAL_PT[a]}`;
      case 2: return `Dois Pares: ${RANK_PLURAL_PT[a]} e ${RANK_PLURAL_PT[b]}`;
      case 1: return `Par de ${RANK_PLURAL_PT[a]}`;
      default: return `Carta Alta: ${RANK_NAME_PT[a]}`;
    }
  }

  function combos(n, k) {
    if (k < 0 || k > n) return 0;
    let r = 1;
    for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
    return Math.round(r);
  }

  function remainingDeck(known) {
    const used = new Set(known);
    const deck = [];
    for (let c = 0; c < 52; c++) if (!used.has(c)) deck.push(c);
    return deck;
  }

  function newStats(opponents) {
    return {
      opponents, trials: 0, wins: 0, ties: 0, losses: 0, equity: 0,
      heroCats: new Float64Array(9), // final hand category of hero
      beatenBy: new Float64Array(9), // category of the best opponent hand when hero loses
      exact: false,
    };
  }

  // Records one showdown into stats. hero score vs array of opponent scores.
  function record(stats, hs, opp, nOpp) {
    let best = 0, nBest = 0;
    for (let i = 0; i < nOpp; i++) {
      const s = opp[i];
      if (s > best) { best = s; nBest = 1; } else if (s === best) nBest++;
    }
    stats.trials++;
    stats.heroCats[hs >> 20]++;
    if (hs > best) { stats.wins++; stats.equity += 1; }
    else if (hs === best) { stats.ties++; stats.equity += 1 / (nBest + 1); }
    else { stats.losses++; stats.beatenBy[best >> 20]++; }
  }

  /** Plans how to compute: exact enumeration if small enough (1 opponent only). */
  function plan(hero, board, opponents) {
    const unknown = 52 - hero.length - board.length;
    const missing = 5 - board.length;
    if (opponents === 1) {
      const total = combos(unknown, missing) * combos(unknown - missing, 2);
      if (total <= 1200000) return { method: 'exact', total };
    }
    return { method: 'montecarlo', total: opponents >= 6 ? 80000 : 150000 };
  }

  /**
   * Creates an incremental equity job. Call job.step(n) repeatedly until job.done.
   * Exact enumeration uses a generator; Monte Carlo draws random cards.
   */
  function createEquityJob(hero, board, opponents) {
    const p = plan(hero, board, opponents);
    const stats = newStats(opponents);
    stats.exact = p.method === 'exact';
    stats.planned = p.total;
    const deck = remainingDeck(hero.concat(board));
    const missing = 5 - board.length;
    const heroCards = new Array(7), oppCards = new Array(7), opp = new Array(opponents);
    for (let i = 0; i < board.length; i++) { heroCards[2 + i] = board[i]; oppCards[2 + i] = board[i]; }
    heroCards[0] = hero[0]; heroCards[1] = hero[1];

    let gen = null;
    if (stats.exact) gen = exactGen();

    function* exactGen() {
      const n = deck.length;
      const idx = [];
      const used = new Uint8Array(52);
      function* boards(start, depth) {
        if (depth === missing) { yield true; return; }
        for (let i = start; i < n; i++) {
          idx[depth] = deck[i]; used[deck[i]] = 1;
          yield* boards(i + 1, depth + 1);
          used[deck[i]] = 0;
        }
      }
      for (const _ of boards(0, 0)) {
        for (let j = 0; j < missing; j++) { heroCards[2 + board.length + j] = idx[j]; oppCards[2 + board.length + j] = idx[j]; }
        const hs = evaluate(heroCards, 7);
        for (let a = 0; a < n; a++) {
          const ca = deck[a]; if (used[ca]) continue;
          for (let b = a + 1; b < n; b++) {
            const cb = deck[b]; if (used[cb]) continue;
            oppCards[0] = ca; oppCards[1] = cb;
            opp[0] = evaluate(oppCards, 7);
            record(stats, hs, opp, 1);
          }
        }
        yield;
      }
    }

    const work = deck.slice();
    function mcTrial() {
      const need = missing + 2 * opponents;
      const len = work.length;
      for (let i = 0; i < need; i++) {
        const j = i + Math.floor(Math.random() * (len - i));
        const t = work[i]; work[i] = work[j]; work[j] = t;
      }
      let k = 0;
      for (let j = 0; j < missing; j++) { const c = work[k++]; heroCards[2 + board.length + j] = c; oppCards[2 + board.length + j] = c; }
      const hs = evaluate(heroCards, 7);
      for (let o = 0; o < opponents; o++) {
        oppCards[0] = work[k++]; oppCards[1] = work[k++];
        opp[o] = evaluate(oppCards, 7);
      }
      record(stats, hs, opp, opponents);
    }

    const job = {
      stats, done: false,
      step(n) {
        if (job.done) return;
        if (gen) {
          const target = stats.trials + n;
          while (stats.trials < target) { if (gen.next().done) { job.done = true; break; } }
        } else {
          const left = Math.min(n, p.total - stats.trials);
          for (let i = 0; i < left; i++) mcTrial();
          if (stats.trials >= p.total) job.done = true;
        }
      },
    };
    return job;
  }

  function runEquity(hero, board, opponents) {
    const job = createEquityJob(hero, board, opponents);
    while (!job.done) job.step(50000);
    return job.stats;
  }

  /**
   * Outs on flop/turn: unseen cards that improve the hero's hand category
   * in a way that uses at least one hole card (i.e. not just improving the board).
   */
  function computeOuts(hero, board) {
    if (board.length < 3 || board.length > 4) return null;
    const known = hero.concat(board);
    const deck = remainingDeck(known);
    const current = evaluate(known);
    const curCat = categoryOf(current);
    const groups = new Map();
    const outs = [];
    for (const c of deck) {
      const withCard = evaluate(known.concat(c));
      const cat = categoryOf(withCard);
      if (cat <= curCat) continue;
      const boardCat = categoryOf(evaluate(board.concat(c)));
      if (cat <= boardCat) continue; // improvement is shared by everyone via the board
      outs.push(c);
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat).push(c);
    }
    const unseen = deck.length;
    const o = outs.length;
    const nextCard = o / unseen;
    const byRiver = board.length === 3 ? 1 - ((unseen - o) / unseen) * ((unseen - 1 - o) / (unseen - 1)) : nextCard;
    return {
      current, curCat, unseen, outs, nextCard, byRiver,
      groups: [...groups.entries()].sort((a, b) => b[0] - a[0]).map(([cat, cards]) => ({ cat, cards })),
      ruleOf: board.length === 3 ? Math.min(o * 4, 100) : Math.min(o * 2, 100),
    };
  }

  // Probability that a random 2-card hand (exact combos) is dealt
  function preflopInfo(hero) {
    const r1 = rankOf(hero[0]), r2 = rankOf(hero[1]);
    const hi = Math.max(r1, r2), lo = Math.min(r1, r2);
    const suited = suitOf(hero[0]) === suitOf(hero[1]);
    const name = RANKS[hi] + RANKS[lo] + (hi === lo ? '' : suited ? 's' : 'o');
    const combosCount = hi === lo ? 6 : suited ? 4 : 12;
    return { name, pair: hi === lo, suited, combos: combosCount, prob: combosCount / 1326 };
  }

  const api = {
    RANKS, SUITS, SUIT_SYMBOL, CATEGORIES, RANK_NAME_PT,
    card, rankOf, suitOf, cardLabel, parseCard, evaluate, categoryOf, describe,
    combos, remainingDeck, plan, createEquityJob, runEquity, computeOuts, preflopInfo,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Poker = api;
})(typeof self !== 'undefined' ? self : this);
