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

  return { absorbField, absorbInput: byId('quoteAbsorbIva'), mode, earlyFields };
}
