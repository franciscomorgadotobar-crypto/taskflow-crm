import { supabase } from './supabase.js';

/**
 * Sesión + perfil de quien está usando el CRM. `profile` viene de la tabla
 * `profiles` (rol, nombre, activo) y es lo que RLS usa para decidir qué ve cada
 * quien. Se crea solo (trigger en la base) la primera vez que alguien se registra.
 */
export const session = {
  user: null,
  profile: null,
  status: 'loading' // 'loading' | 'signed-out' | 'signed-in'
};

const listeners = new Set();
export const onAuthChange = (fn) => (listeners.add(fn), () => listeners.delete(fn));
const notify = () => listeners.forEach((fn) => fn(session));

export async function fetchProfile() {
  if (!session.user) return null;
  const { data, error } = await supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
  if (error) {
    console.error('No se pudo cargar el perfil', error);
    return null;
  }
  return data;
}

async function refresh(user) {
  session.user = user || null;
  if (!user) {
    session.profile = null;
    session.status = 'signed-out';
    return notify();
  }
  session.profile = await fetchProfile();
  session.status = 'signed-in';
  notify();
}

supabase.auth.onAuthStateChange((_event, sess) => refresh(sess?.user || null));

export async function initAuth() {
  const { data } = await supabase.auth.getSession();
  await refresh(data.session?.user || null);
}

export async function signIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signUp(email, password, name) {
  const { error } = await supabase.auth.signUp({ email, password, options: { data: { name } } });
  if (error) throw error;
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function resetPassword(email) {
  // Vuelve a la misma URL donde está publicado el CRM (sirve igual en GitHub Pages,
  // que publica bajo /nombre-del-repo/, que en local).
  const redirectTo = `${window.location.origin}${window.location.pathname}`;
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw error;
}

export const isAdmin = () => ['super', 'admin'].includes(session.profile?.role);
export const canManageAll = isAdmin;
export const isReadOnly = () => session.profile?.role === 'visita';
