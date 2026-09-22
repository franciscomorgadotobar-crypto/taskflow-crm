# TaskFlow CRM

CRM comercial B2B para TaskFlow / Cuatro Rlabs. Frontend en JavaScript puro (sin build ni framework), backend en Supabase (Postgres + Auth + Row Level Security + Realtime).

## Cómo ejecutarlo

El proyecto usa módulos ES, así que **no funciona abriendo `index.html` con doble clic** (el navegador bloquea módulos bajo `file://`). Usa cualquiera de estas opciones:

```bash
python3 -m http.server 8080   # luego abre http://localhost:8080
npx serve .
```

En producción, publica la carpeta en Netlify (o el hosting estático que prefieras) conectado a este repositorio de GitHub, para que cada push despliegue solo. `netlify.toml` ya trae la configuración base.

## Estructura

```
index.html            Estructura, diálogos y la pantalla de acceso
styles.css             Estilos (tema claro/oscuro, responsive)
config.js               Nombre de la app y credenciales públicas de Supabase (URL + anon key)
js/supabase.js    Cliente de Supabase (carga vía CDN, sin instalar nada)
js/auth.js            Sesión, login/registro, recuperar contraseña, rol de quien usa el CRM
js/catalog.js        Etapas, rubros, gatillos, módulos, plantillas, catálogo de unidades y estados de cotización
js/utils.js            Formato de fechas/moneda, escape HTML, toasts
js/store.js            Estado del CRM: leads, levantamientos, actividades, plantillas y equipo — hidratado desde Supabase y sincronizado en vivo
js/quotes.js         Estado del cotizador: catálogo de servicios y cotizaciones con versionado
js/views.js            Render de cada vista (HTML puro)
js/hyperfocus.js        Campañas Híper Foco: importación, cola secuencial, resultados y conversión al CRM
js/app.js              Routing, diálogos, kanban, acciones y el cotizador
hyperfocus.css          Estilos del modo Híper Foco
apps-script/Code.gs Backend antiguo (Google Sheets) — obsoleto, se mantiene solo de referencia
supabase/*.sql       Migraciones del esquema, aplicadas en orden al proyecto de Supabase
```

## Backend: Supabase

El proyecto usa un proyecto de Supabase propio (Postgres + Auth + RLS + Realtime). `config.js` trae la URL del proyecto y la llave publicable (`anon key`) — ambas son públicas por diseño, la seguridad real la da Row Level Security en la base de datos, no mantener esos valores en secreto.

Para levantar el esquema desde cero en un proyecto nuevo, aplica **todos** los archivos de `supabase/` en orden numérico desde el SQL Editor del panel de Supabase o con la CLI. En una instalación existente, aplica solamente las migraciones nuevas que aún no estén ejecutadas. El cierre transaccional de tareas requiere `0010_complete_task_rpc.sql`; el frontend actual sigue siendo compatible mientras esa migración no se haya aplicado. Híper Foco requiere `0008_hyperfocus.sql`.

### Acceso y roles

El registro público está desactivado en la configuración actual (`allowSignup: false`). Las cuentas se crean de forma administrada y cada usuario dispone de un perfil con uno de los siguientes roles:

- **comercial**: ve la cartera no privada de su organización y gestiona las oportunidades que tiene asignadas. Las oportunidades privadas ajenas no se muestran.
- **admin**: ve la cartera no privada de su organización y puede gestionarla completa, además de administrar recursos compartidos. No ve oportunidades privadas ajenas.
- **super**: control total dentro de la organización, incluidas las oportunidades privadas y la administración del equipo.
- **visita**: lectura de la cartera no privada de su organización, sin editar.

**Primer arranque:** si todavía no existe un usuario con permisos de administración, promueve una cuenta existente una vez desde el SQL Editor de Supabase:

```sql
update public.profiles set role = 'super', active = true where email = 'tu-correo@taskflow.cl';
```

Desde ahí, esa persona ya puede asignar roles al resto del equipo desde Configuración → Equipo.

### Cómo escribe los datos

