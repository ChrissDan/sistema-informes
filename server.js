require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;
const crypto = require('crypto');
const JWT_SECRET = process.env.JWT_SECRET || crypto.createHash('sha256').update((process.env.DB_PASSWORD || '') + ':' + (process.env.DB_HOST || '') + ':sistema-informes-jwt').digest('hex');

app.use(express.json());
app.use(express.static('public'));

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: false }, 
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
});

const MESES_ORDER = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];

// --- AUTH ---
const isHash = (v) => typeof v === 'string' && /^\$2[aby]\$/.test(v);

// Limitador simple de intentos de login (por IP, en memoria)
const intentos = new Map();
const MAX_INTENTOS = 8, VENTANA_MS = 15 * 60 * 1000;
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
        const [rows] = await pool.query('SELECT * FROM usuarios WHERE correo = ?', [email]);
        const user = rows[0];
        let valido = false;
        if (user) {
            if (isHash(user.password)) valido = await bcrypt.compare(String(password), user.password);
            else if (String(password) === user.password) { // contraseña heredada en texto plano: migrar
                valido = true;
                await pool.query('UPDATE usuarios SET password = ? WHERE id = ?', [await bcrypt.hash(String(password), 10), user.id]);
            }
        }
        if (!valido) { req.loginEntry.n++; return res.status(401).json({ ok: false, msg: 'Correo o contraseña incorrectos' }); }
        req.loginEntry.n = 0;
        const token = jwt.sign({ id: user.id, grupo: user.grupo }, JWT_SECRET, { expiresIn: '12h' });
        res.json({ ok: true, token, user: { id: user.id, nombre: user.nombre, grupo: user.grupo, correo: user.correo } });
    } catch (error) { res.status(500).json({ ok: false, msg: 'Error de servidor' }); }
});

// Todo /api (excepto login) requiere token válido; el rol sale del token, no del cliente
app.use('/api', (req, res, next) => {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) return res.status(401).json({ ok: false, msg: 'No autenticado' });
    try { req.user = jwt.verify(token, JWT_SECRET); next(); }
    catch (e) { res.status(401).json({ ok: false, msg: 'Sesión inválida o expirada' }); }
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
    catch (error) { res.status(500).json({ error: error.message }); }
});

// --- CIERRES ---
app.get('/api/cierres', async (req, res) => {
    const { anio_servicio } = req.query;
    try { const [rows] = await pool.query('SELECT mes FROM cierres WHERE anio_servicio = ?', [anio_servicio]); res.json(rows.map(r => r.mes)); } 
    catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/cerrar-mes', async (req, res) => {
    const { mes, requester_group, anio_servicio } = req.body;
    if (req.user.grupo != 0) return res.status(403).json({ ok: false, msg: 'Acceso denegado.' });

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const act = await getMesActivo(conn); const kMes = claveMes(mes, anio_servicio);
        if (isNaN(kMes)) { await conn.rollback(); return res.json({ ok: false, msg: 'Mes inválido.' }); }
        if (act.hayCierres && kMes > act.key) { await conn.rollback(); return res.json({ ok: false, msg: `Primero debes cerrar ${act.mes} ${act.anio_servicio}.` }); }
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
    } catch (error) { await conn.rollback(); res.status(500).json({ ok: false, msg: error.message });
    } finally { conn.release(); }
});

app.post('/api/reabrir-mes', async (req, res) => {
    const { mes, requester_group, anio_servicio } = req.body;
    if (req.user.grupo != 0) return res.status(403).json({ ok: false, msg: "No tienes permiso para reabrir meses." });
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const act = await getMesActivo(conn); const kMes = claveMes(mes, anio_servicio);
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
    } catch (error) { res.status(500).json({ error: error.message }); }
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
    } catch (error) { res.status(500).json({ error: error.message }); }
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
    } catch (error) { res.status(500).json({ error: error.message }); }
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
    } catch (error) { res.status(500).json({ error: error.message }); }
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
    } catch (error) { res.status(500).json({ error: error.message }); }
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
    } catch (error) { res.status(500).json({ error: error.message }); }
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
        res.status(500).json({ ok: false, msg: error.message }); 
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
        res.status(500).json({ ok: false, msg: error.message }); 
    }
});

