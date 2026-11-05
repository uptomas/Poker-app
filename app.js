(function () {
  'use strict';
  const P = window.Poker;
  const $ = (id) => document.getElementById(id);
  const fmtPct = (x, d = 1) => (x * 100).toLocaleString('pt-PT', { minimumFractionDigits: d, maximumFractionDigits: d }) + '%';
  const fmtNum = (n) => Math.round(n).toLocaleString('pt-PT');
  const SLOT_ORDER = ['h0', 'h1', 'b0', 'b1', 'b2', 'b3', 'b4'];
  const SUIT_ROWS = [0, 1, 2, 3]; // s h d c
  const isRed = (c) => { const s = P.suitOf(c); return s === 1 || s === 2; };

  const state = {
    slots: { h0: null, h1: null, b0: null, b1: null, b2: null, b3: null, b4: null },
    players: 2,
    active: null,
    job: null,
    stats: null,
    outs: null,
    tab: 'mine',
    acts: Array(9).fill('in'), // per opponent seat: 'in' | 'bet' | 'fold'
    bluff: 0.3,
    potMode: 'call',
    baseline: null, // equity info for comparison (everyone in / random hands)
  };
  const ACT_NEXT = { in: 'bet', bet: 'fold', fold: 'in' };
  const ACT_LABEL = { in: 'em jogo', bet: 'apostou', fold: 'fold' };
  const countActs = () => {
    const acts = state.acts.slice(0, state.players - 1);
    return { total: acts.length, fold: acts.filter((x) => x === 'fold').length, bet: acts.filter((x) => x === 'bet').length,
      active: acts.filter((x) => x !== 'fold').length };
  };

  // ---------- persistence (per-viewer convenience only) ----------
  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem('oddslab') || '{}');
      if (saved.players >= 2 && saved.players <= 10) state.players = saved.players;
      if (saved.pot != null) $('potSize').value = saved.pot;
      if (saved.call != null) $('callSize').value = saved.call;
      if (saved.bluff != null) state.bluff = saved.bluff;
      if (saved.bluffPot != null) $('bluffPot').value = saved.bluffPot;
      if (saved.bluffBet != null) $('bluffBet').value = saved.bluffBet;
      if (saved.fold != null) $('foldRange').value = saved.fold;
    } catch (e) { /* ignore */ }
  }
  function save() {
    try {
      localStorage.setItem('oddslab', JSON.stringify({
        players: state.players, pot: $('potSize').value, call: $('callSize').value, bluff: state.bluff,
        bluffPot: $('bluffPot').value, bluffBet: $('bluffBet').value, fold: $('foldRange').value,
      }));
    } catch (e) { /* ignore */ }
  }

  // ---------- rendering helpers ----------
  function cardHTML(c, mini) {
    const r = P.RANKS[P.rankOf(c)].replace('T', '10');
    const s = P.SUIT_SYMBOL[P.SUITS[P.suitOf(c)]];
    return `<div class="pcard${mini ? ' mini' : ''}${isRed(c) ? ' red' : ''}">${mini ? '' : `<span class="corner">${r}<span>${s}</span></span>`}<span class="r">${r}</span><span class="s">${s}</span></div>`;
  }
  function textCard(c) {
    const r = P.RANKS[P.rankOf(c)].replace('T', '10');
    return `<span class="tc${isRed(c) ? ' red' : ''}">${r}${P.SUIT_SYMBOL[P.SUITS[P.suitOf(c)]]}</span>`;
  }
  const hero = () => [state.slots.h0, state.slots.h1].filter((c) => c != null);
  const board = () => ['b0', 'b1', 'b2', 'b3', 'b4'].map((k) => state.slots[k]).filter((c) => c != null);
  const usedCards = () => SLOT_ORDER.map((k) => state.slots[k]).filter((c) => c != null);

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  function phaseName(n) {
    return n === 0 ? 'Pré-flop' : n < 3 ? 'Flop incompleto' : n === 3 ? 'Flop' : n === 4 ? 'Turn' : 'River';
  }

  // ---------- table ----------
  const prevSlot = {};
  function renderSlots() {
    document.querySelectorAll('.slot').forEach((el) => {
      const k = el.dataset.slot;
      const c = state.slots[k];
      if (prevSlot[k] !== c) {
        el.innerHTML = c == null ? '' : cardHTML(c);
        prevSlot[k] = c;
      }
      el.classList.toggle('filled', c != null);
      el.classList.toggle('active', state.active === k);
      el.setAttribute('aria-label', c == null ? 'Escolher carta' : 'Carta ' + P.cardLabel(c));
    });
    const pill = $('phasePill');
    const text = hero().length < 2 ? 'Escolhe a tua mão' : phaseName(board().length);
    if (pill.textContent !== text) {
      pill.textContent = text;
      pill.classList.remove('bump'); void pill.offsetWidth; pill.classList.add('bump');
    }
    $('dealNext').disabled = board().length >= 5;
  }

  function renderSeats() {
    const wrap = $('seats');
    const n = state.players - 1;
    const existing = [...wrap.children].filter((s) => !s.classList.contains('leaving'));
    existing.forEach((el, i) => { if (i >= n) { el.classList.add('leaving'); setTimeout(() => el.remove(), 260); } });
    for (let i = existing.length; i < n; i++) {
      const el = document.createElement('button');
      el.className = 'seat';
      el.dataset.i = i;
      el.innerHTML = `<div class="backs"><div class="back"></div><div class="back"></div></div><div class="who">J${i + 2}</div>`;
      el.addEventListener('click', () => cycleSeat(i));
      wrap.appendChild(el);
    }
    for (let i = n; i < 9; i++) state.acts[i] = 'in';
    renderSeatActs();
    [...wrap.children].filter((s) => !s.classList.contains('leaving')).forEach((el, i) => {
      // Opponents sit along the top rail, in a gentle arc above the board.
      const t = n === 1 ? 0.5 : i / (n - 1);
      const spread = Math.min(76, 18 + n * 8);
      el.style.left = 50 - spread / 2 + spread * t + '%';
      el.style.top = 30 + 16 * Math.pow(2 * t - 1, 2) + 'px';
    });
    const out = $('playersOut');
    out.textContent = state.players;
    out.classList.remove('flash'); void out.offsetWidth; out.classList.add('flash');
    $('playersMinus').disabled = state.players <= 2;
    $('playersPlus').disabled = state.players >= 10;
  }

  function renderSeatActs() {
    [...$('seats').children].filter((s) => !s.classList.contains('leaving')).forEach((el, i) => {
      const act = state.acts[i];
      el.classList.toggle('bet', act === 'bet');
      el.classList.toggle('fold', act === 'fold');
      let badge = el.querySelector('.badge');
      if (act === 'in') { if (badge) badge.remove(); }
      else {
        if (!badge) { badge = document.createElement('span'); badge.className = 'badge'; el.appendChild(badge); }
        const text = act === 'bet' ? 'APOSTOU' : 'FOLD';
        if (badge.textContent !== text) { badge.textContent = text; badge.style.animation = 'none'; void badge.offsetWidth; badge.style.animation = ''; }
      }
      el.setAttribute('aria-label', `Jogador ${i + 2}: ${ACT_LABEL[act]}. Toca para mudar.`);
    });
    const c = countActs();
    const box = $('actionBox');
    box.hidden = !(c.fold || c.bet);
    $('bluffBox').hidden = !c.bet;
    if (c.fold || c.bet) {
      const parts = [];
      parts.push(`<span class="tag in">${c.active} em jogo</span>`);
      if (c.bet) parts.push(`<span class="tag bet">${c.bet} ${c.bet === 1 ? 'apostou' : 'apostaram'}</span>`);
      if (c.fold) parts.push(`<span class="tag fold">${c.fold} fold</span>`);
      $('actionSummary').innerHTML = parts.join(' ') + (c.active === 0 ? '<div class="hint" style="margin-top:6px">Ganhaste o pote sem showdown.</div>' :
        `<div class="hint" style="margin-top:6px">A calcular contra ${c.active} ${c.active === 1 ? 'adversário' : 'adversários'}${c.bet ? `, ${c.bet} com mão forte ou bluff` : ''}.</div>`);
    }
    $('bluffOut').textContent = Math.round(state.bluff * 100) + '%';
    $('bluffRange').value = Math.round(state.bluff * 100);
  }

  function cycleSeat(i) {
    state.acts[i] = ACT_NEXT[state.acts[i]];
    renderSeatActs();
    scheduleCalc();
  }

  // ---------- picker ----------
  function buildPicker() {
    const picker = $('picker');
    picker.innerHTML = SUIT_ROWS.map((s) => {
      let row = '<div class="pick-row">';
      for (let r = 12; r >= 0; r--) {
        const c = P.card(r, s);
        row += `<button class="pick${isRed(c) ? ' red' : ''}" data-card="${c}" aria-label="${P.cardLabel(c)}">${P.RANKS[r].replace('T', '10')}<span class="ps">${P.SUIT_SYMBOL[P.SUITS[s]]}</span></button>`;
      }
      return row + '</div>';
    }).join('');
    picker.addEventListener('click', (e) => {
      const b = e.target.closest('.pick');
      if (b) pickCard(Number(b.dataset.card));
    });
  }

  function slotTitle(k) {
    return {
      h0: 'A tua 1.ª carta', h1: 'A tua 2.ª carta', b0: 'Flop — 1.ª carta', b1: 'Flop — 2.ª carta',
      b2: 'Flop — 3.ª carta', b3: 'Turn', b4: 'River',
    }[k];
  }

  function refreshPicker() {
    const used = new Set(usedCards());
    const cur = state.slots[state.active];
    document.querySelectorAll('.pick').forEach((b) => {
      const c = Number(b.dataset.card);
      b.classList.toggle('used', used.has(c) && c !== cur);
      b.classList.toggle('current', c === cur);
    });
    $('sheetTitle').textContent = slotTitle(state.active);
    $('removeCard').hidden = cur == null;
  }

  function openSlot(k) {
    // Board must be dealt in order: redirect to the first empty board slot.
    if (k[0] === 'b' && state.slots[k] == null) {
      const firstEmpty = ['b0', 'b1', 'b2', 'b3', 'b4'].find((x) => state.slots[x] == null);
      k = firstEmpty;
    }
    state.active = k;
    $('sheet').hidden = false; $('sheetBackdrop').hidden = false;
    $('sheet').classList.remove('closing');
    refreshPicker();
    renderSlots();
  }

  function closeSheet() {
    if ($('sheet').hidden) return;
    state.active = null;
    $('sheet').classList.add('closing');
    setTimeout(() => { $('sheet').hidden = true; $('sheetBackdrop').hidden = true; }, 200);
    renderSlots();
  }

  // After choosing a card, move to the next slot of the same street; close at the end of a street.
  const NEXT = { h0: 'h1', h1: null, b0: 'b1', b1: 'b2', b2: null, b3: null, b4: null };
  function pickCard(c) {
    const k = state.active;
    if (!k) return;
    state.slots[k] = c;
    let next = NEXT[k];
    while (next && state.slots[next] != null) next = NEXT[next];
    if (next) { state.active = next; refreshPicker(); renderSlots(); }
    else closeSheet();
    scheduleCalc();
  }

  function removeActive() {
    if (!state.active) return;
    state.slots[state.active] = null;
    refreshPicker(); renderSlots(); scheduleCalc();
  }

  // ---------- quick actions ----------
  function randomFromDeck(n) {
    const deck = P.remainingDeck(usedCards());
    const out = [];
    for (let i = 0; i < n; i++) out.push(deck.splice(Math.floor(Math.random() * deck.length), 1)[0]);
    return out;
  }
  function randomHand() {
    Object.keys(state.slots).forEach((k) => (state.slots[k] = null));
    state.acts.fill('in');
    renderSeatActs();
    const [a, b] = randomFromDeck(2);
    state.slots.h0 = a; state.slots.h1 = b;
    renderSlots(); scheduleCalc();
  }
  function dealNext() {
    if (hero().length < 2) {
      ['h0', 'h1'].forEach((k) => { if (state.slots[k] == null) state.slots[k] = randomFromDeck(1)[0]; });
    } else {
      const empties = ['b0', 'b1', 'b2', 'b3', 'b4'].filter((k) => state.slots[k] == null);
      if (!empties.length) return;
      const take = board().length < 3 ? empties.filter((k) => k <= 'b2') : [empties[0]];
      const cards = randomFromDeck(take.length);
      take.forEach((k, i) => (state.slots[k] = cards[i]));
    }
    renderSlots(); scheduleCalc();
  }
  function clearAll() {
    Object.keys(state.slots).forEach((k) => (state.slots[k] = null));
    state.acts.fill('in');
    renderSeatActs();
    renderSlots(); scheduleCalc();
  }

  // ---------- calculation ----------
  let calcTimer = null;
  function scheduleCalc() {
    clearTimeout(calcTimer);
    calcTimer = setTimeout(calc, 120);
  }

  function calc() {
    if (state.job) state.job.cancelled = true;
    const h = hero(), b = board();
    const acts = countActs();
    $('allFolded').hidden = true;
    if (h.length < 2) {
      state.stats = null; state.outs = null;
      $('emptyState').hidden = false; $('result').hidden = true;
      ['outsPanel', 'distPanel', 'explainPanel'].forEach((id) => ($(id).hidden = true));
      renderPot();
      return;
    }
    if (acts.active === 0) {
      state.stats = null; state.outs = null;
      $('emptyState').hidden = true; $('result').hidden = true; $('allFolded').hidden = false;
      ['outsPanel', 'distPanel', 'explainPanel'].forEach((id) => ($(id).hidden = true));
      renderPot();
      return;
    }
    $('emptyState').hidden = true; $('result').hidden = false;
    renderCurrentHand(h, b);
    state.outs = P.computeOuts(h, b);
    renderOuts();

    // Bettors are the first opponents passed to the engine: their hands come from a range.
    const job = P.createEquityJob(h, b, acts.active, { bettors: acts.bet, bluff: state.bluff });
    state.job = job;
    state.baseline = null;
    $('progress').classList.remove('done');
    const loop = () => {
      if (job.cancelled) return;
      const t0 = performance.now();
      while (!job.done && performance.now() - t0 < 14) job.step(job.stats.exact ? 4000 : 2500);
      state.stats = job.stats;
      renderEquity();
      $('progressBar').style.width = Math.min(100, (job.stats.trials / job.stats.planned) * 100) + '%';
      if (job.done) {
        $('progress').classList.add('done');
        if (acts.fold || acts.bet) state.baseline = computeBaseline(h, b, acts);
        renderDist(); renderExplain(); renderPot();
      } else requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // Quick comparison runs: everyone still in with random hands, and the active players with random hands.
  function computeBaseline(h, b, acts) {
    const quick = (opp) => {
      const j = P.createEquityJob(h, b, opp, { forceMC: true, trials: 20000 });
      while (!j.done) j.step(20000);
      return j.stats.equity / j.stats.trials;
    };
    return {
      all: acts.fold ? quick(acts.total) : null,
      randomActive: acts.bet ? quick(acts.active) : null,
    };
  }

  function renderCurrentHand(h, b) {
    const el = $('currentHand');
    let name, hint;
    if (b.length === 0) {
      const info = P.preflopInfo(h);
      name = info.name.replace(/T/g, '10') + (info.pair ? ' — par na mão' : info.suited ? ' — do mesmo naipe' : ' — naipes diferentes');
      hint = `Há ${info.combos} combinações destas em 1326 mãos possíveis (${fmtPct(info.prob, 2)}).`;
    } else {
      const score = P.evaluate(h.concat(b));
      name = P.describe(score);
      hint = b.length < 3 ? 'Ainda faltam cartas do flop.' : phaseName(b.length) + ' · melhor combinação de 5 cartas';
    }
    if (el.textContent !== name) {
      el.textContent = name;
      el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    }
    $('currentHint').textContent = hint;
  }

  const CIRC = 2 * Math.PI * 84;
  let shownEquity = 0;
  function animateNumber(el, to) {
    const from = shownEquity;
    shownEquity = to;
    cancelAnimationFrame(animateNumber.raf);
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / 450);
      const v = from + (to - from) * (1 - Math.pow(1 - t, 3));
      el.textContent = v.toLocaleString('pt-PT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
      if (t < 1) animateNumber.raf = requestAnimationFrame(step);
    };
    animateNumber.raf = requestAnimationFrame(step);
  }

  function verdictFor(eq, players) {
    const ratio = eq * players;
    if (ratio >= 2.2 || eq >= 0.8) return ['Monstro 🔥', 4];
    if (ratio >= 1.4) return ['Forte 💪', 3];
    if (ratio >= 1.0) return ['Acima da média', 2];
    if (ratio >= 0.7) return ['Marginal 🤔', 1];
    return ['Fraca', 0];
  }

  function renderEquity() {
    const s = state.stats;
    if (!s || !s.trials) return;
    const eq = s.equity / s.trials;
    const win = s.wins / s.trials, tie = s.ties / s.trials, lose = s.losses / s.trials;
    animateNumber($('equityValue'), eq * 100);
    $('gaugeBar').style.strokeDashoffset = CIRC * (1 - eq);
    const inHand = countActs().active + 1;
    const fair = 1 / inHand;
    $('gaugeFair').style.strokeDashoffset = -CIRC * fair + 1;
    const [vText, vClass] = verdictFor(eq, inHand);
    const v = $('verdict');
    v.textContent = vText; v.className = 'verdict v' + vClass;
    $('segWin').style.width = win * 100 + '%';
    $('segTie').style.width = tie * 100 + '%';
    $('segLose').style.width = lose * 100 + '%';
    $('pWin').textContent = fmtPct(win); $('pTie').textContent = fmtPct(tie); $('pLose').textContent = fmtPct(lose);
    const ratio = eq / fair;
    $('fairLine').innerHTML = `Com ${inHand} jogadores na mão, a tua “parte justa” seria <b>${fmtPct(fair)}</b> (marca branca no círculo). ` +
      (ratio >= 1 ? `Estás <b>${ratio.toLocaleString('pt-PT', { maximumFractionDigits: 1 })}×</b> acima disso.` : `Estás abaixo: <b>${ratio.toLocaleString('pt-PT', { maximumFractionDigits: 2 })}×</b>.`);
  }

  function renderOuts() {
    const o = state.outs;
    const panel = $('outsPanel');
    if (!o) { panel.hidden = true; return; }
    panel.hidden = false;
    const n = o.outs.length;
    $('outsCount').textContent = n + (n === 1 ? ' out' : ' outs');
    const onFlop = hero().length === 2 && board().length === 3;
    $('outsIntro').innerHTML = n
      ? `Há <b>${n}</b> cartas, das <b>${o.unseen}</b> que não vês, que melhoram a tua mão (${P.CATEGORIES[o.curCat].name.toLowerCase()} → algo melhor).`
      : `Nenhuma carta melhora a categoria da tua mão (${P.CATEGORIES[o.curCat].name.toLowerCase()}). A tua equity depende de já estares à frente.`;
    $('outsNext').textContent = fmtPct(o.nextCard);
    $('outsNextLabel').textContent = onFlop ? 'no turn' : 'no river';
    $('outsRiverBox').hidden = !onFlop;
    $('outsRiver').textContent = fmtPct(o.byRiver);
    $('outsRule').textContent = o.ruleOf + '%';
    $('outsRuleLabel').textContent = onFlop ? 'regra do 4 (outs×4)' : 'regra do 2 (outs×2)';
    $('outsGroups').innerHTML = o.groups.map((g) => `
      <div>
        <div class="out-group-head"><span><b>${P.CATEGORIES[g.cat].name}</b> ${g.cat <= 1 ? '<span class="weak">· out fraco</span>' : ''}</span><span>${g.cards.length} ${g.cards.length === 1 ? 'carta' : 'cartas'}</span></div>
        <div class="out-cards">${g.cards.map((c, i) => cardHTML(c, true).replace('class="pcard', `style="animation-delay:${i * 30}ms" class="pcard`)).join('')}</div>
      </div>`).join('');
  }

  function renderDist() {
    const s = state.stats;
    if (!s) return;
    $('distPanel').hidden = false;
    const beaten = state.tab === 'beaten';
    const arr = beaten ? s.beatenBy : s.heroCats;
    $('distIntro').textContent = beaten
      ? `Quando perdes (${fmtPct(s.losses / s.trials)} das vezes), com que mão te ganham?`
      : board().length === 5 ? 'A mesa está completa: esta é a tua mão final.' : 'Probabilidade de acabares a mão (no river) com cada jogo.';
    const dist = $('dist');
    dist.classList.toggle('beaten', beaten);
    const rows = [];
    for (let c = 8; c >= 0; c--) {
      const p = arr[c] / s.trials;
      rows.push(`<div class="drow${p === 0 ? ' zero' : ''}"><span class="name">${P.CATEGORIES[c].name}</span><div class="track"><div class="fill" data-w="${p * 100}"></div></div><span class="pct">${p > 0 && p < 0.001 ? '<0,1%' : fmtPct(p)}</span></div>`);
    }
    dist.innerHTML = rows.join('');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      dist.querySelectorAll('.fill').forEach((f) => (f.style.width = Math.max(f.dataset.w > 0 ? 1.5 : 0, f.dataset.w) + '%'));
    }));
  }

  function bigNumber(log10) {
    if (log10 < 9) return fmtNum(Math.pow(10, log10));
    const exp = Math.floor(log10);
    const mant = Math.pow(10, log10 - exp);
    const sup = String(exp).split('').map((d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[d]).join('');
    return `≈ ${mant.toLocaleString('pt-PT', { maximumFractionDigits: 1 })} × 10${sup}`;
  }
  const log10C = (n, k) => { let s = 0; for (let i = 1; i <= k; i++) s += Math.log10((n - k + i) / i); return s; };
  function oddsAgainst(p) {
    if (p <= 0) return '—';
    if (p >= 1) return 'certo';
    return ((1 - p) / p).toLocaleString('pt-PT', { maximumFractionDigits: 1 }) + ' para 1';
  }

  function renderExplain() {
    const s = state.stats;
    if (!s) return;
    $('explainPanel').hidden = false;
    const h = hero(), b = board();
    const acts = countActs(), opp = acts.active;
    const known = h.length + b.length, unknown = 52 - known, missing = 5 - b.length;
    const eq = s.equity / s.trials;
    const steps = [];

    steps.push(`<strong>O que já se sabe</strong>
      Vês ${known} cartas: as tuas (${h.map(textCard).join(' ')})${b.length ? ` e a mesa (${b.map(textCard).join(' ')})` : ''}.
      Restam <b>${unknown}</b> cartas desconhecidas no baralho. Faltam sair <b>${missing}</b> ${missing === 1 ? 'carta' : 'cartas'} na mesa
      e cada um dos <b>${opp}</b> ${opp === 1 ? 'adversário ainda em jogo tem' : 'adversários ainda em jogo tem'} 2 cartas escondidas.`);

    const base = state.baseline;
    if (acts.fold) {
      steps.push(`<strong>Quem desistiu já não conta</strong>
        Estavam ${acts.total} adversários e <b>${acts.fold}</b> ${acts.fold === 1 ? 'fez' : 'fizeram'} fold, por isso calculo só contra <b>${opp}</b>.
        Quem desiste não pode ganhar o pote, e cada adversário a menos é uma mão a menos que te pode bater.
        ${base && base.all != null ? `<span class="formula">Com todos em jogo: ${fmtPct(base.all)} → com ${opp} ${opp === 1 ? 'adversário' : 'adversários'}: ${fmtPct(eq)}</span>` : ''}
        As cartas de quem desistiu ficam fora do jogo, mas ninguém as viu, por isso não mudam as contas.`);
    }
    if (acts.bet && s.range) {
      const strongPct = s.range.strong / s.range.total;
      const desc = b.length < 3
        ? 'as ~18% melhores mãos iniciais (pares médios e altos, ases fortes, figuras do mesmo naipe…)'
        : 'top pair ou melhor (usando pelo menos uma carta da mão) ou um projeto forte de cor ou sequência';
      steps.push(`<strong>Quem apostou: mão forte ou bluff?</strong>
        ${acts.bet === 1 ? 'Um adversário apostou' : `${acts.bet} adversários apostaram`}. Quem aposta normalmente tem uma mão forte, mas às vezes está a fazer bluff.
        Das ${fmtNum(s.range.total)} mãos possíveis, <b>${fmtNum(s.range.strong)}</b> (${fmtPct(strongPct)}) contam como “fortes”: ${desc}.
        <span class="formula">Em cada cenário: ${fmtPct(1 - s.bluff, 0)} das vezes recebe uma mão forte · ${fmtPct(s.bluff, 0)} das vezes uma mão fraca (bluff)</span>
        ${base && base.randomActive != null ? `<span class="formula">Contra mãos aleatórias: ${fmtPct(base.randomActive)} → contando com a aposta: ${fmtPct(eq)}</span>` : ''}
        ${base && base.randomActive != null && eq < base.randomActive - 0.02 ? 'A aposta dele baixa as tuas hipóteses: as mãos que apostam são mais fortes do que a média.' : ''}
        ${base && base.randomActive != null && eq > base.randomActive + 0.02 ? 'Com esta taxa de bluff, a tua mão até ganha valor: bates muitos dos bluffs.' : ''}
        Muda a percentagem de bluff no slider da mesa para veres o efeito.`);
    }

    if (s.exact) {
      const boards = P.combos(unknown, missing), hands = P.combos(unknown - missing, 2);
      steps.push(`<strong>Contagem exata de todos os cenários</strong>
        Com 1 adversário dá para testar <b>todas</b> as possibilidades: as maneiras de completar a mesa × as mãos possíveis do adversário.
        <span class="formula">C(${unknown},${missing}) × C(${unknown - missing},2) = ${fmtNum(boards)} × ${fmtNum(hands)} = ${fmtNum(s.trials)} cenários</span>
        O resultado é exato, sem margem de erro.`);
    } else {
      let lg = log10C(unknown, missing);
      for (let i = 0; i < opp; i++) lg += log10C(unknown - missing - 2 * i, 2);
      const moe = 1.96 * Math.sqrt((eq * (1 - eq)) / s.trials);
      steps.push(`<strong>Simulação de Monte Carlo</strong>
        Há ${bigNumber(lg)} maneiras de distribuir as cartas que faltam — demasiadas para contar uma a uma.
        Então “joguei” a mão <b>${fmtNum(s.trials)}</b> vezes ao acaso: em cada uma baralhei o resto do baralho,
        completei a mesa e dei 2 cartas a cada adversário.
        <span class="formula">margem de erro (95%) = 1,96 × √(p(1−p)/N) = ±${fmtPct(moe, 2)}</span>`);
    }

    steps.push(`<strong>Quem ganha em cada cenário</strong>
      Para cada jogador escolho a melhor mão de 5 cartas entre as 7 disponíveis (2 dele + 5 da mesa) e comparo:
      primeiro a categoria (par, trio, cor…), depois os kickers.
      <span class="formula">Ganhaste ${fmtNum(s.wins)} · Empataste ${fmtNum(s.ties)} · Perdeste ${fmtNum(s.losses)}</span>`);

    steps.push(`<strong>Equity = a tua fatia do pote a longo prazo</strong>
      Cada vitória vale 1 pote; num empate o pote é dividido pelos jogadores empatados.
      <span class="formula">Equity = (vitórias + empates partilhados) ÷ cenários = ${fmtNum(s.equity)} ÷ ${fmtNum(s.trials)} = ${fmtPct(eq, 2)}</span>
      Em odds: ${oddsAgainst(eq)} contra ti. Se jogasses esta situação 100 vezes, ganharias cerca de ${Math.round(eq * 100)} potes.`);

    steps.push(`<strong>Comparar com a parte justa</strong>
      Com ${opp + 1} jogadores na mão, se todos fossem iguais cada um teria 1/${opp + 1} = ${fmtPct(1 / (opp + 1))}.
      A tua equity é <b>${(eq * (opp + 1)).toLocaleString('pt-PT', { maximumFractionDigits: 2 })}×</b> isso.
      ${opp + 1 > 2 ? 'Repara: quanto mais jogadores, mais difícil é ganhar — até as melhores mãos perdem força.' : ''}`);

    const o = state.outs;
    if (o && o.outs.length) {
      const U = o.unseen, n = o.outs.length;
      const onFlop = b.length === 3;
      steps.push(`<strong>Outs: as cartas que te ajudam</strong>
        Tens <b>${n}</b> outs em ${U} cartas por ver.
        <span class="formula">Próxima carta: ${n} ÷ ${U} = ${fmtPct(o.nextCard)}</span>
        ${onFlop ? `<span class="formula">Até ao river: 1 − (${U - n}/${U}) × (${U - 1 - n}/${U - 1}) = ${fmtPct(o.byRiver)}</span>` : ''}
        Atalho mental: <b>regra do ${onFlop ? '4' : '2'}</b> → ${n} × ${onFlop ? 4 : 2} ≈ ${o.ruleOf}%.
        Atenção: nem todos os outs garantem a vitória (um adversário pode ter uma mão ainda melhor) — por isso a equity é a medida mais fiel.`);
    }

    steps.push(`<strong>Limitação</strong>
      ${acts.bet ? 'A definição de “mão forte” é uma aproximação: cada jogador é diferente. Jogadores cautelosos fazem menos bluff (usa 10–20%); jogadores agressivos fazem mais (40%+).' : 'Os adversários que não marcaste são tratados como tendo mãos aleatórias. Se alguém apostar, marca-o na mesa: quem aposta costuma ter mãos melhores do que a média.'}`);

    $('steps').innerHTML = steps.map((t, i) => `<li style="animation-delay:${i * 70}ms">${t}</li>`).join('');
  }

  function renderPot() {
    save();
    renderBluff();
    const pot = parseFloat($('potSize').value), call = parseFloat($('callSize').value);
    const el = $('potResult');
    if (!(pot > 0) || !(call > 0)) {
      el.innerHTML = '<p class="muted">Introduz o pote e o valor a pagar para saberes se a chamada é lucrativa a longo prazo.</p>';
      return;
    }
    const need = call / (pot + call);
    const ratio = (pot / call).toLocaleString('pt-PT', { maximumFractionDigits: 1 });
    const s = state.stats;
    if (!s || !s.trials) {
      el.innerHTML = `<div class="pot-lines">O pote paga <b>${ratio} : 1</b>. Precisas de ganhar pelo menos <b>${fmtPct(need)}</b> das vezes para a chamada compensar. Escolhe a tua mão para comparar com a tua equity.</div>`;
      return;
    }
    const eq = s.equity / s.trials;
    const ev = eq * (pot + call) - call;
    const good = eq >= need;
    el.innerHTML = `
      <div class="verdict-box ${good ? 'good' : 'bad'}">
        <div class="big">${good ? '✅ Pagar é lucrativo' : '❌ Desistir é melhor'}</div>
        <div class="hint">EV da chamada: <b>${ev >= 0 ? '+' : ''}${ev.toLocaleString('pt-PT', { maximumFractionDigits: 2 })}</b> por mão, em média</div>
      </div>
      <div class="pot-compare"><div class="eq" style="width:${eq * 100}%"></div><div class="need" style="left:${need * 100}%;--lx:${need < 0.12 ? '-10%' : need > 0.88 ? '-90%' : '-50%'}" data-label="precisas ${fmtPct(need, 0)}"></div></div>
      <div class="pot-lines">
        Equity necessária = pagar ÷ (pote + pagar) = ${call} ÷ ${pot + call} = <b>${fmtPct(need)}</b><br>
        A tua equity = <b>${fmtPct(eq)}</b> ${good ? '≥' : '<'} ${fmtPct(need)}<br>
        EV = equity × (pote + pagar) − pagar = ${fmtPct(eq)} × ${pot + call} − ${call} = <b>${ev.toLocaleString('pt-PT', { maximumFractionDigits: 2 })}</b><br>
        Se a tua mão só ganha quando ele está a fazer bluff, ele tem de fazer bluff em pelo menos <b>${fmtPct(need)}</b> das vezes para pagar compensar.
      </div>`;
  }

  // Bluff calculator: how often must they fold for my bet to be profitable?
  function renderBluff() {
    const pot = parseFloat($('bluffPot').value), bet = parseFloat($('bluffBet').value);
    const F = Number($('foldRange').value) / 100;
    $('foldOut').textContent = Math.round(F * 100) + '%';
    const el = $('bluffResult');
    if (!(pot > 0) || !(bet > 0)) {
      el.innerHTML = '<p class="muted">Introduz o pote e quanto queres apostar para saberes quantas vezes os adversários têm de desistir para o bluff compensar.</p>';
      return;
    }
    const needPure = bet / (pot + bet);
    const s = state.stats;
    const live = s && s.trials && board().length < 5;
    const eq = s && s.trials ? s.equity / s.trials : 0;
    // If called, you still win `eq` of the pot (semi-bluff): pot + your bet + their call.
    const ifCalled = live ? eq * (pot + 2 * bet) - bet : -bet;
    const ev = F * pot + (1 - F) * ifCalled;
    const need = ifCalled >= 0 ? 0 : -ifCalled / (pot - ifCalled);
    const good = ev > 0;
    const n2 = (x) => x.toLocaleString('pt-PT', { maximumFractionDigits: 2 });
    el.innerHTML = `
      <div class="verdict-box ${good ? 'good' : 'bad'}">
        <div class="big">${good ? '✅ O bluff compensa' : '❌ O bluff perde dinheiro'}</div>
        <div class="hint">EV da aposta: <b>${ev >= 0 ? '+' : ''}${n2(ev)}</b> por mão, em média, se desistirem ${fmtPct(F, 0)} das vezes</div>
      </div>
      <div class="pot-compare"><div class="eq" style="width:${F * 100}%"></div><div class="need" style="left:${need * 100}%;--lx:${need < 0.12 ? '-10%' : need > 0.88 ? '-90%' : '-50%'}" data-label="precisas ${fmtPct(need, 0)}"></div></div>
      <div class="pot-lines">
        Bluff puro (se pagarem, perdes): têm de desistir em pelo menos aposta ÷ (pote + aposta) = ${bet} ÷ ${pot + bet} = <b>${fmtPct(needPure)}</b> das vezes.<br>
        ${live ? `Semi-bluff: mesmo que paguem, ainda ganhas ${fmtPct(eq)} das vezes, por isso só precisas que desistam <b>${fmtPct(need)}</b> das vezes. (Conta com cuidado: quem paga costuma ter uma mão melhor do que a média, por isso na prática precisas de um pouco mais.)<br>` : board().length === 5 && s ? 'No river já não há cartas por sair: se pagarem, só ganhas se a tua mão já for a melhor.<br>' : ''}
        EV = desistem × pote + pagam × (resultado se pagarem) = ${fmtPct(F, 0)} × ${pot} + ${fmtPct(1 - F, 0)} × ${n2(ifCalled)} = <b>${n2(ev)}</b>
      </div>`;
  }

  // ---------- rankings ----------
  function renderRankings() {
    const ex = {
      8: 'Ts Js Qs Ks As', 7: '9h 9d 9s 9c Kd', 6: 'Qh Qd Qc 7s 7d', 5: '2h 6h 9h Jh Ah', 4: '5c 6d 7h 8s 9c',
      3: '8s 8h 8d Kc 3s', 2: 'Jh Jc 4d 4s Ac', 1: 'Th Tc 8d 5s 2h', 0: 'Ah Jd 8c 6s 3h',
    };
    const prob = ['17,4%', '43,8%', '23,5%', '4,83%', '4,62%', '3,03%', '2,60%', '0,168%', '0,031%'];
    $('rankings').innerHTML = [8, 7, 6, 5, 4, 3, 2, 1, 0].map((c, i) => `
      <div class="rank-row" style="animation-delay:${i * 40}ms">
        <div class="n">${i + 1}</div>
        <div>
          <div class="t">${P.CATEGORIES[c].name}<span>${prob[c]} das mãos de 7 cartas</span></div>
          <div class="ex">${ex[c].split(' ').map((x) => cardHTML(P.parseCard(x), true)).join('')}</div>
        </div>
      </div>`).join('');
  }

  // ---------- events ----------
  function init() {
    load();
    buildPicker();
    renderRankings();
    renderSeats();
    renderSlots();
    renderPot();

    document.querySelectorAll('.slot').forEach((el) => el.addEventListener('click', () => openSlot(el.dataset.slot)));
    $('closeSheet').addEventListener('click', closeSheet);
    $('sheetBackdrop').addEventListener('click', closeSheet);
    $('removeCard').addEventListener('click', removeActive);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
    $('playersMinus').addEventListener('click', () => { if (state.players > 2) { state.players--; renderSeats(); save(); scheduleCalc(); } });
    $('playersPlus').addEventListener('click', () => { if (state.players < 10) { state.players++; renderSeats(); save(); scheduleCalc(); } });
    $('randomHand').addEventListener('click', randomHand);
    $('dealNext').addEventListener('click', dealNext);
    $('clearAll').addEventListener('click', clearAll);
    $('potSize').addEventListener('input', renderPot);
    $('callSize').addEventListener('input', renderPot);
    document.querySelectorAll('#potTabs .tab').forEach((t) => t.addEventListener('click', () => {
      document.querySelectorAll('#potTabs .tab').forEach((x) => x.classList.toggle('active', x === t));
      state.potMode = t.dataset.pot;
      $('potCall').hidden = state.potMode !== 'call';
      $('potBluff').hidden = state.potMode !== 'bluff';
    }));
    ['bluffPot', 'bluffBet', 'foldRange'].forEach((id) => $(id).addEventListener('input', renderPot));
    $('bluffRange').addEventListener('input', () => {
      state.bluff = Number($('bluffRange').value) / 100;
      $('bluffOut').textContent = Math.round(state.bluff * 100) + '%';
      save();
      scheduleCalc();
    });
    document.querySelectorAll('#distPanel .tab').forEach((t) => t.addEventListener('click', () => {
      document.querySelectorAll('#distPanel .tab').forEach((x) => x.classList.toggle('active', x === t));
      state.tab = t.dataset.tab;
      renderDist();
    }));

    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  init();
  window.OddsLab = { state, toast };
})();
