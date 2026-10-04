window.CRM_PERSONAL_CONFIG = {
  appName: 'CRM',
  internalName: 'CRM Personal',
  companyName: '',
  productName: 'CRM',
  website: '',
  // Proyecto Supabase (URL y llave publicable — ambas son públicas por diseño, la
  // seguridad real la da Row Level Security, no mantener esto en secreto).
  supabaseUrl: 'https://egglrpexexcodsreumnz.supabase.co',
  supabaseAnonKey: 'sb_publishable_VIEfbg5RZq12b_H457NeOA_qr5RpEqd',
  // Registro abierto. En false, la pantalla de acceso no ofrece crear cuenta: las
  // cuentas las crea un administrador desde el panel de Supabase. Debe ir a la par
  // con "Allow new users to sign up" en Supabase; si acá dice true pero allá está
  // cerrado, el registro falla con un error poco claro.
  allowSignup: false,
  storageKey: 'crm-personal-cache-v4'
};
