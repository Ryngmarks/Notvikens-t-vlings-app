/*
 * Datalager. Appen anropar bara funktionerna i `Store` (alla async).
 *
 *  - Supabase-läge: om SUPABASE_URL och SUPABASE_KEY är ifyllda i js/config.js.
 *    Pratar direkt med Supabase REST-API (PostgREST) via fetch – inget bibliotek behövs.
 *  - Demo-läge: annars. Påhittad data som sparas i webbläsarens localStorage.
 *
 * Tabeller (se supabase/schema.sql):
 *   players            id, name, active, created_at
 *   training_sessions  id, date, created_at
 *   results            id, training_session_id, player_id, game_type, result, created_at
 *
 * En "omgång" = alla results med samma training_session_id + created_at.
 */
(function () {
  const cfg = window.APP_CONFIG || {};
  const clone = (x) => JSON.parse(JSON.stringify(x));

  /* ================= Supabase ================= */

  function createSupabaseStore(baseUrl, key) {
    const api = baseUrl.replace(/\/+$/, '') + '/rest/v1/';
    const PAGE = 1000; // Supabase returnerar max 1000 rader per anrop

    // Nya nycklar (sb_publishable_…) skickas bara som apikey.
    // Äldre anon-nycklar är JWT:er (eyJ…) och skickas även som Bearer-token.
    const auth = key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {};

    async function request(path, { method = 'GET', body, headers = {} } = {}) {
      const res = await fetch(api + path, {
        method,
        headers: {
          apikey: key,
          ...auth,
          'Content-Type': 'application/json',
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!res.ok) {
        let msg = res.statusText;
        try { msg = (await res.json()).message || msg; } catch (e) { /* ignorera */ }
        throw new Error(`Supabase ${res.status}: ${msg}`);
      }
      return res.status === 204 ? null : res.json();
    }

    // Hämtar alla rader, sida för sida
    async function selectAll(table, columns, order) {
      const rows = [];
      for (let from = 0; ; from += PAGE) {
        const page = await request(`${table}?select=${columns}&order=${order}`, {
          headers: { Range: `${from}-${from + PAGE - 1}` },
        });
        rows.push(...page);
        if (page.length < PAGE) return rows;
      }
    }

    const insert = (table, rows) =>
      request(table, { method: 'POST', body: rows, headers: { Prefer: 'return=representation' } });

    return {
      mode: 'supabase',

      listPlayers: () => selectAll('players', 'id,name,active,created_at', 'created_at.asc,id.asc'),

      async addPlayer(name) {
        const [p] = await insert('players', [{ name: name.trim() }]);
        return p;
      },

      async updatePlayer(id, patch) {
        const body = {};
        if ('name' in patch) body.name = String(patch.name).trim();
        if ('active' in patch) body.active = !!patch.active;
        const [p] = await request(`players?id=eq.${encodeURIComponent(id)}`, {
          method: 'PATCH', body, headers: { Prefer: 'return=representation' },
        });
        if (!p) throw new Error('Spelare saknas');
        return p;
      },

      async createSession(date) {
        const [s] = await insert('training_sessions', [{ date }]);
        return s;
      },

      /** entries: [{ player_id, result: 'win' | 'loss' }] */
      addRound(sessionId, gameType, entries) {
        const created_at = new Date().toISOString(); // samma tid = samma omgång
        return insert('results', entries.map((e) => ({
          training_session_id: sessionId,
          player_id: e.player_id,
          game_type: gameType,
          result: e.result,
          created_at,
        })));
      },

      listSessions: () => selectAll('training_sessions', 'id,date,created_at', 'created_at.asc,id.asc'),

      listResults: () =>
        selectAll('results', 'id,training_session_id,player_id,game_type,result,created_at', 'created_at.asc,id.asc'),
    };
  }

  /* ================= Demo (localStorage) ================= */

  function createDemoStore() {
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

    return {
      mode: 'demo',

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
  }

  const supabaseKey = (cfg.SUPABASE_KEY || cfg.SUPABASE_ANON_KEY || '').trim();
  window.Store = cfg.SUPABASE_URL && supabaseKey
    ? createSupabaseStore(cfg.SUPABASE_URL.trim(), supabaseKey)
    : createDemoStore();
})();
