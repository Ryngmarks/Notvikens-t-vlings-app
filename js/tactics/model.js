/*
 * Taktiktavla – datamodell (ingen DOM här).
 *
 * Koordinater är relativa: x = 0–100 över planens bredd, y = 0–100 längs planen.
 * Lag A (gult) försvarar nedre målet (y = 100) och anfaller uppåt.
 * Lag B (rött) försvarar övre målet (y = 0).
 *
 * scenario = {
 *   version, name, speed, labelMode: 'number' | 'pos' | 'name',
 *   formations: { A, B },
 *   players: [{ id, team, num, pos, name }],
 *   frames: [{
 *     id, duration,                       // sekunder för övergången till nästa frame
 *     positions: { [playerId]: { x, y } },
 *     ball: { x, y, owner },               // owner = playerId när en spelare har bollen
 *     arrows: [{ type: 'run' | 'pass' | 'dribble', x1, y1, x2, y2, team }]
 *   }]
 * }
 */
(function () {
  const PITCH = { width: 68, length: 105 }; // meter, för ritning och avstånd
  const DEFAULT_DURATION = 1.8;

  // [position, nummer, x, y] för lag A (anfaller uppåt). Lag B speglas.
  const FORMATIONS = {
    '4-3-3': [
      ['GK', 1, 50, 95], ['RB', 2, 85, 77], ['CB', 4, 62, 82], ['CB', 5, 38, 82], ['LB', 3, 15, 77],
      ['DM', 6, 50, 70], ['CM', 8, 66, 63], ['CM', 10, 34, 63],
      ['RW', 7, 82, 55], ['ST', 9, 50, 53], ['LW', 11, 18, 55],
    ],
    '4-2-3-1': [
      ['GK', 1, 50, 95], ['RB', 2, 85, 77], ['CB', 4, 62, 82], ['CB', 5, 38, 82], ['LB', 3, 15, 77],
      ['DM', 6, 60, 69], ['DM', 8, 40, 69],
      ['RW', 7, 82, 58], ['AM', 10, 50, 60], ['LW', 11, 18, 58], ['ST', 9, 50, 52],
    ],
    '4-4-2': [
      ['GK', 1, 50, 95], ['RB', 2, 85, 77], ['CB', 4, 62, 82], ['CB', 5, 38, 82], ['LB', 3, 15, 77],
      ['RM', 7, 85, 64], ['CM', 8, 62, 67], ['CM', 6, 38, 67], ['LM', 11, 15, 64],
      ['ST', 9, 40, 53], ['ST', 10, 60, 53],
    ],
    '3-4-3': [
      ['GK', 1, 50, 95], ['CB', 4, 72, 81], ['CB', 5, 50, 84], ['CB', 3, 28, 81],
      ['RWB', 2, 88, 66], ['CM', 8, 62, 67], ['CM', 6, 38, 67], ['LWB', 11, 12, 66],
      ['RW', 7, 78, 55], ['ST', 9, 50, 53], ['LW', 10, 22, 55],
    ],
    '3-5-2': [
      ['GK', 1, 50, 95], ['CB', 4, 72, 81], ['CB', 5, 50, 84], ['CB', 3, 28, 81],
      ['RWB', 2, 90, 64], ['CM', 8, 66, 63], ['DM', 6, 50, 69], ['CM', 10, 34, 63], ['LWB', 11, 10, 64],
      ['ST', 9, 42, 53], ['ST', 7, 58, 53],
    ],
  };

  const clone = (x) => JSON.parse(JSON.stringify(x));
  const uid = () => Math.random().toString(36).slice(2, 10);
  const round = (v) => Math.round(v * 100) / 100;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  const playerIds = (team) => Array.from({ length: 11 }, (_, i) => `${team}${i + 1}`);

  function slotPosition(team, slot) {
    const [, , x, y] = slot;
    return team === 'A' ? { x, y } : { x: 100 - x, y: 100 - y };
  }

  /** Placerar ett lag enligt formation i en frame och sätter position/nummer. */
  function applyFormation(scenario, frame, team, name) {
    const slots = FORMATIONS[name];
    if (!slots) return;
    playerIds(team).forEach((id, i) => {
      frame.positions[id] = slotPosition(team, slots[i]);
      const def = scenario.players.find((p) => p.id === id);
      if (def) { def.pos = slots[i][0]; def.num = slots[i][1]; }
    });
    scenario.formations[team] = name;
  }

  function newScenario(name = 'Ny taktik', formationA = '4-3-3', formationB = '4-3-3') {
    const scenario = {
      version: 1,
      name,
      speed: 1,
      labelMode: 'number',
      formations: { A: formationA, B: formationB },
      players: ['A', 'B'].flatMap((team) => playerIds(team).map((id) => ({ id, team, num: 0, pos: '', name: '' }))),
      frames: [{ id: uid(), duration: DEFAULT_DURATION, positions: {}, ball: { x: 50, y: 50, owner: null }, arrows: [] }],
    };
    applyFormation(scenario, scenario.frames[0], 'A', formationA);
    applyFormation(scenario, scenario.frames[0], 'B', formationB);
    return scenario;
  }

  /* ---------- Frames ---------- */

  /** Nytt steg efter `index`: samma positioner och boll, inga pilar. */
  function addFrame(scenario, index) {
    const src = scenario.frames[index];
    const frame = { ...clone(src), id: uid(), arrows: [] };
    scenario.frames.splice(index + 1, 0, frame);
    return index + 1;
  }

  function duplicateFrame(scenario, index) {
    scenario.frames.splice(index + 1, 0, { ...clone(scenario.frames[index]), id: uid() });
    return index + 1;
  }

  function deleteFrame(scenario, index) {
    if (scenario.frames.length <= 1) return index;
    scenario.frames.splice(index, 1);
    return Math.min(index, scenario.frames.length - 1);
  }

  /* ---------- Boll ---------- */

  // Bollen ligger lite framför spelaren som har den
  function ballOffset(team) {
    return team === 'B' ? { x: -3, y: 2.2 } : { x: 3, y: -2.2 }; // ≈ 3 m snett framför
  }

  function teamOf(id) { return id && id[0]; }

  function ballAt(ball, positions) {
    if (ball.owner && positions[ball.owner]) {
      const p = positions[ball.owner];
      const o = ballOffset(teamOf(ball.owner));
      return { x: p.x + o.x, y: p.y + o.y };
    }
    return { x: ball.x, y: ball.y };
  }

  /** Spelare närmast punkten inom `maxMeters`, annars null. */
  function nearestPlayer(positions, pt, maxMeters = 3) {
    let best = null;
    let bestD = Infinity;
    for (const [id, p] of Object.entries(positions)) {
      const d = distanceMeters(p, pt);
      if (d < bestD) { bestD = d; best = id; }
    }
    return bestD <= maxMeters ? best : null;
  }

  function distanceMeters(a, b) {
    const dx = (a.x - b.x) * PITCH.width / 100;
    const dy = (a.y - b.y) * PITCH.length / 100;
    return Math.hypot(dx, dy);
  }

  /* ---------- Interpolering ---------- */

  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  /**
   * Läget mellan frame `i` och `i + 1` vid `progress` (0–1, redan easad).
   * Returnerar { positions, ball }.
   */
  function interpolate(scenario, i, progress) {
    const a = scenario.frames[i];
    const b = scenario.frames[Math.min(i + 1, scenario.frames.length - 1)];
    const positions = {};
    for (const id of Object.keys(a.positions)) {
      const pa = a.positions[id];
      const pb = b.positions[id] || pa;
      positions[id] = { x: lerp(pa.x, pb.x, progress), y: lerp(pa.y, pb.y, progress) };
    }

    const ownerA = a.ball.owner;
    const ownerB = b.ball.owner;
    let ball;
    if (ownerA && ownerA === ownerB) {
      // Samma spelare har bollen: den följer med (dribbling/löpning med boll)
      ball = ballAt(a.ball, positions);
    } else {
      // Passning eller fri boll: från avsändaren till mottagaren, även om mottagaren rör sig
      const start = ownerA ? ballAt(a.ball, positions) : { x: a.ball.x, y: a.ball.y };
      const end = ownerB ? ballAt(b.ball, positions) : { x: b.ball.x, y: b.ball.y };
      ball = { x: lerp(start.x, end.x, progress), y: lerp(start.y, end.y, progress) };
    }
    return { positions, ball };
  }

  /** Statiskt läge för en frame (när man redigerar). */
  function frameState(scenario, i) {
    const f = scenario.frames[i];
    return { positions: f.positions, ball: ballAt(f.ball, f.positions) };
  }

  /* ---------- Normalisering vid inläsning ---------- */

  function normalize(data) {
    const s = clone(data);
    s.version = s.version || 1;
    s.speed = s.speed || 1;
    s.labelMode = s.labelMode || 'number';
    s.formations = s.formations || { A: '4-3-3', B: '4-3-3' };
    s.frames.forEach((f) => {
      f.id = f.id || uid();
      f.duration = f.duration || DEFAULT_DURATION;
      f.arrows = f.arrows || [];
      f.ball = f.ball || { x: 50, y: 50, owner: null };
    });
    return s;
  }

  /* ---------- Demo: högt presspel ---------- */

  function pressDemo() {
    const s = newScenario('Demo: Högt presspel mot 4-3-3', '4-3-3', '4-3-3');

    // Demot anger spelare som lag + tröjnummer, t.ex. 'A9' = gula nian
    const id = (key) => s.players.find((p) => p.team === key[0] && p.num === Number(key.slice(1))).id;
    const P = (list) => Object.fromEntries(list.map(([key, x, y]) => [id(key), { x, y }]));
    // Motståndarna (B) bygger upp i 4-3-3
    const B1 = [['B1', 50, 4], ['B2', 10, 26], ['B4', 32, 13], ['B5', 68, 13], ['B3', 90, 26],
      ['B6', 50, 24], ['B8', 33, 36], ['B10', 67, 36], ['B7', 12, 48], ['B9', 55, 61], ['B11', 88, 48]];
    // Gult i mellanhögt block, redo att trigga pressen
    const A1 = [['A1', 50, 94], ['A2', 84, 66], ['A4', 60, 72], ['A5', 40, 72], ['A3', 16, 66],
      ['A6', 50, 56], ['A8', 64, 48], ['A10', 38, 44], ['A7', 80, 36], ['A9', 50, 32], ['A11', 20, 36]];

    const f1 = s.frames[0];
    f1.positions = P([...B1, ...A1]);
    f1.ball = { x: 50, y: 6, owner: id('B1') };
    f1.arrows = [
      { type: 'pass', x1: 50, y1: 6, x2: 31, y2: 15, team: 'B' },
      { type: 'run', x1: 50, y1: 32, x2: 42, y2: 19, team: 'A' },
      { type: 'run', x1: 20, y1: 36, x2: 18, y2: 30, team: 'A' },
      { type: 'run', x1: 38, y1: 44, x2: 47, y2: 32, team: 'A' },
    ];

    // Frame 2: MV spelar till mittbacken – pressen triggas
    const f2 = { id: uid(), duration: DEFAULT_DURATION, ball: { x: 30, y: 14, owner: id('B4') }, arrows: [] };
    f2.positions = P([
      ['B1', 50, 5], ['B2', 10, 27], ['B4', 30, 14], ['B5', 68, 14], ['B3', 90, 27],
      ['B6', 50, 25], ['B8', 32, 37], ['B10', 67, 36], ['B7', 12, 48], ['B9', 52, 60], ['B11', 88, 48],
      ['A1', 50, 86], ['A2', 78, 58], ['A4', 56, 62], ['A5', 36, 62], ['A3', 14, 56],
      ['A6', 42, 46], ['A8', 62, 38], ['A10', 48, 30], ['A7', 64, 24], ['A9', 42, 17], ['A11', 18, 28],
    ]);
    f2.arrows = [
      { type: 'pass', x1: 30, y1: 14, x2: 11, y2: 29, team: 'B' },
      { type: 'run', x1: 18, y1: 28, x2: 14, y2: 31, team: 'A' },
      { type: 'run', x1: 42, y1: 17, x2: 22, y2: 21, team: 'A' },
      { type: 'run', x1: 42, y1: 46, x2: 31, y2: 45, team: 'A' },
    ];

    // Frame 3: bollen till ytterbacken – yttern pressar, nian stänger returen
    const f3 = { id: uid(), duration: DEFAULT_DURATION, ball: { x: 10, y: 30, owner: id('B2') }, arrows: [] };
    f3.positions = P([
      ['B1', 46, 6], ['B2', 10, 30], ['B4', 30, 14], ['B5', 66, 16], ['B3', 88, 30],
      ['B6', 44, 26], ['B8', 28, 40], ['B10', 62, 38], ['B7', 12, 46], ['B9', 48, 60], ['B11', 84, 50],
      ['A1', 48, 80], ['A2', 68, 54], ['A4', 50, 56], ['A5', 32, 56], ['A3', 15, 50],
      ['A6', 31, 45], ['A8', 46, 40], ['A10', 40, 30], ['A7', 54, 24], ['A9', 21, 21], ['A11', 14, 32],
    ]);
    f3.arrows = [
      { type: 'pass', x1: 10, y1: 30, x2: 12, y2: 44, team: 'B' },
      { type: 'run', x1: 15, y1: 50, x2: 14, y2: 45, team: 'A' },
    ];

    // Frame 4: passningen längs linjen bryts – återerövring
    const f4 = { id: uid(), duration: DEFAULT_DURATION, ball: { x: 14, y: 44, owner: id('A3') }, arrows: [] };
    f4.positions = P([
      ['B1', 46, 6], ['B2', 10, 31], ['B4', 30, 15], ['B5', 64, 17], ['B3', 86, 31],
      ['B6', 42, 27], ['B8', 27, 41], ['B10', 60, 39], ['B7', 13, 49], ['B9', 53, 63], ['B11', 82, 51],
      ['A1', 48, 80], ['A2', 66, 56], ['A4', 48, 58], ['A5', 30, 56], ['A3', 14, 44],
      ['A6', 26, 44], ['A8', 42, 40], ['A10', 38, 32], ['A7', 52, 26], ['A9', 22, 24], ['A11', 13, 34],
    ]);
    f4.arrows = [
      { type: 'dribble', x1: 15, y1: 43, x2: 26, y2: 34, team: 'A' },
      { type: 'run', x1: 52, y1: 26, x2: 50, y2: 14, team: 'A' },
    ];

    s.frames.push(f2, f3, f4);
    return s;
  }

  window.TacticsModel = {
    PITCH, FORMATIONS, DEFAULT_DURATION,
    clone, clamp, round, easeInOut,
    newScenario, applyFormation, addFrame, duplicateFrame, deleteFrame,
    interpolate, frameState, ballAt, nearestPlayer, distanceMeters, normalize, pressDemo,
  };
})();
