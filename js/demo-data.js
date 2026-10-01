/*
 * Demo-data för prototypen.
 * Genererar spelare, träningar och resultat med samma struktur som
 * Supabase-tabellerna (players, training_sessions, results).
 * Slumpen är seedad så att demon ser likadan ut varje gång.
 */
(function () {
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function uid(rand) {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.floor(rand() * 16);
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  function shuffle(arr, rand) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // [namn, "form" (påverkar vinstchans), aktiv]
  const ROSTER = [
    ['Johan', 0.92, true], ['Erik', 0.85, true], ['Marcus', 0.78, true],
    ['Anton', 0.62, true], ['David', 0.35, true], ['Simon', 0.7, true],
    ['Oscar', 0.66, true], ['Viktor', 0.55, true], ['Filip', 0.5, true],
    ['Linus', 0.74, true], ['Emil', 0.45, true], ['Gustav', 0.58, true],
    ['Albin', 0.4, true], ['Hampus', 0.82, true], ['Jonas', 0.3, true],
    ['Rasmus', 0.52, true], ['Elias', 0.6, true], ['Niklas', 0.48, false],
  ];

  function generate() {
    const rand = mulberry32(20261001);
    const now = new Date();
    const players = ROSTER.map(([name, form, active], i) => ({
      id: uid(rand),
      name,
      active,
      created_at: new Date(now.getTime() - (120 - i) * 864e5).toISOString(),
      _form: form,
    }));

    const sessions = [];
    const results = [];
    const TRAININGS = 18;

    for (let s = 0; s < TRAININGS; s++) {
      // Två träningar i veckan bakåt i tiden
      const daysAgo = (TRAININGS - s) * 3.5 + 1;
      const date = new Date(now.getTime() - Math.round(daysAgo) * 864e5);
      date.setHours(18, 0, 0, 0);
      const session = {
        id: uid(rand),
        date: date.toISOString().slice(0, 10),
        created_at: date.toISOString(),
      };
      sessions.push(session);

      const pool = players.filter((p) => p.active || s < 8);
      const count = 8 + Math.floor(rand() * 7); // 8–14 deltagare
      const participants = shuffle(pool, rand).slice(0, count);
      const rounds = 3 + Math.floor(rand() * 4); // 3–6 omgångar

      for (let r = 0; r < rounds; r++) {
        const g = rand();
        const gameType = g < 0.48 ? 'small' : g < 0.82 ? 'medium' : 'large';
        const roundTime = new Date(date.getTime() + r * 14 * 60e3).toISOString();
        const mixed = shuffle(participants, rand);
        const half = Math.ceil(mixed.length / 2);
        const teamA = mixed.slice(0, half);
        const teamB = mixed.slice(half);
        const strength = (team) =>
          team.reduce((sum, p) => sum + p._form, 0) / team.length + (rand() - 0.5) * 0.55;
        const aWins = strength(teamA) >= strength(teamB);

        const push = (team, won) =>
          team.forEach((p) =>
            results.push({
              id: uid(rand),
              training_session_id: session.id,
              player_id: p.id,
              game_type: gameType,
              result: won ? 'win' : 'loss',
              created_at: roundTime,
            })
          );
        push(teamA, aWins);
        push(teamB, !aWins);
      }
    }

    players.forEach((p) => delete p._form);
    return { players, sessions, results };
  }

  window.DemoData = { generate };
})();
