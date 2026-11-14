const express = require('express');
const pool = require('../lib/db');
const { parseIds, ordenMesSQL, msgErr } = require('../lib/constantes');
const { esGlobal, soloGlobal } = require('../lib/auth');

const router = express.Router();

// --- REPORTES ---
router.get('/api/reportes/datos-extra', async (req, res) => {
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

router.get('/api/reportes/precursores', async (req, res) => {
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

router.get('/api/reportes/detalle-cursos', async (req, res) => {
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

router.post('/api/reportes/advanced', async (req, res) => { 
    const { mes, grupo, nombre, priv3, anio_servicio } = req.body; 
    try { 
        let query = `SELECT i.*, p.nombre as nombre_publicador FROM informes i LEFT JOIN publicadores p ON i.publicador_id = p.id WHERE i.anio_servicio = ?`; 
        const params = [anio_servicio]; 
        if (mes) { query += " AND i.mes = ?"; params.push(mes); } 
        if (grupo) { query += " AND i.grupo = ?"; params.push(grupo); } 
        if (priv3) { if (priv3 === 'AUX_COMBINED') query += " AND i.priv3 IN ('AUX', 'AUX I', 'AUX M', 'AUX C')"; else if (priv3 === 'PUB_COMBINED') query += " AND i.priv3 IN ('PUB', 'PNB')"; else { query += " AND i.priv3 = ?"; params.push(priv3); } } 
        const ids = parseIds(req.body.publicador_ids); if (ids) { query += " AND i.publicador_id IN (?)"; params.push(ids); }
        if (nombre) { query += " AND LOWER(p.nombre) LIKE ?"; params.push(`%${String(nombre).toLowerCase()}%`); } 
        query += ` ORDER BY ${ordenMesSQL('i.mes')} ASC, i.grupo ASC, p.nombre ASC`; 
        const [rows] = await pool.query(query, params); res.json(rows); 
    } catch (error) { res.status(500).json({ error: msgErr(error) }); } 
});

router.get('/api/reportes/totales-s21', soloGlobal, async (req, res) => {
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

// Todas las tarjetas S-21 de un año en una sola consulta (descarga masiva en ZIP)
router.get('/api/tarjetas', soloGlobal, async (req, res) => {
    try {
        const [pubs] = await pool.query('SELECT * FROM publicadores ORDER BY grupo ASC, nombre ASC');
        const [inf] = await pool.query('SELECT publicador_id, mes, horas, credito_hrs, cursos, comentarios, priv3, predico FROM informes WHERE anio_servicio = ?', [req.query.anio_servicio]);
        const porPub = new Map();
        inf.forEach(i => { if (!porPub.has(i.publicador_id)) porPub.set(i.publicador_id, []); porPub.get(i.publicador_id).push(i); });
        res.json(pubs.map(p => ({ publicador: p, informes: porPub.get(p.id) || [] })));
    } catch (error) { res.status(500).json({ error: msgErr(error) }); }
});

router.get('/api/publicador/:id/tarjeta', async (req, res) => {
    const { id } = req.params; const { anio_servicio } = req.query;
    try {
        const [pub] = await pool.query("SELECT * FROM publicadores WHERE id = ?", [id]);
        if (pub.length === 0) return res.status(404).json({ error: "No encontrado" });
        if (!esGlobal(req.user.grupo) && pub[0].grupo != req.user.grupo) return res.status(403).json({ error: "Acceso denegado." });
        const [informes] = await pool.query("SELECT mes, horas, credito_hrs, cursos, comentarios, priv3, predico FROM informes WHERE publicador_id = ? AND anio_servicio = ?", [id, anio_servicio]);
        res.json({ publicador: pub[0], informes: informes });
    } catch (error) { res.status(500).json({ error: msgErr(error) }); }
});

module.exports = router;
