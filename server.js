require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());
app.use(express.static('public'));

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: true },
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
});

// --- LOGIN ---
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const [rows] = await pool.query('SELECT * FROM usuarios WHERE correo = ?', [email]);
        if (rows.length === 0) return res.status(401).json({ ok: false, msg: 'Correo no registrado' });
        const user = rows[0];
        if (password !== user.password) return res.status(401).json({ ok: false, msg: 'Contraseña incorrecta' });
        res.json({ ok: true, user: { id: user.id, nombre: user.nombre, grupo: user.grupo, correo: user.correo } });
    } catch (error) { res.status(500).json({ ok: false, msg: 'Error de servidor' }); }
});

// ==========================================
// GESTIÓN DE CIERRES
// ==========================================
app.get('/api/cierres', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT mes FROM cierres');
        res.json(rows.map(r => r.mes));
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/cerrar-mes', async (req, res) => {
    const { mes, requester_group } = req.body;
    if (requester_group != 0) return res.status(403).json({ ok: false, msg: 'Acceso denegado.' });

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const [pendientes] = await conn.query("SELECT COUNT(*) as total FROM publicadores WHERE informo = 'NO'");
        if (pendientes[0].total > 0) {
            await conn.rollback();
            return res.json({ ok: false, msg: `Faltan ${pendientes[0].total} informes.` });
        }
        const [existe] = await conn.query("SELECT * FROM cierres WHERE mes = ?", [mes]);
        if (existe.length > 0) {
            await conn.rollback();
            return res.json({ ok: false, msg: `Mes ya cerrado.` });
        }
        await conn.query("INSERT INTO cierres (mes) VALUES (?)", [mes]);
        await conn.query("UPDATE publicadores SET informo = 'NO'");
        await conn.commit();
        res.json({ ok: true });
    } catch (error) { await conn.rollback(); res.status(500).json({ ok: false, msg: error.message }); } finally { conn.release(); }
});

