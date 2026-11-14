// Migración (ejecutar UNA vez en bases de datos ya existentes):
//   node scripts/migrar_indice_reuniones.js
// Crea el índice único uq_reunion (mes, tipo, modalidad, anio_servicio) en la tabla `reuniones`
// para impedir registros duplicados. Si ya hay duplicados, los muestra y NO modifica nada.
require('dotenv').config({ quiet: true });
const mysql = require('mysql2/promise');

(async () => {
    const c = await mysql.createConnection({
        host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER,
        password: process.env.DB_PASSWORD, database: process.env.DB_NAME, ssl: { rejectUnauthorized: true }
    });
    try {
        const [existe] = await c.query("SHOW INDEX FROM reuniones WHERE Key_name = 'uq_reunion'");
        if (existe.length > 0) { console.log('✅ El índice uq_reunion ya existe. Nada que hacer.'); return; }
        const [dups] = await c.query('SELECT mes, tipo, modalidad, anio_servicio, COUNT(*) AS n FROM reuniones GROUP BY mes, tipo, modalidad, anio_servicio HAVING COUNT(*) > 1');
        if (dups.length > 0) {
            console.log('⚠️ Hay registros duplicados. Corrígelos (edita o elimina) desde la vista de Reuniones y vuelve a ejecutar:');
            console.table(dups);
            process.exitCode = 1; return;
        }
        await c.query('ALTER TABLE reuniones ADD UNIQUE KEY uq_reunion (mes, tipo, modalidad, anio_servicio)');
        console.log('✅ Índice uq_reunion creado.');
    } finally { await c.end(); }
})().catch(e => { console.error('❌ Error:', e.code || e.message); process.exit(1); });