app.patch('/api/publicadores/:id/estado', async (req, res) => { /* Igual */ const { activo, requester_group } = req.body; if (req.user.grupo != 0) return res.status(403).json({ ok: false, msg: 'Solo Admin puede cambiar estado.' }); try { await pool.query('UPDATE publicadores SET activo = ? WHERE id = ?', [activo ? 1 : 0, req.params.id]); res.json({ ok: true }); } catch (error) { res.status(500).json({ ok: false, msg: error.message }); }});
app.delete('/api/publicadores/:id', async (req, res) => { /* Igual */ const requester_group = req.query.requester_group; if (req.user.grupo != 0) return res.status(403).json({ ok: false, msg: 'Acceso denegado.' }); try { await pool.query('DELETE FROM publicadores WHERE id = ?', [req.params.id]); res.json({ ok: true }); } catch (error) { if(error.code === 'ER_ROW_IS_REFERENCED_2') res.status(400).json({ ok: false, msg: 'Borra sus informes primero.' }); else res.status(500).json({ ok: false, msg: error.message }); }});

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
    } catch (error) { res.status(500).json({ error: error.message }); }
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
        query += ` ORDER BY FIELD(i.mes, 'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE') DESC, i.grupo ASC, p.nombre ASC`;
        const [rows] = await pool.query(query, params); res.json(rows);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/informes', async (req, res) => {
    let { mes, grupo, publicador_id, publicador_nombre, priv1, priv2, priv3, horas, cursos, predico, comentarios, credito_hrs, anio_servicio } = req.body;
    const h = parseFloat(horas) || 0; const c = parseInt(cursos) || 0; const cred = parseFloat(credito_hrs) || 0;
    const pUpper = (priv3 || "").trim().toUpperCase();
    if (['REG', 'ESP', 'AUX I', 'AUX M', 'AUX', 'AUX C'].includes(pUpper) && h <= 0) return res.status(400).json({ ok: false, msg: `Un ${pUpper} no puede reportar 0 horas.` });
    let maxCred = 55 - h; if (maxCred < 0) maxCred = 0;
    if (cred > maxCred) return res.status(400).json({ ok: false, msg: `Límite de crédito excedido.` });

    // Regla: usuarios no-superadmin tienen el mes bloqueado al mes automático actual; solo el superadmin (grupo 0) puede cambiarlo.
    try {
        const act = await getMesActivo(pool); const kMes = claveMes(mes, anio_servicio);
        if (isNaN(kMes)) return res.status(400).json({ ok: false, msg: 'Mes inválido.' });
        if (req.user.grupo != 0 && (String(mes).trim().toUpperCase() !== act.mes || String(anio_servicio) !== act.anio_servicio)) {
            return res.status(403).json({ ok: false, msg: `El mes está bloqueado. Solo puedes registrar informes del mes actual (${act.mes} ${act.anio_servicio}).` });
        }
    } catch (e) { return res.status(500).json({ ok: false, msg: e.message }); }

    const conn = await pool.getConnection();
    try {
        if (!esGlobal(req.user.grupo)) {
            const [pg] = await conn.query("SELECT grupo FROM publicadores WHERE id = ?", [publicador_id]);
            if (pg.length === 0 || pg[0].grupo != req.user.grupo) { conn.release(); return res.status(403).json({ ok: false, msg: 'Acceso denegado.' }); }
        }
        const [cierre] = await conn.query("SELECT * FROM cierres WHERE mes = ? AND anio_servicio = ?", [mes, anio_servicio]);
        if (cierre.length > 0) { conn.release(); return res.status(400).json({ ok: false, msg: `Mes cerrado en este año.` }); }
        const [existente] = await conn.query("SELECT id FROM informes WHERE publicador_id = ? AND mes = ? AND anio_servicio = ?", [publicador_id, mes, anio_servicio]);
        if (existente.length > 0) { conn.release(); return res.status(400).json({ ok: false, msg: `Ya existe un informe.` }); }
        
        await conn.beginTransaction();
        await conn.query(`INSERT INTO informes (mes, grupo, publicador_id, publicador_nombre, priv1, priv2, priv3, horas, cursos, predico, comentarios, credito_hrs, anio_servicio) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
            [mes, grupo, publicador_id, publicador_nombre, priv1, priv2, priv3, h, c, predico, comentarios, cred, anio_servicio]);
        await conn.commit(); res.json({ ok: true });
    } catch (error) { await conn.rollback(); if (error.code === 'ER_DUP_ENTRY') res.status(400).json({ ok: false, msg: 'Ya existe un informe.' }); else res.status(500).json({ ok: false, msg: error.message }); } finally { conn.release(); }
});

app.put('/api/informes/:id', async (req, res) => {
    let { horas, cursos, predico, comentarios, publicador_id, credito_hrs } = req.body;
    const h = parseFloat(horas) || 0; const c = parseInt(cursos) || 0; const cred = parseFloat(credito_hrs) || 0;
    try {
        const [infOrig] = await pool.query("SELECT mes, priv3, anio_servicio, grupo, publicador_id FROM informes WHERE id = ?", [req.params.id]);
        if (infOrig.length === 0) return res.status(404).json({ ok: false, msg: "No encontrado." });
        const { mes, priv3, anio_servicio } = infOrig[0];
        if (!esGlobal(req.user.grupo) && infOrig[0].grupo != req.user.grupo) return res.status(403).json({ ok: false, msg: 'Acceso denegado.' });
        
        if (['REG', 'ESP', 'AUX I', 'AUX M', 'AUX', 'AUX C'].includes((priv3||'').toUpperCase()) && h <= 0) return res.status(400).json({ ok: false, msg: `0 horas no permitido.` });
        const [cierre] = await pool.query("SELECT * FROM cierres WHERE mes = ? AND anio_servicio = ?", [mes, anio_servicio]);
        if (cierre.length > 0) return res.status(400).json({ ok: false, msg: `Mes cerrado.` });
        
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();
            await conn.query('UPDATE informes SET horas=?, cursos=?, predico=?, comentarios=?, credito_hrs=? WHERE id=?', [h, c, predico, comentarios, cred, req.params.id]);
            await conn.commit(); res.json({ ok: true });
        } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
    } catch (err) { res.status(500).json({ ok: false, msg: err.message }); }
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
    } catch (error) { res.status(500).json({ ok: false, msg: error.message }); }
});

// --- REPORTES ---
app.get('/api/reportes/resumen', async (req, res) => {
    const { mes, grupo, anio_servicio } = req.query;
    try {
        let paramsGrp = []; let whereGrp = "";
        if (grupo && grupo != '0' && grupo != '9') { whereGrp = " AND grupo = ?"; paramsGrp.push(grupo); }
        const [rowsPubs] = await pool.query(`SELECT COUNT(*) as total FROM publicadores WHERE activo = 1 ${whereGrp}`, paramsGrp);
        const [rowsReu] = await pool.query(`SELECT * FROM reuniones WHERE mes = ? AND anio_servicio = ? AND tipo = 'FIN DE SEMANA'`, [mes, anio_servicio]);
        let promedioAsis = 0;
        if (rowsReu.length > 0) {
            const r = rowsReu[0]; const sum = (r.sem1||0) + (r.sem2||0) + (r.sem3||0) + (r.sem4||0) + (r.sem5||0);
            let count = 0; if(r.sem1 > 0) count++; if(r.sem2 > 0) count++; if(r.sem3 > 0) count++; if(r.sem4 > 0) count++; if(r.sem5 > 0) count++;
            if(count > 0) promedioAsis = Math.round(sum / count);
        }
        let paramsStats = [mes, anio_servicio]; if (grupo && grupo != '0' && grupo != '9') paramsStats.push(grupo);
        const [rowsStats] = await pool.query(`SELECT priv3, COUNT(*) as cant, SUM(horas) as horas, SUM(cursos) as cursos FROM informes WHERE mes = ? AND anio_servicio = ? ${whereGrp} GROUP BY priv3`, paramsStats);
        let stats = { pub: { cant: 0, horas: 0, cursos: 0 }, aux: { cant: 0, horas: 0, cursos: 0 }, reg: { cant: 0, horas: 0, cursos: 0 } };
        rowsStats.forEach(row => {
            const p = row.priv3.toUpperCase();
            if (p === 'REG' || p === 'ESP') { stats.reg.cant += row.cant; stats.reg.horas += row.horas || 0; stats.reg.cursos += row.cursos || 0; } 
            else if (p.includes('AUX')) { stats.aux.cant += row.cant; stats.aux.horas += row.horas || 0; stats.aux.cursos += row.cursos || 0; } 
            else { stats.pub.cant += row.cant; stats.pub.horas += row.horas || 0; stats.pub.cursos += row.cursos || 0; }
        });
        res.json({ activos: rowsPubs[0].total, asistencia: promedioAsis, detalles: stats });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

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
        let promedioAsis = 0;
        if (rowsReu.length > 0) {
            let sumTotal = 0; let weeksTotal = 0;
            rowsReu.forEach(r => {
                const s1 = parseInt(r.sem1) || 0; const s2 = parseInt(r.sem2) || 0; const s3 = parseInt(r.sem3) || 0; const s4 = parseInt(r.sem4) || 0; const s5 = parseInt(r.sem5) || 0;
                sumTotal += (s1 + s2 + s3 + s4 + s5);
                if(s1 > 0) weeksTotal++; if(s2 > 0) weeksTotal++; if(s3 > 0) weeksTotal++; if(s4 > 0) weeksTotal++; if(s5 > 0) weeksTotal++;
            });
            if (weeksTotal > 0) promedioAsis = Math.round(sumTotal / (weeksTotal / rowsReu.length));
        }
        res.json({ activos: rowsPubs[0].total, asistencia: promedioAsis });
    } catch (error) { res.status(500).json({ error: error.message }); }
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
    } catch (error) { res.status(500).json({ error: error.message }); }
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
    } catch (error) { res.status(500).json({ error: error.message }); }
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
        query += ` ORDER BY FIELD(i.mes, 'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE') ASC, i.grupo ASC, p.nombre ASC`; 
        const [rows] = await pool.query(query, params); res.json(rows); 
    } catch (error) { res.status(500).json({ error: error.message }); } 
});

app.get('/api/reportes/totales-s21', async (req, res) => {
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
        res.status(500).json({ error: error.message }); 
    }
});

app.get('/api/publicador/:id/tarjeta', async (req, res) => {
    const { id } = req.params; const { anio_servicio } = req.query;
    try {
        const [pub] = await pool.query("SELECT * FROM publicadores WHERE id = ?", [id]);
        if (pub.length === 0) return res.status(404).json({ error: "No encontrado" });
        if (!esGlobal(req.user.grupo) && pub[0].grupo != req.user.grupo) return res.status(403).json({ error: "Acceso denegado." });
        const [informes] = await pool.query("SELECT mes, horas, cursos, comentarios, priv3, predico FROM informes WHERE publicador_id = ? AND anio_servicio = ?", [id, anio_servicio]);
        res.json({ publicador: pub[0], informes: informes });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// --- REUNIONES ---
app.get('/api/reuniones', async (req, res) => {
    const { mes, anio_servicio } = req.query;
    try {
        let query = "SELECT * FROM reuniones WHERE anio_servicio = ?"; const params = [anio_servicio];
        if (mes && mes !== 'TODOS') { query += " AND mes = ?"; params.push(mes); }
        query += ` ORDER BY FIELD(mes, 'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE') ASC, tipo ASC, modalidad ASC`;
        const [rows] = await pool.query(query, params); res.json(rows);
    } catch (error) { res.status(500).json({ error: error.message }); }
});
app.post('/api/reuniones', async (req, res) => { const { mes, tipo, modalidad, sem1, sem2, sem3, sem4, sem5, requester_group, anio_servicio } = req.body; if (req.user.grupo != 0) return res.status(403).json({ ok: false, msg: 'No tienes permiso.' }); try { await pool.query('INSERT INTO reuniones (mes, tipo, modalidad, sem1, sem2, sem3, sem4, sem5, anio_servicio) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [mes, tipo, modalidad, sem1||0, sem2||0, sem3||0, sem4||0, sem5||0, anio_servicio]); res.json({ ok: true }); } catch (error) { res.status(500).json({ ok: false, msg: error.message }); } });
app.put('/api/reuniones/:id', async (req, res) => { const { sem1, sem2, sem3, sem4, sem5, requester_group } = req.body; if (req.user.grupo != 0) return res.status(403).json({ ok: false, msg: 'No tienes permiso.' }); try { await pool.query('UPDATE reuniones SET sem1=?, sem2=?, sem3=?, sem4=?, sem5=? WHERE id=?', [sem1||0, sem2||0, sem3||0, sem4||0, sem5||0, req.params.id]); res.json({ ok: true }); } catch (error) { res.status(500).json({ ok: false, msg: error.message }); } });
app.delete('/api/reuniones/:id', async (req, res) => { const requester_group = req.query.requester_group; if (req.user.grupo != 0) return res.status(403).json({ ok: false, msg: 'Acceso denegado.' }); try { await pool.query('DELETE FROM reuniones WHERE id = ?', [req.params.id]); res.json({ ok: true }); } catch (error) { res.status(500).json({ ok: false, msg: error.message }); } });

// --- TERRITORIOS (Catálogo, Conductores, Turnos, Bitácora y S-13) ---
function parseManzanasList(str) {
    if (!str) return [];
    return String(str).split(',').map(x => parseInt(x.trim(), 10)).filter(n => !isNaN(n) && n >= 1);
}

async function calcularEstadoManzanasCiclo(db, territorio_id, ciclo, excludeId = null) {
    let sql = 'SELECT id, manzanas, estado_manzanas, estado_territorio FROM bitacora_territorios WHERE territorio_id = ? AND ciclo = ?';
    const params = [territorio_id, ciclo];
    if (excludeId) { sql += ' AND id != ?'; params.push(excludeId); }
    sql += ' ORDER BY fecha ASC, id ASC';
    const [rows] = await db.query(sql, params);
    const estadoPorManzana = {};
    let cerradoExplicito = false;
    for (const r of rows) {
        const nums = parseManzanasList(r.manzanas);
        for (const m of nums) {
            if (r.estado_manzanas === 'COMPLETO') estadoPorManzana[m] = 'COMPLETO';
            else if (estadoPorManzana[m] !== 'COMPLETO') estadoPorManzana[m] = 'INCOMPLETO';
        }
        if (r.estado_territorio === 'CIERRE') cerradoExplicito = true;
    }
    return { estadoPorManzana, cerradoExplicito, registrosCount: rows.length };
}

// Catálogo de Territorios + Progreso del ciclo actual
app.get('/api/territorios', soloGlobal, async (req, res) => {
    try {
        const [territorios] = await pool.query('SELECT * FROM territorios ORDER BY CAST(numero AS UNSIGNED) ASC, numero ASC');
        const [bitacora] = await pool.query('SELECT * FROM bitacora_territorios ORDER BY fecha ASC, id ASC');

        const resultado = territorios.map(t => {
            const regsT = bitacora.filter(b => b.territorio_id === t.id);
            const maxCiclo = regsT.reduce((m, r) => Math.max(m, r.ciclo || 1), 1);
            const regsCiclo = regsT.filter(b => (b.ciclo || 1) === maxCiclo);

            const estadoPorManzana = {};
            let estadoTerritorioActual = 'SIN INICIAR';
            for (const r of regsCiclo) {
                const nums = parseManzanasList(r.manzanas);
                for (const m of nums) {
                    if (m <= t.cantidad_manzanas) {
                        if (r.estado_manzanas === 'COMPLETO') estadoPorManzana[m] = 'COMPLETO';
                        else if (estadoPorManzana[m] !== 'COMPLETO') estadoPorManzana[m] = 'INCOMPLETO';
                    }
                }
                estadoTerritorioActual = r.estado_territorio;
            }
            const completadas = Object.values(estadoPorManzana).filter(v => v === 'COMPLETO').length;
            const incompletas = Object.values(estadoPorManzana).filter(v => v === 'INCOMPLETO').length;
            const porcentaje = t.cantidad_manzanas > 0 ? Math.min(100, Math.round((completadas / t.cantidad_manzanas) * 100)) : 0;
            if (completadas >= t.cantidad_manzanas && regsCiclo.length > 0) estadoTerritorioActual = 'CIERRE';
            else if (regsCiclo.length > 0 && estadoTerritorioActual !== 'CIERRE') estadoTerritorioActual = 'INICIO';

            return {
                ...t,
                ciclo_actual: maxCiclo,
                completadas,
                incompletas,
                porcentaje,
                estado_actual: estadoTerritorioActual,
                manzanas_detalle: estadoPorManzana
            };
        });
        res.json(resultado);
    } catch (error) { res.status(500).json({ error: error.message }); }
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
        res.status(500).json({ ok: false, msg: error.message });
    }
});

app.put('/api/territorios/:id', soloAdmin, async (req, res) => {
    const { numero, nombre, cantidad_manzanas } = req.body;
    const cant = parseInt(cantidad_manzanas, 10) || 1;
    try {
        await pool.query('UPDATE territorios SET numero = ?, nombre = ?, cantidad_manzanas = ? WHERE id = ?', [String(numero).trim(), (nombre || '').trim(), cant, req.params.id]);
        res.json({ ok: true });
    } catch (error) { res.status(500).json({ ok: false, msg: error.message }); }
});

app.delete('/api/territorios/:id', soloAdmin, async (req, res) => {
    try {
        await pool.query('DELETE FROM bitacora_territorios WHERE territorio_id = ?', [req.params.id]);
        await pool.query('DELETE FROM territorios WHERE id = ?', [req.params.id]);
        res.json({ ok: true });
    } catch (error) { res.status(500).json({ ok: false, msg: error.message }); }
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
        const { estadoPorManzana, cerradoExplicito, registrosCount } = await calcularEstadoManzanasCiclo(pool, t.id, ciclo, exclude_id || null);
        const completadas = Object.values(estadoPorManzana).filter(v => v === 'COMPLETO').length;
        const cicloTerminado = !exclude_id && registrosCount > 0 && (completadas >= t.cantidad_manzanas || cerradoExplicito);
        res.json({
            territorio: t,
            ciclo: cicloTerminado ? ciclo + 1 : ciclo,
            nueva_vuelta: cicloTerminado,
            registros_en_ciclo: cicloTerminado ? 0 : registrosCount,
            manzanas: cicloTerminado ? {} : estadoPorManzana
        });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// Conductores
app.get('/api/conductores', soloGlobal, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM conductores ORDER BY activo DESC, nombre ASC');
        res.json(rows);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/conductores', soloAdmin, async (req, res) => {
    const { publicador_id, nombre } = req.body;
    if (!nombre || !String(nombre).trim()) return res.status(400).json({ ok: false, msg: 'El nombre del conductor es obligatorio.' });
    try {
        await pool.query('INSERT INTO conductores (publicador_id, nombre, activo) VALUES (?, ?, 1)', [publicador_id || null, String(nombre).trim()]);
        res.json({ ok: true });
    } catch (error) { res.status(500).json({ ok: false, msg: error.message }); }
});

app.put('/api/conductores/:id', soloAdmin, async (req, res) => {
    const { publicador_id, nombre } = req.body;
    if (!nombre || !String(nombre).trim()) return res.status(400).json({ ok: false, msg: 'El nombre del conductor es obligatorio.' });
    try {
        await pool.query('UPDATE conductores SET publicador_id = ?, nombre = ? WHERE id = ?', [publicador_id || null, String(nombre).trim(), req.params.id]);
        res.json({ ok: true });
    } catch (error) { res.status(500).json({ ok: false, msg: error.message }); }
});

app.delete('/api/conductores/:id', soloAdmin, async (req, res) => {
    try {
        await pool.query('DELETE FROM conductores WHERE id = ?', [req.params.id]);
        res.json({ ok: true });
    } catch (error) { res.status(500).json({ ok: false, msg: error.message }); }
});

// Turnos de Predicación
app.get('/api/turnos', soloGlobal, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM turnos_predicacion ORDER BY id ASC');
        res.json(rows);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/turnos', soloAdmin, async (req, res) => {
    const { nombre, horario } = req.body;
    if (!nombre || !String(nombre).trim()) return res.status(400).json({ ok: false, msg: 'El nombre del turno es obligatorio.' });
    try {
        await pool.query('INSERT INTO turnos_predicacion (nombre, horario, activo) VALUES (?, ?, 1)', [String(nombre).trim(), (horario || '').trim()]);
        res.json({ ok: true });
    } catch (error) { res.status(500).json({ ok: false, msg: error.message }); }
});

app.put('/api/turnos/:id', soloAdmin, async (req, res) => {
    const { nombre, horario } = req.body;
    if (!nombre || !String(nombre).trim()) return res.status(400).json({ ok: false, msg: 'El nombre del turno es obligatorio.' });
    try {
        await pool.query('UPDATE turnos_predicacion SET nombre = ?, horario = ? WHERE id = ?', [String(nombre).trim(), (horario || '').trim(), req.params.id]);
        res.json({ ok: true });
    } catch (error) { res.status(500).json({ ok: false, msg: error.message }); }
});

app.delete('/api/turnos/:id', soloAdmin, async (req, res) => {
    try {
        await pool.query('DELETE FROM turnos_predicacion WHERE id = ?', [req.params.id]);
        res.json({ ok: true });
    } catch (error) { res.status(500).json({ ok: false, msg: error.message }); }
});

// Bitácora de Territorios
app.get('/api/territorios/bitacora', soloGlobal, async (req, res) => {
    const { territorio_id } = req.query;
    try {
        let sql = 'SELECT b.*, t.numero as territorio_numero, t.nombre as territorio_nombre, t.cantidad_manzanas FROM bitacora_territorios b JOIN territorios t ON b.territorio_id = t.id WHERE 1=1';
        const params = [];
        if (territorio_id) { sql += ' AND b.territorio_id = ?'; params.push(territorio_id); }
        sql += ' ORDER BY b.fecha DESC, b.id DESC LIMIT 250';
        const [rows] = await pool.query(sql, params);
        res.json(rows);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/territorios/bitacora', soloAdmin, async (req, res) => {
    const { fecha, territorio_id, manzanas, estado_manzanas, turno_id, turno_nombre, conductor_id, conductor_nombre, estado_territorio, notas } = req.body;
    const listaManz = parseManzanasList(manzanas);
    if (!fecha || !territorio_id || listaManz.length === 0) {
        return res.status(400).json({ ok: false, msg: 'Debes indicar la fecha, el territorio y al menos una manzana.' });
    }
    try {
        const [terr] = await pool.query('SELECT * FROM territorios WHERE id = ?', [territorio_id]);
        if (terr.length === 0) return res.status(404).json({ ok: false, msg: 'Territorio no encontrado.' });
        const t = terr[0];

        const [maxRow] = await pool.query('SELECT COALESCE(MAX(ciclo), 1) as ciclo FROM bitacora_territorios WHERE territorio_id = ?', [t.id]);
        let cicloActual = maxRow[0].ciclo || 1;
        const { estadoPorManzana, cerradoExplicito, registrosCount } = await calcularEstadoManzanasCiclo(pool, t.id, cicloActual);
        const completadasAntes = Object.values(estadoPorManzana).filter(v => v === 'COMPLETO').length;

        if (registrosCount > 0 && (completadasAntes >= t.cantidad_manzanas || cerradoExplicito)) {
            cicloActual++;
        } else {
            for (const m of listaManz) {
                if (estadoPorManzana[m] === 'COMPLETO') {
                    return res.status(400).json({ ok: false, msg: `La manzana ${m} ya fue completada en este recorrido.` });
                }
            }
        }

        const manzStr = listaManz.sort((a, b) => a - b).join(', ');
        await pool.query(
            'INSERT INTO bitacora_territorios (fecha, territorio_id, manzanas, estado_manzanas, turno_id, turno_nombre, conductor_id, conductor_nombre, estado_territorio, ciclo, notas) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [fecha, t.id, manzStr, estado_manzanas || 'COMPLETO', turno_id || null, turno_nombre || '', conductor_id || null, conductor_nombre || '', estado_territorio || 'INICIO', cicloActual, notas || null]
        );
        res.json({ ok: true, ciclo: cicloActual });
    } catch (error) { res.status(500).json({ ok: false, msg: error.message }); }
});

app.put('/api/territorios/bitacora/:id', soloAdmin, async (req, res) => {
    const { fecha, territorio_id, manzanas, estado_manzanas, turno_id, turno_nombre, conductor_id, conductor_nombre, estado_territorio, notas } = req.body;
    const listaManz = parseManzanasList(manzanas);
    if (!fecha || !territorio_id || listaManz.length === 0) {
        return res.status(400).json({ ok: false, msg: 'Debes indicar la fecha, el territorio y al menos una manzana.' });
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
        const manzStr = listaManz.sort((a, b) => a - b).join(', ');
        await pool.query(
            'UPDATE bitacora_territorios SET fecha=?, territorio_id=?, manzanas=?, estado_manzanas=?, turno_id=?, turno_nombre=?, conductor_id=?, conductor_nombre=?, estado_territorio=?, notas=? WHERE id=?',
            [fecha, territorio_id, manzStr, estado_manzanas || 'COMPLETO', turno_id || null, turno_nombre || '', conductor_id || null, conductor_nombre || '', estado_territorio || 'INICIO', notas || null, req.params.id]
        );
        res.json({ ok: true });
    } catch (error) { res.status(500).json({ ok: false, msg: error.message }); }
});

app.delete('/api/territorios/bitacora/:id', soloAdmin, async (req, res) => {
    try {
        await pool.query('DELETE FROM bitacora_territorios WHERE id = ?', [req.params.id]);
        res.json({ ok: true });
    } catch (error) { res.status(500).json({ ok: false, msg: error.message }); }
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
                    if (r.estado_manzanas === 'COMPLETO') parseManzanasList(r.manzanas).forEach(m => manzComp.add(m));
                    if (r.estado_territorio === 'CIERRE') cerrado = true;
                });
                const terminado = cerrado || manzComp.size >= t.cantidad_manzanas;
                return {
                    ciclo: Number(cNum),
                    conductor_inicio: primero.conductor_nombre,
                    fecha_inicio: primero.fecha,
                    conductor_cierre: terminado ? ultimo.conductor_nombre : '',
                    fecha_cierre: terminado ? ultimo.fecha : null,
                    completadas: manzComp.size,
                    total_manzanas: t.cantidad_manzanas,
                    terminado
                };
            });
            return { territorio: t, ciclos };
        });
        res.json(data);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// --- USUARIOS (solo admin) ---
app.get('/api/usuarios', soloAdmin, async (req, res) => { try { const [rows] = await pool.query('SELECT id, nombre, grupo, correo FROM usuarios ORDER BY grupo ASC'); res.json(rows); } catch (error) { res.status(500).json({ error: error.message }); } });
app.post('/api/usuarios', soloAdmin, async (req, res) => {
    const { nombre, grupo, correo, password } = req.body;
    if (!password || String(password).length < 6) return res.status(400).json({ ok: false, msg: 'La contraseña debe tener al menos 6 caracteres.' });
    try { await pool.query('INSERT INTO usuarios (nombre, grupo, correo, password) VALUES (?, ?, ?, ?)', [nombre, grupo, correo, await bcrypt.hash(String(password), 10)]); res.json({ ok: true }); } catch (error) { res.status(500).json({ ok: false, msg: error.message }); }
});
app.delete('/api/usuarios/:id', soloAdmin, async (req, res) => {
    if (req.params.id == req.user.id) return res.status(400).json({ ok: false, msg: 'No puedes eliminar tu propio usuario.' });
    try { await pool.query('DELETE FROM usuarios WHERE id = ?', [req.params.id]); res.json({ ok: true }); } catch (error) { res.status(500).json({ ok: false, msg: error.message }); }
});
app.put('/api/usuarios/:id', soloAdmin, async (req, res) => {
    const { nombre, grupo, correo, password } = req.body;
    try {
        if (password) {
            if (String(password).length < 6) return res.status(400).json({ ok: false, msg: 'La contraseña debe tener al menos 6 caracteres.' });
            await pool.query('UPDATE usuarios SET nombre=?, grupo=?, correo=?, password=? WHERE id=?', [nombre, grupo, correo, await bcrypt.hash(String(password), 10), req.params.id]);
        } else {
            await pool.query('UPDATE usuarios SET nombre=?, grupo=?, correo=? WHERE id=?', [nombre, grupo, correo, req.params.id]);
        }
        res.json({ ok: true });
    } catch (error) { res.status(500).json({ ok: false, msg: error.message }); }
});
app.listen(PORT, () => { console.log(`🚀 Sistema corriendo en http://localhost:${PORT}`); });