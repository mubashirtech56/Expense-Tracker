// ============================================================================
// Supabase Client Initialization & Environment Configuration
// ============================================================================

// Safe access to Vite environment variables across all environments
const getEnvVar = (key) => {
  try {
    if (typeof import.meta !== 'undefined' && import.meta?.env?.[key]) {
      return import.meta.env[key];
    }
  } catch (_) {}
  try {
    if (typeof window !== 'undefined' && window.__ENV__?.[key]) {
      return window.__ENV__[key];
    }
  } catch (_) {}
  return '';
};

const supabaseUrl = getEnvVar('VITE_SUPABASE_URL');
const supabaseAnonKey = getEnvVar('VITE_SUPABASE_ANON_KEY');

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
  supabaseAnonKey &&
  !supabaseUrl.includes('your-project') &&
  !supabaseAnonKey.includes('your-anon-public-key')
);

let client = null;
if (isSupabaseConfigured) {
  try {
    const { createClient } = await import('@supabase/supabase-js');
    client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'fem_supabase_auth',
      },
      realtime: {
        params: {
          eventsPerSecond: 10,
        },
      },
    });
  } catch (err) {
    console.warn('Failed to load @supabase/supabase-js client library:', err);
  }
}

export const supabase = client;

if (!isSupabaseConfigured) {
  console.info(
    '%c[Friends Expense Manager]%c Running in offline-first / local fallback mode. Admin login: admin / admin123',
    'color: #3b82f6; font-weight: bold',
    'color: inherit'
  );
}
