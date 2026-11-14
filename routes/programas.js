const express = require('express');
const pool = require('../lib/db');
const { msgErr } = require('../lib/constantes');
const { soloAdmin, soloGlobal } = require('../lib/auth');

const router = express.Router();

// --- PROGRAMA DEL SERVICIO DEL CAMPO ---
// Se guarda UN programa por tipo de reunión: VIE_DOM (Viernes–Domingo) y DOM_JUE (Domingo–Jueves).
// Al guardar uno nuevo del mismo tipo, reemplaza al anterior.
const TIPOS = ['VIE_DOM', 'DOM_JUE'];
const DIAS = ['Viernes', 'Sábado', 'Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves'];
const txt = (v, max) => String(v ?? '').trim().slice(0, max);
const fechaOVacio = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '');

function sanearPrograma(b) {
    if (!b || !Array.isArray(b.filas)) return { error: 'Programa inválido.' };
    if (b.filas.length > 60) return { error: 'El programa no puede tener más de 60 filas.' };
    const filas = b.filas.map((f) => ({
        id: txt(f.id, 40),
        dia: DIAS.includes(f.dia) ? f.dia : 'Viernes',
        turno: txt(f.turno, 60),
        hora: txt(f.hora, 20),
        grupo: txt(f.grupo, 3) || 'T',
        punto: txt(f.punto, 120) || '-',
        territorios: txt(f.territorios, 60),
        manzanas: txt(f.manzanas, 120),
        conductor: txt(f.conductor, 120),
        telefono: txt(f.telefono, 30)
    }));
    return { fechaIni: fechaOVacio(b.fechaIni), fechaFin: fechaOVacio(b.fechaFin), mostrarGrupo: b.mostrarGrupo !== false, filas };
}

router.get('/api/programas', soloGlobal, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT tipo, datos, actualizado_en FROM programas_predicacion');
        const salida = { VIE_DOM: null, DOM_JUE: null };
        for (const r of rows) {
            if (!TIPOS.includes(r.tipo)) continue;
            try { salida[r.tipo] = { ...JSON.parse(r.datos), actualizado_en: r.actualizado_en }; } catch (e) { /* dato dañado: se ignora */ }
        }
        res.json(salida);
    } catch (error) { res.status(500).json({ error: msgErr(error) }); }
});

router.put('/api/programas/:tipo', soloAdmin, async (req, res) => {
    const tipo = String(req.params.tipo).toUpperCase();
    if (!TIPOS.includes(tipo)) return res.status(400).json({ ok: false, msg: 'Tipo de programa inválido.' });
    const p = sanearPrograma(req.body); if (p.error) return res.status(400).json({ ok: false, msg: p.error });
    try {
        await pool.query(
            `INSERT INTO programas_predicacion (tipo, fecha_ini, fecha_fin, datos, actualizado_por) VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE fecha_ini = VALUES(fecha_ini), fecha_fin = VALUES(fecha_fin), datos = VALUES(datos), actualizado_por = VALUES(actualizado_por)`,
            [tipo, p.fechaIni || null, p.fechaFin || null, JSON.stringify(p), req.user.id]);
        res.json({ ok: true });
    } catch (error) { res.status(500).json({ ok: false, msg: msgErr(error) }); }
});

router.delete('/api/programas/:tipo', soloAdmin, async (req, res) => {
    const tipo = String(req.params.tipo).toUpperCase();
    if (!TIPOS.includes(tipo)) return res.status(400).json({ ok: false, msg: 'Tipo de programa inválido.' });
    try { await pool.query('DELETE FROM programas_predicacion WHERE tipo = ?', [tipo]); res.json({ ok: true }); }
    catch (error) { res.status(500).json({ ok: false, msg: msgErr(error) }); }
});

module.exports = router;
