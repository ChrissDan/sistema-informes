// Esquema que necesitan las funciones nuevas (teléfono, vínculos y programas guardados).
// Se aplica SOLO UNA VEZ por instancia del servidor, de forma idempotente (si ya existe, no hace nada):
//  - publicadores.telefono   -> el teléfono de la persona (fuente única)
//  - usuarios.publicador_id  -> vincula un usuario del sistema con su ficha de publicador
//  - usuarios.telefono / conductores.telefono -> respaldo para quien NO está vinculado a un publicador
//  - programas_predicacion   -> un programa guardado por tipo (VIE_DOM / DOM_JUE)
const pool = require('./db');

async function asegurarColumna(tabla, columna, definicion) {
    const [r] = await pool.query(`SHOW COLUMNS FROM \`${tabla}\` LIKE ?`, [columna]);
    if (r.length === 0) {
        await pool.query(`ALTER TABLE \`${tabla}\` ADD COLUMN \`${columna}\` ${definicion}`);
        console.log(`🛠 Esquema: se agregó ${tabla}.${columna}`);
    }
}

async function aplicarEsquema() {
    await asegurarColumna('publicadores', 'telefono', 'VARCHAR(30) DEFAULT NULL');
    await asegurarColumna('usuarios', 'telefono', 'VARCHAR(30) DEFAULT NULL');
    await asegurarColumna('usuarios', 'publicador_id', 'INT DEFAULT NULL');
    await asegurarColumna('conductores', 'telefono', 'VARCHAR(30) DEFAULT NULL');
    await pool.query(`CREATE TABLE IF NOT EXISTS programas_predicacion (
        tipo VARCHAR(10) NOT NULL PRIMARY KEY,
        fecha_ini DATE DEFAULT NULL,
        fecha_fin DATE DEFAULT NULL,
        datos MEDIUMTEXT NOT NULL,
        actualizado_por INT DEFAULT NULL,
        actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`);
}

let promesa = null;
// Middleware: espera a que el esquema esté listo (la primera vez lo crea). Si falla, registra el error y reintenta en la siguiente petición.
async function esquemaListo(req, res, next) {
    if (!promesa) promesa = aplicarEsquema().catch((e) => { console.error('❌ No se pudo preparar el esquema:', e.message); promesa = null; });
    await promesa;
    next();
}

module.exports = { esquemaListo, aplicarEsquema };
