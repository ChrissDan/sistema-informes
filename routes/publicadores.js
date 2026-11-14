const express = require('express');
const pool = require('../lib/db');
const { MSG_TELEFONO, telefonoValido, limpiarTelefono, parseIds, MESES_ORDER, msgErr } = require('../lib/constantes');
const { getMesActivo, pendienteSQL } = require('../lib/mes');

const router = express.Router();

// --- PUBLICADORES (Directorio Global) ---
router.get('/api/publicadores', async (req, res) => {
    const { grupo, pendientes, nombre, priv3, sin_informe_mes, anio_servicio } = req.query;
    try {
        // 'informo_mes' se calcula con los informes reales del mes activo (ya no se guarda una marca)
        const act = await getMesActivo(pool);
        let query = "SELECT publicadores.*, IF(EXISTS(SELECT 1 FROM informes i WHERE i.publicador_id = publicadores.id AND i.mes = ? AND i.anio_servicio = ?), 'SI', 'NO') AS informo_mes, EXISTS(SELECT 1 FROM conductores c WHERE c.publicador_id = publicadores.id AND c.activo = 1) AS es_conductor, EXISTS(SELECT 1 FROM usuarios u WHERE u.publicador_id = publicadores.id) AS es_usuario FROM publicadores WHERE 1=1";
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
        const ids = parseIds(req.query.publicador_ids); if (ids) { query += " AND publicadores.id IN (?)"; params.push(ids); }
        if (nombre && nombre !== '') { query += " AND LOWER(nombre) LIKE ?"; params.push(`%${String(nombre).toLowerCase()}%`); }
        query += " ORDER BY activo DESC, grupo ASC, nombre ASC";
        const [rows] = await pool.query(query, params); res.json(rows);
    } catch (error) { res.status(500).json({ error: msgErr(error) }); }
});

const esVerdadero = (v) => v === true || v === 'true' || v === 'on' || v === 1 || v === '1';
// "Puede ser conductor": crea/activa o desactiva el conductor vinculado a este publicador (undefined = no tocar)
async function sincronizarConductor(pubId, nombre, esConductor) {
    if (esConductor === undefined) return;
    const [rows] = await pool.query('SELECT id FROM conductores WHERE publicador_id = ?', [pubId]);
    if (esConductor) {
        if (rows.length) await pool.query('UPDATE conductores SET nombre = ?, activo = 1 WHERE publicador_id = ?', [nombre, pubId]);
        else await pool.query('INSERT INTO conductores (publicador_id, nombre, activo) VALUES (?, ?, 1)', [pubId, nombre]);
    } else if (rows.length) {
        await pool.query('UPDATE conductores SET activo = 0 WHERE publicador_id = ?', [pubId]);
    }
}

router.post('/api/publicadores', async (req, res) => {
    const { grupo, nombre, priv1, priv2, priv3, comentario, fecha_ingreso, fecha_nacimiento, fecha_bautismo, sexo, esperanza, privilegio_s21 } = req.body;
    if (req.user.grupo != 0) return res.status(403).json({ ok: false, msg: 'Solo Admin puede crear.' });
    if (!telefonoValido(req.body.telefono)) return res.status(400).json({ ok: false, msg: MSG_TELEFONO });
    try {
        const fechaFinal = fecha_ingreso ? fecha_ingreso : new Date();
        const fNac = fecha_nacimiento ? fecha_nacimiento : null;
        const fBau = fecha_bautismo ? fecha_bautismo : null;
        const [r] = await pool.query(
            'INSERT INTO publicadores (grupo, nombre, priv1, priv2, priv3, comentario, activo, fecha_ingreso, fecha_nacimiento, fecha_bautismo, sexo, esperanza, privilegio_s21, telefono) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)',
            [grupo, nombre, priv1, priv2, priv3, comentario, fechaFinal, fNac, fBau, sexo || 'Hombre', esperanza || 'Otras ovejas', privilegio_s21 || '', limpiarTelefono(req.body.telefono)]
        );
        await sincronizarConductor(r.insertId, nombre, req.body.es_conductor === undefined ? undefined : esVerdadero(req.body.es_conductor));
        res.json({ ok: true });
    } catch (error) {
        res.status(500).json({ ok: false, msg: msgErr(error) });
    }
});

router.put('/api/publicadores/:id', async (req, res) => {
    const { nombre, priv1, priv2, priv3, comentario, grupo, fecha_ingreso, fecha_nacimiento, fecha_bautismo, sexo, esperanza, privilegio_s21 } = req.body;
    if (req.user.grupo != 0) return res.status(403).json({ ok: false, msg: 'Acceso denegado.' });
    if (!telefonoValido(req.body.telefono)) return res.status(400).json({ ok: false, msg: MSG_TELEFONO });
    try {
        const fNac = fecha_nacimiento ? fecha_nacimiento : null;
        const fBau = fecha_bautismo ? fecha_bautismo : null;
        await pool.query(
            'UPDATE publicadores SET nombre=?, priv1=?, priv2=?, priv3=?, comentario=?, grupo=?, fecha_ingreso=?, fecha_nacimiento=?, fecha_bautismo=?, sexo=?, esperanza=?, privilegio_s21=?, telefono=? WHERE id=?',
            [nombre, priv1, priv2, priv3, comentario, grupo, fecha_ingreso, fNac, fBau, sexo || 'Hombre', esperanza || 'Otras ovejas', privilegio_s21 || '', limpiarTelefono(req.body.telefono), req.params.id]
        );
        await sincronizarConductor(req.params.id, nombre, req.body.es_conductor === undefined ? undefined : esVerdadero(req.body.es_conductor));
        res.json({ ok: true });
    } catch (error) {
        res.status(500).json({ ok: false, msg: msgErr(error) });
    }
});

router.patch('/api/publicadores/:id/estado', async (req, res) => { /* Igual */ const { activo, requester_group } = req.body; if (req.user.grupo != 0) return res.status(403).json({ ok: false, msg: 'Solo Admin puede cambiar estado.' }); try { await pool.query('UPDATE publicadores SET activo = ? WHERE id = ?', [activo ? 1 : 0, req.params.id]); res.json({ ok: true }); } catch (error) { res.status(500).json({ ok: false, msg: msgErr(error) }); }});
router.delete('/api/publicadores/:id', async (req, res) => { /* Igual */ const requester_group = req.query.requester_group; if (req.user.grupo != 0) return res.status(403).json({ ok: false, msg: 'Acceso denegado.' }); try { const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM informes WHERE publicador_id = ?', [req.params.id]); if (n > 0) return res.status(400).json({ ok: false, msg: `Tiene ${n} informe(s) registrado(s). Para conservar el historial, desactívalo en lugar de eliminarlo (o borra sus informes primero).` }); await pool.query('UPDATE usuarios SET publicador_id = NULL WHERE publicador_id = ?', [req.params.id]); await pool.query('UPDATE conductores SET publicador_id = NULL WHERE publicador_id = ?', [req.params.id]); await pool.query('DELETE FROM publicadores WHERE id = ?', [req.params.id]); res.json({ ok: true }); } catch (error) { if(error.code === 'ER_ROW_IS_REFERENCED_2') res.status(400).json({ ok: false, msg: 'Borra sus informes primero.' }); else res.status(500).json({ ok: false, msg: msgErr(error) }); }});

router.get('/api/check-inactivos', async (req, res) => {
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

module.exports = router;
