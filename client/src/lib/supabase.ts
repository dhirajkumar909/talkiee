import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

if (!isSupabaseConfigured) {
  // Surfaced in the UI via <SetupNotice>; log for developers too.
  console.warn(
    'Supabase is not configured. Copy client/.env.example to client/.env and fill in ' +
      'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
  );
}

// Falls back to harmless placeholders so the app can still render the setup
// notice instead of crashing at import time when env vars are missing.
export const supabase = createClient(
  url || 'http://localhost:54321',
  anonKey || 'public-anon-key',
  {
    auth: { persistSession: true, autoRefreshToken: true },
  },
);
