require('dotenv').config();
const express = require('express');
const path = require('path');
const { autenticar, filtroGrupo } = require('./lib/auth'); // valida JWT_SECRET al cargar

const app = express();
const PORT = process.env.PORT || 3000;

// Detrás de un proxy (Render, Railway, Nginx...) define TRUST_PROXY=1 para que req.ip sea la IP real del cliente
if (process.env.TRUST_PROXY) app.set('trust proxy', /^\d+$/.test(process.env.TRUST_PROXY) ? parseInt(process.env.TRUST_PROXY) : process.env.TRUST_PROXY);
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Login (público, con limitador de intentos)
app.use(require('./routes/auth'));

// Todo lo demás de /api exige token válido y fuerza el grupo del encargado
app.use('/api', autenticar);
app.use('/api', filtroGrupo);

app.use(require('./routes/cierres'));        // mes activo y cierres
app.use(require('./routes/dashboard'));
app.use(require('./routes/publicadores'));
app.use(require('./routes/informes'));
app.use(require('./routes/reportes'));       // reportes, totales S-21 y tarjetas
app.use(require('./routes/reuniones'));
app.use(require('./routes/territorios'));    // catálogo, conductores, turnos, bitácora y S-13
app.use(require('./routes/usuarios'));

if (require.main === module) {
    app.listen(PORT, () => { console.log(`🚀 Sistema corriendo en http://localhost:${PORT}`); });
}
module.exports = app;
