const express = require('express');
const pool = require('../lib/db');
const { parseIds, ordenMesSQL, msgErr, PRIV_CON_HORAS, metaHorasPriv } = require('../lib/constantes');
const { claveMes, getMesActivo } = require('../lib/mes');
const { esGlobal } = require('../lib/auth');

const router = express.Router();

// --- INFORMES ---
router.get('/api/informes', async (req, res) => {
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
        const ids = parseIds(req.query.publicador_ids); if (ids) { query += " AND i.publicador_id IN (?)"; params.push(ids); }
        if (nombre && nombre !== '') { query += " AND LOWER(p.nombre) LIKE ?"; params.push(`%${String(nombre).toLowerCase()}%`); }
        query += ` ORDER BY ${ordenMesSQL('i.mes')} DESC, i.grupo ASC, p.nombre ASC`;
        const [rows] = await pool.query(query, params); res.json(rows);
    } catch (error) { res.status(500).json({ error: msgErr(error) }); }
});

router.post('/api/informes', async (req, res) => {
    const { mes, publicador_id, horas, cursos, predico, comentarios, credito_hrs, anio_servicio } = req.body;
    // Si NO predicó, las horas son 0 automáticamente (y un precursor puede informar 0 horas); si SÍ predicó rigen las reglas de horas
    const noPredico = predico !== 'SI';
    const h = noPredico ? 0 : (parseFloat(horas) || 0); const c = parseInt(cursos) || 0; const cred = parseFloat(credito_hrs) || 0;
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
        if (!noPredico && PRIV_CON_HORAS.includes(pUpper) && h <= 0) return res.status(400).json({ ok: false, msg: `Un ${pUpper} que predicó no puede reportar 0 horas.` });
        // Meta mínima de horas de auxiliares: solo Admin/Supervisor pueden aprobar excepciones
        const meta = metaHorasPriv(pUpper);
        if (!noPredico && meta > 0 && h < meta && !esGlobal(req.user.grupo)) {
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

router.put('/api/informes/:id', async (req, res) => {
    const { horas, cursos, predico, comentarios, credito_hrs, priv3: privSolicitado } = req.body;
    const noPredico = predico !== 'SI';   // si NO predicó, las horas son 0
    let h = noPredico ? 0 : (parseFloat(horas) || 0); const c = parseInt(cursos) || 0; let cred = parseFloat(credito_hrs) || 0;
    if (h < 0 || c < 0 || cred < 0) return res.status(400).json({ ok: false, msg: 'No se permiten valores negativos.' });
    try {
        const [infOrig] = await pool.query("SELECT mes, priv1, priv2, priv3, anio_servicio, grupo, publicador_id FROM informes WHERE id = ?", [req.params.id]);
        if (infOrig.length === 0) return res.status(404).json({ ok: false, msg: "No encontrado." });
        const { mes, anio_servicio } = infOrig[0];
        let { priv1, priv2, priv3 } = infOrig[0];
        if (!esGlobal(req.user.grupo) && infOrig[0].grupo != req.user.grupo) return res.status(403).json({ ok: false, msg: 'Acceso denegado.' });
        // Un encargado solo puede editar informes del mes activo (y siempre que no esté cerrado, ver más abajo)
        if (!esGlobal(req.user.grupo)) {
            const act = await getMesActivo(pool);
            if (String(mes).trim().toUpperCase() !== act.mes || String(anio_servicio) !== act.anio_servicio) {
                return res.status(403).json({ ok: false, msg: `Solo puedes editar informes del mes activo (${act.mes} ${act.anio_servicio}).` });
            }
        }

        // Cambio de privilegio del informe: SOLO el super administrador, y solo si coincide con el privilegio que el
        // publicador tiene ahora en "Publicadores" (primero se corrige allí; así el informe y la ficha no se contradicen)
        let cambioPriv = false;
        const pedido = (privSolicitado === undefined || privSolicitado === null) ? null : String(privSolicitado).trim().toUpperCase();
        if (pedido !== null && pedido !== (priv3 || '').trim().toUpperCase()) {
            if (req.user.grupo != 0) return res.status(403).json({ ok: false, msg: 'Solo el super administrador puede cambiar el privilegio de un informe.' });
            const [pg] = await pool.query('SELECT priv1, priv2, priv3 FROM publicadores WHERE id = ?', [infOrig[0].publicador_id]);
            if (pg.length === 0) return res.status(400).json({ ok: false, msg: 'El publicador de este informe ya no existe.' });
            const actual = (pg[0].priv3 || '').trim().toUpperCase();
            if (pedido !== actual) {
                return res.status(400).json({ ok: false, msg: `En Publicadores este publicador figura como ${actual || 'sin privilegio'}. Primero cambia su privilegio en Publicadores y luego cámbialo en el informe.` });
            }
            priv1 = pg[0].priv1; priv2 = pg[0].priv2; priv3 = pg[0].priv3; cambioPriv = true;
        }
        const pUpper = (priv3 || '').trim().toUpperCase();
        // Con un privilegio nuevo, solo los precursores llevan horas y solo REG/ESP crédito
        if (cambioPriv) { if (!PRIV_CON_HORAS.includes(pUpper)) h = 0; if (!['REG', 'ESP'].includes(pUpper)) cred = 0; }

        if (!noPredico && PRIV_CON_HORAS.includes(pUpper) && h <= 0) return res.status(400).json({ ok: false, msg: `0 horas no permitido si predicó.` });
        const meta = metaHorasPriv(pUpper);
        if (!noPredico && meta > 0 && h < meta && !esGlobal(req.user.grupo)) return res.status(403).json({ ok: false, msg: `Un ${pUpper} debe reportar al menos ${meta} horas. El Secretario debe evaluarlo.` });
        if (cred > Math.max(55 - h, 0)) return res.status(400).json({ ok: false, msg: 'Límite de crédito excedido.' });
        const [cierre] = await pool.query("SELECT * FROM cierres WHERE mes = ? AND anio_servicio = ?", [mes, anio_servicio]);
        if (cierre.length > 0) return res.status(400).json({ ok: false, msg: `Mes cerrado.` });

        const pred = predico === 'SI' ? 'SI' : 'NO';
        if (cambioPriv) await pool.query('UPDATE informes SET horas=?, cursos=?, predico=?, comentarios=?, credito_hrs=?, priv1=?, priv2=?, priv3=? WHERE id=?', [h, c, pred, comentarios, cred, priv1, priv2, priv3, req.params.id]);
        else await pool.query('UPDATE informes SET horas=?, cursos=?, predico=?, comentarios=?, credito_hrs=? WHERE id=?', [h, c, pred, comentarios, cred, req.params.id]);
        res.json({ ok: true, privilegio: pUpper });
    } catch (err) { res.status(500).json({ ok: false, msg: msgErr(err) }); }
});

router.delete('/api/informes/:id', async (req, res) => {
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

module.exports = router;
