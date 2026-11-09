require('dotenv').config();
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const dbConfig = {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: true } // Obligatorio para TiDB Cloud
};

const tables = [
    `CREATE TABLE IF NOT EXISTS grupos (
        id INT NOT NULL PRIMARY KEY,
        nombre VARCHAR(50) NOT NULL,
        encargado_sg VARCHAR(100) DEFAULT NULL,
        encargado_axg VARCHAR(100) DEFAULT NULL,
        estado ENUM('ACTIVO','INACTIVO') DEFAULT 'ACTIVO'
    )`,
    `CREATE TABLE IF NOT EXISTS usuarios (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nombre VARCHAR(100),
        grupo INT NOT NULL,
        priv1 VARCHAR(50),
        correo VARCHAR(100) UNIQUE,
        password VARCHAR(255) NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS publicadores (
        id INT AUTO_INCREMENT PRIMARY KEY,
        grupo INT DEFAULT NULL,
        priv1 VARCHAR(10) DEFAULT NULL,
        priv2 VARCHAR(10) DEFAULT NULL,
        priv3 VARCHAR(10) DEFAULT NULL,
        nombre VARCHAR(150) DEFAULT NULL,
        comentario TEXT DEFAULT NULL,
        activo TINYINT(1) DEFAULT 1,
        fecha_ingreso DATE DEFAULT NULL,
        fecha_nacimiento DATE DEFAULT NULL,
        fecha_bautismo DATE DEFAULT NULL,
        sexo VARCHAR(15) DEFAULT 'Hombre',
        esperanza VARCHAR(20) DEFAULT 'Otras ovejas',
        privilegio_s21 VARCHAR(50) DEFAULT NULL,
        KEY fk_publicador_grupo (grupo),
        CONSTRAINT fk_publicador_grupo FOREIGN KEY (grupo) REFERENCES grupos (id) ON DELETE RESTRICT ON UPDATE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS informes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        mes VARCHAR(20),
        grupo INT NOT NULL,
        publicador_id INT,
        publicador_nombre VARCHAR(150),
        priv1 VARCHAR(10),
        priv2 VARCHAR(10),
        priv3 VARCHAR(10),
        horas DECIMAL(5,1),
        cursos INT,
        predico ENUM('SI', 'NO'),
        comentarios TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        credito_hrs DECIMAL(5,2) DEFAULT 0,
        anio_servicio INT DEFAULT 2026,
        UNIQUE KEY uq_informe_pub_mes (publicador_id, mes, anio_servicio)
    )`,
    `CREATE TABLE IF NOT EXISTS cierres (
        id INT AUTO_INCREMENT PRIMARY KEY,
        mes VARCHAR(20) DEFAULT NULL,
        fecha_cierre TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        anio_servicio INT DEFAULT 2026,
        UNIQUE KEY idx_mes_anio (mes, anio_servicio)
    )`,
    `CREATE TABLE IF NOT EXISTS reuniones (
        id INT AUTO_INCREMENT PRIMARY KEY,
        mes VARCHAR(20) DEFAULT NULL,
        tipo ENUM('ENTRE SEMANA','FIN DE SEMANA') DEFAULT NULL,
        modalidad ENUM('PRESENCIAL','ZOOM') DEFAULT NULL,
        sem1 INT DEFAULT 0,
        sem2 INT DEFAULT 0,
        sem3 INT DEFAULT 0,
        sem4 INT DEFAULT 0,
        sem5 INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        anio_servicio INT DEFAULT 2026
    )`,
    `CREATE TABLE IF NOT EXISTS territorios (
        id INT AUTO_INCREMENT PRIMARY KEY,
        numero VARCHAR(20) NOT NULL,
        nombre VARCHAR(150) DEFAULT '',
        cantidad_manzanas INT NOT NULL DEFAULT 1,
        activo TINYINT(1) DEFAULT 1,
        UNIQUE KEY uq_territorio_numero (numero)
    )`,
    `CREATE TABLE IF NOT EXISTS conductores (
        id INT AUTO_INCREMENT PRIMARY KEY,
        publicador_id INT DEFAULT NULL,
        nombre VARCHAR(150) NOT NULL,
        activo TINYINT(1) DEFAULT 1
    )`,
    `CREATE TABLE IF NOT EXISTS turnos_predicacion (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nombre VARCHAR(80) NOT NULL,
        horario VARCHAR(80) DEFAULT '',
        activo TINYINT(1) DEFAULT 1
    )`,
    `CREATE TABLE IF NOT EXISTS bitacora_territorios (
        id INT AUTO_INCREMENT PRIMARY KEY,
        fecha_registro DATE DEFAULT NULL,
        fecha DATE NOT NULL,
        fecha_cierre DATE DEFAULT NULL,
        territorio_id INT NOT NULL,
        manzanas VARCHAR(255) NOT NULL,
        estado_manzanas ENUM('COMPLETO','INCOMPLETO') NOT NULL DEFAULT 'COMPLETO',
        manzanas_detalle TEXT DEFAULT NULL,
        turno_id INT DEFAULT NULL,
        turno_nombre VARCHAR(80) NOT NULL,
        conductor_id INT DEFAULT NULL,
        conductor_nombre VARCHAR(150) NOT NULL,
        estado_territorio ENUM('INICIO','AVANCE','EN CURSO','CIERRE','INICIO - CIERRE') NOT NULL DEFAULT 'INICIO',
        ciclo INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        KEY idx_terr_ciclo (territorio_id, ciclo)
    )`
];

