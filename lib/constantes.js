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

// Lista de IDs (array o "1,2,3") -> array de enteros. null = sin filtro; si se pidió filtro pero no hay IDs válidos -> [0] (sin resultados)
const parseIds = (v) => {
    if (v === undefined || v === null || v === '') return null;
    const arr = (Array.isArray(v) ? v : String(v).split(',')).map(x => parseInt(x, 10)).filter(n => Number.isInteger(n) && n > 0).slice(0, 1000);
    return arr.length ? arr : [0];
};

// Teléfono peruano: solo dígitos; si llega con prefijo 51 (11 dígitos) se quita. Vacío -> null
const digitosTelefono = (t) => { let d = String(t ?? '').replace(/\D/g, ''); if (d.length === 11 && d.startsWith('51')) d = d.slice(2); return d; };
const limpiarTelefono = (t) => digitosTelefono(t) || null;
// Válido si está vacío o tiene exactamente 9 dígitos
const telefonoValido = (t) => { const d = digitosTelefono(t); return d === '' || d.length === 9; };
const MSG_TELEFONO = 'El teléfono debe tener 9 dígitos (ej: 956713954).';

module.exports = { MSG_TELEFONO, telefonoValido, limpiarTelefono, parseIds, MESES_ORDER, MESES_SERVICIO, ordenMesSQL, msgErr, PRIV_CON_HORAS, metaHorasPriv };
