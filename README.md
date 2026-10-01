# Notvikens IK – Träningsliga

En enkel, mobilanpassad webbapp för lagets interna tävling: vem vinner och förlorar mest i träningsspelen.

**Flöde:** Ny träning → välj deltagare → välj speltyp (5v5 / 7v7 / 11v11) → markera WIN/LOSS → leaderboarden uppdateras.

## Kör lokalt

Ingen byggprocess. Öppna `index.html` direkt, eller starta en enkel server:

```bash
python3 -m http.server 8000
# öppna http://localhost:8000
```

## Läge just nu: demo

Data genereras i `js/demo-data.js` (18 spelare, 18 träningar) och sparas i webbläsarens localStorage.
"Återställ demo-data" längst ned på Spelare-sidan nollställer.

## Struktur

```
index.html           alla vyer (tavla, ny träning, spelare)
css/styles.css       design – tema-variabler överst
js/app.js            gränssnitt och logik
js/store.js          datalager (byts mot Supabase)
js/demo-data.js      demo-data
assets/logo.png      lagets emblem
supabase/schema.sql  tabeller för Supabase
```

## Logotyp & färger

- Loggan ligger i `assets/logo.png` – byt filen för att byta logga.
- Färgerna styrs av CSS-variablerna överst i `css/styles.css`:
  `--primary`, `--secondary`, `--accent`, `--background`, `--surface`, `--text`, `--muted`.

## Supabase (nästa steg)

1. Kör `supabase/schema.sql` i Supabase.
2. Byt implementationen i `js/store.js` mot Supabase-anrop – samma funktioner, inget annat i appen behöver ändras.

En "omgång" = alla `results` med samma `training_session_id` och `created_at`.
