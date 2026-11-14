require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;
// JWT_SECRET es obligatorio: sin él, el token se podría falsificar. Genera uno con:
// node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
    console.error('❌ Falta JWT_SECRET en .env (mínimo 32 caracteres). El servidor no se iniciará sin un secreto seguro.');
    process.exit(1);
}

// Detrás de un proxy (Render, Railway, Nginx...) define TRUST_PROXY=1 para que req.ip sea la IP real del cliente
if (process.env.TRUST_PROXY) app.set('trust proxy', /^\d+$/.test(process.env.TRUST_PROXY) ? parseInt(process.env.TRUST_PROXY) : process.env.TRUST_PROXY);
app.use(express.json());
app.use(express.static('public'));

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: process.env.DB_SSL_INSECURE !== 'true' }, // verifica el certificado de TiDB (DB_SSL_INSECURE=true solo para depurar)
    
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
});

const MESES_ORDER = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
// Orden dentro del año de servicio (septiembre -> agosto) para usar en ORDER BY
const MESES_SERVICIO = ['SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE', 'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO'];
const ordenMesSQL = (col) => `FIELD(${col}, ${MESES_SERVICIO.map(m => `'${m}'`).join(', ')})`;
// Registra el error real en el servidor y devuelve un mensaje genérico al cliente
const msgErr = (e) => { console.error(e); return 'Error interno del servidor.'; };
// Privilegios que deben reportar horas y meta mínima de horas de los auxiliares (S-21)
const PRIV_CON_HORAS = ['REG', 'ESP', 'AUX I', 'AUX M', 'AUX', 'AUX C'];
const metaHorasPriv = (p) => p === 'AUX C' ? 15 : (['AUX I', 'AUX M', 'AUX'].includes(p) ? 30 : 0);

// --- AUTH ---
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

