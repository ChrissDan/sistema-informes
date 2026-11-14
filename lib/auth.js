const jwt = require('jsonwebtoken');
const pool = require('./db');
const { msgErr } = require('./constantes');

// JWT_SECRET es obligatorio: sin él, el token se podría falsificar. Genera uno con:
// node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
    console.error('❌ Falta JWT_SECRET en .env (mínimo 32 caracteres). El servidor no se iniciará sin un secreto seguro.');
    process.exit(1);
}

const esGlobal = (g) => g == 0 || g == 9;
const soloAdmin = (req, res, next) => req.user.grupo == 0 ? next() : res.status(403).json({ ok: false, msg: 'Acceso denegado.' });
const soloGlobal = (req, res, next) => esGlobal(req.user.grupo) ? next() : res.status(403).json({ ok: false, msg: 'Acceso denegado.' });

// Todo /api (excepto login) requiere token válido. El grupo/rol se revalida contra la BD (cache de 30 s):
// si se elimina o cambia a un usuario, el token deja de dar el acceso anterior
const authCache = new Map();
const invalidarAuth = (id) => authCache.delete(Number(id));
async function autenticar(req, res, next) {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) return res.status(401).json({ ok: false, msg: 'No autenticado' });
    let payload;
    try { payload = jwt.verify(token, JWT_SECRET); }
    catch (e) { return res.status(401).json({ ok: false, msg: 'Sesión inválida o expirada' }); }
    try {
        let u = authCache.get(payload.id);
        if (!u || Date.now() - u.t > 30000) {
            const [rows] = await pool.query('SELECT grupo FROM usuarios WHERE id = ?', [payload.id]);
            if (!rows[0]) { authCache.delete(payload.id); return res.status(401).json({ ok: false, msg: 'Sesión inválida o expirada' }); }
            u = { grupo: rows[0].grupo, t: Date.now() }; authCache.set(payload.id, u);
        }
        req.user = { id: payload.id, grupo: u.grupo }; next();
    } catch (e) { res.status(500).json({ ok: false, msg: msgErr(e) }); }
}

// Encargados de grupo (no 0 ni 9): el grupo se fuerza desde el token, ignorando lo que envíe el cliente
function filtroGrupo(req, res, next) {
    if (!esGlobal(req.user.grupo)) {
        const g = String(req.user.grupo);
        Object.defineProperty(req, 'query', { value: { ...req.query, grupo: g }, writable: true, configurable: true });
        if (req.method === 'POST' && req.body && /^\/(informes|reportes\/advanced)$/.test(req.path)) req.body.grupo = g;
    }
    next();
}

module.exports = { JWT_SECRET, esGlobal, soloAdmin, soloGlobal, autenticar, filtroGrupo, invalidarAuth };
