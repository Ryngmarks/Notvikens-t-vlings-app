/*
 * Taktiktavla – SVG-rendering och pekarinmatning.
 *
 * Ritar bara det läge den får i render(view) och rapporterar tryck/drag
 * i modellkoordinater (0–100). All logik ligger i tactics.js.
 */
(function () {
  const M = window.TacticsModel;
  const NS = 'http://www.w3.org/2000/svg';
  const W = M.PITCH.width;   // 68
  const L = M.PITCH.length;  // 105
  const PAD = 5;
  const R = 2.25;            // spelarradie i meter

  const sx = (x) => (x * W) / 100;
  const sy = (y) => (y * L) / 100;

  function el(name, attrs = {}, parent) {
    const node = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if (parent) parent.appendChild(node);
    return node;
  }

  function drawPitch(svg) {
    const g = el('g', { class: 'tb-pitch' }, svg);
    el('rect', { x: -PAD, y: -PAD, width: W + PAD * 2, height: L + PAD * 2, class: 'tb-grass' }, g);
    // Klippta ränder
    const stripes = 12;
    for (let i = 0; i < stripes; i += 2) {
      el('rect', { x: 0, y: (i * L) / stripes, width: W, height: L / stripes, class: 'tb-stripe' }, g);
    }
    const lines = el('g', { class: 'tb-lines' }, g);
    el('rect', { x: 0, y: 0, width: W, height: L }, lines);
    el('line', { x1: 0, y1: L / 2, x2: W, y2: L / 2 }, lines);
    el('circle', { cx: W / 2, cy: L / 2, r: 9.15 }, lines);
    el('circle', { cx: W / 2, cy: L / 2, r: 0.35, class: 'tb-spot' }, lines);
    for (const top of [true, false]) {
      const y0 = top ? 0 : L;
      const dir = top ? 1 : -1;
      const box = (w, d) => el('rect', {
        x: (W - w) / 2, y: top ? 0 : L - d, width: w, height: d,
      }, lines);
      box(40.32, 16.5);
      box(18.32, 5.5);
      const spotY = y0 + dir * 11;
      el('circle', { cx: W / 2, cy: spotY, r: 0.35, class: 'tb-spot' }, lines);
      // Straffbåge utanför straffområdet
      const edge = y0 + dir * 16.5;
      const dx = Math.sqrt(9.15 ** 2 - 5.5 ** 2);
      el('path', {
        d: `M${W / 2 - dx} ${edge} A9.15 9.15 0 0 ${top ? 0 : 1} ${W / 2 + dx} ${edge}`,
      }, lines);
      // Mål
      el('rect', { x: (W - 7.32) / 2, y: top ? -2 : L, width: 7.32, height: 2, class: 'tb-goal' }, lines);
    }
    // Hörnbågar
    for (const [cx, cy] of [[0, 0], [W, 0], [0, L], [W, L]]) {
      const ix = cx === 0 ? 1 : -1; // riktning in mot planen
      const iy = cy === 0 ? 1 : -1;
      el('path', { d: `M${cx + ix} ${cy} A1 1 0 0 ${ix * iy > 0 ? 1 : 0} ${cx} ${cy + iy}` }, lines);
    }
  }

  function arrowPath(a) {
    const x1 = sx(a.x1), y1 = sy(a.y1), x2 = sx(a.x2), y2 = sy(a.y2);
    if (a.type !== 'dribble') return `M${x1} ${y1} L${x2} ${y2}`;
    // Dribbling: vågig linje, rak sista biten in mot pilspetsen
    const len = Math.hypot(x2 - x1, y2 - y1);
    const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
    const nx = -uy, ny = ux;
    const wavy = Math.max(0, len - 2);
    let d = `M${x1} ${y1}`;
    for (let s = 0.25; s <= wavy; s += 0.25) {
      const off = Math.sin((s / 2.4) * Math.PI * 2) * 0.75;
      d += ` L${(x1 + ux * s + nx * off).toFixed(2)} ${(y1 + uy * s + ny * off).toFixed(2)}`;
    }
    return `${d} L${x2} ${y2}`;
  }

  function createBoard(svg, handlers) {
    svg.setAttribute('viewBox', `${-PAD} ${-PAD} ${W + PAD * 2} ${L + PAD * 2}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    const defs = el('defs', {}, svg);
    for (const [id, cls] of [['tb-head-A', 'tb-head--A'], ['tb-head-B', 'tb-head--B'], ['tb-head-N', 'tb-head--N']]) {
      const m = el('marker', {
        id, viewBox: '0 0 10 10', refX: 7, refY: 5, markerWidth: 2.6, markerHeight: 2.6,
        markerUnits: 'userSpaceOnUse', orient: 'auto-start-reverse',
      }, defs);
      el('path', { d: 'M0 0 L10 5 L0 10 z', class: cls }, m);
    }

    drawPitch(svg);
    const gGhosts = el('g', { class: 'tb-ghosts' }, svg);
    const gArrows = el('g', { class: 'tb-arrows' }, svg);
    const gPlayers = el('g', { class: 'tb-players' }, svg);
    const gBall = el('g', { class: 'tb-ball', 'data-kind': 'ball' }, svg);
    el('circle', { r: 1.7, class: 'tb-hit' }, gBall); // liten, så att spelaren under går att ta tag i
    el('circle', { r: 1.05, class: 'tb-ball__body' }, gBall);
    el('circle', { r: 0.42, class: 'tb-ball__patch' }, gBall);
    const gPreview = el('g', { class: 'tb-preview' }, svg);

    const playerEls = new Map();

    function ensurePlayers(players) {
      for (const p of players) {
        if (playerEls.has(p.id)) continue;
        const g = el('g', { class: `tb-player tb-player--${p.team}`, 'data-kind': 'player', 'data-id': p.id }, gPlayers);
        el('circle', { r: R + 1.4, class: 'tb-hit' }, g);
        el('circle', { r: R + 0.85, class: 'tb-ring' }, g);
        el('circle', { r: R, class: 'tb-body' }, g);
        const label = el('text', { class: 'tb-label', 'text-anchor': 'middle', 'dominant-baseline': 'central', y: 0.1 }, g);
        const name = el('text', { class: 'tb-name', 'text-anchor': 'middle', y: R + 2.2 }, g);
        playerEls.set(p.id, { g, label, name });
      }
    }

    function render(view) {
      ensurePlayers(view.players);

      // Spelare
      for (const p of view.players) {
        const node = playerEls.get(p.id);
        const pos = view.positions[p.id];
        if (!pos) { node.g.style.display = 'none'; continue; }
        node.g.style.display = '';
        node.g.setAttribute('transform', `translate(${sx(pos.x).toFixed(3)} ${sy(pos.y).toFixed(3)})`);
        node.g.classList.toggle('is-selected', view.selectedId === p.id);
        let text = '';
        let small = false;
        if (view.labelMode === 'pos') { text = p.pos || ''; small = text.length > 2; }
        else if (view.labelMode === 'name') { text = ''; }
        else text = p.num ? String(p.num) : '';
        if (node.label.textContent !== text) node.label.textContent = text;
        node.label.classList.toggle('is-small', small);
        const nm = view.labelMode === 'name' ? (p.name || p.pos || '') : '';
        if (node.name.textContent !== nm) node.name.textContent = nm;
      }

      // Boll
      gBall.setAttribute('transform', `translate(${sx(view.ball.x).toFixed(3)} ${sy(view.ball.y).toFixed(3)})`);

      // Pilar
      if (view.arrowsKey !== gArrows._key) {
        gArrows._key = view.arrowsKey;
        gArrows.textContent = '';
        view.arrows.forEach((a, i) => {
          const g = el('g', { class: `tb-arrow tb-arrow--${a.type} tb-arrow--${a.team || 'N'}`, 'data-kind': 'arrow', 'data-index': i }, gArrows);
          const d = arrowPath(a);
          el('path', { d, class: 'tb-hit' }, g);
          el('path', { d, class: 'tb-arrow__line', 'marker-end': `url(#tb-head-${a.team || 'N'})` }, g);
        });
      }
      gArrows.style.opacity = view.arrowOpacity == null ? 1 : view.arrowOpacity;
      gArrows.querySelectorAll('.tb-arrow').forEach((g) =>
        g.classList.toggle('is-selected', Number(g.dataset.index) === view.selectedArrow));

      // Förhandsvisning medan man ritar
      gPreview.textContent = '';
      if (view.preview) {
        const a = view.preview;
        const g = el('g', { class: `tb-arrow tb-arrow--${a.type} tb-arrow--${a.team || 'N'}` }, gPreview);
        el('path', { d: arrowPath(a), class: 'tb-arrow__line', 'marker-end': `url(#tb-head-${a.team || 'N'})` }, g);
      }

      // Spår från föregående steg
      if (view.ghostsKey !== gGhosts._key) {
        gGhosts._key = view.ghostsKey;
        gGhosts.textContent = '';
        if (view.ghosts) {
          for (const p of view.players) {
            const from = view.ghosts[p.id];
            const to = view.positions[p.id];
            if (!from || !to || M.distanceMeters(from, to) < 1) continue;
            el('line', { x1: sx(from.x), y1: sy(from.y), x2: sx(to.x), y2: sy(to.y), class: `tb-trail tb-trail--${p.team}` }, gGhosts);
            el('circle', { cx: sx(from.x), cy: sy(from.y), r: R, class: `tb-ghost tb-ghost--${p.team}` }, gGhosts);
          }
        }
      }
    }

    /* ---------- Pekare ---------- */

    function toModel(e) {
      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const p = pt.matrixTransform(svg.getScreenCTM().inverse());
      return { x: M.clamp((p.x / W) * 100, -4, 104), y: M.clamp((p.y / L) * 100, -3, 103) };
    }

    let activePointer = null;

    svg.addEventListener('pointerdown', (e) => {
      if (activePointer !== null || (e.pointerType === 'mouse' && e.button !== 0)) return;
      activePointer = e.pointerId;
      svg.setPointerCapture(e.pointerId);
      const hit = e.target.closest('[data-kind]');
      const kind = hit ? hit.dataset.kind : 'pitch';
      handlers.down({
        kind,
        id: hit && hit.dataset.id,
        index: hit && hit.dataset.index != null ? Number(hit.dataset.index) : null,
        pt: toModel(e),
      });
      e.preventDefault();
    });
    svg.addEventListener('pointermove', (e) => {
      if (e.pointerId !== activePointer) return;
      handlers.move(toModel(e));
    });
    const end = (e) => {
      if (e.pointerId !== activePointer) return;
      activePointer = null;
      handlers.up(toModel(e));
    };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);

    return { render };
  }

  window.TacticsBoard = { createBoard };
})();
