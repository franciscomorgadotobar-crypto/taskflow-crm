import { DEFAULT_USER_MODULE_IDS } from './catalog.js';
import { session } from './auth.js';
import { state } from './store.js';

const ALWAYS_VISIBLE = new Set(['help', 'profile', 'settings']);
const ADMIN_VIEWS = new Set(['audit']);

export function currentAccessProfile() {
  return state.me || session.profile || null;
}

export function currentModuleAccess() {
  const profile = currentAccessProfile();
  const raw = profile?.moduleAccess ?? profile?.module_access;
  if (!Array.isArray(raw)) return [...DEFAULT_USER_MODULE_IDS];
  return [...new Set(raw.filter((id) => DEFAULT_USER_MODULE_IDS.includes(id)))];
}

export function canAccessView(view) {
  if (!view) return false;
  if (ALWAYS_VISIBLE.has(view)) return true;

  const profile = currentAccessProfile();
  const role = profile?.role || '';
  if (ADMIN_VIEWS.has(view)) return ['super', 'admin'].includes(role);

  return currentModuleAccess().includes(view);
}

export function firstAccessibleView() {
  const preferred = ['dashboard', 'leads', 'hyperfocus', 'pipeline', 'remarketing', 'implementation', 'templates', 'chilecompra', 'quotes', 'help'];
  return preferred.find(canAccessView) || 'profile';
}