El store sigue un patrón "local primero, espejo en Supabase": cada acción (crear un lead, mover de etapa, agregar una actividad, etc.) actualiza el estado en memoria al instante — para que la interfaz no espere a la red — y dispara en segundo plano la escritura real en Supabase. Si esa escritura falla (por ejemplo, por Row Level Security) se avisa con un toast. Realtime mantiene a todo el equipo viendo los mismos datos sin recargar la página.

## Proceso comercial

Lead → Contactado → Reunión / Demo → Propuesta → Negociación → Ganado / Perdido.

Cada cambio de etapa queda registrado con fecha en `stageHistory`, lo que alimenta el tiempo promedio por etapa y el ciclo de venta. Al mover una oportunidad a **Perdido** se pide el motivo, que se agrupa en el resumen.

## Módulos

- **Resumen**: pipeline, pipeline ponderado, tasa de cierre, ticket promedio, ciclo de venta, seguimientos vencidos, oportunidades estancadas y motivos de pérdida.
- **Híper Foco**: importa bases CSV/Excel como campañas separadas del CRM, consolida empresas repetidas, detecta coincidencias con el CRM y recorre una cola de contacto una empresa a la vez. Solo los registros calificados se convierten en prospectos o Remarketing.
- **Leads**: búsqueda por texto, etapa, responsable y orden; los filtros se combinan entre sí.
- **Pipeline**: kanban con arrastre en escritorio y botón *Mover* en móvil.
- **Levantamiento**: dolor, gestión actual, dotación, gatillo, módulos, integraciones y criterio de éxito. Disponible también para oportunidades cerradas.
- **Implementación**: clientes ganados con su alcance levantado para el kick-off.
- **Actividades**: historial filtrable; el compromiso puede convertirse en la próxima acción del lead.
- **Plantillas**: variables `{{contacto}}`, `{{empresa}}`, `{{cargo}}`, `{{dolor}}`, `{{modulos}}` y `{{responsable}}`, con copiar al portapapeles y apertura en el cliente de correo.
- **Cotizaciones**: catálogo de servicios con precio neto, constructor de cotizaciones (items del catálogo o personalizados, cálculo automático de neto + IVA 19% + total), preparación de un correo prellenado y editable para el cliente, y quedan guardadas en el historial de cada empresa.
- **Ficha**: vista única por empresa con datos, levantamiento, cotizaciones, recorrido por etapas, actividades e historial.


## Híper Foco

Híper Foco está diseñado para trabajar bases grandes sin convertir cada fila en un lead. El flujo es:

`Base importada → Campaña Híper Foco → Gestión / clasificación → CRM`

- Acepta CSV directamente y Excel (`.xlsx`/`.xls`) mediante SheetJS cargado al momento de importar. Si el CDN de Excel no está disponible, CSV sigue funcionando.
- Detecta y permite corregir el mapeo de empresa, RUT, ubicación, contacto, teléfonos, correo y sitio web.
- Consolida empresas repetidas para evitar llamar dos veces al mismo registro.
- Cruza RUT/nombre contra los leads visibles en el CRM y avisa si ya existe una oportunidad.
- Respeta marcas de “No contactar” de la base de origen y puede excluir registros sin canal.
- Prioriza contactos por cargo y disponibilidad de teléfono/correo.
- La sesión es secuencial: llamar / WhatsApp / correo → resultado → siguiente acción.
- Resultados posibles: reintento, enriquecimiento de contacto, descarte, Remarketing o conversión a prospecto.
- Las campañas y sus registros quedan guardados en Supabase, así que se puede pausar y continuar otro día.
- `visita` puede ver campañas, pero no gestionarlas; `comercial`, `admin` y `super` pueden trabajar la cola.

Para activar las tablas y RLS ejecuta `supabase/0008_hyperfocus.sql` después de `0007_rls_organization_scoped.sql`.

## Cotizador

