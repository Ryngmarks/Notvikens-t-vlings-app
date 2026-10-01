/*
 * Datalager.
 *
 * Just nu: demo-läge som sparar i localStorage.
 * Senare: byt ut implementationen mot Supabase – appen anropar bara
 * funktionerna nedan (alla är async), så resten av koden påverkas inte.
 *
 * Tabeller (se supabase/schema.sql):
 *   players            id, name, active, created_at
 *   training_sessions  id, date, created_at
 *   results            id, training_session_id, player_id, game_type, result, created_at
 *
 * En "omgång" = alla results med samma training_session_id + created_at.
 */
(function () {
  const KEY = 'notviken-traningsliga-demo-v1';

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignorera */ }
    const fresh = window.DemoData.generate();
    save(fresh);
    return fresh;
  }

  function save(data) {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* ignorera */ }
  }

  const newId = () =>
    (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

  let db = load();
  const clone = (x) => JSON.parse(JSON.stringify(x));

  const Store = {
    async listPlayers() {
      return clone(db.players);
    },

    async addPlayer(name) {
      const player = { id: newId(), name: name.trim(), active: true, created_at: new Date().toISOString() };
      db.players.push(player);
      save(db);
      return clone(player);
    },

    async updatePlayer(id, patch) {
      const p = db.players.find((x) => x.id === id);
      if (!p) throw new Error('Spelare saknas');
      if ('name' in patch) p.name = String(patch.name).trim();
      if ('active' in patch) p.active = !!patch.active;
      save(db);
      return clone(p);
    },

    async createSession(date) {
      const session = { id: newId(), date, created_at: new Date().toISOString() };
      db.sessions.push(session);
      save(db);
      return clone(session);
    },

    /** entries: [{ player_id, result: 'win' | 'loss' }] */
    async addRound(sessionId, gameType, entries) {
      const created_at = new Date().toISOString();
      const rows = entries.map((e) => ({
        id: newId(),
        training_session_id: sessionId,
        player_id: e.player_id,
        game_type: gameType,
        result: e.result,
        created_at,
      }));
      db.results.push(...rows);
      save(db);
      return clone(rows);
    },

    async listSessions() {
      return clone(db.sessions);
    },

    async listResults() {
      return clone(db.results);
    },

    async resetDemo() {
      localStorage.removeItem(KEY);
      db = load();
    },
  };

  window.Store = Store;
})();
