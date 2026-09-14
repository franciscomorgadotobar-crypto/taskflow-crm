import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const CFG = window.TASKFLOW_CRM_CONFIG;

if (!CFG.supabaseUrl || !CFG.supabaseAnonKey) {
  // eslint-disable-next-line no-console
  console.error('Falta supabaseUrl/supabaseAnonKey en config.js');
}

export const supabase = createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});
