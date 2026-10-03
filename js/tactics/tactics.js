/*
 * Taktiktavla – gränssnitt. Kopplar ihop modell, animationsmotor, SVG-plan och sparning.
 *
 * TacticsUI.init({ store, toast, onError, getSquad })
 * TacticsUI.open()   – när vyn visas
 * TacticsUI.close()  – när man lämnar vyn (sparar direkt)
 * TacticsUI.reset()  – vid utloggning
 */
(function () {
  const M = window.TacticsModel;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TRAILS_KEY = 'notviken-tactics-trails';
  const LAST_KEY = 'notviken-tactics-last';

  let deps = null;
  let root, board, engine;
  const ui = {
    scenario: null,
    id: null,            // id i databasen (null = inte sparad än)
    tool: 'move',
    selectedId: null,    // vald spelare
    selectedArrow: null, // index för vald pil i aktuell frame
    drag: null,
    preview: null,
    history: [],
    trails: true,
    saveTimer: null,
    saving: false,
    dirty: false,
    status: '',
  };

  /* ================= Hjälpare ================= */

  const frame = () => ui.scenario.frames[engine.frameIndex];
  const def = (id) => ui.scenario.players.find((p) => p.id === id);

  /** Redigering sker alltid på en hel frame: pausa och hoppa till närmaste. */
  function ensureEditable() {
    if (engine.playing) engine.pause();
    if (!engine.atKeyframe) engine.seek(engine.frameIndex);
  }

  function snapshot() {
    return JSON.stringify({ s: ui.scenario, f: engine.frameIndex });
  }

  function pushHistory(snap = snapshot()) {
    ui.history.push(snap);
    if (ui.history.length > 80) ui.history.shift();
    $('[data-tx="undo"]', root).disabled = false;
  }

  function undo() {
    const snap = ui.history.pop();
    if (!snap) return;
    const { s, f } = JSON.parse(snap);
    ui.scenario = s;
    ui.selectedArrow = null;
    engine.load(ui.scenario, f);
    $('[data-tx="undo"]', root).disabled = ui.history.length === 0;
    changed(true);
  }

  /* ================= Sparning ================= */

  function setStatus(text, cls = '') {
    ui.status = text;
    const el = $('[data-tx-save]', root);
    el.textContent = text;
    el.className = `tx-save ${cls}`;
  }

  function changed(structural = false) {
    ui.dirty = true;
    setStatus('Ej sparat');
    if (structural) renderChrome();
    render();
    clearTimeout(ui.saveTimer);
    ui.saveTimer = setTimeout(save, 900);
  }

  async function save() {
    clearTimeout(ui.saveTimer);
    if (!ui.dirty || !ui.scenario) return;
    if (ui.saving) { ui.saveTimer = setTimeout(save, 400); return; }
    ui.saving = true;
    ui.dirty = false;
    setStatus('Sparar…', 'is-busy');
    try {
      const row = await deps.store.saveTactic({
        id: ui.id,
        name: ui.scenario.name || 'Namnlös taktik',
        scenario_data: ui.scenario,
      });
      ui.id = row.id;
      try { localStorage.setItem(LAST_KEY, row.id); } catch (e) { /* ignorera */ }
      setStatus(ui.dirty ? 'Ej sparat' : 'Sparat', ui.dirty ? '' : 'is-ok');
    } catch (err) {
      ui.dirty = true;
      setStatus('Kunde inte spara', 'is-error');
      deps.onError(err, 'Kunde inte spara taktiken');
    }
    ui.saving = false;
  }

  /* ================= Öppna / bibliotek ================= */

  function load(row) {
    ui.scenario = M.normalize(row.scenario_data);
    ui.id = row.id || null;
    ui.history = [];
    ui.selectedId = null;
    ui.selectedArrow = null;
    ui.dirty = false;
    $('[data-tx="undo"]', root).disabled = true;
    engine.load(ui.scenario, 0);
    renderChrome();
    setStatus(ui.id ? 'Sparat' : '', ui.id ? 'is-ok' : '');
    if (ui.id) { try { localStorage.setItem(LAST_KEY, ui.id); } catch (e) { /* ignorera */ } }
  }

  async function createNew(demo) {
    await save();
    const scenario = demo ? M.pressDemo() : M.newScenario('Ny taktik');
    load({ id: null, scenario_data: scenario });
    ui.dirty = true;
    await save();
    closeLibrary();
    if (!demo) $('[data-tx-name]', root).select();
  }

  async function openById(id) {
    await save();
    try {
      const row = await deps.store.getTactic(id);
      if (row) load(row);
      closeLibrary();
    } catch (err) {
      deps.onError(err, 'Kunde inte öppna taktiken');
    }
  }

  async function openLibrary() {
    await save();
    const box = $('[data-tx-library]', root);
    box.hidden = false;
    const list = $('[data-tx-list]', root);
    list.innerHTML = '<li class="tx-library__empty">Hämtar…</li>';
    try {
      const rows = await deps.store.listTactics();
      list.innerHTML = rows.length
        ? rows.map((r) => `
          <li class="tx-library__item ${r.id === ui.id ? 'is-current' : ''}">
            <button class="tx-library__open" data-open="${esc(r.id)}">
              <strong>${esc(r.name || 'Namnlös taktik')}</strong>
              <small>${new Date(r.updated_at).toLocaleString('sv-SE', { dateStyle: 'medium', timeStyle: 'short' })}</small>
            </button>
            <button class="icon-btn icon-btn--sm" data-delete="${esc(r.id)}" aria-label="Ta bort ${esc(r.name)}">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>
            </button>
          </li>`).join('')
        : '<li class="tx-library__empty">Inga sparade taktiker än.</li>';
    } catch (err) {
      list.innerHTML = '<li class="tx-library__empty">Kunde inte hämta taktiker.</li>';
      deps.onError(err, 'Kunde inte hämta taktiker');
    }
  }

  function closeLibrary() { $('[data-tx-library]', root).hidden = true; }

  async function deleteById(id) {
    const item = $(`[data-delete="${CSS.escape(id)}"]`, root);
    const name = item ? item.closest('li').querySelector('strong').textContent : 'taktiken';
    if (!confirm(`Ta bort "${name}"?`)) return;
    try {
      await deps.store.deleteTactic(id);
      if (id === ui.id) {
        // Den öppna taktiken togs bort: öppna nästa, eller börja om med demot
        ui.id = null;
        ui.dirty = false;
        const rows = await deps.store.listTactics();
        if (rows.length) await openById(rows[0].id);
        else await createNew(true);
      }
      await openLibrary();
    } catch (err) {
      deps.onError(err, 'Kunde inte ta bort taktiken');
    }
  }

  /* ================= Rendering ================= */

  function render() {
    if (!ui.scenario) return;
    const st = engine.state();
    const editing = !engine.playing && engine.atKeyframe;
    const f = ui.scenario.frames[st.index];
    const prev = editing && ui.trails && st.index > 0 ? ui.scenario.frames[st.index - 1] : null;

    board.render({
      players: ui.scenario.players,
      positions: st.positions,
      ball: st.ball,
      labelMode: ui.scenario.labelMode,
      arrows: f.arrows,
      arrowsKey: `${f.id}:${JSON.stringify(f.arrows)}`,
      arrowOpacity: editing ? 1 : Math.max(0, 1 - st.progress * 1.6),
      selectedArrow: editing ? ui.selectedArrow : null,
      selectedId: editing ? ui.selectedId : null,
      preview: ui.preview,
      ghosts: prev ? prev.positions : null,
      ghostsKey: prev ? `${prev.id}:${f.id}:${JSON.stringify(f.positions)}:${JSON.stringify(prev.positions)}` : 'none',
    });

    // Uppspelningsknappar och tidslinje
    const playBtn = $('[data-tx="play"]', root);
    playBtn.classList.toggle('is-playing', engine.playing);
    $('[data-tx-play-label]', root).textContent = engine.playing ? 'Pause' : 'Play';
    playBtn.setAttribute('aria-label', engine.playing ? 'Pausa' : 'Spela');
    playBtn.disabled = engine.lastIndex === 0;
    $('[data-tx="prev"]', root).disabled = engine.t <= 0;
    $('[data-tx="next"]', root).disabled = engine.t >= engine.lastIndex;

    const steps = $('[data-tx-steps]', root);
    const fill = $('.tx-steps__fill', steps);
    if (fill) fill.style.transform = `scaleX(${engine.lastIndex ? engine.t / engine.lastIndex : 0})`;
    $$('.tx-step', steps).forEach((b, i) => {
      b.classList.toggle('is-current', editing && i === st.index);
      b.classList.toggle('is-passed', i <= engine.t + 1e-6);
    });
  }

  /** Allt runt planen som inte ändras varje animationsbild. */
  function renderChrome() {
    const s = ui.scenario;
    const nameInput = $('[data-tx-name]', root);
    if (document.activeElement !== nameInput) nameInput.value = s.name || '';

    // Tidslinje
    const n = s.frames.length;
    $('[data-tx-steps]', root).innerHTML = `
      <div class="tx-steps__track"><div class="tx-steps__fill"></div></div>
      ${s.frames.map((f, i) => `
        <button class="tx-step" data-step="${i}" style="--pos:${n > 1 ? (i / (n - 1)) * 100 : 50}%" aria-label="Steg ${i + 1}">
          <span>${i + 1}</span>
        </button>`).join('')}`;
    $('[data-tx="del-step"]', root).disabled = n <= 1;

    // Formationer
    for (const team of ['A', 'B']) {
      $(`[data-tx-formation="${team}"]`, root).innerHTML = Object.keys(M.FORMATIONS)
        .map((name) => `<button class="tx-chip ${s.formations[team] === name ? 'is-active' : ''}" data-formation="${name}" data-team="${team}">${name}</button>`)
        .join('');
    }
    $$('[data-label]', root).forEach((b) => b.classList.toggle('is-active', b.dataset.label === s.labelMode));
    $$('[data-speed]', root).forEach((b) => b.classList.toggle('is-active', Number(b.dataset.speed) === (s.speed || 1)));
    $$('[data-tool]', root).forEach((b) => b.classList.toggle('is-active', b.dataset.tool === ui.tool));
    $('.tx-pitch', root).dataset.mode = ui.tool;
    renderSelection();
  }

  function renderSelection() {
    const box = $('[data-tx-selection]', root);
    const p = ui.selectedId && def(ui.selectedId);
    if (p) {
      const team = p.team === 'A' ? 'gul' : 'röd';
      box.innerHTML = `
        <h3 class="tx-card__title"><i class="tx-dot tx-dot--${p.team}"></i>Spelare – lag ${team}</h3>
        <div class="tx-fields">
          <label class="field field--sm"><span>Nr</span><input data-edit="num" inputmode="numeric" maxlength="2" value="${esc(p.num || '')}"></label>
          <label class="field field--sm"><span>Pos</span><input data-edit="pos" maxlength="4" value="${esc(p.pos || '')}" autocapitalize="characters"></label>
          <label class="field field--sm field--wide"><span>Namn</span><input data-edit="name" maxlength="16" value="${esc(p.name || '')}" ${p.team === 'A' ? 'list="tx-squad"' : ''}></label>
        </div>
        <p class="tx-note">Släpp bollen nära en spelare för att ge den bollen.</p>`;
      return;
    }
    if (ui.selectedArrow != null && frame().arrows[ui.selectedArrow]) {
      const a = frame().arrows[ui.selectedArrow];
      const label = { run: 'Löpning', pass: 'Passning', dribble: 'Dribbling' }[a.type];
      box.innerHTML = `
        <h3 class="tx-card__title">${label}</h3>
        <button class="btn btn--ghost btn--small" data-tx="delete-arrow">Ta bort pil</button>`;
      return;
    }
    box.innerHTML = `
      <h3 class="tx-card__title">Så skapar du en situation</h3>
      <ol class="tx-help">
        <li>Välj formation och dra spelare och boll till startläget.</li>
        <li>Tryck <b>+ Next step</b> och flytta spelarna dit de ska.</li>
        <li>Släpp bollen vid en spelare – i nästa steg vid en annan blir det en passning.</li>
        <li>Rita löpningar, passningar och dribblingar med verktygen.</li>
        <li>Tryck <b>Play</b>.</li>
      </ol>`;
  }

  /* ================= Planen: tryck och drag ================= */

  function onDown({ kind, id, index, pt }) {
    ensureEditable();
    const f = frame();
    if (ui.tool === 'move') {
      if (kind === 'player') {
        ui.drag = { kind, id, snap: snapshot(), start: pt, moved: false };
        select(id, null);
      } else if (kind === 'ball') {
        ui.drag = { kind, snap: snapshot(), start: pt, moved: false };
      } else if (kind === 'arrow') {
        select(null, index);
      } else {
        select(null, null);
      }
      return;
    }
    // Rita pil: börja i spelaren/bollen om man trycker på en
    let start = pt;
    let team = null;
    if (kind === 'player') { start = { ...f.positions[id] }; team = id[0]; }
    else if (kind === 'ball') {
      start = M.ballAt(f.ball, f.positions);
      team = f.ball.owner ? f.ball.owner[0] : null;
    } else {
      const near = M.nearestPlayer(f.positions, pt, 2.5);
      if (near) { start = { ...f.positions[near] }; team = near[0]; }
    }
    ui.drag = { kind: 'draw', start, team };
    ui.preview = { type: ui.tool, x1: start.x, y1: start.y, x2: start.x, y2: start.y, team };
    render();
  }

  function onMove(pt) {
    const d = ui.drag;
    if (!d) return;
    const f = frame();
    if (d.kind === 'draw') {
      Object.assign(ui.preview, { x2: pt.x, y2: pt.y });
      render();
      return;
    }
    if (!d.moved) {
      if (M.distanceMeters(d.start, pt) < 0.5) return;
      d.moved = true;
      pushHistory(d.snap);
    }
    const p = { x: M.round(M.clamp(pt.x, -3, 103)), y: M.round(M.clamp(pt.y, -2, 102)) };
    if (d.kind === 'player') f.positions[d.id] = p;
    if (d.kind === 'ball') f.ball = { ...p, owner: null };
    render();
  }

  function onUp(pt) {
    const d = ui.drag;
    ui.drag = null;
    if (!d) return;
    const f = frame();
    if (d.kind === 'draw') {
      const a = ui.preview;
      ui.preview = null;
      if (M.distanceMeters({ x: a.x1, y: a.y1 }, { x: a.x2, y: a.y2 }) < 2) { render(); return; }
      // Passning: lås slutpunkten på mottagaren om man släpper nära en spelare
      if (a.type === 'pass') {
        const target = M.nearestPlayer(f.positions, { x: a.x2, y: a.y2 }, 3);
        if (target) { a.x2 = f.positions[target].x; a.y2 = f.positions[target].y; }
      }
      pushHistory();
      f.arrows.push({ type: a.type, x1: M.round(a.x1), y1: M.round(a.y1), x2: M.round(a.x2), y2: M.round(a.y2), team: a.team });
      ui.selectedArrow = null;
      changed(true);
      return;
    }
    if (!d.moved) return;
    if (d.kind === 'ball') {
      const owner = M.nearestPlayer(f.positions, f.ball, 2.8);
      if (owner) f.ball = { ...f.positions[owner], owner };
    }
    changed();
  }

  function select(playerId, arrowIndex) {
    ui.selectedId = playerId;
    ui.selectedArrow = arrowIndex;
    renderSelection();
    render();
  }

  function deleteSelectedArrow() {
    if (ui.selectedArrow == null) return;
    ensureEditable();
    pushHistory();
    frame().arrows.splice(ui.selectedArrow, 1);
    ui.selectedArrow = null;
    changed(true);
  }

  function setTool(tool) {
    ui.tool = tool;
    ui.selectedArrow = null;
    renderChrome();
    render();
  }

  /* ================= Steg ================= */

  function goTo(index) {
    engine.seek(index);
    ui.selectedArrow = null;
    renderSelection();
  }

  function addStep() {
    ensureEditable();
    pushHistory();
    const i = M.addFrame(ui.scenario, engine.frameIndex);
    engine.load(ui.scenario, i);
    ui.selectedArrow = null;
    changed(true);
  }

  function duplicateStep() {
    ensureEditable();
    pushHistory();
    const i = M.duplicateFrame(ui.scenario, engine.frameIndex);
    engine.load(ui.scenario, i);
    changed(true);
  }

  function deleteStep() {
    ensureEditable();
    if (ui.scenario.frames.length <= 1) return;
    pushHistory();
    const i = M.deleteFrame(ui.scenario, engine.frameIndex);
    engine.load(ui.scenario, i);
    ui.selectedArrow = null;
    changed(true);
  }

  /* ================= Bindningar ================= */

  function bind() {
    root.addEventListener('click', (e) => {
      const t = e.target.closest('[data-tx],[data-tool],[data-step],[data-formation],[data-label],[data-speed],[data-open],[data-delete]');
      if (!t) return;
      const d = t.dataset;
      if (d.tool) return setTool(d.tool);
      if (d.step != null) return goTo(Number(d.step));
      if (d.formation) {
        ensureEditable();
        pushHistory();
        M.applyFormation(ui.scenario, frame(), d.team, d.formation);
        return changed(true);
      }
      if (d.label) { ui.scenario.labelMode = d.label; return changed(true); }
      if (d.speed) { ui.scenario.speed = Number(d.speed); return changed(true); }
      if (d.open) return openById(d.open);
      if (d.delete) return deleteById(d.delete);
      switch (d.tx) {
        case 'play': ui.selectedArrow = null; engine.toggle(); break;
        case 'restart': engine.restart(); break;
        case 'prev': engine.step(-1); renderSelection(); break;
        case 'next': engine.step(1); renderSelection(); break;
        case 'add-step': addStep(); break;
        case 'dup-step': duplicateStep(); break;
        case 'del-step': deleteStep(); break;
        case 'undo': undo(); break;
        case 'delete-arrow': deleteSelectedArrow(); break;
        case 'library': openLibrary(); break;
        case 'close-library': closeLibrary(); break;
        case 'new': createNew(false); break;
        case 'new-demo': createNew(true); break;
      }
    });

    $('[data-tx-library]', root).addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeLibrary();
    });

    $('[data-tx-name]', root).addEventListener('input', (e) => {
      ui.scenario.name = e.target.value;
      changed();
    });

    // Spelarredigering
    $('[data-tx-selection]', root).addEventListener('focusin', (e) => {
      if (e.target.matches('[data-edit]')) pushHistory();
    });
    $('[data-tx-selection]', root).addEventListener('input', (e) => {
      const field = e.target.dataset.edit;
      const p = ui.selectedId && def(ui.selectedId);
      if (!field || !p) return;
      p[field] = field === 'num' ? (parseInt(e.target.value, 10) || 0) : field === 'pos' ? e.target.value.toUpperCase() : e.target.value;
      changed();
    });

    $('[data-tx-trails]', root).addEventListener('change', (e) => {
      ui.trails = e.target.checked;
      try { localStorage.setItem(TRAILS_KEY, ui.trails ? '1' : '0'); } catch (err) { /* ignorera */ }
      render();
    });

    document.addEventListener('keydown', (e) => {
      if (root.hidden || !ui.scenario) return;
      if (e.target.matches('input, textarea, select')) return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); undo(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (k === ' ') { e.preventDefault(); engine.toggle(); }
      else if (k === 'arrowright') engine.step(1);
      else if (k === 'arrowleft') engine.step(-1);
      else if (k === 'delete' || k === 'backspace') deleteSelectedArrow();
      else if (k === 'escape') { closeLibrary(); select(null, null); setTool('move'); }
      else if (k === 'v') setTool('move');
      else if (k === 'r') setTool('run');
      else if (k === 'p') setTool('pass');
      else if (k === 'd') setTool('dribble');
      else if (k === 'n') addStep();
    });

    // Spara innan sidan stängs
    window.addEventListener('pagehide', () => { if (ui.dirty) save(); });
  }

  /* ================= Publikt ================= */

  function init(options) {
    deps = options;
    root = $('[data-view="tactics"]');
    engine = new window.TacticsEngine({ onUpdate: () => render() });
    board = window.TacticsBoard.createBoard($('[data-tx-svg]', root), { down: onDown, move: onMove, up: onUp });
    try { ui.trails = localStorage.getItem(TRAILS_KEY) !== '0'; } catch (e) { /* ignorera */ }
    $('[data-tx-trails]', root).checked = ui.trails;
    bind();
  }

  async function open() {
    // Namnförslag från truppen
    $('#tx-squad').innerHTML = (deps.getSquad() || []).map((n) => `<option value="${esc(n)}">`).join('');
    if (ui.scenario) { renderChrome(); render(); return; }
    setStatus('Hämtar…', 'is-busy');
    try {
      const rows = await deps.store.listTactics();
      let last = null;
      try { last = localStorage.getItem(LAST_KEY); } catch (e) { /* ignorera */ }
      const pick = rows.find((r) => r.id === last) || rows[0];
      if (pick) {
        const row = await deps.store.getTactic(pick.id);
        if (row) { load(row); return; }
      }
      await createNew(true); // första gången: börja med pressdemot
    } catch (err) {
      setStatus('Kunde inte hämta', 'is-error');
      deps.onError(err, 'Kunde inte hämta taktiker');
      if (!ui.scenario) load({ id: null, scenario_data: M.pressDemo() });
    }
  }

  function close() {
    if (engine) engine.pause();
    closeLibrary();
    if (ui.dirty) save();
  }

  function reset() {
    if (engine) engine.pause();
    clearTimeout(ui.saveTimer);
    Object.assign(ui, { scenario: null, id: null, history: [], selectedId: null, selectedArrow: null, dirty: false, drag: null, preview: null });
  }

  window.TacticsUI = { init, open, close, reset };
})();
