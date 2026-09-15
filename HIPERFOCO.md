# Híper Foco · instalación y prueba

Esta versión fue construida sobre el repo entregado el 15-09-2026, incluyendo organizaciones y RLS hasta `0007_rls_organization_scoped.sql`.

## 1. Antes de publicar

Crea un punto de retorno en Git:

```bash
git add .
git commit -m "Checkpoint antes de Hiper Foco"
git tag pre-hyperfocus
```

## 2. Base de datos

En Supabase → SQL Editor ejecuta **una sola vez**:

`supabase/0008_hyperfocus.sql`

La migración crea:

- `hyperfocus_campaigns`
- `hyperfocus_records`
- `hyperfocus_interactions`
- vista `hyperfocus_campaign_stats`
- RPC `hyperfocus_claim_next(uuid)`
- RLS por organización y rol

No modifica ni borra datos existentes de `leads`, `activities`, `quotes` o `profiles`.

## 3. Publicación

Publica el repo completo. Los archivos nuevos principales son:

- `js/hyperfocus.js`
- `hyperfocus.css`
- `supabase/0008_hyperfocus.sql`

También cambian `index.html`, `js/app.js`, `js/catalog.js`, `js/store.js` y `README.md` para integrar el módulo.

## 4. Prueba recomendada

Antes de subir una base completa:

1. Inicia sesión con un usuario `comercial`, `admin` o `super`.
2. Entra a **Híper Foco**.
3. Crea una campaña con 5–10 filas de prueba.
4. Revisa el mapeo automático.
5. Inicia la sesión y prueba: llamada → no contesta → reintento.
6. Prueba: contacto efectivo → interesado → guardar como prospecto.
7. Confirma que el prospecto aparece en CRM y que la campaña avanza.
8. Prueba Remarketing.
9. Prueba pausar y volver a entrar.
10. Si hay dos usuarios disponibles, abre la misma campaña en ambos y confirma que no reciben simultáneamente la misma empresa.

Después de eso puedes cargar las bases completas.

## 5. Bases reales usadas como referencia

El importador contempla los patrones observados en:

- `Base_Maestra_Ascensores-3.xlsx`: empresa, rubro, región/comuna, teléfono y email de registro, tomador de decisiones, datos históricos y correos adicionales.
- `BD OPERACIONES.csv`: RUT, razón social, ubicación, contacto, celular/teléfono, email, web y representante legal.

La base importada queda en staging. **No se crean miles de leads automáticamente.** Un registro entra al CRM solamente al calificarse o al enviarse a Remarketing.

## 6. Rollback

Para volver al estado previo del código:

```bash
git reset --hard pre-hyperfocus
```

Si además quieres retirar las tablas de Híper Foco de Supabase, hazlo solo después de respaldar sus campañas. No es necesario borrarlas para volver al código anterior: pueden quedar sin uso sin afectar el CRM existente.
