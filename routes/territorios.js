const express = require('express');
const pool = require('../lib/db');
const { msgErr } = require('../lib/constantes');
const { soloAdmin, soloGlobal } = require('../lib/auth');

const router = express.Router();

// --- TERRITORIOS (Catálogo, Conductores, Turnos, Bitácora y S-13) ---
function parseManzanasList(str) {
    if (!str) return [];
    return String(str).split(',').map(x => parseInt(x.trim(), 10)).filter(n => !isNaN(n) && n >= 1);
}

function parseManzanasDetalleRow(r) {
    const map = {};
    if (r && r.manzanas_detalle) {
        try {
            const parsed = typeof r.manzanas_detalle === 'string' ? JSON.parse(r.manzanas_detalle) : r.manzanas_detalle;
            if (parsed && typeof parsed === 'object') {
                for (const [k, v] of Object.entries(parsed)) {
                    const num = parseInt(k, 10);
                    if (!isNaN(num) && num >= 1) {
                        map[num] = v === 'COMPLETO' ? 'COMPLETO' : 'INCOMPLETO';
                    }
                }
                if (Object.keys(map).length > 0) return map;
            }
        } catch (e) {}
    }
    const nums = parseManzanasList(r?.manzanas);
    const estDefault = r?.estado_manzanas === 'INCOMPLETO' ? 'INCOMPLETO' : 'COMPLETO';
    for (const m of nums) {
        map[m] = estDefault;
    }
    return map;
}

function normalizarPayloadManzanas(manzanas, estado_manzanas, manzanas_detalle) {
    const detalleMap = {};
    if (manzanas_detalle) {
        try {
            const parsed = typeof manzanas_detalle === 'string' ? JSON.parse(manzanas_detalle) : manzanas_detalle;
            if (parsed && typeof parsed === 'object') {
                for (const [k, v] of Object.entries(parsed)) {
                    const num = parseInt(k, 10);
                    if (!isNaN(num) && num >= 1) {
                        detalleMap[num] = v === 'COMPLETO' ? 'COMPLETO' : 'INCOMPLETO';
                    }
                }
            }
        } catch (e) {}
    }
    const listaDesdeStr = parseManzanasList(manzanas);
    if (Object.keys(detalleMap).length === 0 && listaDesdeStr.length > 0) {
        const estDef = estado_manzanas === 'INCOMPLETO' ? 'INCOMPLETO' : 'COMPLETO';
        listaDesdeStr.forEach(m => { detalleMap[m] = estDef; });
    }
    const listaManz = Object.keys(detalleMap).map(Number).sort((a, b) => a - b);
    const tieneIncompletas = listaManz.some(m => detalleMap[m] === 'INCOMPLETO');
    const estadoResumen = tieneIncompletas ? 'INCOMPLETO' : 'COMPLETO';
    const detalleOrdenado = {};
    listaManz.forEach(m => { detalleOrdenado[m] = detalleMap[m]; });
    return {
        listaManz,
        manzStr: listaManz.join(', '),
        estadoResumen,
        detalleJson: JSON.stringify(detalleOrdenado)
    };
}

function formatearFechaYMD(val) {
    if (!val) return null;
    if (val instanceof Date) {
        return val.toISOString().split('T')[0];
    }
    const s = String(val).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const d = new Date(s);
    return !isNaN(d.getTime()) ? d.toISOString().split('T')[0] : s;
}

async function calcularEstadoManzanasCiclo(db, territorio_id, ciclo, excludeId = null) {
    let sql = 'SELECT id, fecha, fecha_cierre, manzanas, estado_manzanas, manzanas_detalle, estado_territorio FROM bitacora_territorios WHERE territorio_id = ? AND ciclo = ?';
    const params = [territorio_id, ciclo];
    if (excludeId) { sql += ' AND id != ?'; params.push(excludeId); }
    sql += ' ORDER BY fecha ASC, id ASC';
    const [rows] = await db.query(sql, params);
    const estadoPorManzana = {};
    let cerradoExplicito = false;
    for (const r of rows) {
        const detRow = parseManzanasDetalleRow(r);
        for (const [mStr, estM] of Object.entries(detRow)) {
            const m = Number(mStr);
            if (estM === 'COMPLETO') estadoPorManzana[m] = 'COMPLETO';
            else if (estadoPorManzana[m] !== 'COMPLETO') estadoPorManzana[m] = 'INCOMPLETO';
        }
        if (r.estado_territorio === 'CIERRE' || r.estado_territorio === 'INICIO - CIERRE' || Boolean(r.fecha_cierre)) cerradoExplicito = true;
    }
    const fechaInicioCiclo = rows.length > 0 && rows[0].fecha ? formatearFechaYMD(rows[0].fecha) : null;
    return { estadoPorManzana, cerradoExplicito, registrosCount: rows.length, fechaInicioCiclo };
}

