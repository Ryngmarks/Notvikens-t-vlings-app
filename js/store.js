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
    // Tål att adressen klistrats in med /rest/v1/ på slutet
    const root = baseUrl.trim().replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
    const api = root + '/rest/v1/';
    const authApi = root + '/auth/v1/';
    const PAGE = 1000; // Supabase returnerar max 1000 rader per anrop
    const SESSION_KEY = 'notviken-auth-session';

    /* ---------- Inloggning (Supabase Auth) ----------
       Databasen svarar bara inloggade användare (se schema.sql),
       så utan giltig inloggning går ingen data att läsa eller skriva. */

    // "Kom ihåg mig": localStorage (kvar tills man loggar ut).
    // Annars sessionStorage (borta när webbläsaren stängs).
    let session = null; // { access_token, refresh_token, expires_at, email }
    let storage = window.localStorage;
    try {
      const fromSession = sessionStorage.getItem(SESSION_KEY);
      if (fromSession) { session = JSON.parse(fromSession); storage = window.sessionStorage; }
      else session = JSON.parse(localStorage.getItem(SESSION_KEY));
    } catch (e) { /* ignorera */ }

    function setSession(s) {
      session = s;
      try {
        localStorage.removeItem(SESSION_KEY);
        sessionStorage.removeItem(SESSION_KEY);
        if (s) storage.setItem(SESSION_KEY, JSON.stringify(s));
      } catch (e) { /* ignorera */ }
    }

    function authError(msg) {
      const err = new Error(msg);
      err.code = 'auth';
      return err;
    }

    async function authRequest(path, body, token) {
      const res = await fetch(authApi + path, {
        method: 'POST',
        headers: {
          apikey: key,
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body || {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const e = new Error(data.msg || data.error_description || data.message || res.statusText);
        e.status = res.status;
        e.errorCode = data.error_code || data.error;
        throw e;
      }
      return data;
    }

    function toSession(d) {
      return {
        access_token: d.access_token,
        refresh_token: d.refresh_token,
        expires_at: d.expires_at || Math.floor(Date.now() / 1000) + (d.expires_in || 3600),
        email: d.user && d.user.email,
      };
    }

    // Delas så att flera samtidiga anrop bara förnyar en gång
    let refreshing = null;
    function refreshSession() {
      if (!session) return Promise.reject(authError('Inte inloggad'));
      if (!refreshing) {
        refreshing = authRequest('token?grant_type=refresh_token', { refresh_token: session.refresh_token })
          .then((d) => setSession(toSession(d)))
          .catch((e) => {
            // Bara ett nekat svar loggar ut – inte ett tillfälligt nätverksfel
            if (e.status >= 400 && e.status < 500) setSession(null);
            throw e.status ? authError('Inloggningen har gått ut') : e;
          })
          .finally(() => { refreshing = null; });
      }
      return refreshing;
    }

    async function accessToken() {
      if (!session) throw authError('Inte inloggad');
      if (session.expires_at - 60 < Date.now() / 1000) await refreshSession();
      return session.access_token;
    }

    async function request(path, { method = 'GET', body, headers = {} } = {}, retried = false) {
      const token = await accessToken();
      const res = await fetch(api + path, {
        method,
        headers: {
          apikey: key,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (res.status === 401 && !retried) {
        await refreshSession();
        return request(path, { method, body, headers }, true);
      }
      if (!res.ok) {
        let msg = res.statusText;
        try { msg = (await res.json()).message || msg; } catch (e) { /* ignorera */ }
        if (res.status === 401) { setSession(null); throw authError(msg); }
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
      requiresLogin: true,
      isLoggedIn: () => !!session,
      userEmail: () => (session && session.email) || '',

      async signIn(email, password, remember = true) {
        storage = remember ? window.localStorage : window.sessionStorage;
        try {
          const d = await authRequest('token?grant_type=password', { email: email.trim(), password });
          setSession(toSession(d));
        } catch (e) {
          if (e.status === 400 || e.errorCode === 'invalid_credentials' || e.errorCode === 'invalid_grant') {
            throw authError('Fel e-post eller lösenord');
          }
          throw e;
        }
      },

      async signOut() {
        const token = session && session.access_token;
        setSession(null);
        if (token) { try { await authRequest('logout', {}, token); } catch (e) { /* utloggad lokalt ändå */ } }
      },

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

      /* ---------- Taktiktavla ----------
         Behörighet styrs i databasen (tabellen tactics_access, se schema.sql). */

      async canUseTactics() {
        try {
          return (await request('rpc/has_tactics_access', { method: 'POST', body: {} })) === true;
        } catch (e) {
          if (e.code === 'auth') throw e;
          return false; // t.ex. om schemat för taktiker inte är kört än
        }
      },

      listTactics: () => request('tactics?select=id,name,updated_at&order=updated_at.desc'),

      async getTactic(id) {
        const [row] = await request(`tactics?id=eq.${encodeURIComponent(id)}&select=id,name,scenario_data,updated_at`);
        return row || null;
      },

      async saveTactic({ id, name, scenario_data }) {
        if (id) {
          const [row] = await request(`tactics?id=eq.${encodeURIComponent(id)}&select=id,name,updated_at`, {
            method: 'PATCH', body: { name, scenario_data }, headers: { Prefer: 'return=representation' },
          });
          if (row) return row;
        }
        const [row] = await request('tactics?select=id,name,updated_at', {
          method: 'POST', body: [{ name, scenario_data }], headers: { Prefer: 'return=representation' },
        });
        return row;
      },

      deleteTactic: (id) => request(`tactics?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' }),
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

    const TACTICS_KEY = 'notviken-tactics-demo-v1';
    function loadTactics() {
      try { return JSON.parse(localStorage.getItem(TACTICS_KEY)) || []; } catch (e) { return []; }
    }
    function saveTactics(list) {
      try { localStorage.setItem(TACTICS_KEY, JSON.stringify(list)); } catch (e) { /* ignorera */ }
    }

    return {
      mode: 'demo',
      requiresLogin: false,
      isLoggedIn: () => true,
      userEmail: () => '',
      async signIn() {},
      async signOut() {},

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

      /* ---------- Taktiktavla (demo: sparas i webbläsaren) ---------- */

      async canUseTactics() { return true; },

      async listTactics() {
        return loadTactics()
          .map(({ id, name, updated_at }) => ({ id, name, updated_at }))
          .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      },

      async getTactic(id) {
        const row = loadTactics().find((t) => t.id === id);
        return row ? clone(row) : null;
      },

      async saveTactic({ id, name, scenario_data }) {
        const list = loadTactics();
        const now = new Date().toISOString();
        let row = id && list.find((t) => t.id === id);
        if (row) Object.assign(row, { name, scenario_data, updated_at: now });
        else list.push(row = { id: newId(), name, scenario_data, created_at: now, updated_at: now });
        saveTactics(list);
        return { id: row.id, name: row.name, updated_at: row.updated_at };
      },

      async deleteTactic(id) {
        saveTactics(loadTactics().filter((t) => t.id !== id));
      },
    };
  }

  let supabaseKey = (cfg.SUPABASE_KEY || cfg.SUPABASE_ANON_KEY || '').trim();

  // Spärr: hemliga nycklar ger full åtkomst och får aldrig ligga i webbläsaren
  const isSecret = (k) => {
    if (k.startsWith('sb_secret_')) return true;
    try { return JSON.parse(atob(k.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role === 'service_role'; }
    catch (e) { return false; }
  };
  if (supabaseKey && isSecret(supabaseKey)) {
    console.error('js/config.js innehåller en HEMLIG Supabase-nyckel. Använd "Publishable key" (sb_publishable_…) och byt ut den hemliga nyckeln i Supabase.');
    alert('Fel nyckel i js/config.js: det är en hemlig nyckel. Använd "Publishable key" (sb_publishable_…). Appen körs i demo-läge tills det är rättat.');
    supabaseKey = '';
  }

  window.Store = cfg.SUPABASE_URL && supabaseKey
    ? createSupabaseStore(cfg.SUPABASE_URL.trim(), supabaseKey)
    : createDemoStore();
})();
