# Notvikens IK – Träningsliga

En enkel, mobilanpassad webbapp för lagets interna tävling: vem vinner och förlorar mest i träningsspelen.

**Flöde:** Ny träning → välj deltagare → välj speltyp (5v5 / 7v7 / 11v11) → markera WIN/LOSS → leaderboarden uppdateras.

## Kör lokalt

Ingen byggprocess. Öppna `index.html` direkt, eller starta en enkel server:

```bash
python3 -m http.server 8000
# öppna http://localhost:8000
```

## Demo eller Supabase

Appen väljer läge automatiskt utifrån `js/config.js`:

- **Tomma fält → demo-läge.** Påhittad data (18 spelare, 18 träningar) sparas i webbläsaren.
  "Återställ demo-data" längst ned på Spelare-sidan nollställer.
- **Ifyllda fält → Supabase.** All data sparas i databasen och delas mellan alla som öppnar appen.

## Struktur

```
index.html           alla vyer (tavla, ny träning, spelare)
css/styles.css       design – tema-variabler överst
js/app.js            gränssnitt och logik
js/config.js         Supabase-nycklar
js/store.js          datalager (Supabase eller demo)
js/demo-data.js      demo-data
js/tactics/          taktiktavla: model.js (data + formationer + pressdemo),
                     engine.js (animation), board.js (SVG-plan), tactics.js (gränssnitt)
assets/logo.png      lagets emblem
supabase/schema.sql  tabeller för Supabase
```

## Logotyp & färger

- Loggan ligger i `assets/logo.png` – byt filen för att byta logga.
- Valfritt: lägg ett stämningsfoto som `assets/hero.jpg` så visas det (svartvitt, tonat) bakom toppen på tavlan. Utan foto används en CSS-version med strålkastare.
- Färgerna styrs av CSS-variablerna överst i `css/styles.css`:
  `--primary`, `--secondary`, `--accent`, `--background`, `--surface`, `--text`, `--muted`.

## Koppla på Supabase

1. Skapa ett projekt på [supabase.com](https://supabase.com) (gratisnivån räcker).
2. **SQL Editor → New query**, klistra in hela `supabase/schema.sql` och kör.
3. Kopiera två värden (finns även under knappen **Connect** högst upp i projektet):
   - **Project Settings → Data API → Project URL**
   - **Project Settings → API Keys → Publishable key** (`sb_publishable_…`).
     Äldre projekt: fliken *Legacy API Keys* → *anon public* (`eyJ…`). Båda fungerar.
4. Klistra in dem i `js/config.js` (`SUPABASE_URL` och `SUPABASE_KEY`).

Publishable-/anon-nyckeln är gjord för att ligga i webbläsaren, så den får finnas i koden.
Använd aldrig *Secret key* / *service_role* – appen vägrar använda en sådan.

## Inloggning

I Supabase-läge måste man logga in med e-post och lösenord. Skyddet sitter i databasen:
utan inloggning svarar Supabase inte med någon data och tar inte emot något, oavsett
vilken adress man går till eller vad man gör i webbläsaren.

1. **Stäng av egen registrering:** *Authentication → Sign In / Providers* →
   stäng av **Allow new users to sign up**. Annars kan vem som helst skapa ett konto.
2. **Skapa konton:** *Authentication → Users → Add user → Create new user*.
   Fyll i e-post och lösenord och kryssa i **Auto Confirm User**.
   Ett gemensamt lagkonto räcker, eller ett per ledare.
3. Ta bort en användare i samma lista för att stänga ute någon.

Med **Kom ihåg mig** (förvalt) sparas e-posten och man förblir inloggad tills man trycker
**Logga ut** (längst ned på Spelare). Utan den loggas man ut när webbläsaren stängs –
bra på en lånad telefon. Lösenordet sparas av telefonens/webbläsarens egen lösenordshanterare
(iCloud-nyckelring, Google m.fl.), aldrig av appen.

En "omgång" = alla `results` med samma `training_session_id` och `created_at`.

## Taktiktavla

Knappen **Taktik** uppe till höger på tavlan visas bara för den som har behörighet.
Behörigheten kontrolleras i databasen (tabellen `tactics_access`), så det går inte att ta sig
förbi genom att skriva adressen `#/taktik` direkt.

**Ge fler tillgång** (Supabase → SQL Editor):

```sql
insert into tactics_access (email) values ('namn@exempel.se');
```

**Ta bort tillgång:**

```sql
delete from tactics_access where email = 'namn@exempel.se';
```

Personen måste också ha ett inloggningskonto (Authentication → Users).

Taktiker sparas som JSON i tabellen `tactics` (en rad per taktik). Positioner lagras relativt
(x/y 0–100), så taktiken ser likadan ut på alla skärmar. I demo-läget sparas de i webbläsaren.

Kortkommandon på dator: **Mellanslag** play/paus, **←/→** steg, **N** nytt steg,
**V/R/P/D** verktyg, **Delete** ta bort vald pil, **Ctrl+Z** ångra.