app.post('/api/login', loginLimiter, async (req, res) => {
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

// Todo /api (excepto login) requiere token válido; el rol sale del token, no del cliente
// El grupo/rol se revalida contra la BD (cache de 30 s): si se elimina o cambia a un usuario, el token deja de dar el acceso anterior
const authCache = new Map();
const invalidarAuth = (id) => authCache.delete(Number(id));
app.use('/api', async (req, res, next) => {
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
});
// Encargados de grupo (no 0 ni 9): el grupo se fuerza desde el token, ignorando lo que envíe el cliente
const esGlobal = (g) => g == 0 || g == 9;
app.use('/api', (req, res, next) => {
    if (!esGlobal(req.user.grupo)) {
        const g = String(req.user.grupo);
        Object.defineProperty(req, 'query', { value: { ...req.query, grupo: g }, writable: true, configurable: true });
        if (req.method === 'POST' && req.body && /^\/(informes|reportes\/advanced)$/.test(req.path)) req.body.grupo = g;
    }
    next();
});
const soloAdmin = (req, res, next) => req.user.grupo == 0 ? next() : res.status(403).json({ ok: false, msg: 'Acceso denegado.' });
const soloGlobal = (req, res, next) => esGlobal(req.user.grupo) ? next() : res.status(403).json({ ok: false, msg: 'Acceso denegado.' });
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
app.get('/api/mes-activo', async (req, res) => {
    try { const a = await getMesActivo(pool); res.json({ mes: a.mes, anio_servicio: a.anio_servicio }); }
    catch (error) { res.status(500).json({ error: msgErr(error) }); }
});

// --- CIERRES ---
app.get('/api/cierres', async (req, res) => {
    const { anio_servicio } = req.query;
    try { const [rows] = await pool.query('SELECT mes FROM cierres WHERE anio_servicio = ?', [anio_servicio]); res.json(rows.map(r => r.mes)); } 
    catch (error) { res.status(500).json({ error: msgErr(error) }); }
});

app.post('/api/cerrar-mes', async (req, res) => {
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

app.post('/api/reabrir-mes', async (req, res) => {
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

// --- DASHBOARD ---
app.get('/api/dashboard', async (req, res) => {
    const { mes, grupo, anio_servicio } = req.query;
    try {
        let filterGrp = ""; let paramsTotal = []; let paramsMes = [mes, anio_servicio];
        if (grupo && grupo != '0' && grupo != '9') { filterGrp = " AND grupo = ?"; paramsTotal.push(grupo); paramsMes.push(grupo); }

        const qReports = `SELECT grupo, COUNT(*) as count FROM informes WHERE mes = ? AND anio_servicio = ? ${filterGrp} GROUP BY grupo`;
        const qStats = `SELECT
            SUM(CASE WHEN priv3 IN ('PUB', 'PNB') THEN 1 ELSE 0 END) as pub_count,
            SUM(CASE WHEN priv3 IN ('PUB', 'PNB') THEN cursos ELSE 0 END) as pub_cursos,
            SUM(CASE WHEN priv3 IN ('AUX I', 'AUX M', 'AUX', 'AUX C') THEN 1 ELSE 0 END) as aux_count,
            SUM(CASE WHEN priv3 IN ('AUX I', 'AUX M', 'AUX', 'AUX C') THEN horas ELSE 0 END) as aux_horas,
            SUM(CASE WHEN priv3 IN ('AUX I', 'AUX M', 'AUX', 'AUX C') THEN cursos ELSE 0 END) as aux_cursos,
            SUM(CASE WHEN priv3 IN ('REG', 'ESP', 'MISIONERO') THEN 1 ELSE 0 END) as reg_count,
            SUM(CASE WHEN priv3 IN ('REG', 'ESP', 'MISIONERO') THEN horas ELSE 0 END) as reg_horas,
            SUM(CASE WHEN priv3 IN ('REG', 'ESP', 'MISIONERO') THEN cursos ELSE 0 END) as reg_cursos
            FROM informes WHERE mes = ? AND anio_servicio = ? ${filterGrp}`;

        const [[cierre], [reportsGroup], [statsRows], [activePubs]] = await Promise.all([
            pool.query("SELECT 1 FROM cierres WHERE mes = ? AND anio_servicio = ? LIMIT 1", [mes, anio_servicio]),
            pool.query(qReports, paramsMes),
            pool.query(qStats, paramsMes),
            pool.query(`SELECT grupo, COUNT(*) as total FROM publicadores WHERE activo = 1 ${filterGrp} GROUP BY grupo`, paramsTotal)
        ]);

        const isClosed = cierre.length > 0;
        const totalPubs = isClosed
            ? reportsGroup.map(r => ({ grupo: r.grupo, total: r.count }))
            : activePubs;
        const st = statsRows[0] || {};

        res.json({
            groups: { totals: totalPubs, reports: reportsGroup },
            stats: {
                pub: { count: Number(st.pub_count) || 0, cursos: Number(st.pub_cursos) || 0 },
                aux: { count: Number(st.aux_count) || 0, horas: Number(st.aux_horas) || 0, cursos: Number(st.aux_cursos) || 0 },
                reg: { count: Number(st.reg_count) || 0, horas: Number(st.reg_horas) || 0, cursos: Number(st.reg_cursos) || 0 }
            }
        });
    } catch (error) { res.status(500).json({ error: msgErr(error) }); }
});

app.get('/api/dashboard/cursos-por-mes', async (req, res) => {
    const { grupo, anio_servicio } = req.query;
    try {
        let sql = `SELECT mes,
            SUM(CASE WHEN priv3 IN ('PUB', 'PNB') THEN cursos ELSE 0 END) as pub,
            SUM(CASE WHEN priv3 IN ('AUX', 'AUX I', 'AUX M', 'AUX C') THEN cursos ELSE 0 END) as aux,
            SUM(CASE WHEN priv3 IN ('REG', 'ESP', 'MISIONERO') THEN cursos ELSE 0 END) as reg
            FROM informes WHERE anio_servicio = ?`;
        const params = [anio_servicio];
        if (grupo && grupo != '0' && grupo != '9') { sql += " AND grupo = ?"; params.push(grupo); }
        sql += " GROUP BY mes";
        const [rows] = await pool.query(sql, params);
        res.json(rows);
    } catch (error) { res.status(500).json({ error: msgErr(error) }); }
});

app.get('/api/dashboard/cursos', async (req, res) => {
    const { mes, grupo, anio_servicio } = req.query;
    try {
        let sql = `SELECT SUM(CASE WHEN priv3 IN ('PUB', 'PNB') THEN cursos ELSE 0 END) as pub, SUM(CASE WHEN priv3 IN ('AUX', 'AUX I', 'AUX M', 'AUX C') THEN cursos ELSE 0 END) as aux, SUM(CASE WHEN priv3 IN ('REG', 'ESP', 'MISIONERO') THEN cursos ELSE 0 END) as reg FROM informes WHERE anio_servicio = ?`;
        let params = [anio_servicio];
        if (mes && mes !== '' && mes !== 'TODOS') { sql += " AND mes = ?"; params.push(mes); }
        if (grupo && grupo != '0' && grupo != '9') { sql += " AND grupo = ?"; params.push(grupo); }
        const [rows] = await pool.query(sql, params);
        res.json({ pub: parseInt(rows[0].pub) || 0, aux: parseInt(rows[0].aux) || 0, reg: parseInt(rows[0].reg) || 0 });
    } catch (error) { res.status(500).json({ error: msgErr(error) }); }
});

app.get('/api/dashboard/cursos-comparativa', async (req, res) => {
    const { grupo, anio_servicio } = req.query;
    try {
        let sql = `SELECT mes, SUM(CASE WHEN cursos > 0 THEN 1 ELSE 0 END) as con_cursos, SUM(CASE WHEN cursos = 0 OR cursos IS NULL THEN 1 ELSE 0 END) as sin_cursos FROM informes WHERE anio_servicio = ?`;
        let params = [anio_servicio];
        if (grupo && grupo != '0' && grupo != '9') { sql += " AND grupo = ?"; params.push(grupo); }
        sql += " GROUP BY mes";
        const [rows] = await pool.query(sql, params);
        res.json(rows); 
    } catch (error) { res.status(500).json({ error: msgErr(error) }); }
});

app.get('/api/dashboard/asistencia-comparativa', async (req, res) => {
    const { anio_servicio } = req.query;
    try {
        const sql = `SELECT mes, tipo, modalidad, SUM(sem1) as s1, SUM(sem2) as s2, SUM(sem3) as s3, SUM(sem4) as s4, SUM(sem5) as s5 FROM reuniones WHERE anio_servicio = ? GROUP BY mes, tipo, modalidad`;
        const [rows] = await pool.query(sql, [anio_servicio]);
        const resultados = rows.map(r => {
            const s1 = parseInt(r.s1) || 0; const s2 = parseInt(r.s2) || 0; const s3 = parseInt(r.s3) || 0; const s4 = parseInt(r.s4) || 0; const s5 = parseInt(r.s5) || 0;
            let weeks = 0; if (s1 > 0) weeks++; if (s2 > 0) weeks++; if (s3 > 0) weeks++; if (s4 > 0) weeks++; if (s5 > 0) weeks++;
            return { mes: r.mes, tipo: r.tipo, modalidad: r.modalidad, promedio: weeks > 0 ? Math.round((s1 + s2 + s3 + s4 + s5) / weeks) : 0 };
        });
        res.json(resultados);
    } catch (error) { res.status(500).json({ error: msgErr(error) }); }
});

// --- PUBLICADORES (Directorio Global) ---
app.get('/api/publicadores', async (req, res) => {
    const { grupo, pendientes, nombre, priv3, sin_informe_mes, anio_servicio } = req.query;
    try {
        // 'informo_mes' se calcula con los informes reales del mes activo (ya no se guarda una marca)
        const act = await getMesActivo(pool);
        let query = "SELECT publicadores.*, IF(EXISTS(SELECT 1 FROM informes i WHERE i.publicador_id = publicadores.id AND i.mes = ? AND i.anio_servicio = ?), 'SI', 'NO') AS informo_mes FROM publicadores WHERE 1=1";
        const params = [act.mes, act.anio_servicio];
        if (grupo && grupo != '0' && grupo != '9') { query += " AND grupo = ?"; params.push(grupo); }
        if (pendientes === 'true') { const pq = pendienteSQL(act.mes, act.anio_servicio); query += " AND " + pq.sql; params.push(...pq.params); }
        // Solo activos que aún NO tienen informe en ese mes/año de servicio (evita duplicados)
        if (sin_informe_mes && anio_servicio) {
            const pq = pendienteSQL(sin_informe_mes, anio_servicio); query += " AND " + pq.sql; params.push(...pq.params);
        }
        if (priv3 && priv3 !== '') { 
            if (priv3 === 'AUX' || priv3 === 'AUX_COMBINED') { query += " AND priv3 IN ('AUX', 'AUX I', 'AUX M', 'AUX C')"; } 
            else { query += " AND priv3 = ?"; params.push(priv3); }
        }
        if (nombre && nombre !== '') { query += " AND nombre LIKE ?"; params.push(`%${nombre}%`); }
        query += " ORDER BY activo DESC, grupo ASC, nombre ASC";
        const [rows] = await pool.query(query, params); res.json(rows);
    } catch (error) { res.status(500).json({ error: msgErr(error) }); }
});

app.post('/api/publicadores', async (req, res) => { 
    const { grupo, nombre, priv1, priv2, priv3, comentario, fecha_ingreso, requester_group, fecha_nacimiento, fecha_bautismo, sexo, esperanza, privilegio_s21 } = req.body; 
    if (req.user.grupo != 0) return res.status(403).json({ ok: false, msg: 'Solo Admin puede crear.' }); 
    try { 
        const fechaFinal = fecha_ingreso ? fecha_ingreso : new Date(); 
        const fNac = fecha_nacimiento ? fecha_nacimiento : null;
        const fBau = fecha_bautismo ? fecha_bautismo : null;
        await pool.query(
            'INSERT INTO publicadores (grupo, nombre, priv1, priv2, priv3, comentario, activo, fecha_ingreso, fecha_nacimiento, fecha_bautismo, sexo, esperanza, privilegio_s21) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)', 
            [grupo, nombre, priv1, priv2, priv3, comentario, fechaFinal, fNac, fBau, sexo || 'Hombre', esperanza || 'Otras ovejas', privilegio_s21 || '']
        ); 
        res.json({ ok: true }); 
    } catch (error) { 
        res.status(500).json({ ok: false, msg: msgErr(error) }); 
    }
});

app.put('/api/publicadores/:id', async (req, res) => { 
    const { nombre, priv1, priv2, priv3, comentario, grupo, fecha_ingreso, requester_group, fecha_nacimiento, fecha_bautismo, sexo, esperanza, privilegio_s21 } = req.body; 
    if (req.user.grupo != 0) return res.status(403).json({ ok: false, msg: 'Acceso denegado.' }); 
    try { 
        const fNac = fecha_nacimiento ? fecha_nacimiento : null;
        const fBau = fecha_bautismo ? fecha_bautismo : null;
        await pool.query(
            'UPDATE publicadores SET nombre=?, priv1=?, priv2=?, priv3=?, comentario=?, grupo=?, fecha_ingreso=?, fecha_nacimiento=?, fecha_bautismo=?, sexo=?, esperanza=?, privilegio_s21=? WHERE id=?', 
            [nombre, priv1, priv2, priv3, comentario, grupo, fecha_ingreso, fNac, fBau, sexo || 'Hombre', esperanza || 'Otras ovejas', privilegio_s21 || '', req.params.id]
        ); 
        res.json({ ok: true }); 
    } catch (error) { 
        res.status(500).json({ ok: false, msg: msgErr(error) }); 
    }
});

app.patch('/api/publicadores/:id/estado', async (req, res) => { /* Igual */ const { activo, requester_group } = req.body; if (req.user.grupo != 0) return res.status(403).json({ ok: false, msg: 'Solo Admin puede cambiar estado.' }); try { await pool.query('UPDATE publicadores SET activo = ? WHERE id = ?', [activo ? 1 : 0, req.params.id]); res.json({ ok: true }); } catch (error) { res.status(500).json({ ok: false, msg: msgErr(error) }); }});
app.delete('/api/publicadores/:id', async (req, res) => { /* Igual */ const requester_group = req.query.requester_group; if (req.user.grupo != 0) return res.status(403).json({ ok: false, msg: 'Acceso denegado.' }); try { const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM informes WHERE publicador_id = ?', [req.params.id]); if (n > 0) return res.status(400).json({ ok: false, msg: `Tiene ${n} informe(s) registrado(s). Para conservar el historial, desactívalo en lugar de eliminarlo (o borra sus informes primero).` }); await pool.query('DELETE FROM publicadores WHERE id = ?', [req.params.id]); res.json({ ok: true }); } catch (error) { if(error.code === 'ER_ROW_IS_REFERENCED_2') res.status(400).json({ ok: false, msg: 'Borra sus informes primero.' }); else res.status(500).json({ ok: false, msg: msgErr(error) }); }});

app.get('/api/check-inactivos', async (req, res) => {
    // Check inactivos busca en todo el historial, lo dejamos global por ahora para alertas generales.
    const { grupo } = req.query;
    try {
        const now = new Date(); const currentYear = now.getFullYear(); const currentMonth = now.getMonth(); 
        let sqlPubs = "SELECT id, nombre, grupo, fecha_ingreso FROM publicadores WHERE activo = 1";
        let paramsPubs = []; if (grupo && grupo != '0' && grupo != '9') { sqlPubs += " AND grupo = ?"; paramsPubs.push(grupo); }
        const anioServicioDe = (anioCal, mesIdx) => (mesIdx >= 8 ? anioCal + 1 : anioCal);
        const [[publicadores], [informes], [cierres]] = await Promise.all([
            pool.query(sqlPubs, paramsPubs),
            pool.query("SELECT publicador_id, mes, anio_servicio FROM informes WHERE predico = 'SI'"),
            pool.query("SELECT mes, anio_servicio FROM cierres")
        ]);
        const informesMap = new Set(); informes.forEach(inf => { if(inf.mes) informesMap.add(`${inf.publicador_id}-${inf.mes.trim().toUpperCase()}-${inf.anio_servicio}`); }); const mesesCerradosSet = new Set(cierres.map(c => `${c.mes.trim().toUpperCase()}-${c.anio_servicio}`));
        const candidatos = []; const mesesAtrasMax = 12;
        for (const pub of publicadores) {
            let mesesSinInformar = 0; let startScore = 190001;
            if (pub.fecha_ingreso) { const dString = new Date(pub.fecha_ingreso).toISOString().split('T')[0]; const parts = dString.split('-'); let y = parseInt(parts[0]); let m = parseInt(parts[1]); let d = parseInt(parts[2]); if (d === 1) { m--; if (m === 0) { m = 12; y--; } } startScore = (y * 100) + m; }
            for (let i = 1; i <= mesesAtrasMax; i++) {
                let checkDate = new Date(currentYear, currentMonth - i, 1); let checkY = checkDate.getFullYear(); let checkM = checkDate.getMonth() + 1; let checkScore = (checkY * 100) + checkM; const nombreMes = MESES_ORDER[checkDate.getMonth()]; const anioSrv = anioServicioDe(checkY, checkDate.getMonth()); 
                if (!mesesCerradosSet.has(`${nombreMes}-${anioSrv}`)) continue; if (checkScore < startScore) continue;
                const key = `${pub.id}-${nombreMes}-${anioSrv}`; if (!informesMap.has(key)) mesesSinInformar++; else break;
            }
            if (mesesSinInformar >= 1) candidatos.push({ ...pub, meses_sin_informar: mesesSinInformar });
        }
        res.json({ candidatos: candidatos.sort((a, b) => a.grupo !== b.grupo ? a.grupo - b.grupo : a.nombre.localeCompare(b.nombre)) }); 
    } catch (error) { res.status(500).json({ error: msgErr(error) }); }
});

// --- INFORMES ---
app.get('/api/informes', async (req, res) => {
    const { grupo, mes, nombre, priv3, anio_servicio } = req.query; 
    try {
        let query = `SELECT i.*, p.nombre as nombre_publicador FROM informes i LEFT JOIN publicadores p ON i.publicador_id = p.id WHERE i.anio_servicio = ? `;
        let params = [anio_servicio];
        if (grupo != '0' && grupo != '9') { query += ` AND i.grupo = ?`; params.push(grupo); }
        if (mes && mes !== 'TODOS' && mes !== '') { query += ` AND i.mes = ?`; params.push(mes); }
        if (priv3 && priv3 !== '') { 
            if (priv3 === 'AUX_COMBINED') query += " AND i.priv3 IN ('AUX', 'AUX I', 'AUX M', 'AUX C')"; 
            else if (priv3 === 'PUB_COMBINED') query += " AND i.priv3 IN ('PUB', 'PNB')"; 
            else { query += " AND i.priv3 = ?"; params.push(priv3); }
        }
        if (nombre && nombre !== '') { query += " AND p.nombre LIKE ?"; params.push(`%${nombre}%`); }
        query += ` ORDER BY ${ordenMesSQL('i.mes')} DESC, i.grupo ASC, p.nombre ASC`;
        const [rows] = await pool.query(query, params); res.json(rows);
    } catch (error) { res.status(500).json({ error: msgErr(error) }); }
});

app.post('/api/informes', async (req, res) => {
    const { mes, publicador_id, horas, cursos, predico, comentarios, credito_hrs, anio_servicio } = req.body;
    const h = parseFloat(horas) || 0; const c = parseInt(cursos) || 0; const cred = parseFloat(credito_hrs) || 0;
    if (h < 0 || c < 0 || cred < 0) return res.status(400).json({ ok: false, msg: 'No se permiten valores negativos.' });
    let maxCred = 55 - h; if (maxCred < 0) maxCred = 0;
    if (cred > maxCred) return res.status(400).json({ ok: false, msg: `Límite de crédito excedido.` });

    // Regla: usuarios no-superadmin tienen el mes bloqueado al mes automático actual; solo el superadmin (grupo 0) puede cambiarlo.
    try {
        const act = await getMesActivo(pool); const kMes = claveMes(mes, anio_servicio);
        if (isNaN(kMes)) return res.status(400).json({ ok: false, msg: 'Mes inválido.' });
        if (req.user.grupo != 0 && (String(mes).trim().toUpperCase() !== act.mes || String(anio_servicio) !== act.anio_servicio)) {
            return res.status(403).json({ ok: false, msg: `El mes está bloqueado. Solo puedes registrar informes del mes actual (${act.mes} ${act.anio_servicio}).` });
        }
    } catch (e) { return res.status(500).json({ ok: false, msg: msgErr(e) }); }

    const conn = await pool.getConnection();
    try {
        // Grupo, nombre y privilegios salen SIEMPRE de la base de datos, nunca de lo que envíe el cliente
        const [pg] = await conn.query("SELECT id, nombre, grupo, priv1, priv2, priv3 FROM publicadores WHERE id = ?", [publicador_id]);
        if (pg.length === 0) return res.status(404).json({ ok: false, msg: 'Publicador no encontrado.' });
        const pub = pg[0];
        if (!esGlobal(req.user.grupo) && pub.grupo != req.user.grupo) return res.status(403).json({ ok: false, msg: 'Acceso denegado.' });

        const pUpper = (pub.priv3 || '').trim().toUpperCase();
        if (PRIV_CON_HORAS.includes(pUpper) && h <= 0) return res.status(400).json({ ok: false, msg: `Un ${pUpper} no puede reportar 0 horas.` });
        // Meta mínima de horas de auxiliares: solo Admin/Supervisor pueden aprobar excepciones
        const meta = metaHorasPriv(pUpper);
        if (meta > 0 && h < meta && !esGlobal(req.user.grupo)) {
            return res.status(403).json({ ok: false, msg: `Un ${pUpper} debe reportar al menos ${meta} horas. El Secretario debe evaluarlo.` });
        }

        const [cierre] = await conn.query("SELECT * FROM cierres WHERE mes = ? AND anio_servicio = ?", [mes, anio_servicio]);
        if (cierre.length > 0) return res.status(400).json({ ok: false, msg: `Mes cerrado en este año.` });
        const [existente] = await conn.query("SELECT id FROM informes WHERE publicador_id = ? AND mes = ? AND anio_servicio = ?", [pub.id, mes, anio_servicio]);
        if (existente.length > 0) return res.status(400).json({ ok: false, msg: `Ya existe un informe.` });

        await conn.beginTransaction();
        await conn.query(`INSERT INTO informes (mes, grupo, publicador_id, publicador_nombre, priv1, priv2, priv3, horas, cursos, predico, comentarios, credito_hrs, anio_servicio) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [mes, pub.grupo, pub.id, pub.nombre, pub.priv1, pub.priv2, pub.priv3, h, c, predico === 'SI' ? 'SI' : 'NO', comentarios, cred, anio_servicio]);
        await conn.commit(); res.json({ ok: true });
    } catch (error) { await conn.rollback(); if (error.code === 'ER_DUP_ENTRY') res.status(400).json({ ok: false, msg: 'Ya existe un informe.' }); else res.status(500).json({ ok: false, msg: msgErr(error) }); } finally { conn.release(); }
});

app.put('/api/informes/:id', async (req, res) => {
    const { horas, cursos, predico, comentarios, credito_hrs } = req.body;
    const h = parseFloat(horas) || 0; const c = parseInt(cursos) || 0; const cred = parseFloat(credito_hrs) || 0;
    if (h < 0 || c < 0 || cred < 0) return res.status(400).json({ ok: false, msg: 'No se permiten valores negativos.' });
    try {
        const [infOrig] = await pool.query("SELECT mes, priv3, anio_servicio, grupo, publicador_id FROM informes WHERE id = ?", [req.params.id]);
        if (infOrig.length === 0) return res.status(404).json({ ok: false, msg: "No encontrado." });
        const { mes, priv3, anio_servicio } = infOrig[0];
        if (!esGlobal(req.user.grupo) && infOrig[0].grupo != req.user.grupo) return res.status(403).json({ ok: false, msg: 'Acceso denegado.' });

        const pUpper = (priv3 || '').trim().toUpperCase();
        if (PRIV_CON_HORAS.includes(pUpper) && h <= 0) return res.status(400).json({ ok: false, msg: `0 horas no permitido.` });
        const meta = metaHorasPriv(pUpper);
        if (meta > 0 && h < meta && !esGlobal(req.user.grupo)) return res.status(403).json({ ok: false, msg: `Un ${pUpper} debe reportar al menos ${meta} horas. El Secretario debe evaluarlo.` });
        if (cred > Math.max(55 - h, 0)) return res.status(400).json({ ok: false, msg: 'Límite de crédito excedido.' });
        const [cierre] = await pool.query("SELECT * FROM cierres WHERE mes = ? AND anio_servicio = ?", [mes, anio_servicio]);
        if (cierre.length > 0) return res.status(400).json({ ok: false, msg: `Mes cerrado.` });

        await pool.query('UPDATE informes SET horas=?, cursos=?, predico=?, comentarios=?, credito_hrs=? WHERE id=?', [h, c, predico === 'SI' ? 'SI' : 'NO', comentarios, cred, req.params.id]);
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ ok: false, msg: msgErr(err) }); }
});

app.delete('/api/informes/:id', async (req, res) => {
    const { requester_group, mes, anio_servicio } = req.query;
    if (req.user.grupo != 0) return res.status(403).json({ ok: false, msg: 'Acceso denegado.' });
    try { 
        const [informe] = await pool.query("SELECT publicador_id, mes, anio_servicio FROM informes WHERE id = ?", [req.params.id]);
        if (informe.length > 0) {
            // El cierre se valida con los datos reales del informe, no con los que envía el cliente
            const [cierre] = await pool.query("SELECT 1 FROM cierres WHERE mes = ? AND anio_servicio = ?", [informe[0].mes, informe[0].anio_servicio]);
            if (cierre.length > 0) return res.status(400).json({ ok: false, msg: `Mes cerrado.` });
            await pool.query('DELETE FROM informes WHERE id = ?', [req.params.id]);
        }
        res.json({ ok: true });
    } catch (error) { res.status(500).json({ ok: false, msg: msgErr(error) }); }
});

// --- REPORTES ---
app.get('/api/reportes/datos-extra', async (req, res) => {
    const { mes, grupo, anio_servicio } = req.query;
    try {
        let paramsPubs = []; let whereGrp = "";
        if (grupo && grupo != '0' && grupo != '9') { whereGrp = " AND grupo = ?"; paramsPubs.push(grupo); }
        const [rowsPubs] = await pool.query(`SELECT COUNT(*) as total FROM publicadores WHERE activo = 1 ${whereGrp}`, paramsPubs);
        let sqlReu = "SELECT * FROM reuniones WHERE tipo = 'FIN DE SEMANA' AND anio_servicio = ?";
        let paramsReu = [anio_servicio];
        if (mes && mes !== '' && mes !== 'TODOS') { sqlReu += " AND mes = ?"; paramsReu.push(mes); }
        const [rowsReu] = await pool.query(sqlReu, paramsReu);
        // Por mes: se suma cada semana entre modalidades (presencial + zoom) y se promedia sobre las semanas con asistencia.
        // Anual: promedio de los promedios mensuales de los meses que tienen datos.
        const semanasPorMes = {};
        rowsReu.forEach(r => {
            const arr = semanasPorMes[r.mes] || (semanasPorMes[r.mes] = [0, 0, 0, 0, 0]);
            [r.sem1, r.sem2, r.sem3, r.sem4, r.sem5].forEach((v, i) => { arr[i] += parseInt(v) || 0; });
        });
        const promediosMensuales = Object.values(semanasPorMes).map(arr => {
            const semanas = arr.filter(v => v > 0).length;
            return semanas > 0 ? arr.reduce((a, b) => a + b, 0) / semanas : null;
        }).filter(v => v !== null);
        const promedioAsis = promediosMensuales.length > 0 ? Math.round(promediosMensuales.reduce((a, b) => a + b, 0) / promediosMensuales.length) : 0;
        res.json({ activos: rowsPubs[0].total, asistencia: promedioAsis });
    } catch (error) { res.status(500).json({ error: msgErr(error) }); }
});

app.get('/api/reportes/precursores', async (req, res) => {
    const { tipo, anio_servicio } = req.query; 
    try {
        let wherePriv = tipo === 'REG' ? "priv3 IN ('REG', 'ESP', 'MISIONERO')" : "priv3 IN ('AUX', 'AUX I', 'AUX M', 'AUX C')";
        let [pubs] = await pool.query(`SELECT id, nombre, grupo, priv3 FROM publicadores WHERE activo = 1 AND (${wherePriv}) ORDER BY grupo ASC, nombre ASC`);
        if (!esGlobal(req.user.grupo)) pubs = pubs.filter(p => p.grupo == req.user.grupo);
        if (pubs.length === 0) return res.json([]);
        const [informes] = await pool.query(`SELECT publicador_id, mes, horas, credito_hrs FROM informes WHERE anio_servicio = ? AND publicador_id IN (SELECT id FROM publicadores WHERE activo=1 AND (${wherePriv})) AND (${wherePriv}) ORDER BY FIELD(mes, 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE', 'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO')`, [anio_servicio]);
        const data = pubs.map(p => {
            const mis = informes.filter(r => r.publicador_id === p.id);
            const t = mis.reduce((sum, r) => sum + (parseFloat(r.horas) || 0) + (parseFloat(r.credito_hrs) || 0), 0);
            return { nombre: p.nombre, grupo: p.grupo, priv: p.priv3, informes: mis.map(i => ({ mes: i.mes.substring(0,3), horas: i.horas, credito_hrs: i.credito_hrs })), total: t };
        });
        res.json(data);
    } catch (error) { res.status(500).json({ error: msgErr(error) }); }
});

app.get('/api/reportes/detalle-cursos', async (req, res) => {
    const { grupo, anio_servicio } = req.query;
    try {
        let whereGrp = ""; let params = [anio_servicio];
        if (grupo && grupo != '0' && grupo != '9') { whereGrp = " AND p.grupo = ?"; params.push(grupo); }
        const query = `SELECT p.id, p.nombre, p.grupo, GROUP_CONCAT(CASE WHEN i.cursos > 0 THEN i.mes ELSE NULL END SEPARATOR ', ') as meses_con_cursos, SUM(CASE WHEN i.cursos > 0 THEN 1 ELSE 0 END) as total_meses FROM publicadores p LEFT JOIN informes i ON p.id = i.publicador_id AND i.anio_servicio = ? WHERE p.activo = 1 ${whereGrp} GROUP BY p.id ORDER BY p.grupo ASC, p.nombre ASC`;
        const [rows] = await pool.query(query, params);
        const con = rows.filter(r => Number(r.total_meses) > 0).map(r => ({ grupo: r.grupo, nombre: r.nombre, meses: r.meses_con_cursos }));
        const sin = rows.filter(r => Number(r.total_meses) === 0 || !r.total_meses).map(r => ({ grupo: r.grupo, nombre: r.nombre }));
        res.json({ totales: { conducen: con.length, no_conducen: sin.length }, conducen: con, no_conducen: sin });
    } catch (error) { res.status(500).json({ error: msgErr(error) }); }
});

app.post('/api/reportes/advanced', async (req, res) => { 
    const { mes, grupo, nombre, priv3, anio_servicio } = req.body; 
    try { 
        let query = `SELECT i.*, p.nombre as nombre_publicador FROM informes i LEFT JOIN publicadores p ON i.publicador_id = p.id WHERE i.anio_servicio = ?`; 
        const params = [anio_servicio]; 
        if (mes) { query += " AND i.mes = ?"; params.push(mes); } 
        if (grupo) { query += " AND i.grupo = ?"; params.push(grupo); } 
        if (priv3) { if (priv3 === 'AUX_COMBINED') query += " AND i.priv3 IN ('AUX', 'AUX I', 'AUX M', 'AUX C')"; else if (priv3 === 'PUB_COMBINED') query += " AND i.priv3 IN ('PUB', 'PNB')"; else { query += " AND i.priv3 = ?"; params.push(priv3); } } 
        if (nombre) { query += " AND p.nombre LIKE ?"; params.push(`%${nombre}%`); } 
        query += ` ORDER BY ${ordenMesSQL('i.mes')} ASC, i.grupo ASC, p.nombre ASC`; 
        const [rows] = await pool.query(query, params); res.json(rows); 
    } catch (error) { res.status(500).json({ error: msgErr(error) }); } 
});

app.get('/api/reportes/totales-s21', soloGlobal, async (req, res) => {
    const { anio_servicio } = req.query;
    try {
        const sql = `
            SELECT 
                mes,
                CASE 
                    WHEN priv3 IN ('REG', 'ESP', 'MISIONERO') THEN 'REG'
                    WHEN priv3 IN ('AUX', 'AUX I', 'AUX M', 'AUX C') THEN 'AUX'
                    ELSE 'PUB'
                END as categoria,
                COUNT(DISTINCT publicador_id) as cantidad,
                SUM(horas) as total_horas,
                SUM(cursos) as total_cursos
            FROM informes 
            WHERE anio_servicio = ?
            GROUP BY mes, categoria
        `;
        const [rows] = await pool.query(sql, [anio_servicio]);
        res.json(rows);
    } catch (error) { 
        res.status(500).json({ error: msgErr(error) }); 
    }
});

app.get('/api/publicador/:id/tarjeta', async (req, res) => {
    const { id } = req.params; const { anio_servicio } = req.query;
    try {
        const [pub] = await pool.query("SELECT * FROM publicadores WHERE id = ?", [id]);
        if (pub.length === 0) return res.status(404).json({ error: "No encontrado" });
        if (!esGlobal(req.user.grupo) && pub[0].grupo != req.user.grupo) return res.status(403).json({ error: "Acceso denegado." });
        const [informes] = await pool.query("SELECT mes, horas, credito_hrs, cursos, comentarios, priv3, predico FROM informes WHERE publicador_id = ? AND anio_servicio = ?", [id, anio_servicio]);
        res.json({ publicador: pub[0], informes: informes });
    } catch (error) { res.status(500).json({ error: msgErr(error) }); }
});

// --- REUNIONES ---
app.get('/api/reuniones', async (req, res) => {
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
app.post('/api/reuniones', async (req, res) => {
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
app.put('/api/reuniones/:id', async (req, res) => {
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
app.delete('/api/reuniones/:id', async (req, res) => { const requester_group = req.query.requester_group; if (req.user.grupo != 0) return res.status(403).json({ ok: false, msg: 'Acceso denegado.' }); try { await pool.query('DELETE FROM reuniones WHERE id = ?', [req.params.id]); res.json({ ok: true }); } catch (error) { res.status(500).json({ ok: false, msg: msgErr(error) }); } });

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
app.get('/api/territorios', soloGlobal, async (req, res) => {
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

app.post('/api/territorios', soloAdmin, async (req, res) => {
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

app.put('/api/territorios/:id', soloAdmin, async (req, res) => {
    const { numero, nombre, cantidad_manzanas } = req.body;
    const cant = parseInt(cantidad_manzanas, 10) || 1;
    try {
        await pool.query('UPDATE territorios SET numero = ?, nombre = ?, cantidad_manzanas = ? WHERE id = ?', [String(numero).trim(), (nombre || '').trim(), cant, req.params.id]);
        res.json({ ok: true });
    } catch (error) { res.status(500).json({ ok: false, msg: msgErr(error) }); }
});

app.delete('/api/territorios/:id', soloAdmin, async (req, res) => {
    try {
        await pool.query('DELETE FROM bitacora_territorios WHERE territorio_id = ?', [req.params.id]);
        await pool.query('DELETE FROM territorios WHERE id = ?', [req.params.id]);
        res.json({ ok: true });
    } catch (error) { res.status(500).json({ ok: false, msg: msgErr(error) }); }
});

// Estado de manzanas de un territorio en su vuelta actual (o excluyendo un registro al editar)
app.get('/api/territorios/:id/manzanas', soloGlobal, async (req, res) => {
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
app.get('/api/conductores', soloGlobal, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM conductores ORDER BY activo DESC, nombre ASC');
        res.json(rows);
    } catch (error) { res.status(500).json({ error: msgErr(error) }); }
});

app.post('/api/conductores', soloAdmin, async (req, res) => {
    const { publicador_id, nombre } = req.body;
    if (!nombre || !String(nombre).trim()) return res.status(400).json({ ok: false, msg: 'El nombre del conductor es obligatorio.' });
    try {
        await pool.query('INSERT INTO conductores (publicador_id, nombre, activo) VALUES (?, ?, 1)', [publicador_id || null, String(nombre).trim()]);
        res.json({ ok: true });
    } catch (error) { res.status(500).json({ ok: false, msg: msgErr(error) }); }
});

app.put('/api/conductores/:id', soloAdmin, async (req, res) => {
    const { publicador_id, nombre } = req.body;
    if (!nombre || !String(nombre).trim()) return res.status(400).json({ ok: false, msg: 'El nombre del conductor es obligatorio.' });
    try {
        await pool.query('UPDATE conductores SET publicador_id = ?, nombre = ? WHERE id = ?', [publicador_id || null, String(nombre).trim(), req.params.id]);
        res.json({ ok: true });
    } catch (error) { res.status(500).json({ ok: false, msg: msgErr(error) }); }
});

app.delete('/api/conductores/:id', soloAdmin, async (req, res) => {
    try {
        await pool.query('DELETE FROM conductores WHERE id = ?', [req.params.id]);
        res.json({ ok: true });
    } catch (error) { res.status(500).json({ ok: false, msg: msgErr(error) }); }
});

// Turnos de Predicación
app.get('/api/turnos', soloGlobal, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM turnos_predicacion ORDER BY id ASC');
        res.json(rows);
    } catch (error) { res.status(500).json({ error: msgErr(error) }); }
});

app.post('/api/turnos', soloAdmin, async (req, res) => {
    const { nombre, horario } = req.body;
    if (!nombre || !String(nombre).trim()) return res.status(400).json({ ok: false, msg: 'El nombre del turno es obligatorio.' });
    try {
        await pool.query('INSERT INTO turnos_predicacion (nombre, horario, activo) VALUES (?, ?, 1)', [String(nombre).trim(), (horario || '').trim()]);
        res.json({ ok: true });
    } catch (error) { res.status(500).json({ ok: false, msg: msgErr(error) }); }
});

app.put('/api/turnos/:id', soloAdmin, async (req, res) => {
    const { nombre, horario } = req.body;
    if (!nombre || !String(nombre).trim()) return res.status(400).json({ ok: false, msg: 'El nombre del turno es obligatorio.' });
    try {
        await pool.query('UPDATE turnos_predicacion SET nombre = ?, horario = ? WHERE id = ?', [String(nombre).trim(), (horario || '').trim(), req.params.id]);
        res.json({ ok: true });
    } catch (error) { res.status(500).json({ ok: false, msg: msgErr(error) }); }
});

app.delete('/api/turnos/:id', soloAdmin, async (req, res) => {
    try {
        await pool.query('DELETE FROM turnos_predicacion WHERE id = ?', [req.params.id]);
        res.json({ ok: true });
    } catch (error) { res.status(500).json({ ok: false, msg: msgErr(error) }); }
});

// Bitácora de Territorios
app.get('/api/territorios/bitacora', soloGlobal, async (req, res) => {
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

app.post('/api/territorios/bitacora', soloAdmin, async (req, res) => {
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

app.put('/api/territorios/bitacora/:id', soloAdmin, async (req, res) => {
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

app.delete('/api/territorios/bitacora/:id', soloAdmin, async (req, res) => {
    try {
        await pool.query('DELETE FROM bitacora_territorios WHERE id = ?', [req.params.id]);
        res.json({ ok: true });
    } catch (error) { res.status(500).json({ ok: false, msg: msgErr(error) }); }
});

// Resumen de ciclos por territorio para el reporte S-13
app.get('/api/territorios/s13', soloGlobal, async (req, res) => {
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

// --- USUARIOS (solo admin) ---
app.get('/api/usuarios', soloAdmin, async (req, res) => { try { const [rows] = await pool.query('SELECT id, nombre, grupo, correo FROM usuarios ORDER BY grupo ASC'); res.json(rows); } catch (error) { res.status(500).json({ error: msgErr(error) }); } });
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
app.post('/api/usuarios', soloAdmin, async (req, res) => {
    const v = validarUsuario(req.body, { passwordObligatoria: true }); if (v.error) return res.status(400).json({ ok: false, msg: v.error });
    try { await pool.query('INSERT INTO usuarios (nombre, grupo, correo, password) VALUES (?, ?, ?, ?)', [v.nombre, v.grupo, v.correo, await bcrypt.hash(v.password, 10)]); res.json({ ok: true }); } catch (error) { errorUsuario(res, error); }
});
app.delete('/api/usuarios/:id', soloAdmin, async (req, res) => {
    if (req.params.id == req.user.id) return res.status(400).json({ ok: false, msg: 'No puedes eliminar tu propio usuario.' });
    try { await pool.query('DELETE FROM usuarios WHERE id = ?', [req.params.id]); invalidarAuth(req.params.id); res.json({ ok: true }); } catch (error) { res.status(500).json({ ok: false, msg: msgErr(error) }); }
});
app.put('/api/usuarios/:id', soloAdmin, async (req, res) => {
    const v = validarUsuario(req.body, { passwordObligatoria: false }); if (v.error) return res.status(400).json({ ok: false, msg: v.error });
    if (req.params.id == req.user.id && v.grupo != 0) return res.status(400).json({ ok: false, msg: 'No puedes quitarte a ti mismo el rol de administrador.' });
    try {
        if (v.password) await pool.query('UPDATE usuarios SET nombre=?, grupo=?, correo=?, password=? WHERE id=?', [v.nombre, v.grupo, v.correo, await bcrypt.hash(v.password, 10), req.params.id]);
        else await pool.query('UPDATE usuarios SET nombre=?, grupo=?, correo=? WHERE id=?', [v.nombre, v.grupo, v.correo, req.params.id]);
        invalidarAuth(req.params.id);
        res.json({ ok: true });
    } catch (error) { errorUsuario(res, error); }
});
app.listen(PORT, () => { console.log(`🚀 Sistema corriendo en http://localhost:${PORT}`); });