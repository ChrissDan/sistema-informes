# Sistema de Informes de Congregación

Aplicación web para gestionar informes mensuales de servicio, directorio de publicadores, asistencia a reuniones, cierres mensuales y generación de reportes y tarjetas S-21 en PDF.

---

## Requisitos y Puesta en Marcha

1. **Instalar dependencias:**
   ```bash
   npm install
   ```
2. **Configurar variables de entorno:**
   Copia `.env.example` a `.env` y completa las credenciales de tu base de datos MySQL / TiDB Cloud y `JWT_SECRET`.
3. **Inicializar la base de datos (solo en entornos nuevos):**
   ```bash
   node db_setup.js
   ```
4. **Iniciar el servidor:**
   ```bash
   npm start
   ```
   El sistema estará disponible en `http://localhost:3000`.

---

## Arquitectura y Características Principales

### 1. Seguridad y Permisos
- **Contraseñas cifradas con `bcryptjs`**: nunca se almacenan ni se exponen en texto plano.
- **Autenticación con JWT (`jsonwebtoken`)**: sesión de 12 horas en el encabezado `Authorization: Bearer <token>`, con limitador de intentos de login por IP (máx. 25 intentos fallidos cada 5 min). `JWT_SECRET` es **obligatorio** (mín. 32 caracteres) y el rol del usuario se revalida contra la base de datos (caché de 30 s), así que eliminar o cambiar a un usuario surte efecto de inmediato.
- **Variables opcionales:** `TRUST_PROXY=1` si se despliega detrás de un proxy (para que el limitador use la IP real) y `DB_SSL_INSECURE=true` solo para depurar la conexión SSL.
- **Roles aplicados desde el servidor (`req.user.grupo`)**:
  - `grupo = 0` (**Superadmin**): acceso total, gestión de usuarios, cierres/reaperturas de mes y registro en meses pasados reabiertos.
  - `grupo = 9` (**Supervisor**): vista global de auditoría.
  - `grupo = 1..8` (**Encargados de grupo**): acceso restringido exclusivamente a los publicadores e informes de su propio grupo.

### 2. Año de Servicio, Mes Activo y Cierres
- **Año de servicio**: comprende de **septiembre a agosto** (ej. Septiembre 2025 – Agosto 2026 corresponde al año de servicio `2026`).
- **Regla del Mes Activo (`GET /api/mes-activo`)**:
  - El mes activo es automático: siempre el mes calendario inmediatamente anterior (zona horaria UTC-5) y cambia solo al iniciar el siguiente mes.
  - Los encargados solo pueden registrar informes del mes activo; solo el superadmin puede registrar en otros meses abiertos.
  - Un mes cerrado no admite altas, ediciones ni borrados de informes hasta que el superadmin lo reabra (`/api/reabrir-mes`).
  - El servidor toma grupo, nombre y privilegios del publicador desde la base de datos y valida la meta mínima de horas de los auxiliares (30 h AUX/AUX I/AUX M, 15 h AUX C); solo Admin/Supervisor pueden aprobar excepciones.

### 3. Control de Pendientes sin Duplicados
- **Fuente única de verdad**: quién falta por informar en un mes se calcula directamente sobre la tabla `informes` (publicadores activos cuya `fecha_ingreso` sea anterior o igual al mes consultado y que aún no tengan informe en ese mes y año).
- **Índice único en base de datos**: `uq_informe_pub_mes (publicador_id, mes, anio_servicio)` impide informes duplicados incluso ante envíos concurrentes.
- **Formulario ágil**: el selector de *Nuevo Informe* lista únicamente a los publicadores pendientes del mes y avanza automáticamente al siguiente tras guardar.

### 4. Interfaz Visual (Estilo Vercel / Geist)
- Tema minimalista en `public/css/vercel.css` con soporte para **Modo Claro y Modo Oscuro** (`html[data-theme="dark"]`), persistencia en `localStorage` y adaptación automática de las gráficas de Chart.js.


---

## Estructura del proyecto

```
server.js                 Arranque: Express, estáticos y montaje de routers
lib/
  db.js                   Pool de conexiones MySQL / TiDB
  constantes.js           Meses, privilegios, metas de horas, msgErr
  mes.js                  Año de servicio, mes activo y filtro de pendientes
  auth.js                 JWT, roles (soloAdmin/soloGlobal) y filtro por grupo
routes/                   Un router por área: auth, cierres, dashboard, publicadores,
                          informes, reportes, reuniones, territorios, usuarios
scripts/                  Migraciones puntuales (p. ej. migrar_indice_reuniones.js)
public/
  index.html, js/login.js Inicio de sesión
  dashboard.html          Panel principal
  js/*.js                 Scripts clásicos del panel (comparten ámbito global);
                          el ORDEN de carga está en dashboard.html:
                          core, informes, publicadores, dashboard, reuniones, cierres,
                          reportes, s21, graficas, usuarios, territorios-*, programa-predicacion, vcal
```

### Migración de bases de datos existentes
Si tu base ya existía antes del índice único de reuniones, ejecuta una vez: `node scripts/migrar_indice_reuniones.js`.
Para cifrar con bcrypt las contraseñas heredadas en texto plano: `node scripts/migrar_passwords_bcrypt.js` (solo cuenta) y luego `node scripts/migrar_passwords_bcrypt.js --aplicar`.