// Catálogo de Territorios + Progreso del ciclo actual
router.get('/api/territorios', soloGlobal, async (req, res) => {
    try {
        const [territorios] = await pool.query('SELECT * FROM territorios ORDER BY CAST(numero AS UNSIGNED) ASC, numero ASC');
        const [bitacora] = await pool.query('SELECT * FROM bitacora_territorios ORDER BY fecha ASC, id ASC');

        const resultado = territorios.map(t => {
            const regsT = bitacora.filter(b => b.territorio_id === t.id);
            const maxCiclo = regsT.length > 0 ? regsT.reduce((m, r) => Math.max(m, r.ciclo || 1), 1) : 0;
            const regsCiclo = maxCiclo > 0 ? regsT.filter(b => (b.ciclo || 1) === maxCiclo) : [];

            // Contabilizar vueltas completas (con fecha_cierre) e incompletas (sin fecha_cierre)
            const ciclosMap = {};
            regsT.forEach(r => {
                const cNum = r.ciclo || 1;
                if (!ciclosMap[cNum]) ciclosMap[cNum] = [];
                ciclosMap[cNum].push(r);
            });
            let vueltasCompletas = 0;
            let vueltasIncompletas = 0;
            Object.values(ciclosMap).forEach(lista => {
                const tieneFechaCierre = lista.some(r => Boolean(r.fecha_cierre));
                if (tieneFechaCierre) vueltasCompletas++;
                else vueltasIncompletas++;
            });

            const estadoPorManzana = {};
            let estadoTerritorioActual = 'SIN INICIAR';
            for (const r of regsCiclo) {
                const detRow = parseManzanasDetalleRow(r);
                for (const [mStr, estM] of Object.entries(detRow)) {
                    const m = Number(mStr);
                    if (m <= t.cantidad_manzanas) {
                        if (estM === 'COMPLETO') estadoPorManzana[m] = 'COMPLETO';
                        else if (estadoPorManzana[m] !== 'COMPLETO') estadoPorManzana[m] = 'INCOMPLETO';
                    }
                }
                estadoTerritorioActual = r.estado_territorio;
            }
            const completadas = Object.values(estadoPorManzana).filter(v => v === 'COMPLETO').length;
            const incompletas = Object.values(estadoPorManzana).filter(v => v === 'INCOMPLETO').length;
            const porcentaje = t.cantidad_manzanas > 0 ? Math.min(100, Math.round((completadas / t.cantidad_manzanas) * 100)) : 0;
            const esEstadoCierre = (est) => est === 'CIERRE' || est === 'INICIO - CIERRE';
            const tieneCierreCiclo = regsCiclo.some(r => Boolean(r.fecha_cierre) || esEstadoCierre(r.estado_territorio));
            const regCierre = regsCiclo.slice().reverse().find(r => r.fecha_cierre || esEstadoCierre(r.estado_territorio));
            if (tieneCierreCiclo && regsCiclo.length > 0) {
                const fIniStr = formatearFechaYMD(regsCiclo[0].fecha);
                const fFinStr = formatearFechaYMD(regCierre?.fecha_cierre || regsCiclo[regsCiclo.length - 1]?.fecha);
                estadoTerritorioActual = (regCierre?.estado_territorio === 'INICIO - CIERRE' || (fIniStr && fFinStr && fIniStr === fFinStr))
                    ? 'INICIO - CIERRE'
                    : 'CIERRE';
            } else if (regsCiclo.length > 0) {
                const ultEst = regsCiclo[regsCiclo.length - 1].estado_territorio;
                estadoTerritorioActual = (ultEst === 'AVANCE' || regsCiclo.length > 1) ? 'AVANCE' : 'INICIO';
            }

            const fechaInicioCiclo = regsCiclo.length > 0 ? regsCiclo[0].fecha : null;
            const fechaCierreCiclo = esEstadoCierre(estadoTerritorioActual)
                ? (regCierre?.fecha_cierre || regsCiclo[regsCiclo.length - 1]?.fecha || null)
                : (regCierre?.fecha_cierre || null);

            return {
                ...t,
                ciclo_actual: maxCiclo,
                vueltas_completas: vueltasCompletas,
                vueltas_incompletas: vueltasIncompletas,
                completadas,
                incompletas,
                porcentaje,
                estado_actual: estadoTerritorioActual,
                fecha_inicio: fechaInicioCiclo,
                fecha_cierre: fechaCierreCiclo,
                manzanas_detalle: estadoPorManzana
            };
        });
        res.json(resultado);
    } catch (error) { res.status(500).json({ error: msgErr(error) }); }
});

