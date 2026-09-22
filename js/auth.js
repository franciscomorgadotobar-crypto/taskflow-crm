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
let refreshGeneration = 0;

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
  const generation = ++refreshGeneration;
  session.user = user || null;
  if (!user) {
    session.profile = null;
    session.status = 'signed-out';
    return notify();
  }
  const profile = await fetchProfile();
  // Un fetch de perfil iniciado por una sesión anterior no puede revivirla si
  // mientras tanto llegó un SIGNED_OUT u otro usuario inició sesión.
  if (generation !== refreshGeneration || session.user?.id !== user.id) return;
  if (!profile || profile.active === false) {
    // Un usuario desactivado puede conservar un JWT válido. La migración 0018
    // bloquea sus datos por RLS; además cerramos su sesión para no dejar una
    // interfaz aparentemente operativa sin permisos.
    const { error } = await supabase.auth.signOut();
    if (error) console.error('No se pudo cerrar la sesión del perfil inactivo', error);
    if (generation !== refreshGeneration) return;
    session.user = null;
    session.profile = null;
    session.status = 'signed-out';
    return notify();
  }
  session.profile = profile;
  session.status = 'signed-in';
  notify();
}

supabase.auth.onAuthStateChange((_event, sess) => refresh(sess?.user || null));

export async function initAuth() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  // onAuthStateChange puede haberse adelantado mientras getSession estaba en vuelo.
  // En ese caso esa notificación más reciente ya es la fuente de verdad.
  if (session.status !== 'loading') return;
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
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
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