- El catálogo de servicios (nombre, unidad, precio neto, categoría) lo administra un admin/super desde Cotizaciones → Catálogo de servicios; cualquiera puede usarlo para cotizar.
- Cada cotización queda ligada a una empresa (lead) y muestra el desglose neto / IVA (19%) / total.
- **Editar una cotización no la sobrescribe: crea una versión nueva.** La versión anterior queda en el historial (visible desde "Ver" → "Versiones") y deja de ser la vigente. Así siempre se puede ver qué se le mandó a un cliente en cada momento.
- Para instalaciones existentes, aplica también `supabase/0012_quote_version_integrity.sql`. Agrega restricciones de base de datos para impedir dos versiones vigentes o dos números de versión iguales dentro de una misma cadena de cotización.
- Aplica después `supabase/0013_create_quote_version_rpc.sql`: el alta de una nueva versión, la desactivación de la anterior y sus ítems pasan a ejecutarse en una única transacción.
- Aplica `supabase/0014_delete_quote_version_rpc.sql`: al eliminar la versión vigente, la reactivación de la versión anterior ocurre en la misma transacción.
- Aplica `supabase/0015_delete_quote_root_version.sql`: permite eliminar también la versión raíz de una cadena, promoviendo y reenganchando las versiones posteriores de forma transaccional.
- `supabase/0016_hyperfocus_finalize_rpc.sql`: hace atómico el cierre de una gestión de Híper Foco (registro + interacción) conservando RLS.
- Preparar el correo de una cotización arma un mensaje con el detalle de los ítems y el total, lo deja editable y lo abre en el cliente de correo del comercial (`mailto:`). Abrir ese correo no marca la cotización como enviada, porque el CRM no puede confirmar el envío realizado por una aplicación externa.

## Datos

El estado se hidrata desde Supabase al iniciar sesión (fuente de verdad) y se guarda además en una copia local (`localStorage`) solo como caché de arranque — nunca se lee de ahí para las decisiones de permisos. Desde **Datos y respaldo**:

- Exportar/importar JSON completo (la importación crea registros nuevos, no reemplaza lo existente).
- Exportar leads a CSV (compatible con Excel, incluye BOM).
- Borrar las oportunidades visibles para quien tiene la sesión abierta (según su rol).

Para instalaciones existentes, aplica también `supabase/0011_activities_lead_cascade.sql`. Esta migración hace que, al eliminar una oportunidad, su historial de actividades ligado al lead se elimine junto con ella en vez de quedar huérfano. No borra actividades globales existentes con `lead_id = NULL`.

## Backend antiguo: Google Sheets (obsoleto)

`apps-script/Code.gs` era el backend original, antes de migrar a Supabase. Ya no se usa ni se necesita desplegar — se mantiene en el repositorio solo como referencia histórica.

## Marca

Paleta: `#1b3257`, `#1d71b8`, `#6caaf4`, `#9cbdf4`. Nombre visible: TaskFlow CRM · By 4R Labs.


### Migración 0017 — actividad manual + tarea

`supabase/0017_resolve_task_with_activity_rpc.sql` agrega `resolve_task_with_activity`, que registra una actividad manual y limpia la tarea pendiente del lead dentro de una sola transacción, preservando contacto y responsable. Usa `SECURITY INVOKER` y requiere ejecución autenticada.


### Migración 0018 — perfiles inactivos

`supabase/0018_inactive_profiles_access.sql` hace que `internal.my_org()` e `internal.my_role()` solo reconozcan perfiles activos. Como las políticas RLS organizacionales dependen de esos helpers, un usuario desactivado deja de leer y escribir datos aunque conserve un token de Auth válido. El frontend además cierra su sesión al detectar el perfil inactivo.


### Migración 0019 — permiso service_role en my_org

`supabase/0019_service_role_my_org.sql` restaura el grant explícito de `service_role` sobre `internal.my_org()`. La migración 0018 eliminó correctamente el permiso heredado de `PUBLIC`, pero con ello también dejó a `service_role` sin EXECUTE explícito en esta función. `anon` y `PUBLIC` continúan sin permiso.


### Migración 0020 — protección de privilegios del equipo

`supabase/0020_profile_privilege_guard.sql` cierra la auto-escalación de roles en `profiles`: cada usuario puede seguir editando sus datos personales, pero solo `super` puede administrar otros perfiles, cambiar roles/estado o eliminar cuentas. También impide desactivar, degradar, mover o eliminar al último super activo de una organización. Como defensa adicional, toda cuenta nueva nace con `active=false`; así incluso un signup directo contra Auth queda sin acceso por RLS hasta que un super lo habilite. La UI usa la misma separación: `admin` conserva administración operativa del CRM, mientras la administración del equipo queda reservada a `super`.