router.post('/api/territorios', soloAdmin, async (req, res) => {
    const { numero, nombre, cantidad_manzanas } = req.body;
    const cant = parseInt(cantidad_manzanas, 10) || 1;
    if (!numero || cant < 1) return res.status(400).json({ ok: false, msg: 'Datos de territorio inválidos.' });
    try {
        await pool.query('INSERT INTO territorios (numero, nombre, cantidad_manzanas, activo) VALUES (?, ?, ?, 1)', [String(numero).trim(), (nombre || '').trim(), cant]);
        res.json({ ok: true });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') return res.status(400).json({ ok: false, msg: 'Ya existe un territorio con ese número.' });
        res.status(500).json({ ok: false, msg: msgErr(error) });
    }
});

router.put('/api/territorios/:id', soloAdmin, async (req, res) => {
    const { numero, nombre, cantidad_manzanas } = req.body;
    const cant = parseInt(cantidad_manzanas, 10) || 1;
    try {
        await pool.query('UPDATE territorios SET numero = ?, nombre = ?, cantidad_manzanas = ? WHERE id = ?', [String(numero).trim(), (nombre || '').trim(), cant, req.params.id]);
        res.json({ ok: true });
    } catch (error) { res.status(500).json({ ok: false, msg: msgErr(error) }); }
});

router.delete('/api/territorios/:id', soloAdmin, async (req, res) => {
    try {
        await pool.query('DELETE FROM bitacora_territorios WHERE territorio_id = ?', [req.params.id]);
        await pool.query('DELETE FROM territorios WHERE id = ?', [req.params.id]);
        res.json({ ok: true });
    } catch (error) { res.status(500).json({ ok: false, msg: msgErr(error) }); }
});

// Estado de manzanas de un territorio en su vuelta actual (o excluyendo un registro al editar)
router.get('/api/territorios/:id/manzanas', soloGlobal, async (req, res) => {
    try {
        const { exclude_id, ciclo_forzado } = req.query;
        const [terr] = await pool.query('SELECT * FROM territorios WHERE id = ?', [req.params.id]);
        if (terr.length === 0) return res.status(404).json({ error: 'Territorio no encontrado' });
        const t = terr[0];
        let ciclo = parseInt(ciclo_forzado, 10);
        if (!ciclo) {
            const [maxRow] = await pool.query('SELECT COALESCE(MAX(ciclo), 1) as ciclo FROM bitacora_territorios WHERE territorio_id = ?', [t.id]);
            ciclo = maxRow[0].ciclo || 1;
        }
        const { estadoPorManzana, cerradoExplicito, registrosCount, fechaInicioCiclo } = await calcularEstadoManzanasCiclo(pool, t.id, ciclo, exclude_id || null);
        const completadas = Object.values(estadoPorManzana).filter(v => v === 'COMPLETO').length;
        const cicloTerminado = !exclude_id && registrosCount > 0 && cerradoExplicito;
        res.json({
            territorio: t,
            ciclo: cicloTerminado ? ciclo + 1 : ciclo,
            nueva_vuelta: cicloTerminado,
            registros_en_ciclo: cicloTerminado ? 0 : registrosCount,
            fecha_inicio_ciclo: cicloTerminado ? null : fechaInicioCiclo,
            manzanas: cicloTerminado ? {} : estadoPorManzana
        });
    } catch (error) { res.status(500).json({ error: msgErr(error) }); }
});

