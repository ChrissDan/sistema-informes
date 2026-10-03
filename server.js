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
    ssl: { rejectUnauthorized: false }, 
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
});

const MESES_ORDER = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];

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

// --- CIERRES ---
app.get('/api/cierres', async (req, res) => {
    const { anio_servicio } = req.query;
    try { const [rows] = await pool.query('SELECT mes FROM cierres WHERE anio_servicio = ?', [anio_servicio]); res.json(rows.map(r => r.mes)); } 
    catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/cerrar-mes', async (req, res) => {
    const { mes, requester_group, anio_servicio } = req.body;
    if (requester_group != 0) return res.status(403).json({ ok: false, msg: 'Acceso denegado.' });

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const [pendientes] = await conn.query("SELECT COUNT(*) as total FROM publicadores WHERE informo = 'NO' AND activo = 1");
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
        await conn.query("UPDATE publicadores SET informo = 'NO'");
        await conn.commit();
        res.json({ ok: true });
    } catch (error) { await conn.rollback(); res.status(500).json({ ok: false, msg: error.message });
    } finally { conn.release(); }
});

app.post('/api/reabrir-mes', async (req, res) => {
    const { mes, requester_group, anio_servicio } = req.body;
    if (requester_group != 0) return res.status(403).json({ ok: false, msg: "No tienes permiso para reabrir meses." });
    try {
        await pool.query("DELETE FROM cierres WHERE mes = ? AND anio_servicio = ?", [mes, anio_servicio]);
        await pool.query("UPDATE publicadores SET informo = 'SI'");
        res.json({ ok: true });
    } catch (error) { res.status(500).json({ ok: false, msg: "Error al reabrir el mes." }); }
});

