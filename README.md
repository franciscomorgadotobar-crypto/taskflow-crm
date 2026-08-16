# TaskFlow CRM

CRM comercial B2B para TaskFlow / Cuatro Rlabs. Sin dependencias, sin build.

## Cómo ejecutarlo

El proyecto usa módulos ES, así que **no funciona abriendo `index.html` con doble clic** (el navegador bloquea módulos bajo `file://`). Usa cualquiera de estas opciones:

```bash
python3 -m http.server 8080   # luego abre http://localhost:8080
npx serve .
```

En producción basta con publicar la carpeta en Netlify: `netlify.toml` ya trae la configuración.

## Estructura

```
index.html          Estructura y diálogos
styles.css          Estilos (tema claro/oscuro, responsive)
config.js           Nombre, endpoint y clave de almacenamiento
js/catalog.js       Etapas, rubros, gatillos, módulos, plantillas
js/utils.js         Formato de fechas/moneda, escape HTML, toasts
js/store.js         Estado, persistencia, migraciones y métricas
js/views.js         Render de cada vista (HTML puro)
js/api.js           Sincronización con Google Sheets
js/app.js           Routing, diálogos, kanban y acciones
apps-script/Code.gs Backend opcional
```

## Proceso comercial

Lead → Contactado → Reunión / Demo → Propuesta → Negociación → Ganado / Perdido.

Cada cambio de etapa queda registrado con fecha en `stageHistory`, lo que alimenta el tiempo promedio por etapa y el ciclo de venta. Al mover una oportunidad a **Perdido** se pide el motivo, que se agrupa en el resumen.

## Módulos

- **Resumen**: pipeline, pipeline ponderado, tasa de cierre, ticket promedio, ciclo de venta, seguimientos vencidos, oportunidades estancadas y motivos de pérdida.
- **Leads**: búsqueda por texto, etapa, responsable y orden; los filtros se combinan entre sí.
- **Pipeline**: kanban con arrastre en escritorio y botón *Mover* en móvil.
- **Levantamiento**: dolor, gestión actual, dotación, gatillo, módulos, integraciones y criterio de éxito. Disponible también para oportunidades cerradas.
- **Implementación**: clientes ganados con su alcance levantado para el kick-off.
- **Actividades**: historial filtrable; el compromiso puede convertirse en la próxima acción del lead.
- **Plantillas**: variables `{{contacto}}`, `{{empresa}}`, `{{cargo}}`, `{{dolor}}`, `{{modulos}}` y `{{responsable}}`, con copiar al portapapeles y apertura en el cliente de correo.
- **Archivos**: registro de propuestas, cotizaciones y contratos con enlace a Drive u OneDrive.
- **Ficha**: vista única por empresa con datos, levantamiento, recorrido por etapas, actividades y archivos.

## Datos

Todo vive en `localStorage` del navegador. Desde **Datos y respaldo**:

- Exportar/importar JSON completo.
- Exportar leads a CSV (compatible con Excel, incluye BOM).
- Borrar los datos locales.

Los datos de versiones anteriores se migran automáticamente al abrir la aplicación.

## Backend opcional: Google Sheets

1. Crear una Google Sheet.
2. Extensiones > Apps Script, pegar `apps-script/Code.gs`.
3. Ejecutar `setupTaskFlowCRM()` una vez.
4. Implementar > Nueva implementación > Aplicación web (ejecutar como tú, acceso: cualquier persona).
5. Copiar la URL `/exec` en `apiUrl` dentro de `config.js`.

Las cabeceras de la planilla usan las mismas claves que el frontend, así que no hay traducción de campos. `stageHistory` viaja como JSON y `modules` como lista separada por `|`.

Desde **Datos y respaldo** puedes descargar la planilla, subir el estado local o activar la sincronización automática al guardar. La URL de la aplicación web actúa como credencial: quien la tenga puede leer y escribir, así que no la publiques.

## Marca

Paleta: `#1b3257`, `#1d71b8`, `#6caaf4`, `#9cbdf4`. Nombre visible: TaskFlow CRM · By 4R Labs.
