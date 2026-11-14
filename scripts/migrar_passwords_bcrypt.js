// Convierte a bcrypt las contraseñas que aún estén guardadas en texto plano (heredadas de versiones anteriores).
// Los usuarios NO notan nada: siguen entrando con la misma contraseña.
//
//   node scripts/migrar_passwords_bcrypt.js            -> solo cuenta cuántas faltan (no modifica nada)
//   node scripts/migrar_passwords_bcrypt.js --aplicar  -> convierte y guarda los hashes
//
// Es seguro repetirlo: ignora las que ya están cifradas. Nunca imprime contraseñas.
require('dotenv').config({ quiet: true });
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const esHash = (v) => typeof v === 'string' && /^\$2[aby]\$/.test(v);
const aplicar = process.argv.includes('--aplicar');

(async () => {
    const c = await mysql.createConnection({
        host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER,
        password: process.env.DB_PASSWORD, database: process.env.DB_NAME, ssl: { rejectUnauthorized: true }
    });
    try {
        const [usuarios] = await c.query('SELECT id, nombre, password FROM usuarios');
        const pendientes = usuarios.filter(u => !esHash(u.password));
        console.log(`Usuarios: ${usuarios.length} | ya cifrados: ${usuarios.length - pendientes.length} | en texto plano: ${pendientes.length}`);
        if (pendientes.length === 0) { console.log('✅ Nada que migrar.'); return; }
        if (!aplicar) {
            console.log('Pendientes:', pendientes.map(u => `#${u.id} ${u.nombre}`).join(', '));
            console.log('Para convertirlas ejecuta de nuevo con --aplicar');
            return;
        }
        for (const u of pendientes) {
            // Mismo criterio que el login: se guarda el hash de la contraseña sin espacios sobrantes
            await c.query('UPDATE usuarios SET password = ? WHERE id = ?', [await bcrypt.hash(String(u.password).trim(), 10), u.id]);
        }
        console.log(`✅ ${pendientes.length} contraseña(s) convertida(s) a bcrypt.`);
    } finally { await c.end(); }
})().catch(e => { console.error('❌ Error:', e.code || e.message); process.exit(1); });