// Conductores
router.get('/api/conductores', soloGlobal, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM conductores ORDER BY activo DESC, nombre ASC');
        res.json(rows);
    } catch (error) { res.status(500).json({ error: msgErr(error) }); }
});

router.post('/api/conductores', soloAdmin, async (req, res) => {
    const { publicador_id, nombre } = req.body;
    if (!nombre || !String(nombre).trim()) return res.status(400).json({ ok: false, msg: 'El nombre del conductor es obligatorio.' });
    try {
        await pool.query('INSERT INTO conductores (publicador_id, nombre, activo) VALUES (?, ?, 1)', [publicador_id || null, String(nombre).trim()]);
        res.json({ ok: true });
    } catch (error) { res.status(500).json({ ok: false, msg: msgErr(error) }); }
});

router.put('/api/conductores/:id', soloAdmin, async (req, res) => {
    const { publicador_id, nombre } = req.body;
    if (!nombre || !String(nombre).trim()) return res.status(400).json({ ok: false, msg: 'El nombre del conductor es obligatorio.' });
    try {
        await pool.query('UPDATE conductores SET publicador_id = ?, nombre = ? WHERE id = ?', [publicador_id || null, String(nombre).trim(), req.params.id]);
        res.json({ ok: true });
    } catch (error) { res.status(500).json({ ok: false, msg: msgErr(error) }); }
});

router.delete('/api/conductores/:id', soloAdmin, async (req, res) => {
    try {
        await pool.query('DELETE FROM conductores WHERE id = ?', [req.params.id]);
        res.json({ ok: true });
    } catch (error) { res.status(500).json({ ok: false, msg: msgErr(error) }); }
});

// Turnos de Predicación
router.get('/api/turnos', soloGlobal, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM turnos_predicacion ORDER BY id ASC');
        res.json(rows);
    } catch (error) { res.status(500).json({ error: msgErr(error) }); }
});

router.post('/api/turnos', soloAdmin, async (req, res) => {
    const { nombre, horario } = req.body;
    if (!nombre || !String(nombre).trim()) return res.status(400).json({ ok: false, msg: 'El nombre del turno es obligatorio.' });
    try {
        await pool.query('INSERT INTO turnos_predicacion (nombre, horario, activo) VALUES (?, ?, 1)', [String(nombre).trim(), (horario || '').trim()]);
        res.json({ ok: true });
    } catch (error) { res.status(500).json({ ok: false, msg: msgErr(error) }); }
});

router.put('/api/turnos/:id', soloAdmin, async (req, res) => {
    const { nombre, horario } = req.body;
    if (!nombre || !String(nombre).trim()) return res.status(400).json({ ok: false, msg: 'El nombre del turno es obligatorio.' });
    try {
        await pool.query('UPDATE turnos_predicacion SET nombre = ?, horario = ? WHERE id = ?', [String(nombre).trim(), (horario || '').trim(), req.params.id]);
        res.json({ ok: true });
    } catch (error) { res.status(500).json({ ok: false, msg: msgErr(error) }); }
});

router.delete('/api/turnos/:id', soloAdmin, async (req, res) => {
    try {
        await pool.query('DELETE FROM turnos_predicacion WHERE id = ?', [req.params.id]);
        res.json({ ok: true });
    } catch (error) { res.status(500).json({ ok: false, msg: msgErr(error) }); }
});

