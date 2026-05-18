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
    try { const [rows] = await pool.query('SELECT mes FROM cierres'); res.json(rows.map(r => r.mes)); } 
    catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/cerrar-mes', async (req, res) => {
    const { mes, requester_group } = req.body;
    if (requester_group != 0) return res.status(403).json({ ok: false, msg: 'Acceso denegado.' });

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const [pendientes] = await conn.query("SELECT COUNT(*) as total FROM publicadores WHERE informo = 'NO' AND activo = 1");
        if (pendientes[0].total > 0) {
            await conn.rollback();
            return res.json({ ok: false, msg: `Faltan ${pendientes[0].total} informes de publicadores activos.` });
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

// --- DASHBOARD ---
app.get('/api/dashboard', async (req, res) => {
    const { mes, grupo } = req.query;
    try {
        const conn = await pool.getConnection();
        const [cierre] = await conn.query("SELECT * FROM cierres WHERE mes = ?", [mes]);
        const isClosed = cierre.length > 0;
        
        let filterGrp = ""; let paramsTotal = []; let paramsMes = [mes];
        if (grupo && grupo != '0' && grupo != '9') { filterGrp = " AND grupo = ?"; paramsTotal.push(grupo); paramsMes.push(grupo); }
        
        let qTotal = isClosed 
            ? `SELECT grupo, COUNT(*) as total FROM informes WHERE mes = ? ${filterGrp} GROUP BY grupo` 
            : `SELECT grupo, COUNT(*) as total FROM publicadores WHERE activo = 1 ${filterGrp.replace('AND', 'AND')} GROUP BY grupo`;
        
        const [totalPubs] = await conn.query(qTotal, isClosed ? paramsMes : paramsTotal);
        
        let qReports = `SELECT grupo, COUNT(*) as count FROM informes WHERE mes = ? ${filterGrp} GROUP BY grupo`;
        const [reportsGroup] = await conn.query(qReports, paramsMes);
        
        const [pubStats] = await conn.query(`SELECT COUNT(*) as count, SUM(cursos) as cursos FROM informes WHERE mes = ? AND priv3 IN ('PUB', 'PNB') ${filterGrp}`, paramsMes);
        const [auxStats] = await conn.query(`SELECT COUNT(*) as count, SUM(horas) as horas, SUM(cursos) as cursos FROM informes WHERE mes = ? AND priv3 IN ('AUX I', 'AUX M', 'AUX') ${filterGrp}`, paramsMes);
        const [regStats] = await conn.query(`SELECT COUNT(*) as count, SUM(horas) as horas, SUM(cursos) as cursos FROM informes WHERE mes = ? AND priv3 = 'REG' ${filterGrp}`, paramsMes);
        
        conn.release();
        res.json({ 
            groups: { totals: totalPubs, reports: reportsGroup }, 
            stats: { pub: pubStats[0], aux: auxStats[0], reg: regStats[0] } 
        });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// >>> NUEVO ENDPOINT: GRÁFICA DE CURSOS <<<
app.get('/api/dashboard/cursos', async (req, res) => {
    const { mes, grupo } = req.query;
    try {
        // Hacemos que SQL sume las columnas dividiéndolas por categoría
        let sql = `
            SELECT 
                SUM(CASE WHEN priv3 IN ('PUB', 'PNB') THEN cursos ELSE 0 END) as pub,
                SUM(CASE WHEN priv3 IN ('AUX', 'AUX I', 'AUX M') THEN cursos ELSE 0 END) as aux,
                SUM(CASE WHEN priv3 IN ('REG', 'ESP', 'MISIONERO') THEN cursos ELSE 0 END) as reg
            FROM informes 
            WHERE 1=1
        `;
        let params = [];

        // Si envían un mes, filtramos. Si no (TODOS), suma el año completo
        if (mes && mes !== '' && mes !== 'TODOS') {
            sql += " AND mes = ?";
            params.push(mes);
        }

        // Filtro de seguridad por grupo (0 o 9 son administradores)
        if (grupo && grupo != '0' && grupo != '9') {
            sql += " AND grupo = ?";
            params.push(grupo);
        }

        const [rows] = await pool.query(sql, params);
        
        // Devolvemos exactamente los 3 números que necesita la gráfica
        res.json({
            pub: parseInt(rows[0].pub) || 0,
            aux: parseInt(rows[0].aux) || 0,
            reg: parseInt(rows[0].reg) || 0
        });

    } catch (error) { 
        console.error("Error en /api/dashboard/cursos:", error);
        res.status(500).json({ error: error.message }); 
    }
});

// >>> NUEVO ENDPOINT: COMPARATIVA DE CURSOS (TIENEN VS NO TIENEN) <<<
app.get('/api/dashboard/cursos-comparativa', async (req, res) => {
    const { grupo } = req.query;
    try {
        // Agrupamos por mes y usamos CASE para contar 1 si cumple la condición, y 0 si no.
        let sql = `
            SELECT 
                mes,
                SUM(CASE WHEN cursos > 0 THEN 1 ELSE 0 END) as con_cursos,
                SUM(CASE WHEN cursos = 0 OR cursos IS NULL THEN 1 ELSE 0 END) as sin_cursos
            FROM informes 
            WHERE 1=1
        `;
        let params = [];

        // Filtro de seguridad por grupo (0 o 9 son administradores globales)
        if (grupo && grupo != '0' && grupo != '9') {
            sql += " AND grupo = ?";
            params.push(grupo);
        }

        sql += " GROUP BY mes";

        const [rows] = await pool.query(sql, params);
        res.json(rows); // Devolvemos el conteo directo a la gráfica

    } catch (error) { 
        console.error("Error en /api/dashboard/cursos-comparativa:", error);
        res.status(500).json({ error: error.message }); 
    }
});

// --- PUBLICADORES ---
app.get('/api/publicadores', async (req, res) => {
    const { grupo, pendientes, nombre, priv3 } = req.query;
    try {
        let query = "SELECT * FROM publicadores WHERE 1=1";
        const params = [];
        if (grupo && grupo != '0' && grupo != '9') { query += " AND grupo = ?"; params.push(grupo); }
        if (pendientes === 'true') { query += " AND informo = 'NO' AND activo = 1"; }
        if (priv3 && priv3 !== '') { 
            if (priv3 === 'AUX') { query += " AND priv3 IN ('AUX', 'AUX I', 'AUX M')"; } 
            else { query += " AND priv3 = ?"; params.push(priv3); }
        }
        if (nombre && nombre !== '') { query += " AND nombre LIKE ?"; params.push(`%${nombre}%`); }
        query += " ORDER BY activo DESC, grupo ASC, nombre ASC";
        const [rows] = await pool.query(query, params); res.json(rows);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/publicadores', async (req, res) => {
    const { grupo, nombre, priv1, priv2, priv3, informo, comentario, fecha_ingreso, requester_group } = req.body;
    if (requester_group != 0) return res.status(403).json({ ok: false, msg: 'Solo Admin puede crear.' });
    try { 
        const fechaFinal = fecha_ingreso ? fecha_ingreso : new Date();
        await pool.query('INSERT INTO publicadores (grupo, nombre, priv1, priv2, priv3, informo, comentario, activo, fecha_ingreso) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)', [grupo, nombre, priv1, priv2, priv3, informo || 'NO', comentario, fechaFinal]); 
        res.json({ ok: true }); 
    } 
    catch (error) { res.status(500).json({ ok: false, msg: error.message }); }
});

app.put('/api/publicadores/:id', async (req, res) => {
    const { nombre, priv1, priv2, priv3, informo, comentario, grupo, fecha_ingreso, requester_group } = req.body;
    if (requester_group != 0) return res.status(403).json({ ok: false, msg: 'Acceso denegado.' });
    try { 
        await pool.query('UPDATE publicadores SET nombre=?, priv1=?, priv2=?, priv3=?, informo=?, comentario=?, grupo=?, fecha_ingreso=? WHERE id=?', [nombre, priv1, priv2, priv3, informo, comentario, grupo, fecha_ingreso, req.params.id]); 
        res.json({ ok: true }); 
    } 
    catch (error) { res.status(500).json({ ok: false, msg: error.message }); }
});

app.patch('/api/publicadores/:id/estado', async (req, res) => {
    const { activo, requester_group } = req.body;
    if (requester_group != 0) return res.status(403).json({ ok: false, msg: 'Solo Admin puede cambiar estado.' });
    try {
        await pool.query('UPDATE publicadores SET activo = ? WHERE id = ?', [activo ? 1 : 0, req.params.id]);
        res.json({ ok: true });
    } catch (error) { res.status(500).json({ ok: false, msg: error.message }); }
});

app.delete('/api/publicadores/:id', async (req, res) => {
    const requester_group = req.query.requester_group; 
    if (requester_group != 0) return res.status(403).json({ ok: false, msg: 'Acceso denegado.' });
    try { await pool.query('DELETE FROM publicadores WHERE id = ?', [req.params.id]); res.json({ ok: true }); } 
    catch (error) { 
        if(error.code === 'ER_ROW_IS_REFERENCED_2') res.status(400).json({ ok: false, msg: 'Borra sus informes primero.' });
        else res.status(500).json({ ok: false, msg: error.message }); 
    }
});

// >>> INACTIVOS (ORDENADO POR GRUPO + NOMBRE) <<<
app.get('/api/check-inactivos', async (req, res) => {
    const { grupo } = req.query;
    console.log("\n>>> [DEBUG] Buscando irregulares..."); 
    
    try {
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth(); 

        let sqlPubs = "SELECT id, nombre, grupo, fecha_ingreso FROM publicadores WHERE activo = 1";
        let paramsPubs = [];
        if (grupo && grupo != '0' && grupo != '9') {
            sqlPubs += " AND grupo = ?";
            paramsPubs.push(grupo);
        }
        const [publicadores] = await pool.query(sqlPubs, paramsPubs);

        // MAPA: Solo traemos informes donde PREDICO = 'SI'
        const [informes] = await pool.query("SELECT publicador_id, mes FROM informes WHERE predico = 'SI'");
        
        const informesMap = new Set();
        informes.forEach(inf => {
            if(inf.mes) informesMap.add(`${inf.publicador_id}-${inf.mes.trim().toUpperCase()}`);
        });

        const [cierres] = await pool.query("SELECT mes FROM cierres");
        const mesesCerradosSet = new Set(cierres.map(c => c.mes.trim().toUpperCase()));

        console.log(`- Meses Cerrados: ${Array.from(mesesCerradosSet).join(', ')}`);

        const candidatos = [];
        const mesesAtrasMax = 12;

        for (const pub of publicadores) {
            let mesesSinInformar = 0;
            
            // --- CALCULAR MES DE INICIO DE OBLIGACIÓN ---
            let startScore = 190001; 

            if (pub.fecha_ingreso) {
                const dString = new Date(pub.fecha_ingreso).toISOString().split('T')[0];
                const parts = dString.split('-'); 
                let y = parseInt(parts[0]);
                let m = parseInt(parts[1]); 
                let d = parseInt(parts[2]);

                if (d === 1) {
                    m--;
                    if (m === 0) { m = 12; y--; }
                } 
                startScore = (y * 100) + m;
            }

            for (let i = 1; i <= mesesAtrasMax; i++) {
                let checkDate = new Date(currentYear, currentMonth - i, 1);
                let checkY = checkDate.getFullYear();
                let checkM = checkDate.getMonth() + 1;
                let checkScore = (checkY * 100) + checkM;
                const nombreMes = MESES_ORDER[checkDate.getMonth()]; 

                if (!mesesCerradosSet.has(nombreMes)) continue;
                if (checkScore < startScore) continue;

                const key = `${pub.id}-${nombreMes}`;
                if (!informesMap.has(key)) {
                    mesesSinInformar++;
                } else {
                    break; // Rompe racha
                }
            }

            if (mesesSinInformar >= 1) { 
                candidatos.push({ ...pub, meses_sin_informar: mesesSinInformar });
            }
        }
        
        console.log(`>>> [RESULTADO] Irregulares: ${candidatos.length}`);
        
        // --- ORDENAMIENTO FINAL: GRUPO (ASC) -> NOMBRE (ASC) ---
        const finalList = candidatos.sort((a, b) => {
            if (a.grupo !== b.grupo) {
                return a.grupo - b.grupo; // Grupo 1, 2, 3...
            }
            return a.nombre.localeCompare(b.nombre); // Alfabético
        });

        res.json({ candidatos: finalList }); 

    } catch (error) { 
        console.error(">>> [ERROR]", error);
        res.status(500).json({ error: error.message }); 
    }
});

// --- INFORMES ---
app.get('/api/informes', async (req, res) => {
    const { grupo, mes, nombre, priv3 } = req.query; 
    try {
        let query = `SELECT i.*, p.nombre as nombre_publicador FROM informes i LEFT JOIN publicadores p ON i.publicador_id = p.id WHERE 1=1 `;
        let params = [];
        if (grupo != '0' && grupo != '9') { query += ` AND i.grupo = ?`; params.push(grupo); }
        if (mes && mes !== 'TODOS' && mes !== '') { query += ` AND i.mes = ?`; params.push(mes); }
        if (priv3 && priv3 !== '') { 
            if (priv3 === 'AUX_COMBINED') { query += " AND i.priv3 IN ('AUX', 'AUX I', 'AUX M')"; } 
            else if (priv3 === 'PUB_COMBINED') { query += " AND i.priv3 IN ('PUB', 'PNB')"; } 
            else { query += " AND i.priv3 = ?"; params.push(priv3); }
        }
        if (nombre && nombre !== '') { query += " AND p.nombre LIKE ?"; params.push(`%${nombre}%`); }
        query += ` ORDER BY FIELD(i.mes, 'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE') DESC, i.grupo ASC, p.nombre ASC`;
        const [rows] = await pool.query(query, params);
        res.json(rows);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/informes', async (req, res) => {
    let { mes, grupo, publicador_id, publicador_nombre, priv1, priv2, priv3, horas, cursos, predico, comentarios, credito_hrs } = req.body;
    const horasFinal = parseFloat(horas) || 0; 
    const cursosFinal = parseInt(cursos) || 0;
    const creditoFinal = parseFloat(credito_hrs) || 0;

    let creditoPermitido = 55 - horasFinal;
    if (creditoPermitido < 0) creditoPermitido = 0;

    if (creditoFinal > creditoPermitido) {
        return res.status(400).json({ ok: false, msg: `Con ${horasFinal}h, el crédito máximo es ${creditoPermitido}h.` });
    }

    const conn = await pool.getConnection();
    try {
        // Verificamos si el mes está cerrado
        const [cierre] = await conn.query("SELECT * FROM cierres WHERE mes = ?", [mes]);
        if (cierre.length > 0) {
            conn.release();
            return res.status(400).json({ ok: false, msg: `El mes de ${mes} está cerrado.` });
        }

        // ---> ¡LA NUEVA BARRERA ANTI-DUPLICADOS! <---
        // Verificamos si este publicador YA tiene un informe registrado en este mes
        const [existente] = await conn.query("SELECT id FROM informes WHERE publicador_id = ? AND mes = ?", [publicador_id, mes]);
        if (existente.length > 0) {
            conn.release();
            return res.status(400).json({ ok: false, msg: `Este publicador ya tiene un informe registrado en ${mes}.` });
        }

        await conn.beginTransaction();
        await conn.query(
            `INSERT INTO informes (mes, grupo, publicador_id, publicador_nombre, priv1, priv2, priv3, horas, cursos, predico, comentarios, credito_hrs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
            [mes, grupo, publicador_id, publicador_nombre, priv1, priv2, priv3, horasFinal, cursosFinal, predico, comentarios, creditoFinal]
        );
        await conn.query('UPDATE publicadores SET informo = "SI" WHERE id = ?', [publicador_id]);
        
        await conn.commit(); 
        res.json({ ok: true });
    } catch (error) { 
        await conn.rollback(); 
        res.status(500).json({ ok: false, msg: 'Error: ' + error.message }); 
    } finally { 
        // Asegurarse de que la conexión SIEMPRE se libere
        if (conn && !conn.connection._fatalError) {
            conn.release();
        }
    }
});

app.put('/api/informes/:id', async (req, res) => {
    let { horas, cursos, predico, comentarios, publicador_id, mes, credito_hrs } = req.body;
    const horasFinal = parseFloat(horas) || 0; 
    const cursosFinal = parseInt(cursos) || 0;
    const creditoFinal = parseFloat(credito_hrs) || 0;

    let creditoPermitido = 55 - horasFinal;
    if (creditoPermitido < 0) creditoPermitido = 0;

    if (creditoFinal > creditoPermitido) {
        return res.status(400).json({ ok: false, msg: `Con ${horasFinal}h, el crédito máximo es ${creditoPermitido}h.` });
    }

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        await conn.query(
            'UPDATE informes SET horas=?, cursos=?, predico=?, comentarios=?, credito_hrs=? WHERE id=?', 
            [horasFinal, cursosFinal, predico, comentarios, credito_hrs, req.params.id]
        );
        await conn.query('UPDATE publicadores SET informo = "SI" WHERE id = ?', [publicador_id]);
        await conn.commit(); 
        res.json({ ok: true });
    } catch (error) { await conn.rollback(); res.status(500).json({ ok: false, msg: 'Error: ' + error.message }); } finally { conn.release(); }
});

app.delete('/api/informes/:id', async (req, res) => {
    const requester_group = req.query.requester_group;
    const mes = req.query.mes;
    
    // 1. Verificamos permisos
    if (requester_group != 0) return res.status(403).json({ ok: false, msg: 'Acceso denegado.' });
    
    // 2. Verificamos que el mes no esté cerrado
    if(mes) {
        const [cierre] = await pool.query("SELECT * FROM cierres WHERE mes = ?", [mes]);
        if (cierre.length > 0) return res.status(400).json({ ok: false, msg: `El mes de ${mes} está cerrado.` });
    }
    
    try { 
        // 3. Averiguamos de quién es este informe ANTES de borrarlo
        const [informe] = await pool.query("SELECT publicador_id FROM informes WHERE id = ?", [req.params.id]);
        
        if (informe.length === 0) {
            return res.status(404).json({ ok: false, msg: "Informe no encontrado." });
        }
        
        const publicadorId = informe[0].publicador_id;

        // 4. Borramos el informe de la base de datos
        await pool.query('DELETE FROM informes WHERE id = ?', [req.params.id]); 
        
        // 5. ¡LA MAGIA! Restablecemos el estado del publicador a 'NO'
        await pool.query("UPDATE publicadores SET informo = 'NO' WHERE id = ?", [publicadorId]);

        res.json({ ok: true, msg: "Informe eliminado y estado de INFO restablecido a NO." }); 
        
    } catch (error) { 
        res.status(500).json({ ok: false, msg: error.message }); 
    }
});

// >>> NUEVO: API PARA RESUMEN DEL REPORTE (DATOS S-21) <<<
app.get('/api/reportes/resumen', async (req, res) => {
    const { mes, grupo } = req.query;
    try {
        let params = [];
        let whereGrp = "";
        
        // Si se filtra por grupo, ajustamos las consultas
        if (grupo && grupo != '0' && grupo != '9') {
            whereGrp = " AND grupo = ?";
            params.push(grupo);
        }

        // 1. Total Publicadores Activos
        const [rowsPubs] = await pool.query(`SELECT COUNT(*) as total FROM publicadores WHERE activo = 1 ${whereGrp}`, params);
        const totalActivos = rowsPubs[0].total;

        // 2. Promedio Asistencia (Solo Fin de Semana del mes actual)
        // Nota: Asume que hay una fila en 'reuniones' para ese mes y tipo 'FIN DE SEMANA'
        const [rowsReu] = await pool.query(`SELECT * FROM reuniones WHERE mes = ? AND tipo = 'FIN DE SEMANA'`, [mes]);
        let promedioAsis = 0;
        if (rowsReu.length > 0) {
            const r = rowsReu[0];
            const sum = (r.sem1||0) + (r.sem2||0) + (r.sem3||0) + (r.sem4||0) + (r.sem5||0);
            // Contamos cuántas semanas tuvieron dato > 0
            let count = 0;
            if(r.sem1 > 0) count++; if(r.sem2 > 0) count++; if(r.sem3 > 0) count++; if(r.sem4 > 0) count++; if(r.sem5 > 0) count++;
            if(count > 0) promedioAsis = Math.round(sum / count);
        }

        // 3. Totales por Privilegio (Publicadores, Auxiliares, Regulares)
        // Usamos paramsMes porque necesitamos filtrar por MES y GRUPO
        let paramsStats = [mes];
        if (grupo && grupo != '0' && grupo != '9') paramsStats.push(grupo);

        const [rowsStats] = await pool.query(`
            SELECT 
                priv3, 
                COUNT(*) as cant, 
                SUM(horas) as horas, 
                SUM(cursos) as cursos 
            FROM informes 
            WHERE mes = ? ${whereGrp.replace('AND', 'AND')} 
            GROUP BY priv3
        `, paramsStats);

        // Procesar los datos para agrupar (PUB+PNB) y (AUX+AUX I+AUX M)
        let stats = {
            pub: { cant: 0, horas: 0, cursos: 0 },
            aux: { cant: 0, horas: 0, cursos: 0 },
            reg: { cant: 0, horas: 0, cursos: 0 }
        };

        rowsStats.forEach(row => {
            const p = row.priv3.toUpperCase();
            if (p === 'REG' || p === 'ESP') {
                stats.reg.cant += row.cant;
                stats.reg.horas += row.horas || 0;
                stats.reg.cursos += row.cursos || 0;
            } else if (p.includes('AUX')) { // AUX, AUX I, AUX M
                stats.aux.cant += row.cant;
                stats.aux.horas += row.horas || 0;
                stats.aux.cursos += row.cursos || 0;
            } else { // PUB, PNB
                stats.pub.cant += row.cant;
                stats.pub.horas += row.horas || 0; // Aunque PUB no reporta horas, por si acaso
                stats.pub.cursos += row.cursos || 0;
            }
        });

        res.json({
            activos: totalActivos,
            asistencia: promedioAsis,
            detalles: stats
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// >>> NUEVO ENDPOINT LIGERO PARA DATOS EXTRA DEL PDF (SOPORTA 'TODOS' LOS MESES) <<<
app.get('/api/reportes/datos-extra', async (req, res) => {
    const { mes, grupo } = req.query;
    try {
        let paramsPubs = [];
        let whereGrp = "";
        
        // Filtro de Grupo para Publicadores
        if (grupo && grupo != '0' && grupo != '9') {
            whereGrp = " AND grupo = ?";
            paramsPubs.push(grupo);
        }

        // 1. Total Publicadores Activos (Siempre es el total actual)
        const [rowsPubs] = await pool.query(`SELECT COUNT(*) as total FROM publicadores WHERE activo = 1 ${whereGrp}`, paramsPubs);
        
        // 2. Promedio Asistencia (Dinámico: Mes específico o Todo el año)
        let sqlReu = "SELECT * FROM reuniones WHERE tipo = 'FIN DE SEMANA'";
        let paramsReu = [];

        // Solo filtramos por mes si el usuario seleccionó uno específico
        if (mes && mes !== '' && mes !== 'TODOS') {
            sqlReu += " AND mes = ?";
            paramsReu.push(mes);
        }

        const [rowsReu] = await pool.query(sqlReu, paramsReu);
        
        let promedioAsis = 0;
        
        if (rowsReu.length > 0) {
            let sumTotal = 0;
            let weeksTotal = 0;

            // Sumamos TODO lo que encuentre (sea 1 mes o 12 meses)
            rowsReu.forEach(r => {
                const s1 = parseInt(r.sem1) || 0;
                const s2 = parseInt(r.sem2) || 0;
                const s3 = parseInt(r.sem3) || 0;
                const s4 = parseInt(r.sem4) || 0;
                const s5 = parseInt(r.sem5) || 0;
                
                sumTotal += (s1 + s2 + s3 + s4 + s5);

                if(s1 > 0) weeksTotal++;
                if(s2 > 0) weeksTotal++;
                if(s3 > 0) weeksTotal++;
                if(s4 > 0) weeksTotal++;
                if(s5 > 0) weeksTotal++;
            });
            
            if (weeksTotal > 0) {
                promedioAsis = Math.round(sumTotal / weeksTotal);
            }
        }

        res.json({
            activos: rowsPubs[0].total,
            asistencia: promedioAsis
        });

    } catch (error) { res.status(500).json({ error: error.message }); }
});

// >>> REPORTE ESPECIAL: PROGRESO PRECURSORES (CON CRÉDITO DE HORAS) <<<
app.get('/api/reportes/precursores', async (req, res) => {
    const { tipo } = req.query; // 'REG' o 'AUX'
    try {
        let wherePriv = "";
        // Definimos los privilegios a buscar
        if (tipo === 'REG') {
            wherePriv = "priv3 IN ('REG', 'ESP', 'MISIONERO')"; 
        } else {
            wherePriv = "priv3 IN ('AUX', 'AUX I', 'AUX M')";
        }

        // 1. Obtener Publicadores Activos de ese tipo (HOY)
        const [pubs] = await pool.query(`
            SELECT id, nombre, grupo, priv3 
            FROM publicadores 
            WHERE activo = 1 AND (${wherePriv}) 
            ORDER BY grupo ASC, nombre ASC
        `);

        if (pubs.length === 0) return res.json([]);

        // 2. Obtener sus informes FILTRADOS POR EL PRIVILEGIO
        // AHORA TRAEMOS TAMBIÉN "credito_hrs"
        const [informes] = await pool.query(`
            SELECT publicador_id, mes, horas, credito_hrs 
            FROM informes 
            WHERE publicador_id IN (SELECT id FROM publicadores WHERE activo=1 AND (${wherePriv}))
            AND (${wherePriv}) 
            ORDER BY FIELD(mes, 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE', 'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO')
        `);

        // 3. Cruzar datos
        const data = pubs.map(p => {
            const misInformes = informes.filter(r => r.publicador_id === p.id);
            
            // Calcular Total: Suma Horas normales + Crédito de horas
            const totalHoras = misInformes.reduce((sum, r) => sum + (parseFloat(r.horas) || 0) + (parseFloat(r.credito_hrs) || 0), 0);
            
            return {
                nombre: p.nombre,
                grupo: p.grupo,
                priv: p.priv3,
                informes: misInformes.map(i => ({ 
                    mes: i.mes.substring(0,3), 
                    horas: i.horas,
                    credito_hrs: i.credito_hrs // Enviamos el crédito al frontend
                })),
                total: totalHoras
            };
        });

        res.json(data);

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// >>> NUEVO ENDPOINT: REPORTE DETALLADO DE CURSOS (TIENEN VS NO TIENEN) <<<
app.get('/api/reportes/detalle-cursos', async (req, res) => {
    const { grupo } = req.query;
    try {
        let whereGrp = "";
        let params = [];
        
        if (grupo && grupo != '0' && grupo != '9') {
            whereGrp = " AND p.grupo = ?";
            params.push(grupo);
        }

        const query = `
            SELECT 
                p.id, 
                p.nombre, 
                p.grupo,
                GROUP_CONCAT(CASE WHEN i.cursos > 0 THEN i.mes ELSE NULL END SEPARATOR ', ') as meses_con_cursos,
                SUM(CASE WHEN i.cursos > 0 THEN 1 ELSE 0 END) as total_meses
            FROM publicadores p
            LEFT JOIN informes i ON p.id = i.publicador_id
            WHERE p.activo = 1 ${whereGrp}
            GROUP BY p.id
            ORDER BY p.grupo ASC, p.nombre ASC
        `;

        const [rows] = await pool.query(query, params);

        // 👇 CORRECCIÓN: Usamos Number() para forzar la conversión, sin importar si MySQL lo manda como texto o número
        const conducen = rows.filter(r => Number(r.total_meses) > 0).map(r => ({
            grupo: r.grupo,
            nombre: r.nombre,
            meses: r.meses_con_cursos 
        }));

        const noConducen = rows.filter(r => Number(r.total_meses) === 0 || !r.total_meses).map(r => ({
            grupo: r.grupo,
            nombre: r.nombre
        }));

        res.json({
            totales: {
                conducen: conducen.length,
                no_conducen: noConducen.length
            },
            conducen: conducen,
            no_conducen: noConducen
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// >>> ENDPOINT: OBTENER DATOS ANUALES PARA TARJETA S-21 <<<
app.get('/api/publicador/:id/tarjeta', async (req, res) => {
    const { id } = req.params;
    try {
        // 1. Obtener datos del publicador
        const [pub] = await pool.query("SELECT * FROM publicadores WHERE id = ?", [id]);
        if (pub.length === 0) return res.status(404).json({ error: "Publicador no encontrado" });

        // 2. Obtener sus informes (Agregamos "priv3" y "predico" a la consulta)
        const [informes] = await pool.query("SELECT mes, horas, cursos, comentarios, priv3, predico FROM informes WHERE publicador_id = ?", [id]);

        res.json({
            publicador: pub[0],
            informes: informes
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// >>> ENDPOINT PARA REABRIR MES <<<
app.post('/api/reabrir-mes', async (req, res) => {
    const { mes, requester_group } = req.body;

    // Medida de seguridad: Solo el Admin (Grupo 0) puede hacer esto
    if (requester_group != 0) {
        return res.status(403).json({ ok: false, msg: "No tienes permiso para reabrir meses." });
    }

    try {
        // 1. Borramos el registro del mes cerrado 
        // (⚠️ Cambia "cierres" por el nombre real de tu tabla si es distinto, ej: meses_cerrados)
        await pool.query("DELETE FROM cierres WHERE mes = ?", [mes]);

        // 2. Como pediste: Se marca "SI" en la columna informo de TODOS los publicadores
        await pool.query("UPDATE publicadores SET informo = 'SI'");

        res.json({ ok: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ ok: false, msg: "Error al reabrir el mes." });
    }
});

// --- REPORTES y OTROS ---
app.post('/api/reportes/advanced', async (req, res) => { const { mes, grupo, nombre, priv3 } = req.body; try { let query = `SELECT i.*, p.nombre as nombre_publicador FROM informes i LEFT JOIN publicadores p ON i.publicador_id = p.id WHERE 1=1`; const params = []; if (mes) { query += " AND i.mes = ?"; params.push(mes); } if (grupo) { query += " AND i.grupo = ?"; params.push(grupo); } if (priv3) { if (priv3 === 'AUX_COMBINED') query += " AND i.priv3 IN ('AUX', 'AUX I', 'AUX M')"; else if (priv3 === 'PUB_COMBINED') query += " AND i.priv3 IN ('PUB', 'PNB')"; else { query += " AND i.priv3 = ?"; params.push(priv3); } } if (nombre) { query += " AND p.nombre LIKE ?"; params.push(`%${nombre}%`); } query += ` ORDER BY FIELD(i.mes, 'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE') ASC, i.grupo ASC, p.nombre ASC`; const [rows] = await pool.query(query, params); res.json(rows); } catch (error) { res.status(500).json({ error: error.message }); } });
app.get('/api/reuniones', async (req, res) => { try { let query = "SELECT * FROM reuniones"; const params = []; if (req.query.mes && req.query.mes !== 'TODOS') { query += " WHERE mes = ?"; params.push(req.query.mes); } query += ` ORDER BY FIELD(mes, 'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE') ASC, tipo ASC, modalidad ASC`; const [rows] = await pool.query(query, params); res.json(rows); } catch (error) { res.status(500).json({ error: error.message }); } });
app.post('/api/reuniones', async (req, res) => { const { mes, tipo, modalidad, sem1, sem2, sem3, sem4, sem5, requester_group } = req.body; if (requester_group != 0) return res.status(403).json({ ok: false, msg: 'No tienes permiso.' }); try { await pool.query('INSERT INTO reuniones (mes, tipo, modalidad, sem1, sem2, sem3, sem4, sem5) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [mes, tipo, modalidad, sem1||0, sem2||0, sem3||0, sem4||0, sem5||0]); res.json({ ok: true }); } catch (error) { res.status(500).json({ ok: false, msg: error.message }); } });
app.put('/api/reuniones/:id', async (req, res) => { const { sem1, sem2, sem3, sem4, sem5, requester_group } = req.body; if (requester_group != 0) return res.status(403).json({ ok: false, msg: 'No tienes permiso.' }); try { await pool.query('UPDATE reuniones SET sem1=?, sem2=?, sem3=?, sem4=?, sem5=? WHERE id=?', [sem1||0, sem2||0, sem3||0, sem4||0, sem5||0, req.params.id]); res.json({ ok: true }); } catch (error) { res.status(500).json({ ok: false, msg: error.message }); } });
app.delete('/api/reuniones/:id', async (req, res) => { const requester_group = req.query.requester_group; if (requester_group != 0) return res.status(403).json({ ok: false, msg: 'Acceso denegado.' }); try { await pool.query('DELETE FROM reuniones WHERE id = ?', [req.params.id]); res.json({ ok: true }); } catch (error) { res.status(500).json({ ok: false, msg: error.message }); } });
app.get('/api/usuarios', async (req, res) => { try { const [rows] = await pool.query('SELECT id, nombre, grupo, correo, password FROM usuarios ORDER BY grupo ASC'); res.json(rows); } catch (error) { res.status(500).json({ error: error.message }); } });
app.post('/api/usuarios', async (req, res) => { const { nombre, grupo, correo, password } = req.body; try { await pool.query('INSERT INTO usuarios (nombre, grupo, correo, password) VALUES (?, ?, ?, ?)', [nombre, grupo, correo, password]); res.json({ ok: true }); } catch (error) { res.status(500).json({ ok: false, msg: error.message }); } });
app.delete('/api/usuarios/:id', async (req, res) => { try { await pool.query('DELETE FROM usuarios WHERE id = ?', [req.params.id]); res.json({ ok: true }); } catch (error) { res.status(500).json({ ok: false, msg: error.message }); } });
app.put('/api/usuarios/:id', async (req, res) => { const { nombre, grupo, correo, password } = req.body; try { await pool.query('UPDATE usuarios SET nombre=?, grupo=?, correo=?, password=? WHERE id=?', [nombre, grupo, correo, password, req.params.id]); res.json({ ok: true }); } catch (error) { res.status(500).json({ ok: false, msg: error.message }); } });

app.listen(PORT, () => { console.log(`🚀 Sistema corriendo en http://localhost:${PORT}`); });