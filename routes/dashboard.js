const express = require('express');
const pool = require('../lib/db');
const { msgErr } = require('../lib/constantes');

const router = express.Router();

// --- DASHBOARD ---
router.get('/api/dashboard', async (req, res) => {
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

router.get('/api/dashboard/cursos-por-mes', async (req, res) => {
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

router.get('/api/dashboard/cursos', async (req, res) => {
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

router.get('/api/dashboard/cursos-comparativa', async (req, res) => {
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

router.get('/api/dashboard/asistencia-comparativa', async (req, res) => {
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

module.exports = router;
