const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../lib/db');
const { JWT_SECRET } = require('../lib/auth');

const router = express.Router();

const isHash = (v) => typeof v === 'string' && /^\$2[aby]\$/.test(v);

// Limitador simple de intentos de login (por IP, en memoria)
const intentos = new Map();
const MAX_INTENTOS = 25, VENTANA_MS = 5 * 60 * 1000;
setInterval(() => { const now = Date.now(); for (const [ip, e] of intentos) if (now - e.t > VENTANA_MS) intentos.delete(ip); }, VENTANA_MS).unref();
function loginLimiter(req, res, next) {
    const now = Date.now();
    const e = intentos.get(req.ip) || { n: 0, t: now };
    if (now - e.t > VENTANA_MS) { e.n = 0; e.t = now; }
    if (e.n >= MAX_INTENTOS) return res.status(429).json({ ok: false, msg: 'Demasiados intentos. Intenta más tarde.' });
    req.loginEntry = e; intentos.set(req.ip, e);
    next();
}

router.post('/api/login', loginLimiter, async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ ok: false, msg: 'Datos incompletos' });
    try {
        const cleanEmail = String(email).trim().toLowerCase();
        const cleanPass = String(password);
        const [rows] = await pool.query('SELECT * FROM usuarios WHERE LOWER(TRIM(correo)) = ?', [cleanEmail]);
        const user = rows[0];
        let valido = false;
        if (user) {
            if (isHash(user.password)) {
                valido = await bcrypt.compare(cleanPass, user.password) || (cleanPass.trim() !== cleanPass && await bcrypt.compare(cleanPass.trim(), user.password));
            } else if (cleanPass === user.password || cleanPass.trim() === user.password) { // contraseña heredada en texto plano: migrar
                valido = true;
                await pool.query('UPDATE usuarios SET password = ? WHERE id = ?', [await bcrypt.hash(cleanPass.trim(), 10), user.id]);
            }
        }
        if (!valido) { 
            req.loginEntry.n++; 
            return res.status(401).json({ ok: false, msg: 'Correo o contraseña incorrectos' }); 
        }
        req.loginEntry.n = 0;
        const token = jwt.sign({ id: user.id, grupo: user.grupo }, JWT_SECRET, { expiresIn: '12h' });
        res.json({ ok: true, token, user: { id: user.id, nombre: user.nombre, grupo: user.grupo, correo: user.correo } });
    } catch (error) { 
        console.error('Error en /api/login:', error);
        res.status(500).json({ ok: false, msg: 'Error de servidor' }); 
    }
});

module.exports = router;
