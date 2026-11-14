// Constantes y utilidades compartidas por todo el servidor
const MESES_ORDER = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
// Orden dentro del año de servicio (septiembre -> agosto) para usar en ORDER BY
const MESES_SERVICIO = ['SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE', 'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO'];
const ordenMesSQL = (col) => `FIELD(${col}, ${MESES_SERVICIO.map(m => `'${m}'`).join(', ')})`;
// Registra el error real en el servidor y devuelve un mensaje genérico al cliente
const msgErr = (e) => { console.error(e); return 'Error interno del servidor.'; };
// Privilegios que deben reportar horas y meta mínima de horas de los auxiliares (S-21)
const PRIV_CON_HORAS = ['REG', 'ESP', 'AUX I', 'AUX M', 'AUX', 'AUX C'];
const metaHorasPriv = (p) => p === 'AUX C' ? 15 : (['AUX I', 'AUX M', 'AUX'].includes(p) ? 30 : 0);

module.exports = { MESES_ORDER, MESES_SERVICIO, ordenMesSQL, msgErr, PRIV_CON_HORAS, metaHorasPriv };
