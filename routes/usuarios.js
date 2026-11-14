const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../lib/db');
const { msgErr, limpiarTelefono, telefonoValido, MSG_TELEFONO } = require('../lib/constantes');
const { soloAdmin, invalidarAuth } = require('../lib/auth');

const router = express.Router();

// --- USUARIOS (solo admin) ---
router.get('/api/usuarios', soloAdmin, async (req, res) => {
    try {
        // El teléfono sale del publicador vinculado (fuente única); si no hay vínculo, del propio usuario
        const [rows] = await pool.query(`SELECT u.id, u.nombre, u.grupo, u.correo, u.publicador_id, p.nombre AS publicador_nombre,
            COALESCE(NULLIF(p.telefono, ''), u.telefono) AS telefono
            FROM usuarios u LEFT JOIN publicadores p ON p.id = u.publicador_id ORDER BY u.grupo ASC`);
        res.json(rows);
    } catch (error) { res.status(500).json({ error: msgErr(error) }); }
});
function validarUsuario(b, { passwordObligatoria }) {
    const nombre = String(b.nombre || '').trim();
    const correo = String(b.correo || '').trim().toLowerCase();
    const grupo = parseInt(b.grupo);
    if (!nombre) return { error: 'El nombre es obligatorio.' };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) return { error: 'Correo electrónico inválido.' };
    if (isNaN(grupo) || grupo < 0 || grupo > 9) return { error: 'Grupo inválido (0 a 9).' };
    const password = b.password ? String(b.password) : '';
    if ((passwordObligatoria || password) && password.length < 6) return { error: 'La contraseña debe tener al menos 6 caracteres.' };
    const pidRaw = b.publicador_id;
    const publicador_id = (pidRaw === undefined || pidRaw === null || pidRaw === '') ? null : parseInt(pidRaw, 10);
    if (publicador_id !== null && (!Number.isInteger(publicador_id) || publicador_id < 1)) return { error: 'Publicador vinculado inválido.' };
    if (b.telefono !== undefined && !telefonoValido(b.telefono)) return { error: MSG_TELEFONO };
    const telefono = b.telefono === undefined ? undefined : limpiarTelefono(b.telefono);
    return { nombre, correo, grupo, password, publicador_id, telefono };
}
// El publicador debe existir y no estar ya vinculado a otro usuario
async function validarVinculo(publicadorId, usuarioId) {
    if (publicadorId === null) return null;
    const [p] = await pool.query('SELECT id FROM publicadores WHERE id = ?', [publicadorId]);
    if (p.length === 0) return 'El publicador vinculado no existe.';
    const [u] = await pool.query('SELECT id FROM usuarios WHERE publicador_id = ? AND id != ?', [publicadorId, usuarioId || 0]);
    if (u.length > 0) return 'Ese publicador ya está vinculado a otro usuario.';
    return null;
}
const errorUsuario = (res, error) => error.code === 'ER_DUP_ENTRY'
    ? res.status(400).json({ ok: false, msg: 'Ya existe un usuario con ese correo.' })
    : res.status(500).json({ ok: false, msg: msgErr(error) });
router.post('/api/usuarios', soloAdmin, async (req, res) => {
    const v = validarUsuario(req.body, { passwordObligatoria: true }); if (v.error) return res.status(400).json({ ok: false, msg: v.error });
    try {
        const err = await validarVinculo(v.publicador_id, 0); if (err) return res.status(400).json({ ok: false, msg: err });
        await pool.query('INSERT INTO usuarios (nombre, grupo, correo, password, publicador_id, telefono) VALUES (?, ?, ?, ?, ?, ?)',
            [v.nombre, v.grupo, v.correo, await bcrypt.hash(v.password, 10), v.publicador_id, v.publicador_id ? null : (v.telefono ?? null)]);
        if (v.publicador_id && v.telefono !== undefined) await pool.query('UPDATE publicadores SET telefono = ? WHERE id = ?', [v.telefono, v.publicador_id]);
        res.json({ ok: true });
    } catch (error) { errorUsuario(res, error); }
});
router.delete('/api/usuarios/:id', soloAdmin, async (req, res) => {
    if (req.params.id == req.user.id) return res.status(400).json({ ok: false, msg: 'No puedes eliminar tu propio usuario.' });
    try { await pool.query('DELETE FROM usuarios WHERE id = ?', [req.params.id]); invalidarAuth(req.params.id); res.json({ ok: true }); } catch (error) { res.status(500).json({ ok: false, msg: msgErr(error) }); }
});
router.put('/api/usuarios/:id', soloAdmin, async (req, res) => {
    const v = validarUsuario(req.body, { passwordObligatoria: false }); if (v.error) return res.status(400).json({ ok: false, msg: v.error });
    if (req.params.id == req.user.id && v.grupo != 0) return res.status(400).json({ ok: false, msg: 'No puedes quitarte a ti mismo el rol de administrador.' });
    try {
        const err = await validarVinculo(v.publicador_id, req.params.id); if (err) return res.status(400).json({ ok: false, msg: err });
        const campos = ['nombre=?', 'grupo=?', 'correo=?', 'publicador_id=?']; const vals = [v.nombre, v.grupo, v.correo, v.publicador_id];
        if (v.password) { campos.push('password=?'); vals.push(await bcrypt.hash(v.password, 10)); }
        if (v.telefono !== undefined) { campos.push('telefono=?'); vals.push(v.publicador_id ? null : v.telefono); }
        vals.push(req.params.id);
        await pool.query(`UPDATE usuarios SET ${campos.join(', ')} WHERE id=?`, vals);
        if (v.publicador_id && v.telefono !== undefined) await pool.query('UPDATE publicadores SET telefono = ? WHERE id = ?', [v.telefono, v.publicador_id]);
        invalidarAuth(req.params.id);
        res.json({ ok: true });
    } catch (error) { errorUsuario(res, error); }
});

module.exports = router;
