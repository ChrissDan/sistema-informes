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
- **Autenticación con JWT (`jsonwebtoken`)**: sesión de 12 horas en el encabezado `Authorization: Bearer <token>`, con limitador de intentos de login por IP (máx. 8 intentos fallidos cada 15 min).
- **Roles aplicados desde el servidor (`req.user.grupo`)**:
  - `grupo = 0` (**Superadmin**): acceso total, gestión de usuarios, cierres/reaperturas de mes y registro en meses pasados reabiertos.
  - `grupo = 9` (**Supervisor**): vista global de auditoría.
  - `grupo = 1..8` (**Encargados de grupo**): acceso restringido exclusivamente a los publicadores e informes de su propio grupo.

### 2. Año de Servicio, Mes Activo y Cierres
- **Año de servicio**: comprende de **septiembre a agosto** (ej. Septiembre 2025 – Agosto 2026 corresponde al año de servicio `2026`).
- **Regla del Mes Activo (`GET /api/mes-activo`)**:
  - Para informar un mes nuevo, el mes anterior debe estar cerrado.
  - El mes activo es siempre el inmediatamente posterior al último mes cerrado.
  - No se permiten informes ni cierres de meses futuros al activo.
  - Si el superadmin reabre un mes pasado (`/api/reabrir-mes`), solo el superadmin puede registrar informes en él.

### 3. Control de Pendientes sin Duplicados
- **Fuente única de verdad**: quién falta por informar en un mes se calcula directamente sobre la tabla `informes` (publicadores activos cuya `fecha_ingreso` sea anterior o igual al mes consultado y que aún no tengan informe en ese mes y año).
- **Índice único en base de datos**: `uq_informe_pub_mes (publicador_id, mes, anio_servicio)` impide informes duplicados incluso ante envíos concurrentes.
- **Formulario ágil**: el selector de *Nuevo Informe* lista únicamente a los publicadores pendientes del mes y avanza automáticamente al siguiente tras guardar.

### 4. Interfaz Visual (Estilo Vercel / Geist)
- Tema minimalista en `public/css/vercel.css` con soporte para **Modo Claro y Modo Oscuro** (`html[data-theme="dark"]`), persistencia en `localStorage` y adaptación automática de las gráficas de Chart.js.