// Bitácora de Territorios
router.get('/api/territorios/bitacora', soloGlobal, async (req, res) => {
    const { territorio_id } = req.query;
    try {
        let sql = 'SELECT b.*, t.numero as territorio_numero, t.nombre as territorio_nombre, t.cantidad_manzanas FROM bitacora_territorios b JOIN territorios t ON b.territorio_id = t.id WHERE 1=1';
        const params = [];
        if (territorio_id) { sql += ' AND b.territorio_id = ?'; params.push(territorio_id); }
        sql += ' ORDER BY COALESCE(b.fecha_registro, b.fecha_cierre, b.fecha) DESC, b.id DESC LIMIT 2000';
        const [rows] = await pool.query(sql, params);
        res.json(rows);
    } catch (error) { res.status(500).json({ error: msgErr(error) }); }
});

router.post('/api/territorios/bitacora', soloAdmin, async (req, res) => {
    const { fecha_registro, fecha, fecha_cierre, territorio_id, manzanas, estado_manzanas, manzanas_detalle, turno_id, turno_nombre, conductor_id, conductor_nombre, estado_territorio } = req.body;
    const { listaManz, manzStr, estadoResumen, detalleJson } = normalizarPayloadManzanas(manzanas, estado_manzanas, manzanas_detalle);
    if (!fecha || !territorio_id || listaManz.length === 0) {
        return res.status(400).json({ ok: false, msg: 'Debes indicar la fecha de inicio, el territorio y al menos una manzana.' });
    }
    try {
        const [terr] = await pool.query('SELECT * FROM territorios WHERE id = ?', [territorio_id]);
        if (terr.length === 0) return res.status(404).json({ ok: false, msg: 'Territorio no encontrado.' });
        const t = terr[0];

        const [maxRow] = await pool.query('SELECT COALESCE(MAX(ciclo), 1) as ciclo FROM bitacora_territorios WHERE territorio_id = ?', [t.id]);
        let cicloActual = maxRow[0].ciclo || 1;
        const { estadoPorManzana, cerradoExplicito, registrosCount } = await calcularEstadoManzanasCiclo(pool, t.id, cicloActual);
        if (registrosCount > 0 && cerradoExplicito) {
            cicloActual++;
        } else {
            for (const m of listaManz) {
                if (estadoPorManzana[m] === 'COMPLETO') {
                    return res.status(400).json({ ok: false, msg: `La manzana ${m} ya fue completada en este recorrido.` });
                }
            }
        }

        const hoyPeru = new Date(Date.now() - 5 * 3600000).toISOString().split('T')[0];
        const fechaRegFinal = fecha_registro || hoyPeru;
        const estadoFinalTerr = estado_territorio || 'INICIO';
        const esCierre = estadoFinalTerr === 'CIERRE' || estadoFinalTerr === 'INICIO - CIERRE';
        const fechaCierreFinal = fecha_cierre ? fecha_cierre : (esCierre ? fecha : null);
        await pool.query(
            'INSERT INTO bitacora_territorios (fecha_registro, fecha, fecha_cierre, territorio_id, manzanas, estado_manzanas, manzanas_detalle, turno_id, turno_nombre, conductor_id, conductor_nombre, estado_territorio, ciclo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [fechaRegFinal, fecha, fechaCierreFinal, t.id, manzStr, estadoResumen, detalleJson, turno_id || null, turno_nombre || '', conductor_id || null, conductor_nombre || '', estadoFinalTerr, cicloActual]
        );
        res.json({ ok: true, ciclo: cicloActual });
    } catch (error) { res.status(500).json({ ok: false, msg: msgErr(error) }); }
});

