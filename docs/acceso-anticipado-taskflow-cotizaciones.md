# Modalidad de cotización: Acceso Anticipado TaskFlow

Fecha: 2026-11-03 · Propuesta comercial de 4R Labs · Estado: borrador sujeto a aprobación comercial.

## Propósito
Invitar a empresas seleccionadas a utilizar anticipadamente TaskFlow mientras se termina el módulo de mantenimiento. Captar clientes potenciales, validar flujos reales, obtener retroalimentación y facilitar la conversión posterior. Comunicar explícitamente qué funciones están disponibles y cuáles están en desarrollo; no presentar la versión como terminada.

## Denominación comercial
**Acceso Anticipado TaskFlow — Beneficios de Lanzamiento.**
Alternativas conversadas: programa piloto, beta tester, demo privada. Se descartan como nombre principal «Clientes pioneros» y «Acceso prioritario». «Acceso anticipado» es el concepto mejor recibido.

## Beneficios propuestos (no aprobados aún)
1. Demostración gratuita del sistema.
2. Acceso gratuito por 60 días **de uso efectivo desde que exista una versión mínima funcional**; alternativa comercial: precio reducido durante el piloto.
3. Implementación y capacitación inicial sin costo, con alcance definido.
4. Participación en pruebas y retroalimentación del módulo de mantenimiento; las solicitudes no constituyen compromisos de desarrollo.
5. Soporte preferencial durante el piloto, sujeto a capacidad y condiciones definidas.
6. Propuesta de descuento del 40 % por seis meses después del piloto, **alternativa** a tarifa preferencial por doce meses. No acumular ambas promociones sin aprobación expresa.
7. Cupos limitados sugeridos: 5–10 empresas, solo si se decide una capacidad real de acompañamiento.

## Condiciones del piloto
- Empresa designa responsable y participa en sesión de inicio y retroalimentación periódica.
- La gratuidad no implica que todas las funcionalidades estén disponibles.
- Inicio, duración, alcance, módulos habilitados, límite de usuarios y fecha de término deben figurar en cada cotización.
- Precio de continuidad, descuento y plazo deben ser explícitos; no generar cobros automáticos ni compromiso de permanencia sin aceptación.
- Registrar consentimiento para contacto y tratamiento de datos según política aplicable.

## Nueva modalidad dentro de Cotizaciones
Agregar en el constructor un campo **Modalidad**: «Estándar» (por defecto) / «Acceso anticipado».
Para «Acceso anticipado»:
- Mostrar panel editable de condiciones: fecha de activación, duración gratuita (60 días por defecto), costo piloto (0 por defecto, o tarifa reducida), alcance funcional, acompañamiento, condiciones de participación, beneficio de continuidad (40 % por 6 meses **o** tarifa preferencial por 12 meses), vigencia y observaciones.
- Mantener compatibilidad con moneda, vendedor, absorción de IVA, listas de precios y versionado actuales.
- No convertir 60 días gratis en un descuento global que afecte permanentemente la tarifa. Desglosar **etapa piloto** y **etapa posterior opcional**; total del piloto 0 cuando corresponda, precios posteriores claramente separados.
- Mostrar modalidad y beneficios en PDF/correo; mantener internos los estados y datos administrativos.
- Persistir la modalidad y condiciones en base de datos con migración y compatibilidad con cotizaciones anteriores; validaciones en servidor, permisos/RLS, historial de versiones y pruebas.

## Texto comercial sugerido
**Acceso Anticipado TaskFlow — Beneficios de Lanzamiento**

Tu empresa está invitada a conocer y probar TaskFlow antes de su lanzamiento general. Durante esta etapa podrás utilizar las funcionalidades habilitadas, contar con acompañamiento del equipo de 4R Labs y compartir tus necesidades para orientar la evolución del módulo de mantenimiento.

**Beneficios propuestos:** demostración gratuita, hasta 60 días de uso sin costo una vez habilitado el piloto funcional, capacitación inicial, soporte preferencial y condiciones especiales de contratación posterior.

La disponibilidad de funcionalidades y los términos finales se detallarán en la propuesta individual. Participar no obliga a contratar.

## Criterios de aceptación de desarrollo
- Nueva modalidad visible al crear y editar cotizaciones sin alterar el flujo estándar.
- Beneficios configurables, guardados y reproducibles en nuevas versiones.
- PDF/correo separan etapa gratuita de eventual contratación.
- Precio total no suma cuotas futuras opcionales al período gratuito.
- Pruebas de regresión de cotización estándar y cálculo de IVA.
