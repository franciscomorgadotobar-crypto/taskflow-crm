/**
 * Recupera controles nuevos cuando la PWA conserva HTML anterior al JS cargado.
 * Idempotente; no modifica cotizaciones ni estado remoto.
 */
export function ensureQuoteFormControls(root = document) {
  const byId = (id) => root.getElementById(id);
  const currency = byId('quoteCurrency');
  const conditions = currency?.closest('.form-grid');
  if (!conditions) {
    throw new Error('No se encontró el formulario de cotizaciones. Actualiza con Ctrl + F5.');
  }

  let absorbField = byId('quoteAbsorbIvaField');
  if (!absorbField || !byId('quoteAbsorbIva')) {
    absorbField?.remove();
    absorbField = root.createElement('div');
    absorbField.className = 'span-2';
    absorbField.id = 'quoteAbsorbIvaField';
    absorbField.hidden = true;
    absorbField.innerHTML =
      '<label class="inline"><input id="quoteAbsorbIva" type="checkbox" /> Absorber IVA (19%) dentro de los precios en USD</label>' +
      '<small class="muted">Mantiene el total final y distribuye el importe en los servicios. El cliente no verá IVA desglosado. Se aplica solo a cotizaciones USD.</small>';
    const anchor = byId('quoteUsdField')?.parentElement === conditions
      ? byId('quoteUsdField')
      : currency.closest('label');
    if (!anchor || anchor.parentElement !== conditions) {
      throw new Error('No se pudo recuperar el control de IVA. Actualiza con Ctrl + F5.');
    }
    anchor.insertAdjacentElement('afterend', absorbField);
  }

  let mode = byId('quoteMode');
  if (!mode) {
    const label = root.createElement('label');
    label.innerHTML = 'Modalidad<select id="quoteMode"><option value="standard">Estándar</option><option value="early">Acceso anticipado</option></select>';
    const payment = byId('quotePaymentTerms')?.closest('label');
    if (!payment || payment.parentElement !== conditions) {
      throw new Error('No se pudo recuperar el campo Modalidad. Actualiza con Ctrl + F5.');
    }
    payment.insertAdjacentElement('afterend', label);
    mode = byId('quoteMode');
  }

  const earlyIds = [
    'quoteEarlyDays', 'quoteEarlyPilotPrice', 'quoteEarlyBenefit',
    'quoteEarlyScope', 'quoteEarlyConditions'
  ];
  let earlyFields = byId('quoteEarlyFields');
  if (!earlyFields || earlyIds.some((id) => !byId(id))) {
    earlyFields?.remove();
    earlyFields = root.createElement('div');
    earlyFields.id = 'quoteEarlyFields';
    earlyFields.className = 'span-2';
    earlyFields.hidden = true;
    earlyFields.innerHTML =
      '<label>Días gratuitos<input id="quoteEarlyDays" type="number" value="60" min="0"></label>' +
      '<label>Precio piloto<input id="quoteEarlyPilotPrice" type="number" value="0" min="0"></label>' +
      '<label>Beneficio posterior<select id="quoteEarlyBenefit">' +
      '<option value="40x6">40% por seis meses</option>' +
      '<option value="preferential12">Tarifa preferencial por doce meses</option>' +
      '<option value="none">Sin descuento</option></select></label>' +
      '<label>Alcance<textarea id="quoteEarlyScope">Funcionalidades habilitadas; mantenimiento en desarrollo.</textarea></label>' +
      '<label>Condiciones<textarea id="quoteEarlyConditions">Implementación, capacitación, soporte preferencial y retroalimentación.</textarea></label>';
    mode.closest('label')?.insertAdjacentElement('afterend', earlyFields);
  }

  // En versiones PWA anteriores este bloque todavía no existe en index.html.
  const optionalIds = ['quoteOptionalLinesRoot', 'quoteOptionalService', 'quoteOptionalQty'];
  if (optionalIds.some((id) => !byId(id))) {
    byId('quoteOptionalLinesRoot')?.closest('section')?.remove();
    const discounts = byId('quoteDiscountsRoot')?.closest('section');
    if (!discounts) throw new Error('No se encontró la sección de descuentos de la cotización.');
    const section = root.createElement('section');
    section.className = 'quote-section quote-optional-section';
    section.innerHTML =
      '<h4>Complementos opcionales</h4>' +
      '<p class="muted quote-hint">Selecciona packs u otros productos individualmente. Sus valores no se suman al contrato.</p>' +
      '<div id="quoteOptionalLinesRoot"></div>' +
      '<div class="quote-add-row">' +
      '<label class="grow">Producto opcional<select id="quoteOptionalService"></select></label>' +
      '<label>Cantidad<input id="quoteOptionalQty" type="number" min="1" step="1" value="1"></label>' +
      '<button type="button" class="ghost-btn" data-action="add-quote-optional">Agregar complemento</button>' +
      '</div>';
    discounts.insertAdjacentElement('beforebegin', section);
  }

  return { absorbField, absorbInput: byId('quoteAbsorbIva'), mode, earlyFields };
}


/** Recupera el campo de alcance comercial de listas de precios con HTML anterior. */
export function ensurePriceItemDescription(root = document) {
  const input = root.getElementById('priceItemDescription');
  if (input) return input;
  const name = root.getElementById('priceItemName')?.closest('label');
  if (!name) throw new Error('Formulario de lista de precios no disponible. Recarga con Ctrl + F5.');
  const label = root.createElement('label');
  label.className = 'span-2';
  label.innerHTML = 'Capacidades y alcance comercial<textarea id="priceItemDescription" rows="5" maxlength="1500" placeholder="Una capacidad por línea"></textarea>';
  name.insertAdjacentElement('afterend', label);
  return root.getElementById('priceItemDescription');
}
