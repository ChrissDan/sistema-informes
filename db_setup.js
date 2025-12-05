require('dotenv').config();
const mysql = require('mysql2/promise');

const dbConfig = {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: true } // OBLIGATORIO para TiDB
};

const tables = [
    `CREATE TABLE IF NOT EXISTS usuarios (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nombre VARCHAR(100),
        grupo INT NOT NULL,
        priv1 VARCHAR(50),
        correo VARCHAR(100) UNIQUE,
        password VARCHAR(255) DEFAULT '123456'
    )`,
    `CREATE TABLE IF NOT EXISTS publicadores (
        id INT AUTO_INCREMENT PRIMARY KEY,
        grupo INT NOT NULL,
        priv1 VARCHAR(10),
        priv2 VARCHAR(10),
        priv3 VARCHAR(10),
        nombre VARCHAR(150),
        informo ENUM('SI', 'NO', '') DEFAULT '',
        comentario TEXT
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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`
];

const seedUsers = `
INSERT IGNORE INTO usuarios (nombre, grupo, priv1, correo) VALUES 
('Admin General', 0, 'Admin', 'admin@correo.com'),
('Encargado G1', 1, 'Encargado', 'grupo1@correo.com'),
('Encargado G2', 2, 'Encargado', 'grupo2@correo.com'),
('Encargado G3', 3, 'Encargado', 'grupo3@correo.com'),
('Encargado G4', 4, 'Encargado', 'grupo4@correo.com'),
('Encargado G5', 5, 'Encargado', 'grupo5@correo.com'),
('Encargado G6', 6, 'Encargado', 'grupo6@correo.com'),
('Encargado G7', 7, 'Encargado', 'grupo7@correo.com'),
('Encargado G8', 8, 'Encargado', 'grupo8@correo.com');
`;

async function setup() {
    try {
        console.log("📡 Conectando a TiDB Cloud...");
        const connection = await mysql.createConnection(dbConfig);
        console.log("✅ ¡Conexión exitosa!");
        
        console.log("🛠 Creando tablas...");
        for (let sql of tables) {
            await connection.query(sql);
            console.log(" - Tabla verificada.");
        }

        console.log("🌱 Insertando usuarios de prueba...");
        await connection.query(seedUsers);
        
        console.log("🚀 ¡Base de Datos configurada correctamente!");
        await connection.end();
    } catch (e) {
        console.error("❌ Error:", e.message);
    }
}

setup();