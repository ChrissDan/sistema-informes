const express = require('express');
const pool = require('../lib/db');
const { MESES_ORDER, ordenMesSQL, msgErr } = require('../lib/constantes');

const router = express.Router();

// --- REUNIONES ---
router.get('/api/reuniones', async (req, res) => {
    const { mes, anio_servicio } = req.query;
    try {
        let query = "SELECT * FROM reuniones WHERE anio_servicio = ?"; const params = [anio_servicio];
        if (mes && mes !== 'TODOS') { query += " AND mes = ?"; params.push(mes); }
        query += ` ORDER BY ${ordenMesSQL('mes')} ASC, tipo ASC, modalidad ASC`;
        const [rows] = await pool.query(query, params); res.json(rows);
    } catch (error) { res.status(500).json({ error: msgErr(error) }); }
});
const TIPOS_REUNION = ['ENTRE SEMANA', 'FIN DE SEMANA'], MODALIDADES_REUNION = ['PRESENCIAL', 'ZOOM'];
function validarReunion(b) {
    const mes = String(b.mes || '').trim().toUpperCase();
    if (!MESES_ORDER.includes(mes)) return { error: 'Mes inválido.' };
    if (!TIPOS_REUNION.includes(b.tipo)) return { error: 'Tipo de reunión inválido.' };
    if (!MODALIDADES_REUNION.includes(b.modalidad)) return { error: 'Modalidad inválida.' };
    const sem = [b.sem1, b.sem2, b.sem3, b.sem4, b.sem5].map(v => parseInt(v) || 0);
    if (sem.some(v => v < 0 || v > 9999)) return { error: 'La asistencia debe ser un número entre 0 y 9999.' };
    return { mes, tipo: b.tipo, modalidad: b.modalidad, sem };
}
router.post('/api/reuniones', async (req, res) => {
    if (req.user.grupo != 0) return res.status(403).json({ ok: false, msg: 'No tienes permiso.' });
    const v = validarReunion(req.body); if (v.error) return res.status(400).json({ ok: false, msg: v.error });
    const anio = parseInt(req.body.anio_servicio); if (!anio) return res.status(400).json({ ok: false, msg: 'Año de servicio inválido.' });
    try {
        const [dup] = await pool.query('SELECT id FROM reuniones WHERE mes = ? AND tipo = ? AND modalidad = ? AND anio_servicio = ?', [v.mes, v.tipo, v.modalidad, anio]);
        if (dup.length > 0) return res.status(400).json({ ok: false, msg: `Ya existe el registro de ${v.mes} · ${v.tipo} · ${v.modalidad}. Edítalo en lugar de crear otro.` });
        await pool.query('INSERT INTO reuniones (mes, tipo, modalidad, sem1, sem2, sem3, sem4, sem5, anio_servicio) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [v.mes, v.tipo, v.modalidad, ...v.sem, anio]);
        res.json({ ok: true });
    } catch (error) { res.status(500).json({ ok: false, msg: msgErr(error) }); }
});
router.put('/api/reuniones/:id', async (req, res) => {
    if (req.user.grupo != 0) return res.status(403).json({ ok: false, msg: 'No tienes permiso.' });
    const v = validarReunion(req.body); if (v.error) return res.status(400).json({ ok: false, msg: v.error });
    try {
        const [orig] = await pool.query('SELECT anio_servicio FROM reuniones WHERE id = ?', [req.params.id]);
        if (orig.length === 0) return res.status(404).json({ ok: false, msg: 'Registro no encontrado.' });
        const [dup] = await pool.query('SELECT id FROM reuniones WHERE mes = ? AND tipo = ? AND modalidad = ? AND anio_servicio = ? AND id != ?', [v.mes, v.tipo, v.modalidad, orig[0].anio_servicio, req.params.id]);
        if (dup.length > 0) return res.status(400).json({ ok: false, msg: `Ya existe otro registro de ${v.mes} · ${v.tipo} · ${v.modalidad}.` });
        await pool.query('UPDATE reuniones SET mes=?, tipo=?, modalidad=?, sem1=?, sem2=?, sem3=?, sem4=?, sem5=? WHERE id=?', [v.mes, v.tipo, v.modalidad, ...v.sem, req.params.id]);
        res.json({ ok: true });
    } catch (error) { res.status(500).json({ ok: false, msg: msgErr(error) }); }
});
router.delete('/api/reuniones/:id', async (req, res) => { const requester_group = req.query.requester_group; if (req.user.grupo != 0) return res.status(403).json({ ok: false, msg: 'Acceso denegado.' }); try { await pool.query('DELETE FROM reuniones WHERE id = ?', [req.params.id]); res.json({ ok: true }); } catch (error) { res.status(500).json({ ok: false, msg: msgErr(error) }); } });

module.exports = router;
