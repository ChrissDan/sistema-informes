const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../lib/db');
const { msgErr } = require('../lib/constantes');
const { soloAdmin, invalidarAuth } = require('../lib/auth');

const router = express.Router();

// --- USUARIOS (solo admin) ---
router.get('/api/usuarios', soloAdmin, async (req, res) => { try { const [rows] = await pool.query('SELECT id, nombre, grupo, correo FROM usuarios ORDER BY grupo ASC'); res.json(rows); } catch (error) { res.status(500).json({ error: msgErr(error) }); } });
function validarUsuario(b, { passwordObligatoria }) {
    const nombre = String(b.nombre || '').trim();
    const correo = String(b.correo || '').trim().toLowerCase();
    const grupo = parseInt(b.grupo);
    if (!nombre) return { error: 'El nombre es obligatorio.' };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) return { error: 'Correo electrónico inválido.' };
    if (isNaN(grupo) || grupo < 0 || grupo > 9) return { error: 'Grupo inválido (0 a 9).' };
    const password = b.password ? String(b.password) : '';
    if ((passwordObligatoria || password) && password.length < 6) return { error: 'La contraseña debe tener al menos 6 caracteres.' };
    return { nombre, correo, grupo, password };
}
const errorUsuario = (res, error) => error.code === 'ER_DUP_ENTRY'
    ? res.status(400).json({ ok: false, msg: 'Ya existe un usuario con ese correo.' })
    : res.status(500).json({ ok: false, msg: msgErr(error) });
router.post('/api/usuarios', soloAdmin, async (req, res) => {
    const v = validarUsuario(req.body, { passwordObligatoria: true }); if (v.error) return res.status(400).json({ ok: false, msg: v.error });
    try { await pool.query('INSERT INTO usuarios (nombre, grupo, correo, password) VALUES (?, ?, ?, ?)', [v.nombre, v.grupo, v.correo, await bcrypt.hash(v.password, 10)]); res.json({ ok: true }); } catch (error) { errorUsuario(res, error); }
});
router.delete('/api/usuarios/:id', soloAdmin, async (req, res) => {
    if (req.params.id == req.user.id) return res.status(400).json({ ok: false, msg: 'No puedes eliminar tu propio usuario.' });
    try { await pool.query('DELETE FROM usuarios WHERE id = ?', [req.params.id]); invalidarAuth(req.params.id); res.json({ ok: true }); } catch (error) { res.status(500).json({ ok: false, msg: msgErr(error) }); }
});
router.put('/api/usuarios/:id', soloAdmin, async (req, res) => {
    const v = validarUsuario(req.body, { passwordObligatoria: false }); if (v.error) return res.status(400).json({ ok: false, msg: v.error });
    if (req.params.id == req.user.id && v.grupo != 0) return res.status(400).json({ ok: false, msg: 'No puedes quitarte a ti mismo el rol de administrador.' });
    try {
        if (v.password) await pool.query('UPDATE usuarios SET nombre=?, grupo=?, correo=?, password=? WHERE id=?', [v.nombre, v.grupo, v.correo, await bcrypt.hash(v.password, 10), req.params.id]);
        else await pool.query('UPDATE usuarios SET nombre=?, grupo=?, correo=? WHERE id=?', [v.nombre, v.grupo, v.correo, req.params.id]);
        invalidarAuth(req.params.id);
        res.json({ ok: true });
    } catch (error) { errorUsuario(res, error); }
});

module.exports = router;
