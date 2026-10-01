/*
 * Supabase-inställningar. Lämnas fälten tomma körs appen i demo-läge.
 *
 * Hitta värdena i Supabase-projektet (eller via knappen "Connect" högst upp):
 *   SUPABASE_URL  Project Settings → Data API → Project URL
 *                 t.ex. https://abcdefgh.supabase.co
 *   SUPABASE_KEY  Project Settings → API Keys → "Publishable key" (sb_publishable_…)
 *                 eller fliken "Legacy API Keys" → "anon public" (eyJ…). Båda fungerar.
 *
 * Använd ALDRIG "Secret key" / "service_role" här – den ger full åtkomst.
 */
window.APP_CONFIG = {
  SUPABASE_URL: '',
  SUPABASE_KEY: '',
};
