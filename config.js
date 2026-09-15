window.TASKFLOW_CRM_CONFIG = {
  appName: 'TaskFlow CRM',
  companyName: 'Cuatro Rlabs',
  productName: 'TaskFlow',
  website: 'https://taskflow.cl',
  // Proyecto Supabase (URL y llave publicable — ambas son públicas por diseño, la
  // seguridad real la da Row Level Security, no mantener esto en secreto).
  supabaseUrl: 'https://egglrpexexcodsreumnz.supabase.co',
  supabaseAnonKey: 'sb_publishable_VIEfbg5RZq12b_H457NeOA_qr5RpEqd',
  // Registro abierto. En false, la pantalla de acceso no ofrece crear cuenta: las
  // cuentas las crea un administrador desde el panel de Supabase. Debe ir a la par
  // con "Allow new users to sign up" en Supabase; si acá dice true pero allá está
  // cerrado, el registro falla con un error poco claro.
  allowSignup: false,
  storageKey: 'taskflow-crm-cache-v3'
};
