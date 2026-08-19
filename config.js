/* =========================================================================
   MARATH — Supabase connection config
   -------------------------------------------------------------------------
   Fill these two values in from your Supabase project:
   Dashboard → Project Settings → API → "Project URL" and "anon public" key.

   The anon key is safe to ship in browser code — it is a public key that
   only ever grants what your Row Level Security policies allow (see
   supabase/schema.sql). Never put your "service_role" key in this file.
   ========================================================================= */

const SUPABASE_URL = "https://YOUR-PROJECT-REF.supabase.co";
const SUPABASE_ANON_KEY = "YOUR-ANON-PUBLIC-KEY";

// Single shared client instance, used by app.js and admin.js
const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
