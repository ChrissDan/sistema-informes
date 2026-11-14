const express = require('express');
const pool = require('../lib/db');
const { msgErr } = require('../lib/constantes');
const { claveMes, getMesActivo, pendienteSQL } = require('../lib/mes');

const router = express.Router();

router.get('/api/mes-activo', async (req, res) => {
    try { const a = await getMesActivo(pool); res.json({ mes: a.mes, anio_servicio: a.anio_servicio }); }
    catch (error) { res.status(500).json({ error: msgErr(error) }); }
});

// --- CIERRES ---
router.get('/api/cierres', async (req, res) => {
    const { anio_servicio } = req.query;
    try { const [rows] = await pool.query('SELECT mes FROM cierres WHERE anio_servicio = ?', [anio_servicio]); res.json(rows.map(r => r.mes)); } 
    catch (error) { res.status(500).json({ error: msgErr(error) }); }
});

router.post('/api/cerrar-mes', async (req, res) => {
    const { mes, anio_servicio } = req.body;
    if (req.user.grupo != 0) return res.status(403).json({ ok: false, msg: 'Acceso denegado.' });

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        if (isNaN(claveMes(mes, anio_servicio))) { await conn.rollback(); return res.json({ ok: false, msg: 'Mes inválido.' }); }
        const pq = pendienteSQL(mes, anio_servicio, 'p'); const [pendientes] = await conn.query(`SELECT COUNT(*) as total FROM publicadores p WHERE ${pq.sql}`, pq.params);
        if (pendientes[0].total > 0) {
            await conn.rollback();
            return res.json({ ok: false, msg: `Faltan ${pendientes[0].total} informes de publicadores activos.` });
        }
        const [existe] = await conn.query("SELECT * FROM cierres WHERE mes = ? AND anio_servicio = ?", [mes, anio_servicio]);
        if (existe.length > 0) {
            await conn.rollback();
            return res.json({ ok: false, msg: `Mes ya cerrado en este año.` });
        }
        await conn.query("INSERT INTO cierres (mes, anio_servicio) VALUES (?, ?)", [mes, anio_servicio]);
        await conn.commit();
        res.json({ ok: true });
    } catch (error) { await conn.rollback(); res.status(500).json({ ok: false, msg: msgErr(error) });
    } finally { conn.release(); }
});

router.post('/api/reabrir-mes', async (req, res) => {
    const { mes, anio_servicio } = req.body;
    if (req.user.grupo != 0) return res.status(403).json({ ok: false, msg: "No tienes permiso para reabrir meses." });
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const [del] = await conn.query("DELETE FROM cierres WHERE mes = ? AND anio_servicio = ?", [mes, anio_servicio]);
        if (del.affectedRows === 0) { await conn.rollback(); return res.json({ ok: false, msg: "Ese mes no estaba cerrado." }); }
        await conn.commit();
        res.json({ ok: true });
    } catch (error) { await conn.rollback(); res.status(500).json({ ok: false, msg: "Error al reabrir el mes." }); }
    finally { conn.release(); }
});

module.exports = router;