// ==========================================
// DASHBOARD STATS
// ==========================================
app.get('/api/dashboard', async (req, res) => {
    const { mes, grupo } = req.query;
    try {
        const conn = await pool.getConnection();
        const [cierre] = await conn.query("SELECT * FROM cierres WHERE mes = ?", [mes]);
        const isClosed = cierre.length > 0;
        let filterGrp = ""; let paramsTotal = []; let paramsMes = [mes];
        if (grupo && grupo != '0' && grupo != '9') { filterGrp = " AND grupo = ?"; paramsTotal.push(grupo); paramsMes.push(grupo); }
        let qTotal = isClosed ? `SELECT grupo, COUNT(*) as total FROM informes WHERE mes = ? ${filterGrp} GROUP BY grupo` : `SELECT grupo, COUNT(*) as total FROM publicadores WHERE 1=1 ${filterGrp.replace('AND', 'AND')} GROUP BY grupo`;
        const [totalPubs] = await conn.query(qTotal, isClosed ? paramsMes : paramsTotal);
        let qReports = `SELECT grupo, COUNT(*) as count FROM informes WHERE mes = ? ${filterGrp} GROUP BY grupo`;
        const [reportsGroup] = await conn.query(qReports, paramsMes);
        const [pubStats] = await conn.query(`SELECT COUNT(*) as count, SUM(cursos) as cursos FROM informes WHERE mes = ? AND priv3 IN ('PUB', 'PNB') ${filterGrp}`, paramsMes);
        const [auxStats] = await conn.query(`SELECT COUNT(*) as count, SUM(horas) as horas, SUM(cursos) as cursos FROM informes WHERE mes = ? AND priv3 IN ('AUX I', 'AUX M', 'AUX') ${filterGrp}`, paramsMes);
        const [regStats] = await conn.query(`SELECT COUNT(*) as count, SUM(horas) as horas, SUM(cursos) as cursos FROM informes WHERE mes = ? AND priv3 IN ('REG', 'ESP') ${filterGrp}`, paramsMes);
        conn.release();
        res.json({ groups: { totals: totalPubs, reports: reportsGroup }, stats: { pub: pubStats[0], aux: auxStats[0], reg: regStats[0] } });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// ==========================================
// CRUD PUBLICADORES
// ==========================================
app.get('/api/publicadores', async (req, res) => {
    const { grupo, pendientes, nombre, priv3 } = req.query;
    try {
        let query = "SELECT * FROM publicadores WHERE 1=1";
        const params = [];
        if (grupo && grupo != '0' && grupo != '9') { query += " AND grupo = ?"; params.push(grupo); }
        if (pendientes === 'true') { query += " AND informo = 'NO'"; }
        if (priv3 && priv3 !== '') { query += " AND priv3 = ?"; params.push(priv3); }
        if (nombre && nombre !== '') { query += " AND nombre LIKE ?"; params.push(`%${nombre}%`); }
        query += " ORDER BY grupo ASC, nombre ASC";
        const [rows] = await pool.query(query, params); res.json(rows);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/publicadores', async (req, res) => {
    const { grupo, nombre, priv1, priv2, priv3, informo, comentario, requester_group } = req.body;
    if (requester_group != 0) return res.status(403).json({ ok: false, msg: 'Solo Admin puede crear.' });
    try { await pool.query('INSERT INTO publicadores (grupo, nombre, priv1, priv2, priv3, informo, comentario) VALUES (?, ?, ?, ?, ?, ?, ?)', [grupo, nombre, priv1, priv2, priv3, informo, comentario]); res.json({ ok: true }); }
    catch (error) { res.status(500).json({ ok: false, msg: error.message }); }
});

app.put('/api/publicadores/:id', async (req, res) => {
    const { nombre, priv1, priv2, priv3, informo, comentario, grupo, requester_group } = req.body;
    if (requester_group != 0) return res.status(403).json({ ok: false, msg: 'Acceso denegado.' });
    try { await pool.query('UPDATE publicadores SET nombre=?, priv1=?, priv2=?, priv3=?, informo=?, comentario=?, grupo=? WHERE id=?', [nombre, priv1, priv2, priv3, informo, comentario, grupo, req.params.id]); res.json({ ok: true }); }
    catch (error) { res.status(500).json({ ok: false, msg: error.message }); }
});

app.delete('/api/publicadores/:id', async (req, res) => {
    const requester_group = req.query.requester_group;
    if (requester_group != 0) return res.status(403).json({ ok: false, msg: 'Acceso denegado.' });
    try {
        await pool.query('DELETE FROM publicadores WHERE id = ?', [req.params.id]);
        res.json({ ok: true });
    } catch (error) {
        if (error.code === 'ER_ROW_IS_REFERENCED_2') res.status(400).json({ ok: false, msg: 'Borra sus informes primero.' });
        else res.status(500).json({ ok: false, msg: error.message });
    }
});

// ==========================================
// CRUD INFORMES (ACTUALIZADO CON FILTROS COMPLETOS)
// ==========================================
app.get('/api/informes', async (req, res) => {
    const { grupo, mes, nombre, priv3 } = req.query; // Recibimos nuevos filtros
    try {
        let query = `SELECT i.*, p.nombre as nombre_publicador FROM informes i LEFT JOIN publicadores p ON i.publicador_id = p.id WHERE 1=1 `;
        let params = [];

        // Filtro Grupo (0 y 9 ven todo)
        if (grupo && grupo != '0' && grupo != '9') { query += ` AND i.grupo = ?`; params.push(grupo); }

        // Filtro Mes (Puede ser específico o todos)
        if (mes && mes !== 'TODOS' && mes !== '') { query += ` AND i.mes = ?`; params.push(mes); }

        // Filtro Privilegio (Soporta Combinados)
        if (priv3 && priv3 !== '') {
            if (priv3 === 'AUX_COMBINED') { query += " AND i.priv3 IN ('AUX', 'AUX I', 'AUX M')"; }
            else if (priv3 === 'PUB_COMBINED') { query += " AND i.priv3 IN ('PUB', 'PNB')"; }
            else { query += " AND i.priv3 = ?"; params.push(priv3); }
        }

        // Filtro Nombre (LIKE para búsqueda parcial insensible a mayúsculas)
        if (nombre && nombre !== '') { query += " AND p.nombre LIKE ?"; params.push(`%${nombre}%`); }

        // Orden
        query += ` ORDER BY FIELD(i.mes, 'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE') DESC, i.grupo ASC, p.nombre ASC`;

        const [rows] = await pool.query(query, params);
        res.json(rows);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/informes', async (req, res) => {
    let { mes, grupo, publicador_id, publicador_nombre, priv1, priv2, priv3, horas, cursos, predico, comentarios } = req.body;
    const horasFinal = horas || 0; const cursosFinal = cursos || 0;
    const [cierre] = await pool.query("SELECT * FROM cierres WHERE mes = ?", [mes]);
    if (cierre.length > 0) return res.status(400).json({ ok: false, msg: `El mes de ${mes} está cerrado.` });
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        await conn.query(`INSERT INTO informes (mes, grupo, publicador_id, publicador_nombre, priv1, priv2, priv3, horas, cursos, predico, comentarios) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [mes, grupo, publicador_id, publicador_nombre, priv1, priv2, priv3, horasFinal, cursosFinal, predico, comentarios]);
        if (predico === 'SI' || horasFinal > 0) { await conn.query('UPDATE publicadores SET informo = "SI" WHERE id = ?', [publicador_id]); }
        await conn.commit(); res.json({ ok: true });
    } catch (error) { await conn.rollback(); res.status(500).json({ ok: false, msg: 'Error' }); } finally { conn.release(); }
});

app.put('/api/informes/:id', async (req, res) => {
    let { horas, cursos, predico, comentarios, publicador_id, mes } = req.body;
    const horasFinal = horas || 0; const cursosFinal = cursos || 0;
    if (mes) {
        const [cierre] = await pool.query("SELECT * FROM cierres WHERE mes = ?", [mes]);
        if (cierre.length > 0) return res.status(400).json({ ok: false, msg: `El mes de ${mes} está cerrado.` });
    }
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        await conn.query('UPDATE informes SET horas=?, cursos=?, predico=?, comentarios=? WHERE id=?', [horasFinal, cursosFinal, predico, comentarios, req.params.id]);
        if (predico === 'SI' || horasFinal > 0) { await conn.query('UPDATE publicadores SET informo = "SI" WHERE id = ?', [publicador_id]); }
        await conn.commit(); res.json({ ok: true });
    } catch (error) { await conn.rollback(); res.status(500).json({ ok: false, msg: 'Error' }); } finally { conn.release(); }
});

app.delete('/api/informes/:id', async (req, res) => {
    const requester_group = req.query.requester_group;
    const mes = req.query.mes;
    if (requester_group != 0) return res.status(403).json({ ok: false, msg: 'Acceso denegado.' });
    if (mes) {
        const [cierre] = await pool.query("SELECT * FROM cierres WHERE mes = ?", [mes]);
        if (cierre.length > 0) return res.status(400).json({ ok: false, msg: `El mes de ${mes} está cerrado.` });
    }
    try {
        await pool.query('DELETE FROM informes WHERE id = ?', [req.params.id]);
        res.json({ ok: true });
    } catch (error) { res.status(500).json({ ok: false, msg: error.message }); }
});

// ==========================================
// REPORTES AVANZADOS
// ==========================================
app.post('/api/reportes/advanced', async (req, res) => {
    const { mes, grupo, nombre, priv3 } = req.body;
    try {
        let query = `SELECT i.*, p.nombre as nombre_publicador FROM informes i LEFT JOIN publicadores p ON i.publicador_id = p.id WHERE 1=1`;
        const params = [];
        if (mes) { query += " AND i.mes = ?"; params.push(mes); }
        if (grupo) { query += " AND i.grupo = ?"; params.push(grupo); }
        if (priv3) {
            if (priv3 === 'AUX_COMBINED') query += " AND i.priv3 IN ('AUX', 'AUX I', 'AUX M')";
            else if (priv3 === 'PUB_COMBINED') query += " AND i.priv3 IN ('PUB', 'PNB')";
            else { query += " AND i.priv3 = ?"; params.push(priv3); }
        }
        if (nombre) { query += " AND p.nombre LIKE ?"; params.push(`%${nombre}%`); }
        query += ` ORDER BY FIELD(i.mes, 'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE') ASC, i.grupo ASC, p.nombre ASC`;
        const [rows] = await pool.query(query, params); res.json(rows);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// ==========================================
// CRUD REUNIONES
// ==========================================
app.get('/api/reuniones', async (req, res) => {
    const { mes } = req.query;
    try {
        let query = "SELECT * FROM reuniones";
        const params = [];
        if (mes && mes !== 'TODOS') { query += " WHERE mes = ?"; params.push(mes); }
        query += ` ORDER BY FIELD(mes, 'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE') ASC, tipo ASC, modalidad ASC`;
        const [rows] = await pool.query(query, params); res.json(rows);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/reuniones', async (req, res) => {
    const { mes, tipo, modalidad, sem1, sem2, sem3, sem4, sem5, requester_group } = req.body;
    if (requester_group != 0) return res.status(403).json({ ok: false, msg: 'No tienes permiso.' });
    const s1 = sem1 || 0; const s2 = sem2 || 0; const s3 = sem3 || 0; const s4 = sem4 || 0; const s5 = sem5 || 0;
    try { await pool.query('INSERT INTO reuniones (mes, tipo, modalidad, sem1, sem2, sem3, sem4, sem5) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [mes, tipo, modalidad, s1, s2, s3, s4, s5]); res.json({ ok: true }); }
    catch (error) { res.status(500).json({ ok: false, msg: error.message }); }
});

app.put('/api/reuniones/:id', async (req, res) => {
    const { sem1, sem2, sem3, sem4, sem5, requester_group } = req.body;
    if (requester_group != 0) return res.status(403).json({ ok: false, msg: 'No tienes permiso.' });
    const s1 = sem1 || 0; const s2 = sem2 || 0; const s3 = sem3 || 0; const s4 = sem4 || 0; const s5 = sem5 || 0;
    try { await pool.query('UPDATE reuniones SET sem1=?, sem2=?, sem3=?, sem4=?, sem5=? WHERE id=?', [s1, s2, s3, s4, s5, req.params.id]); res.json({ ok: true }); }
    catch (error) { res.status(500).json({ ok: false, msg: error.message }); }
});

app.delete('/api/reuniones/:id', async (req, res) => {
    const requester_group = req.query.requester_group;
    if (requester_group != 0) return res.status(403).json({ ok: false, msg: 'Acceso denegado.' });
    try { await pool.query('DELETE FROM reuniones WHERE id = ?', [req.params.id]); res.json({ ok: true }); }
    catch (error) { res.status(500).json({ ok: false, msg: error.message }); }
});

// ==========================================
// CRUD USUARIOS
// ==========================================
app.get('/api/usuarios', async (req, res) => {
    try { const [rows] = await pool.query('SELECT id, nombre, grupo, correo, password FROM usuarios ORDER BY grupo ASC'); res.json(rows); }
    catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/usuarios', async (req, res) => {
    const { nombre, grupo, correo, password } = req.body;
    try { await pool.query('INSERT INTO usuarios (nombre, grupo, correo, password) VALUES (?, ?, ?, ?)', [nombre, grupo, correo, password]); res.json({ ok: true }); }
    catch (error) { res.status(500).json({ ok: false, msg: error.message }); }
});

app.delete('/api/usuarios/:id', async (req, res) => {
    try { await pool.query('DELETE FROM usuarios WHERE id = ?', [req.params.id]); res.json({ ok: true }); }
    catch (error) { res.status(500).json({ ok: false, msg: error.message }); }
});

app.put('/api/usuarios/:id', async (req, res) => {
    const { nombre, grupo, correo, password } = req.body;
    try { await pool.query('UPDATE usuarios SET nombre=?, grupo=?, correo=?, password=? WHERE id=?', [nombre, grupo, correo, password, req.params.id]); res.json({ ok: true }); }
    catch (error) { res.status(500).json({ ok: false, msg: error.message }); }
});

app.listen(PORT, () => { console.log(`🚀 Sistema corriendo en http://localhost:${PORT}`); });