router.put('/api/territorios/bitacora/:id', soloAdmin, async (req, res) => {
    const { fecha_registro, fecha, fecha_cierre, territorio_id, manzanas, estado_manzanas, manzanas_detalle, turno_id, turno_nombre, conductor_id, conductor_nombre, estado_territorio } = req.body;
    const { listaManz, manzStr, estadoResumen, detalleJson } = normalizarPayloadManzanas(manzanas, estado_manzanas, manzanas_detalle);
    if (!fecha || !territorio_id || listaManz.length === 0) {
        return res.status(400).json({ ok: false, msg: 'Debes indicar la fecha de inicio, el territorio y al menos una manzana.' });
    }
    try {
        const [orig] = await pool.query('SELECT * FROM bitacora_territorios WHERE id = ?', [req.params.id]);
        if (orig.length === 0) return res.status(404).json({ ok: false, msg: 'Registro no encontrado.' });
        const ciclo = orig[0].ciclo || 1;
        const { estadoPorManzana } = await calcularEstadoManzanasCiclo(pool, territorio_id, ciclo, req.params.id);
        for (const m of listaManz) {
            if (estadoPorManzana[m] === 'COMPLETO') {
                return res.status(400).json({ ok: false, msg: `La manzana ${m} ya fue completada en otro registro de esta vuelta.` });
            }
        }
        const fechaRegFinal = fecha_registro || formatearFechaYMD(orig[0].fecha_registro) || fecha;
        const estadoFinalTerr = estado_territorio || 'INICIO';
        const esCierre = estadoFinalTerr === 'CIERRE' || estadoFinalTerr === 'INICIO - CIERRE';
        const fechaCierreFinal = fecha_cierre ? fecha_cierre : (esCierre ? fecha : null);
        await pool.query(
            'UPDATE bitacora_territorios SET fecha_registro=?, fecha=?, fecha_cierre=?, territorio_id=?, manzanas=?, estado_manzanas=?, manzanas_detalle=?, turno_id=?, turno_nombre=?, conductor_id=?, conductor_nombre=?, estado_territorio=? WHERE id=?',
            [fechaRegFinal, fecha, fechaCierreFinal, territorio_id, manzStr, estadoResumen, detalleJson, turno_id || null, turno_nombre || '', conductor_id || null, conductor_nombre || '', estadoFinalTerr, req.params.id]
        );
        res.json({ ok: true });
    } catch (error) { res.status(500).json({ ok: false, msg: msgErr(error) }); }
});

router.delete('/api/territorios/bitacora/:id', soloAdmin, async (req, res) => {
    try {
        await pool.query('DELETE FROM bitacora_territorios WHERE id = ?', [req.params.id]);
        res.json({ ok: true });
    } catch (error) { res.status(500).json({ ok: false, msg: msgErr(error) }); }
});

// Resumen de ciclos por territorio para el reporte S-13
router.get('/api/territorios/s13', soloGlobal, async (req, res) => {
    try {
        const [territorios] = await pool.query('SELECT * FROM territorios ORDER BY CAST(numero AS UNSIGNED) ASC, numero ASC');
        const [bitacora] = await pool.query('SELECT * FROM bitacora_territorios ORDER BY fecha ASC, id ASC');
        const data = territorios.map(t => {
            const regs = bitacora.filter(b => b.territorio_id === t.id);
            const ciclosMap = {};
            regs.forEach(r => {
                const c = r.ciclo || 1;
                if (!ciclosMap[c]) ciclosMap[c] = [];
                ciclosMap[c].push(r);
            });
            const ciclos = Object.keys(ciclosMap).map(cNum => {
                const lista = ciclosMap[cNum];
                const primero = lista[0];
                const ultimo = lista[lista.length - 1];
                const manzComp = new Set();
                let cerrado = false;
                lista.forEach(r => {
                    const detRow = parseManzanasDetalleRow(r);
                    for (const [mStr, estM] of Object.entries(detRow)) {
                        if (estM === 'COMPLETO') manzComp.add(Number(mStr));
                    }
                    if (r.estado_territorio === 'CIERRE' || r.estado_territorio === 'INICIO - CIERRE' || Boolean(r.fecha_cierre)) cerrado = true;
                });
                const terminado = cerrado || manzComp.size >= t.cantidad_manzanas;
                return {
                    ciclo: Number(cNum),
                    conductor_inicio: primero.conductor_nombre,
                    fecha_inicio: primero.fecha,
                    conductor_cierre: terminado ? ultimo.conductor_nombre : '',
                    fecha_cierre: terminado ? (ultimo.fecha_cierre || ultimo.fecha) : (ultimo.fecha_cierre || null),
                    completadas: manzComp.size,
                    total_manzanas: t.cantidad_manzanas,
                    terminado
                };
            });
            return { territorio: t, ciclos };
        });
        res.json(data);
    } catch (error) { res.status(500).json({ error: msgErr(error) }); }
});

module.exports = router;