const seedGroups = `
INSERT IGNORE INTO grupos (id, nombre, estado) VALUES
(1, 'Grupo 1', 'ACTIVO'),
(2, 'Grupo 2', 'ACTIVO'),
(3, 'Grupo 3', 'ACTIVO'),
(4, 'Grupo 4', 'ACTIVO'),
(5, 'Grupo 5', 'ACTIVO'),
(6, 'Grupo 6', 'ACTIVO'),
(7, 'Grupo 7', 'ACTIVO'),
(8, 'Grupo 8', 'ACTIVO');
`;

async function setup() {
    try {
        console.log("📡 Conectando a TiDB Cloud...");
        const connection = await mysql.createConnection(dbConfig);
        console.log("✅ ¡Conexión exitosa!");

        console.log("🛠 Creando tablas...");
        for (const sql of tables) {
            await connection.query(sql);
            console.log(" - Tabla verificada.");
        }

        console.log("🌱 Insertando grupos base...");
        await connection.query(seedGroups);

        console.log("🌱 Insertando usuarios iniciales (contraseñas cifradas con bcrypt)...");
        const defaultPass = process.env.SEED_DEFAULT_PASSWORD || '123456';
        const hash = await bcrypt.hash(defaultPass, 10);
        const seedUsers = [
            ['Admin General', 0, 'Admin', 'admin@correo.com', hash],
            ['Encargado G1', 1, 'Encargado', 'grupo1@correo.com', hash],
            ['Encargado G2', 2, 'Encargado', 'grupo2@correo.com', hash],
            ['Encargado G3', 3, 'Encargado', 'grupo3@correo.com', hash],
            ['Encargado G4', 4, 'Encargado', 'grupo4@correo.com', hash],
            ['Encargado G5', 5, 'Encargado', 'grupo5@correo.com', hash],
            ['Encargado G6', 6, 'Encargado', 'grupo6@correo.com', hash],
            ['Encargado G7', 7, 'Encargado', 'grupo7@correo.com', hash],
            ['Encargado G8', 8, 'Encargado', 'grupo8@correo.com', hash]
        ];
        for (const u of seedUsers) {
            await connection.query(
                'INSERT IGNORE INTO usuarios (nombre, grupo, priv1, correo, password) VALUES (?, ?, ?, ?, ?)',
                u
            );
        }

        console.log("🚀 ¡Base de Datos configurada correctamente!");
        await connection.end();
    } catch (e) {
        console.error("❌ Error:", e.message);
        process.exit(1);
    }
}

setup();
