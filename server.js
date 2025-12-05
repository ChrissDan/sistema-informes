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
// DASHBOARD STATS (FILTRABLE POR GRUPO)
// ==========================================
app.get('/api/dashboard', async (req, res) => {
    const { mes, grupo } = req.query; // Recibimos el grupo también
    try {
        const conn = await pool.getConnection();
        
        // Preparar filtro SQL dinámico
        let filterGrp = "";
        let paramsTotal = [];
        let paramsMes = [mes];

        if (grupo && grupo != '0') {
            filterGrp = " AND grupo = ?";
            paramsTotal.push(grupo);
            paramsMes.push(grupo);
        }

        // 1. Totales por Grupo (Total de publicadores activos)
        // Nota: Si hay filtro, WHERE grupo = ?
        let qTotal = `SELECT grupo, COUNT(*) as total FROM publicadores WHERE 1=1 ${filterGrp.replace('AND', 'AND')} GROUP BY grupo`;
        const [totalPubs] = await conn.query(qTotal, paramsTotal);
        
        // 2. Informes por Grupo (Cuántos informaron este mes)
        let qReports = `SELECT grupo, COUNT(*) as count FROM informes WHERE mes = ? ${filterGrp} GROUP BY grupo`;
        const [reportsGroup] = await conn.query(qReports, paramsMes);
        
        // 3. Estadísticas PUB + PNB
        const [pubStats] = await conn.query(`
            SELECT COUNT(*) as count, SUM(cursos) as cursos 
            FROM informes 
            WHERE mes = ? AND priv3 IN ('PUB', 'PNB') ${filterGrp}`, paramsMes);

        // 4. Estadísticas AUX (I + M)
        const [auxStats] = await conn.query(`
            SELECT COUNT(*) as count, SUM(horas) as horas, SUM(cursos) as cursos 
            FROM informes 
            WHERE mes = ? AND priv3 IN ('AUX I', 'AUX M', 'AUX') ${filterGrp}`, paramsMes);

        // 5. Estadísticas REG
        const [regStats] = await conn.query(`
            SELECT COUNT(*) as count, SUM(horas) as horas, SUM(cursos) as cursos 
            FROM informes 
            WHERE mes = ? AND priv3 IN ('REG', 'ESP') ${filterGrp}`, paramsMes);

        conn.release();

        res.json({
            groups: { totals: totalPubs, reports: reportsGroup },
            stats: {
                pub: pubStats[0],
                aux: auxStats[0],
                reg: regStats[0]
            }
        });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// ==========================================
// CRUD PUBLICADORES
// ==========================================
app.get('/api/publicadores', async (req, res) => {
    const { grupo } = req.query;
    try {
        let query = (grupo == '0') 
            ? 'SELECT * FROM publicadores ORDER BY grupo ASC, nombre ASC' 
            : 'SELECT * FROM publicadores WHERE grupo = ? ORDER BY nombre ASC';
        const [rows] = await pool.query(query, (grupo == '0') ? [] : [grupo]);
        res.json(rows);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/publicadores', async (req, res) => {
    const { grupo, nombre, priv1, priv2, priv3, informo, comentario, requester_group } = req.body;
    if (requester_group != 0) return res.status(403).json({ ok: false, msg: 'No tienes permiso.' });
    try {
        await pool.query(
            'INSERT INTO publicadores (grupo, nombre, priv1, priv2, priv3, informo, comentario) VALUES (?, ?, ?, ?, ?, ?, ?)', 
            [grupo, nombre, priv1, priv2, priv3, informo, comentario]
        );
        res.json({ ok: true });
    } catch (error) { res.status(500).json({ ok: false, msg: error.message }); }
});

app.delete('/api/publicadores/:id', async (req, res) => {
    const { requester_group } = req.body;
    if (requester_group != 0) return res.status(403).json({ ok: false, msg: 'Acceso denegado.' });
    try {
        await pool.query('DELETE FROM publicadores WHERE id = ?', [req.params.id]);
        res.json({ ok: true });
    } catch (error) { res.status(500).json({ ok: false, msg: error.message }); }
});

app.put('/api/publicadores/:id', async (req, res) => {
    const { nombre, priv1, priv2, priv3, informo, comentario, grupo, requester_group } = req.body;
    if (requester_group != 0) return res.status(403).json({ ok: false, msg: 'Acceso denegado.' });
    try {
        await pool.query(
            'UPDATE publicadores SET nombre=?, priv1=?, priv2=?, priv3=?, informo=?, comentario=?, grupo=? WHERE id=?', 
            [nombre, priv1, priv2, priv3, informo, comentario, grupo, req.params.id]
        );
        res.json({ ok: true });
    } catch (error) { res.status(500).json({ ok: false, msg: error.message }); }
});

// ==========================================
// CRUD INFORMES
// ==========================================
app.get('/api/informes', async (req, res) => {
    const { grupo, mes } = req.query;
    try {
        let query = `SELECT i.*, p.nombre as nombre_publicador FROM informes i LEFT JOIN publicadores p ON i.publicador_id = p.id WHERE 1=1 `;
        let params = [];
        if (grupo != '0') { query += ` AND i.grupo = ?`; params.push(grupo); }
        if (mes && mes !== 'TODOS') { query += ` AND i.mes = ?`; params.push(mes); }
        query += ` ORDER BY i.grupo ASC, p.nombre ASC`;
        const [rows] = await pool.query(query, params);
        res.json(rows);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/informes', async (req, res) => {
    let { mes, grupo, publicador_id, publicador_nombre, priv1, priv2, priv3, horas, cursos, predico, comentarios } = req.body;
    const horasFinal = horas || 0;
    const cursosFinal = cursos || 0;
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        await conn.query(`INSERT INTO informes (mes, grupo, publicador_id, publicador_nombre, priv1, priv2, priv3, horas, cursos, predico, comentarios) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [mes, grupo, publicador_id, publicador_nombre, priv1, priv2, priv3, horasFinal, cursosFinal, predico, comentarios]);
        if (predico === 'SI' || horasFinal > 0) { 
            await conn.query('UPDATE publicadores SET informo = "SI" WHERE id = ?', [publicador_id]); 
        }
        await conn.commit();
        res.json({ ok: true });
    } catch (error) { await conn.rollback(); res.status(500).json({ ok: false, msg: 'Error' }); } finally { conn.release(); }
});

app.put('/api/informes/:id', async (req, res) => {
    let { horas, cursos, predico, comentarios, publicador_id } = req.body;
    const horasFinal = horas || 0;
    const cursosFinal = cursos || 0;
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        await conn.query('UPDATE informes SET horas=?, cursos=?, predico=?, comentarios=? WHERE id=?', [horasFinal, cursosFinal, predico, comentarios, req.params.id]);
        if (predico === 'SI' || horasFinal > 0) { 
            await conn.query('UPDATE publicadores SET informo = "SI" WHERE id = ?', [publicador_id]); 
        }
        await conn.commit();
        res.json({ ok: true });
    } catch (error) { await conn.rollback(); res.status(500).json({ ok: false, msg: 'Error' }); } finally { conn.release(); }
});

app.delete('/api/informes/:id', async (req, res) => {
    const { requester_group } = req.body;
    if (requester_group != 0) return res.status(403).json({ ok: false, msg: 'Solo el Admin puede eliminar informes.' });
    try {
        await pool.query('DELETE FROM informes WHERE id = ?', [req.params.id]);
        res.json({ ok: true });
    } catch (error) { res.status(500).json({ ok: false, msg: error.message }); }
});

// ==========================================
// CRUD USUARIOS
// ==========================================
app.get('/api/usuarios', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT id, nombre, grupo, correo, password FROM usuarios ORDER BY grupo ASC');
        res.json(rows);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/usuarios', async (req, res) => {
    const { nombre, grupo, correo, password } = req.body;
    try {
        await pool.query('INSERT INTO usuarios (nombre, grupo, correo, password) VALUES (?, ?, ?, ?)', [nombre, grupo, correo, password]);
        res.json({ ok: true });
    } catch (error) { res.status(500).json({ ok: false, msg: error.message }); }
});

app.delete('/api/usuarios/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM usuarios WHERE id = ?', [req.params.id]);
        res.json({ ok: true });
    } catch (error) { res.status(500).json({ ok: false, msg: error.message }); }
});

app.put('/api/usuarios/:id', async (req, res) => {
    const { nombre, grupo, correo, password } = req.body;
    try {
        await pool.query('UPDATE usuarios SET nombre=?, grupo=?, correo=?, password=? WHERE id=?', [nombre, grupo, correo, password, req.params.id]);
        res.json({ ok: true });
    } catch (error) { res.status(500).json({ ok: false, msg: error.message }); }
});

app.listen(PORT, () => { console.log(`🚀 Sistema corriendo en http://localhost:${PORT}`); });