// --- DASHBOARD ---
app.get('/api/dashboard', async (req, res) => {
    const { mes, grupo, anio_servicio } = req.query;
    try {
        const conn = await pool.getConnection();
        const [cierre] = await conn.query("SELECT * FROM cierres WHERE mes = ? AND anio_servicio = ?", [mes, anio_servicio]);
        const isClosed = cierre.length > 0;
        
        let filterGrp = ""; let paramsTotal = []; let paramsMes = [mes, anio_servicio];
        if (grupo && grupo != '0' && grupo != '9') { filterGrp = " AND grupo = ?"; paramsTotal.push(grupo); paramsMes.push(grupo); }
        
        let qTotal = isClosed 
            ? `SELECT grupo, COUNT(*) as total FROM informes WHERE mes = ? AND anio_servicio = ? ${filterGrp} GROUP BY grupo` 
            : `SELECT grupo, COUNT(*) as total FROM publicadores WHERE activo = 1 ${filterGrp.replace('AND', 'AND')} GROUP BY grupo`;
        
        const [totalPubs] = await conn.query(qTotal, isClosed ? paramsMes : paramsTotal);
        
        let qReports = `SELECT grupo, COUNT(*) as count FROM informes WHERE mes = ? AND anio_servicio = ? ${filterGrp} GROUP BY grupo`;
        const [reportsGroup] = await conn.query(qReports, paramsMes);

        const [pubStats] = await conn.query(`SELECT COUNT(*) as count, SUM(cursos) as cursos FROM informes WHERE mes = ? AND anio_servicio = ? AND priv3 IN ('PUB', 'PNB') ${filterGrp}`, paramsMes);
        const [auxStats] = await conn.query(`SELECT COUNT(*) as count, SUM(horas) as horas, SUM(cursos) as cursos FROM informes WHERE mes = ? AND anio_servicio = ? AND priv3 IN ('AUX I', 'AUX M', 'AUX', 'AUX C') ${filterGrp}`, paramsMes);
        const [regStats] = await conn.query(`SELECT COUNT(*) as count, SUM(horas) as horas, SUM(cursos) as cursos FROM informes WHERE mes = ? AND anio_servicio = ? AND priv3 IN ('REG', 'ESP', 'MISIONERO') ${filterGrp}`, paramsMes);
        
        conn.release();
        res.json({ groups: { totals: totalPubs, reports: reportsGroup }, stats: { pub: pubStats[0], aux: auxStats[0], reg: regStats[0] } });
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
    const { grupo, pendientes, nombre, priv3 } = req.query;
    try {
        let query = "SELECT * FROM publicadores WHERE 1=1";
        const params = [];
        if (grupo && grupo != '0' && grupo != '9') { query += " AND grupo = ?"; params.push(grupo); }
        if (pendientes === 'true') { query += " AND informo = 'NO' AND activo = 1"; }
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
    const { grupo, nombre, priv1, priv2, priv3, informo, comentario, fecha_ingreso, requester_group, fecha_nacimiento, fecha_bautismo, sexo, esperanza, privilegio_s21 } = req.body; 
    if (requester_group != 0) return res.status(403).json({ ok: false, msg: 'Solo Admin puede crear.' }); 
    try { 
        const fechaFinal = fecha_ingreso ? fecha_ingreso : new Date(); 
        const fNac = fecha_nacimiento ? fecha_nacimiento : null;
        const fBau = fecha_bautismo ? fecha_bautismo : null;
        await pool.query(
            'INSERT INTO publicadores (grupo, nombre, priv1, priv2, priv3, informo, comentario, activo, fecha_ingreso, fecha_nacimiento, fecha_bautismo, sexo, esperanza, privilegio_s21) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)', 
            [grupo, nombre, priv1, priv2, priv3, informo || 'NO', comentario, fechaFinal, fNac, fBau, sexo || 'Hombre', esperanza || 'Otras ovejas', privilegio_s21 || '']
        ); 
        res.json({ ok: true }); 
    } catch (error) { 
        res.status(500).json({ ok: false, msg: error.message }); 
    }
});

app.put('/api/publicadores/:id', async (req, res) => { 
    const { nombre, priv1, priv2, priv3, informo, comentario, grupo, fecha_ingreso, requester_group, fecha_nacimiento, fecha_bautismo, sexo, esperanza, privilegio_s21 } = req.body; 
    if (requester_group != 0) return res.status(403).json({ ok: false, msg: 'Acceso denegado.' }); 
    try { 
        const fNac = fecha_nacimiento ? fecha_nacimiento : null;
        const fBau = fecha_bautismo ? fecha_bautismo : null;
        await pool.query(
            'UPDATE publicadores SET nombre=?, priv1=?, priv2=?, priv3=?, informo=?, comentario=?, grupo=?, fecha_ingreso=?, fecha_nacimiento=?, fecha_bautismo=?, sexo=?, esperanza=?, privilegio_s21=? WHERE id=?', 
            [nombre, priv1, priv2, priv3, informo, comentario, grupo, fecha_ingreso, fNac, fBau, sexo || 'Hombre', esperanza || 'Otras ovejas', privilegio_s21 || '', req.params.id]
        ); 
        res.json({ ok: true }); 
    } catch (error) { 
        res.status(500).json({ ok: false, msg: error.message }); 
    }
});

app.patch('/api/publicadores/:id/estado', async (req, res) => { /* Igual */ const { activo, requester_group } = req.body; if (requester_group != 0) return res.status(403).json({ ok: false, msg: 'Solo Admin puede cambiar estado.' }); try { await pool.query('UPDATE publicadores SET activo = ? WHERE id = ?', [activo ? 1 : 0, req.params.id]); res.json({ ok: true }); } catch (error) { res.status(500).json({ ok: false, msg: error.message }); }});
app.delete('/api/publicadores/:id', async (req, res) => { /* Igual */ const requester_group = req.query.requester_group; if (requester_group != 0) return res.status(403).json({ ok: false, msg: 'Acceso denegado.' }); try { await pool.query('DELETE FROM publicadores WHERE id = ?', [req.params.id]); res.json({ ok: true }); } catch (error) { if(error.code === 'ER_ROW_IS_REFERENCED_2') res.status(400).json({ ok: false, msg: 'Borra sus informes primero.' }); else res.status(500).json({ ok: false, msg: error.message }); }});

app.get('/api/check-inactivos', async (req, res) => {
    // Check inactivos busca en todo el historial, lo dejamos global por ahora para alertas generales.
    const { grupo } = req.query;
    try {
        const now = new Date(); const currentYear = now.getFullYear(); const currentMonth = now.getMonth(); 
        let sqlPubs = "SELECT id, nombre, grupo, fecha_ingreso FROM publicadores WHERE activo = 1";
        let paramsPubs = []; if (grupo && grupo != '0' && grupo != '9') { sqlPubs += " AND grupo = ?"; paramsPubs.push(grupo); }
        const [publicadores] = await pool.query(sqlPubs, paramsPubs);
        const [informes] = await pool.query("SELECT publicador_id, mes FROM informes WHERE predico = 'SI'");
        const informesMap = new Set(); informes.forEach(inf => { if(inf.mes) informesMap.add(`${inf.publicador_id}-${inf.mes.trim().toUpperCase()}`); });
        const [cierres] = await pool.query("SELECT mes FROM cierres"); const mesesCerradosSet = new Set(cierres.map(c => c.mes.trim().toUpperCase()));
        const candidatos = []; const mesesAtrasMax = 12;
        for (const pub of publicadores) {
            let mesesSinInformar = 0; let startScore = 190001;
            if (pub.fecha_ingreso) { const dString = new Date(pub.fecha_ingreso).toISOString().split('T')[0]; const parts = dString.split('-'); let y = parseInt(parts[0]); let m = parseInt(parts[1]); let d = parseInt(parts[2]); if (d === 1) { m--; if (m === 0) { m = 12; y--; } } startScore = (y * 100) + m; }
            for (let i = 1; i <= mesesAtrasMax; i++) {
                let checkDate = new Date(currentYear, currentMonth - i, 1); let checkY = checkDate.getFullYear(); let checkM = checkDate.getMonth() + 1; let checkScore = (checkY * 100) + checkM; const nombreMes = MESES_ORDER[checkDate.getMonth()]; 
                if (!mesesCerradosSet.has(nombreMes)) continue; if (checkScore < startScore) continue;
                const key = `${pub.id}-${nombreMes}`; if (!informesMap.has(key)) mesesSinInformar++; else break;
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

    const conn = await pool.getConnection();
    try {
        const [cierre] = await conn.query("SELECT * FROM cierres WHERE mes = ? AND anio_servicio = ?", [mes, anio_servicio]);
        if (cierre.length > 0) { conn.release(); return res.status(400).json({ ok: false, msg: `Mes cerrado en este año.` }); }
        const [existente] = await conn.query("SELECT id FROM informes WHERE publicador_id = ? AND mes = ? AND anio_servicio = ?", [publicador_id, mes, anio_servicio]);
        if (existente.length > 0) { conn.release(); return res.status(400).json({ ok: false, msg: `Ya existe un informe.` }); }
        
        await conn.beginTransaction();
        await conn.query(`INSERT INTO informes (mes, grupo, publicador_id, publicador_nombre, priv1, priv2, priv3, horas, cursos, predico, comentarios, credito_hrs, anio_servicio) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
            [mes, grupo, publicador_id, publicador_nombre, priv1, priv2, priv3, h, c, predico, comentarios, cred, anio_servicio]);
        await conn.query('UPDATE publicadores SET informo = "SI" WHERE id = ?', [publicador_id]);
        await conn.commit(); res.json({ ok: true });
    } catch (error) { await conn.rollback(); res.status(500).json({ ok: false, msg: error.message }); } finally { conn.release(); }
});

app.put('/api/informes/:id', async (req, res) => {
    let { horas, cursos, predico, comentarios, publicador_id, credito_hrs } = req.body;
    const h = parseFloat(horas) || 0; const c = parseInt(cursos) || 0; const cred = parseFloat(credito_hrs) || 0;
    try {
        const [infOrig] = await pool.query("SELECT mes, priv3, anio_servicio FROM informes WHERE id = ?", [req.params.id]);
        if (infOrig.length === 0) return res.status(404).json({ ok: false, msg: "No encontrado." });
        const { mes, priv3, anio_servicio } = infOrig[0];
        
        if (['REG', 'ESP', 'AUX I', 'AUX M', 'AUX', 'AUX C'].includes((priv3||'').toUpperCase()) && h <= 0) return res.status(400).json({ ok: false, msg: `0 horas no permitido.` });
        const [cierre] = await pool.query("SELECT * FROM cierres WHERE mes = ? AND anio_servicio = ?", [mes, anio_servicio]);
        if (cierre.length > 0) return res.status(400).json({ ok: false, msg: `Mes cerrado.` });
        
        const conn = await pool.getConnection();
        await conn.beginTransaction();
        await conn.query('UPDATE informes SET horas=?, cursos=?, predico=?, comentarios=?, credito_hrs=? WHERE id=?', [h, c, predico, comentarios, cred, req.params.id]);
        await conn.query('UPDATE publicadores SET informo = "SI" WHERE id = ?', [publicador_id]);
        await conn.commit(); conn.release(); res.json({ ok: true });
    } catch (err) { res.status(500).json({ ok: false, msg: err.message }); }
});

app.delete('/api/informes/:id', async (req, res) => {
    const { requester_group, mes, anio_servicio } = req.query;
    if (requester_group != 0) return res.status(403).json({ ok: false, msg: 'Acceso denegado.' });
    if (mes && anio_servicio) {
        const [cierre] = await pool.query("SELECT * FROM cierres WHERE mes = ? AND anio_servicio = ?", [mes, anio_servicio]);
        if (cierre.length > 0) return res.status(400).json({ ok: false, msg: `Mes cerrado.` });
    }
    try { 
        const [informe] = await pool.query("SELECT publicador_id FROM informes WHERE id = ?", [req.params.id]);
        if (informe.length > 0) {
            await pool.query('DELETE FROM informes WHERE id = ?', [req.params.id]);
            await pool.query("UPDATE publicadores SET informo = 'NO' WHERE id = ?", [informe[0].publicador_id]);
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
        const [rowsStats] = await pool.query(`SELECT priv3, COUNT(*) as cant, SUM(horas) as horas, SUM(cursos) as cursos FROM informes WHERE mes = ? AND anio_servicio = ? ${whereGrp.replace('AND', 'AND')} GROUP BY priv3`, paramsStats);
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
        const [pubs] = await pool.query(`SELECT id, nombre, grupo, priv3 FROM publicadores WHERE activo = 1 AND (${wherePriv}) ORDER BY grupo ASC, nombre ASC`);
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
app.post('/api/reuniones', async (req, res) => { const { mes, tipo, modalidad, sem1, sem2, sem3, sem4, sem5, requester_group, anio_servicio } = req.body; if (requester_group != 0) return res.status(403).json({ ok: false, msg: 'No tienes permiso.' }); try { await pool.query('INSERT INTO reuniones (mes, tipo, modalidad, sem1, sem2, sem3, sem4, sem5, anio_servicio) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [mes, tipo, modalidad, sem1||0, sem2||0, sem3||0, sem4||0, sem5||0, anio_servicio]); res.json({ ok: true }); } catch (error) { res.status(500).json({ ok: false, msg: error.message }); } });
app.put('/api/reuniones/:id', async (req, res) => { const { sem1, sem2, sem3, sem4, sem5, requester_group } = req.body; if (requester_group != 0) return res.status(403).json({ ok: false, msg: 'No tienes permiso.' }); try { await pool.query('UPDATE reuniones SET sem1=?, sem2=?, sem3=?, sem4=?, sem5=? WHERE id=?', [sem1||0, sem2||0, sem3||0, sem4||0, sem5||0, req.params.id]); res.json({ ok: true }); } catch (error) { res.status(500).json({ ok: false, msg: error.message }); } });
app.delete('/api/reuniones/:id', async (req, res) => { const requester_group = req.query.requester_group; if (requester_group != 0) return res.status(403).json({ ok: false, msg: 'Acceso denegado.' }); try { await pool.query('DELETE FROM reuniones WHERE id = ?', [req.params.id]); res.json({ ok: true }); } catch (error) { res.status(500).json({ ok: false, msg: error.message }); } });

// --- USUARIOS ---
app.get('/api/usuarios', async (req, res) => { try { const [rows] = await pool.query('SELECT id, nombre, grupo, correo, password FROM usuarios ORDER BY grupo ASC'); res.json(rows); } catch (error) { res.status(500).json({ error: error.message }); } });
app.post('/api/usuarios', async (req, res) => { const { nombre, grupo, correo, password } = req.body; try { await pool.query('INSERT INTO usuarios (nombre, grupo, correo, password) VALUES (?, ?, ?, ?)', [nombre, grupo, correo, password]); res.json({ ok: true }); } catch (error) { res.status(500).json({ ok: false, msg: error.message }); } });
app.delete('/api/usuarios/:id', async (req, res) => { try { await pool.query('DELETE FROM usuarios WHERE id = ?', [req.params.id]); res.json({ ok: true }); } catch (error) { res.status(500).json({ ok: false, msg: error.message }); } });
app.put('/api/usuarios/:id', async (req, res) => { const { nombre, grupo, correo, password } = req.body; try { await pool.query('UPDATE usuarios SET nombre=?, grupo=?, correo=?, password=? WHERE id=?', [nombre, grupo, correo, password, req.params.id]); res.json({ ok: true }); } catch (error) { res.status(500).json({ ok: false, msg: error.message }); } });

app.listen(PORT, () => { console.log(`🚀 Sistema corriendo en http://localhost:${PORT}`); });