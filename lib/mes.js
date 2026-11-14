const { MESES_ORDER } = require('./constantes');

// --- MES ACTIVO ---
// Regla: para informar un mes nuevo, el anterior debe estar cerrado. Mes activo = el siguiente al último mes cerrado.
// Orden dentro del año de servicio: SEPTIEMBRE(0) ... AGOSTO(11). Clave = anio_servicio*12 + posición.
const posServicio = (mes) => { const i = MESES_ORDER.indexOf(String(mes).trim().toUpperCase()); return i < 0 ? -1 : (i + 4) % 12; };
const claveMes = (mes, anio) => { const p = posServicio(mes); return p < 0 ? NaN : parseInt(anio) * 12 + p; };
async function getMesActivo(db) {
    // Mes automático de informe: siempre el mes calendario inmediatamente anterior (zona horaria UTC-5)
    // Cambia automáticamente al iniciar el siguiente mes calendario.
    const hoy = new Date(Date.now() - 5 * 3600 * 1000);
    const mesActual = hoy.getUTCMonth();
    const anioCal = hoy.getUTCFullYear();
    const idx = (mesActual + 11) % 12;
    const calDelMes = mesActual === 0 ? anioCal - 1 : anioCal;
    const anio_servicio = String(idx >= 8 ? calDelMes + 1 : calDelMes);
    const mes = MESES_ORDER[idx];
    const key = parseInt(anio_servicio) * 12 + ((idx + 4) % 12);
    return { key, hayCierres: false, mes, anio_servicio };
}
// Condición SQL "publicador pendiente de informar ese mes": activo, ya ingresado en ese mes y sin informe (no usa la marca 'informo')
function pendienteSQL(mes, anio, alias = 'publicadores') {
    const idx = MESES_ORDER.indexOf(String(mes).trim().toUpperCase());
    const cal = idx >= 8 ? parseInt(anio) - 1 : parseInt(anio);
    const a = alias;
    return {
        sql: `(${a}.activo = 1 AND NOT EXISTS (SELECT 1 FROM informes i WHERE i.publicador_id = ${a}.id AND i.mes = ? AND i.anio_servicio = ?) AND (${a}.fecha_ingreso IS NULL OR DATE_FORMAT(IF(DAY(${a}.fecha_ingreso) = 1, DATE_SUB(${a}.fecha_ingreso, INTERVAL 1 MONTH), ${a}.fecha_ingreso), '%Y%m') <= ?))`,
        params: [mes, String(anio), String(cal * 100 + idx + 1)]
    };
}

module.exports = { posServicio, claveMes, getMesActivo, pendienteSQL };
