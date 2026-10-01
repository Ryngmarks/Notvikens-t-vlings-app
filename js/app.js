(function () {
  'use strict';

  const TEAM = { name: 'Notvikens IK', sub: 'Träningsligan' };
  const GAME_TYPES = {
    small: { label: 'Small game', format: '5v5' },
    medium: { label: 'Medium game', format: '7v7' },
    large: { label: 'Large game', format: '11v11' },
  };
  // Separat nyckel per läge så att en demo-träning aldrig skickas till Supabase
  const ACTIVE_KEY = `notviken-active-training-${Store.mode}`;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const today = () => new Date().toLocaleDateString('sv-SE');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const state = {
    players: [],
    sessions: [],
    results: [],
    filter: 'total',
    flow: {
      step: '1',
      selected: new Set(),
      gameType: null,
      marks: new Map(), // player_id -> 'win' | 'loss'
    },
    active: loadActive(), // { sessionId, date, participants: [], rounds }
  };

  /* ---------------- Pågående träning ---------------- */

  function loadActive() {
    try {
      const a = JSON.parse(localStorage.getItem(ACTIVE_KEY));
      if (a && a.date === today()) return a;
    } catch (e) { /* ignorera */ }
    return null;
  }
  function saveActive() {
    try {
      if (state.active) localStorage.setItem(ACTIVE_KEY, JSON.stringify(state.active));
      else localStorage.removeItem(ACTIVE_KEY);
    } catch (e) { /* ignorera */ }
  }

  /* ---------------- Data ---------------- */

  async function refresh() {
    const [players, sessions, results] = await Promise.all([
      Store.listPlayers(), Store.listSessions(), Store.listResults(),
    ]);
    state.players = players;
    state.sessions = sessions;
    state.results = results;
  }

  function computeBoard(filter) {
    const rows = filter === 'total' ? state.results : state.results.filter((r) => r.game_type === filter);
    const byPlayer = new Map();
    const sessions = new Set();
    const rounds = new Set();
    for (const r of rows) {
      sessions.add(r.training_session_id);
      rounds.add(r.training_session_id + '|' + r.created_at);
      let s = byPlayer.get(r.player_id);
      if (!s) byPlayer.set(r.player_id, (s = { wins: 0, losses: 0 }));
      r.result === 'win' ? s.wins++ : s.losses++;
    }
    const list = state.players
      .filter((p) => byPlayer.has(p.id))
      .map((p) => ({ id: p.id, name: p.name, active: p.active, ...byPlayer.get(p.id) }))
      .sort((a, b) => b.wins - a.wins || a.losses - b.losses || a.name.localeCompare(b.name, 'sv'));
    return {
      list,
      stats: { trainings: sessions.size, rounds: rounds.size, players: list.length },
    };
  }

  /* ---------------- Animerade siffror ---------------- */

  function countTo(el, to) {
    const from = Number(el.dataset.value || 0);
    el.dataset.value = to;
    if (reduceMotion || from === to) { el.textContent = to; return; }
    const start = performance.now();
    const dur = 650;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - t, 3);
      el.textContent = Math.round(from + (to - from) * e);
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /* ---------------- Leaderboard ---------------- */

  function renderBoard() {
    const { list, stats } = computeBoard(state.filter);
    countTo($('[data-stat="trainings"]'), stats.trainings);
    countTo($('[data-stat="rounds"]'), stats.rounds);
    countTo($('[data-stat="players"]'), stats.players);

    // Stapelns längd = spelade omgångar relativt den som spelat mest
    const max = Math.max(1, ...list.map((p) => p.wins + p.losses));
    const ol = $('[data-board]');
    $('[data-board-empty]').hidden = list.length > 0;

    // FLIP: kom ihåg gamla positioner så att raderna glider till nya platser
    const existing = new Map($$('.lb-row', ol).map((el) => [el.dataset.id, el]));
    const before = new Map();
    existing.forEach((el, id) => before.set(id, el.getBoundingClientRect().top));

    const keep = new Set();
    list.forEach((p, i) => {
      let li = existing.get(p.id);
      const isNew = !li;
      if (isNew) {
        li = document.createElement('li');
        li.className = 'lb-row';
        li.dataset.id = p.id;
        li.innerHTML = `
          <span class="lb-num lb-num--win" data-wins>0</span>
          <div class="lb-main">
            <b class="lb-rank"></b>
            <span class="lb-player"></span>
            <small class="lb-pct"></small>
            <span class="lb-bar"><i class="lb-bar__win"></i><i class="lb-bar__loss"></i></span>
          </div>
          <span class="lb-num lb-num--loss" data-losses>0</span>`;
        li.style.setProperty('--delay', `${Math.min(i, 14) * 40}ms`);
        li.classList.add('is-entering');
      }
      keep.add(p.id);
      const rank = i + 1;
      li.classList.toggle('is-top1', rank === 1);
      li.classList.toggle('is-top2', rank === 2);
      li.classList.toggle('is-top3', rank === 3);
      li.classList.toggle('is-inactive', !p.active);
      $('.lb-rank', li).textContent = rank;
      $('.lb-player', li).textContent = p.name;
      const games = p.wins + p.losses;
      $('.lb-pct', li).textContent = games ? `${Math.round((p.wins / games) * 100)}%` : '';
      ol.appendChild(li);

      const setBars = () => {
        $('.lb-bar__win', li).style.setProperty('--p', p.wins / max);
        $('.lb-bar__loss', li).style.setProperty('--p', p.losses / max);
        countTo($('[data-wins]', li), p.wins);
        countTo($('[data-losses]', li), p.losses);
      };
      if (isNew) {
        // starta från 0 för att få in-animationen på staplarna
        requestAnimationFrame(() => requestAnimationFrame(setBars));
      } else {
        setBars();
      }
    });

    existing.forEach((el, id) => { if (!keep.has(id)) el.remove(); });

    if (!reduceMotion) {
      $$('.lb-row', ol).forEach((el) => {
        const old = before.get(el.dataset.id);
        if (old === undefined) return;
        const dy = old - el.getBoundingClientRect().top;
        if (!dy) return;
        el.style.transition = 'none';
        el.style.transform = `translateY(${dy}px)`;
        requestAnimationFrame(() => {
          el.style.transition = '';
          el.style.transform = '';
        });
      });
    }
    setTimeout(() => $$('.lb-row.is-entering', ol).forEach((el) => el.classList.remove('is-entering')), 1200);

    renderActiveBanner();
  }

  function setFilter(value) {
    state.filter = value;
    const buttons = $$('[data-filter] button');
    buttons.forEach((b) => b.classList.toggle('is-active', b.dataset.filterValue === value));
    moveIndicator();
    renderBoard();
  }

  function moveIndicator() {
    const nav = $('[data-filter]');
    const active = $('button.is-active', nav);
    const ind = $('.segmented__indicator', nav);
    ind.style.width = active.offsetWidth + 'px';
    ind.style.transform = `translateX(${active.offsetLeft}px)`;
  }

  function renderActiveBanner() {
    const el = $('[data-active-training]');
    const a = state.active;
    el.hidden = !a;
    if (a) {
      $('[data-active-training-info]').textContent =
        `${a.participants.length} spelare · ${a.rounds} ${a.rounds === 1 ? 'omgång' : 'omgångar'}`;
    }
  }

  /* ---------------- Ny träning ---------------- */

  function activePlayers() {
    return state.players
      .filter((p) => p.active)
      .sort((a, b) => a.name.localeCompare(b.name, 'sv'));
  }

  function startFlow() {
    const f = state.flow;
    f.marks = new Map();
    f.gameType = null;
    if (state.active) {
      f.selected = new Set(state.active.participants);
      goStep('2');
    } else {
      f.selected = new Set();
      goStep('1');
    }
  }

  function goStep(step) {
    state.flow.step = step;
    $$('[data-step]').forEach((el) => { el.hidden = el.dataset.step !== step; });
    const n = step === 'done' ? 4 : Number(step);
    $$('[data-step-dot]').forEach((el) => {
      const d = Number(el.dataset.stepDot);
      el.classList.toggle('is-current', d === n);
      el.classList.toggle('is-done', d < n);
    });
    const round = (state.active ? state.active.rounds : 0) + 1;
    $$('[data-round-label]').forEach((el) => {
      el.textContent = step === '1' && !state.active ? 'Ny träning' : `Omgång ${round}`;
    });
    if (step === '1') renderPick();
    if (step === '2') renderGameTypes();
    if (step === '3') renderResults();
    window.scrollTo({ top: 0 });
  }

  function renderPick() {
    const grid = $('[data-pick-grid]');
    const sel = state.flow.selected;
    grid.innerHTML = activePlayers()
      .map((p) => `
        <button class="pick ${sel.has(p.id) ? 'is-selected' : ''}" data-pick="${p.id}" aria-pressed="${sel.has(p.id)}">
          <span class="pick__check"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>
          <span class="pick__name">${esc(p.name)}</span>
        </button>`)
      .join('');
    updatePickBar();
  }

  function updatePickBar() {
    const n = state.flow.selected.size;
    $('[data-selected-count]').textContent = n;
    $('[data-action="to-step-2"]').disabled = n < 2;
    const all = activePlayers().every((p) => state.flow.selected.has(p.id));
    $('[data-action="toggle-all"]').textContent = all ? 'Avmarkera alla' : 'Markera alla';
  }

  function renderGameTypes() {
    $$('[data-game-type]').forEach((b) =>
      b.classList.toggle('is-last', !!state.active && state.active.lastGameType === b.dataset.gameType));
  }

  function renderResults() {
    const f = state.flow;
    const ids = Array.from(f.selected);
    const players = state.players.filter((p) => ids.includes(p.id)).sort((a, b) => a.name.localeCompare(b.name, 'sv'));
    const t = GAME_TYPES[f.gameType];
    $('[data-step="3"] .flow-title').innerHTML = `Vem vann? <span class="tag">${t.format}</span>`;
    $('[data-result-list]').innerHTML = players
      .map((p) => {
        const m = f.marks.get(p.id) || '';
        return `
        <li class="result-row ${m ? 'is-' + m : ''}" data-result-row="${p.id}">
          <span class="result-row__name">${esc(p.name)}</span>
          <span class="wl">
            <button class="wl__btn wl__btn--win ${m === 'win' ? 'is-on' : ''}" data-mark="win">Win</button>
            <button class="wl__btn wl__btn--loss ${m === 'loss' ? 'is-on' : ''}" data-mark="loss">Loss</button>
          </span>
        </li>`;
      })
      .join('');
    updateResultBar();
  }

  function setMark(row, mark) {
    const id = row.dataset.resultRow;
    const marks = state.flow.marks;
    if (marks.get(id) === mark) marks.delete(id);
    else marks.set(id, mark);
    const m = marks.get(id) || '';
    row.classList.toggle('is-win', m === 'win');
    row.classList.toggle('is-loss', m === 'loss');
    $('.wl__btn--win', row).classList.toggle('is-on', m === 'win');
    $('.wl__btn--loss', row).classList.toggle('is-on', m === 'loss');
    updateResultBar();
  }

  function updateResultBar() {
    let w = 0, l = 0;
    state.flow.marks.forEach((v) => (v === 'win' ? w++ : l++));
    $('[data-count-win]').textContent = w;
    $('[data-count-loss]').textContent = l;
    $('[data-action="save-round"]').disabled = w + l === 0;
  }

  async function saveRound() {
    const f = state.flow;
    const btn = $('[data-action="save-round"]');
    btn.disabled = true;
    try {
      if (!state.active) {
        const session = await Store.createSession(today());
        state.active = { sessionId: session.id, date: today(), participants: [], rounds: 0 };
      }
      const entries = Array.from(f.marks, ([player_id, result]) => ({ player_id, result }));
      await Store.addRound(state.active.sessionId, f.gameType, entries);
      state.active.participants = Array.from(f.selected);
      state.active.rounds += 1;
      state.active.lastGameType = f.gameType;
      saveActive();
      await refresh();
      renderBoard();

      const wins = entries.filter((e) => e.result === 'win').length;
      $('[data-done-info]').textContent =
        `${GAME_TYPES[f.gameType].format} · ${wins} vinster · ${entries.length - wins} förluster · omgång ${state.active.rounds} idag`;
      goStep('done');
    } catch (err) {
      fail(err, 'Kunde inte spara – försök igen');
      btn.disabled = false;
    }
  }

  function finishTraining() {
    const rounds = state.active ? state.active.rounds : 0;
    state.active = null;
    saveActive();
    location.hash = '#/';
    if (rounds) toast(`Träning avslutad · ${rounds} ${rounds === 1 ? 'omgång' : 'omgångar'}`);
  }

  /* ---------------- Spelare ---------------- */

  function renderPlayers() {
    const sorted = state.players.slice().sort((a, b) => a.name.localeCompare(b.name, 'sv'));
    const row = (p) => `
      <li class="player-row" data-player="${p.id}">
        <input class="player-row__name" value="${esc(p.name)}" maxlength="24" aria-label="Namn" data-player-name>
        <label class="switch" title="${p.active ? 'Aktiv' : 'Inaktiv'}">
          <input type="checkbox" ${p.active ? 'checked' : ''} data-player-active>
          <span class="switch__track"><span class="switch__thumb"></span></span>
          <span class="switch__label">${p.active ? 'Aktiv' : 'Inaktiv'}</span>
        </label>
      </li>`;
    const active = sorted.filter((p) => p.active);
    const inactive = sorted.filter((p) => !p.active);
    $('[data-player-list]').innerHTML = active.map(row).join('');
    $('[data-player-list-inactive]').innerHTML = inactive.map(row).join('');
    $('[data-inactive-label]').hidden = inactive.length === 0;
  }

  async function renamePlayer(input) {
    const id = input.closest('[data-player]').dataset.player;
    const p = state.players.find((x) => x.id === id);
    const name = input.value.trim();
    if (!name) { input.value = p.name; return; }
    if (name === p.name) return;
    try {
      await Store.updatePlayer(id, { name });
      await refresh();
      toast(`Namn ändrat till ${name}`);
    } catch (err) {
      fail(err, 'Kunde inte byta namn');
      input.value = p.name;
    }
  }

  async function toggleActive(input) {
    const id = input.closest('[data-player]').dataset.player;
    try {
      await Store.updatePlayer(id, { active: input.checked });
      await refresh();
      const p = state.players.find((x) => x.id === id);
      toast(`${p.name} är nu ${p.active ? 'aktiv' : 'inaktiv'}`);
    } catch (err) {
      fail(err, 'Kunde inte spara');
    }
    renderPlayers();
  }

  /* ---------------- Toast ---------------- */

  function fail(err, msg) {
    console.error(err);
    toast(navigator.onLine === false ? 'Ingen internetanslutning' : msg);
  }

  let toastTimer;
  function toast(msg) {
    const el = $('[data-toast]');
    el.textContent = msg;
    el.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-visible'), 2400);
  }

  /* ---------------- Routing ---------------- */

  function route() {
    const hash = location.hash.replace(/^#\/?/, '');
    const view = hash === 'traning' ? 'training' : hash === 'spelare' ? 'players' : 'board';
    $$('[data-view]').forEach((el) => { el.hidden = el.dataset.view !== view; });
    $$('[data-tab]').forEach((el) => el.classList.toggle('is-active', el.dataset.tab === view));
    document.body.classList.toggle('is-flow', view === 'training');
    document.body.dataset.page = view;
    if (view === 'training') startFlow();
    if (view === 'players') renderPlayers();
    if (view === 'board') {
      renderBoard();
      requestAnimationFrame(moveIndicator);
    }
    window.scrollTo({ top: 0 });
  }

  /* ---------------- Events ---------------- */

  function bind() {
    $('[data-filter]').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-filter-value]');
      if (b && b.dataset.filterValue !== state.filter) setFilter(b.dataset.filterValue);
    });
    window.addEventListener('resize', moveIndicator);

    $('[data-pick-grid]').addEventListener('click', (e) => {
      const b = e.target.closest('[data-pick]');
      if (!b) return;
      const id = b.dataset.pick;
      const sel = state.flow.selected;
      sel.has(id) ? sel.delete(id) : sel.add(id);
      b.classList.toggle('is-selected', sel.has(id));
      b.setAttribute('aria-pressed', sel.has(id));
      if (navigator.vibrate) navigator.vibrate(8);
      updatePickBar();
    });

    $$('[data-game-type]').forEach((b) =>
      b.addEventListener('click', () => {
        state.flow.gameType = b.dataset.gameType;
        // behåll inte markeringar mellan omgångar
        state.flow.marks = new Map();
        goStep('3');
      }));

    $('[data-result-list]').addEventListener('click', (e) => {
      const b = e.target.closest('[data-mark]');
      if (b) {
        setMark(b.closest('[data-result-row]'), b.dataset.mark);
        if (navigator.vibrate) navigator.vibrate(8);
        return;
      }
      // tryck på namnet växlar: tom → win → loss → tom
      const row = e.target.closest('[data-result-row]');
      if (!row) return;
      const cur = state.flow.marks.get(row.dataset.resultRow);
      setMark(row, cur === 'win' ? 'loss' : cur === 'loss' ? 'loss' : 'win');
    });

    document.addEventListener('click', (e) => {
      const a = e.target.closest('[data-action]');
      if (!a) return;
      const action = a.dataset.action;
      const f = state.flow;
      switch (action) {
        case 'toggle-all': {
          const all = activePlayers();
          const everyone = all.every((p) => f.selected.has(p.id));
          f.selected = everyone ? new Set() : new Set(all.map((p) => p.id));
          renderPick();
          break;
        }
        case 'to-step-2': goStep('2'); break;
        case 'rest-loss':
          $$('[data-result-row]').forEach((row) => {
            if (!f.marks.has(row.dataset.resultRow)) setMark(row, 'loss');
          });
          break;
        case 'save-round': saveRound(); break;
        case 'next-round': f.marks = new Map(); goStep('2'); break;
        case 'change-players': goStep('1'); break;
        case 'finish-training': finishTraining(); break;
        case 'resume-training': location.hash = '#/traning'; break;
        case 'flow-back':
          if (f.step === '3') goStep('2');
          else if (f.step === '2') goStep('1');
          else location.hash = '#/';
          break;
        case 'flow-close':
          location.hash = '#/';
          if (state.active) toast('Träningen pågår – fortsätt från tavlan');
          break;
        case 'reset-demo':
          if (confirm('Återställ all demo-data?')) {
            Store.resetDemo().then(async () => {
              state.active = null;
              saveActive();
              await refresh();
              renderPlayers();
              toast('Demo-data återställd');
            });
          }
          break;
      }
    });

    $('[data-add-player]').addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = e.target.elements.name;
      const name = input.value.trim();
      if (!name) return;
      const btn = e.target.querySelector('button');
      btn.disabled = true;
      try {
        await Store.addPlayer(name);
        input.value = '';
        await refresh();
        renderPlayers();
        toast(`${name} tillagd`);
      } catch (err) {
        fail(err, 'Kunde inte lägga till spelaren');
      }
      btn.disabled = false;
    });

    const list = $('.view[data-view="players"]');
    list.addEventListener('change', (e) => {
      if (e.target.matches('[data-player-active]')) toggleActive(e.target);
      if (e.target.matches('[data-player-name]')) renamePlayer(e.target);
    });
    list.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.matches('[data-player-name]')) e.target.blur();
    });

    window.addEventListener('hashchange', route);

    // Hämta nytt när appen öppnas igen – någon annan kan ha registrerat under tiden
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState !== 'visible' || Store.mode === 'demo') return;
      try {
        await refresh();
        const page = document.body.dataset.page;
        if (page === 'board') renderBoard();
        if (page === 'players' && !document.activeElement.matches('input')) renderPlayers();
      } catch (err) { console.error(err); }
    });
  }

  /* ---------------- Start ---------------- */

  function loadHeroPhoto() {
    // Valfritt foto bakom toppen: lägg en bild som assets/hero.jpg
    const img = new Image();
    img.onload = () => $('[data-hero-bg]').style.setProperty('--hero-photo', `url("${img.src}")`);
    img.src = 'assets/hero.jpg';
  }

  async function init() {
    loadHeroPhoto();
    $('[data-team-name]').textContent = TEAM.name;
    $('[data-team-sub]').textContent = TEAM.sub;
    $('[data-action="reset-demo"]').hidden = Store.mode !== 'demo';
    try {
      await refresh();
    } catch (err) {
      fail(err, 'Kunde inte hämta data – kolla anslutningen');
      $('[data-board-empty]').textContent = 'Kunde inte hämta data. Dra ned eller ladda om sidan för att försöka igen.';
    }
    bind();
    route();
  }

  init();
})();
