// Base: escape HTML, token, tema, año de servicio, sesión/roles, navegación y modales
// (script clásico: comparte el ámbito global con el resto de archivos; el orden de carga está en dashboard.html)
// --- Escape de HTML para todo dato de usuario que se inserte con innerHTML ---
function esc(v) { return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
// --- AUTH: adjunta el token a cada llamada /api y cierra sesión si expira ---
(function () {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (url, opts = {}) => {
        const token = localStorage.getItem('auth_token');
        if (typeof url === 'string' && url.startsWith('/api/') && token) {
            opts = { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + token } };
        }
        const res = await originalFetch(url, opts);
        if (res.status === 401 && typeof url === 'string' && url.startsWith('/api/') && !url.startsWith('/api/login')) {
            localStorage.removeItem('user_session'); localStorage.removeItem('auth_token');
            window.location.href = '/index.html';
        }
        return res;
    };
})();
// --- TEMA CLARO / OSCURO ---
function isDarkTheme() { return document.documentElement.getAttribute('data-theme') === 'dark'; }
function aplicarColoresChart() {
    if (typeof Chart === 'undefined') return;
    const dark = isDarkTheme();
    Chart.defaults.color = dark ? '#a1a1a1' : '#666666';
    Chart.defaults.borderColor = dark ? '#242424' : '#e2e8f0';
}
function toggleTheme() {
    const next = isDarkTheme() ? 'light' : 'dark';
    if (next === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('theme', next);
    const icon = document.getElementById('themeIcon');
    if (icon) icon.className = next === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
    aplicarColoresChart();
    if (typeof cargarGraficaCursos === 'function') { cargarGraficaCursos(); cargarGraficaComparativa(); cargarGraficaAsistencia(); if (typeof renderGraficaTerritorios === 'function') renderGraficaTerritorios(); }
}
window.addEventListener('DOMContentLoaded', () => {
    const icon = document.getElementById('themeIcon');
    if (icon) icon.className = isDarkTheme() ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
    aplicarColoresChart();
});

// --- NUEVO: OBTENER EL AÑO GLOBAL SELECCIONADO ---
function getAnio() {
    const anioSelect = document.getElementById('globalAnioSelect');
    return anioSelect ? anioSelect.value : '2026';
}

// --- ACTUALIZADO: Función para cuando cambias el selector de año ---
function cambiarAnioGlobal() {
    // 1. Mostrar el toast correcto con el año actual seleccionado
    Toast.fire({ 
        icon: 'info', 
        title: 'Cargando datos del ' + getAnio() 
    });
    
    // 2. Refrescar la vista activa para que dispare los nuevos fetch
    const viewActualElement = document.querySelector('.section-view.active');
    if (viewActualElement) {
        const viewActual = viewActualElement.id.replace('view-', '');
        showView(viewActual); 
        
        // >>> NUEVO: Si estamos en el Dashboard, forzar la recarga de los 3 gráficos <<<
        if (viewActual === 'dashboard') {
            cargarGraficaCursos();
            cargarGraficaComparativa();
            cargarGraficaAsistencia();
        }
    }
}

function toggleSidebar(force) { const sb = document.getElementById('sidebar'); const ov = document.getElementById('sidebarOverlay'); if (force === false) { sb.classList.remove('active'); ov.classList.remove('active'); } else { sb.classList.toggle('active'); ov.classList.toggle('active'); } }
const session = JSON.parse(localStorage.getItem('user_session')); if (!session) window.location.href = '/index.html';
function logout() { localStorage.removeItem('user_session'); localStorage.removeItem('auth_token'); window.location.href = '/index.html'; } document.getElementById('btnLogoutSide').addEventListener('click', logout);
const isAdmin = session.grupo == 0; const isSupervisor = session.grupo == 9; const isGlobal = (isAdmin || isSupervisor);
const sidebarTitle = document.getElementById('sidebarTitle'); if (isAdmin) { sidebarTitle.textContent = "ADMINISTRADOR"; document.getElementById('userRole').textContent = "Acceso Total"; } else if (isSupervisor) { sidebarTitle.textContent = "SUPERVISOR"; document.getElementById('userRole').textContent = "Auditoría"; } else { sidebarTitle.textContent = "GRUPO " + session.grupo; document.getElementById('userRole').textContent = "Encargado"; }
document.getElementById('userName').textContent = session.nombre; document.getElementById('userAvatar').textContent = session.nombre.charAt(0).toUpperCase();

if (isAdmin) {
    document.querySelectorAll('.admin-only').forEach(el => el.style.display = el.tagName === 'BUTTON' ? 'inline-flex' : 'block');
    document.querySelectorAll('.global-view').forEach(el => el.style.display = el.tagName === 'BUTTON' ? 'inline-flex' : 'block');
    document.querySelectorAll('th.admin-only, td.admin-only').forEach(el => el.style.display = 'table-cell');
    document.querySelectorAll('th.global-view, td.global-view').forEach(el => el.style.display = 'table-cell');
}
else if (isSupervisor) {
    document.querySelectorAll('#sidebar .global-view').forEach(el => el.style.display = 'block');
    document.querySelectorAll('.global-view').forEach(el => el.style.display = 'block');
    document.querySelectorAll('th.global-view, td.global-view').forEach(el => el.style.display = 'table-cell');
    document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'none');
}
else {
    document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.global-view').forEach(el => el.style.display = 'none');
    document.getElementById('nav-usuarios').parentElement.style.display = 'none';
    document.getElementById('nav-reportes').parentElement.style.display = 'none';
    document.getElementById('nav-reuniones').parentElement.style.display = 'none';
    document.getElementById('nav-territorios').parentElement.style.display = 'none';
}

const Toast = Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer: 3000, timerProgressBar: true });
const MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
let mesActual = new Date().getMonth(); let mesIndexActual = (mesActual === 0) ? 11 : mesActual - 1; let mesIndexInformes = mesIndexActual;

// >>> NUEVO: CÁLCULO AUTOMÁTICO DE AÑO DE SERVICIO (HISTORIAL COMPLETO) <<<
const añoCalendario = new Date().getFullYear();
let añoServicioCalculado = añoCalendario;

// Si el mes actual es Octubre (9) o posterior, saltamos al siguiente año de servicio
if (mesActual >= 9) { 
    añoServicioCalculado = añoCalendario + 1;
}

const globalAnioSelect = document.getElementById('globalAnioSelect');
if (globalAnioSelect) {
    globalAnioSelect.innerHTML = ''; 
    
    // Definimos el año en que nació tu sistema para que siempre empiece desde aquí
    const añoInicio = 2025; 
    
    // Generamos la lista desde el 2025 hasta un año en el futuro
    for (let y = añoInicio; y <= añoServicioCalculado + 1; y++) {
        const opt = document.createElement('option');
        opt.value = y;
        opt.textContent = `Año ${y}`;
        // Seleccionamos automáticamente el año de servicio actual
        if (y === añoServicioCalculado) opt.selected = true; 
        globalAnioSelect.appendChild(opt);
    }
}
// >>> FIN CÁLCULO AUTOMÁTICO <<<

const formMesSelect = document.getElementById('formMesSelect'); const dashMesSelect = document.getElementById('dashMesSelect'); const repMesSelect = document.getElementById('repMesSelect'); const reuMesSelect = document.getElementById('reuMesSelect'); const reuFilterMes = document.getElementById('reuFilterMes'); const infFiltroMes = document.getElementById('infFiltroMes');
formMesSelect.innerHTML = '<option value="">-- Seleccione --</option>';
MESES.forEach(m => { const opt = document.createElement('option'); opt.value = m; opt.textContent = m; formMesSelect.appendChild(opt); dashMesSelect.appendChild(opt.cloneNode(true)); repMesSelect.appendChild(opt.cloneNode(true)); reuMesSelect.appendChild(opt.cloneNode(true)); reuFilterMes.appendChild(opt.cloneNode(true)); infFiltroMes.appendChild(opt.cloneNode(true)); });
let mesActivo = null;
function getMesAutomatico() { const m = new Date().getMonth(); return MESES[(m === 0) ? 11 : m - 1]; }
function aplicarBloqueoMesForm(el) {
    if (!el) return;
    if (!isAdmin) {
        el.value = (mesActivo && mesActivo.mes) ? mesActivo.mes : getMesAutomatico();
        el.disabled = true;
        el.style.backgroundColor = 'var(--bg-subtle, #f1f5f9)';
        el.style.cursor = 'not-allowed';
        el.style.fontWeight = 'bold';
        el.style.color = 'var(--text-secondary, #475569)';
    } else {
        el.disabled = false;
        el.style.backgroundColor = '';
        el.style.cursor = '';
        el.style.fontWeight = '';
        el.style.color = '';
    }
}
dashMesSelect.value = MESES[mesIndexActual];
formMesSelect.value = getMesAutomatico();
aplicarBloqueoMesForm(formMesSelect);

window.onload = function () { verificarInactivos(); };
function cambiarMesInformes(direccion) { mesIndexInformes += direccion; if (mesIndexInformes > 11) mesIndexInformes = 0; if (mesIndexInformes < 0) mesIndexInformes = 11; document.getElementById('infMesLabel').textContent = MESES[mesIndexInformes]; cargarTablaInformes(); }

async function verificarInactivos() { try { const grp = isGlobal ? 0 : session.grupo; const res = await fetch(`/api/check-inactivos?grupo=${grp}`); const data = await res.json(); if (data.candidatos && data.candidatos.length > 0) { let listaHtml = `<ul style="text-align:left; font-size:0.9rem; max-height:200px; overflow-y:auto;">`; data.candidatos.forEach(c => { listaHtml += `<li><b>G${c.grupo}</b> - ${esc(c.nombre)} <span style="color:#ef4444; font-weight:bold;">(Hace ${c.meses_sin_informar} meses)</span></li>`; }); listaHtml += `</ul>`; Swal.fire({ title: '⚠️ Irregulares Detectados', html: `Los siguientes publicadores llevan varios <b>meses cerrados</b> sin informar:<br><br>${listaHtml}`, icon: 'warning', confirmButtonText: 'Entendido' }); } } catch (e) { console.error(e); } }

function showView(viewName) {
    if (!isGlobal && ['territorios', 'reuniones', 'reportes', 'usuarios', 'cierres'].includes(viewName)) return;
    if (!isAdmin && ['usuarios', 'cierres'].includes(viewName)) return;
    document.querySelectorAll('.section-view').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-links a').forEach(el => el.classList.remove('active'));
    document.getElementById(`view-${viewName}`).classList.add('active');
    document.getElementById(`nav-${viewName}`).classList.add('active');
    const titles = { 'dashboard': 'Dashboard General', 'informes': 'Gestión de Informes', 'publicadores': 'Directorio Publicadores', 'territorios': 'Gestión de Territorios', 'usuarios': 'Administración Usuarios', 'reportes': 'Centro de Reportes', 'reuniones': 'Asistencia Reuniones', 'cierres': 'Gestión de Cierres' };
    const icons = { 'dashboard': 'gauge-high', 'informes': 'file-lines', 'publicadores': 'users', 'territorios': 'map-location-dot', 'usuarios': 'user-shield', 'reportes': 'print', 'reuniones': 'users-rectangle', 'cierres': 'lock-open' };
    document.getElementById('pageTitle').innerHTML = `<i class="fa-solid fa-${icons[viewName]}" style="color:var(--primary)"></i> ${titles[viewName]}`;

    if (viewName === 'informes') { document.getElementById('infMesLabel').textContent = MESES[mesIndexInformes]; cargarTablaInformes(); cargarPublicadoresSelect(isGlobal ? 1 : session.grupo, 'pending'); verificarCierres(); }
    if (viewName === 'publicadores') cargarTablaPublicadores();
    if (viewName === 'usuarios') cargarTablaUsuarios();
    if (viewName === 'dashboard') cargarDashboard();
    if (viewName === 'reuniones') cargarTablaReuniones();
    if (viewName === 'cierres') cargarTablaCierres();
    if (viewName === 'territorios') cargarVistaTerritorios();
}

function abrirModal(tipo, id = null) {
    if (!isAdmin && ['territorio', 'conductor', 'turno', 'bitacora', 'publicador', 'reunion', 'usuario'].includes(tipo)) return;
    const modalWrapper = document.getElementById('mainModal'); const modalBody = document.getElementById('modalBody'); const modalTitle = document.getElementById('modalTitle'); modalBody.innerHTML = ''; let formId = '';
    if (tipo === 'informe') { formId = 'formInforme'; modalTitle.innerHTML = id ? '<i class="fa-solid fa-pen"></i> Editar Informe' : '<i class="fa-solid fa-circle-plus"></i> Nuevo Informe'; if (!id) resetFormInforme(true); } else if (tipo === 'publicador') { formId = 'formPublicador'; modalTitle.innerHTML = id ? '<i class="fa-solid fa-pen"></i> Editar Publicador' : '<i class="fa-solid fa-user-plus"></i> Nuevo Publicador'; if (!id) resetFormPub(); } else if (tipo === 'reunion') { formId = 'formReunion'; modalTitle.innerHTML = id ? '<i class="fa-solid fa-pen"></i> Editar Asistencia' : '<i class="fa-solid fa-calendar-plus"></i> Registrar Asistencia'; if (!id) resetFormReu(); } else if (tipo === 'usuario') { formId = 'formUsuario'; modalTitle.innerHTML = id ? '<i class="fa-solid fa-pen"></i> Editar Usuario' : '<i class="fa-solid fa-user-shield"></i> Crear Usuario'; if (!id) resetFormUser(); } else if (tipo === 'territorio') { formId = 'formTerritorio'; modalTitle.innerHTML = id ? '<i class="fa-solid fa-pen"></i> Editar Territorio' : '<i class="fa-solid fa-map"></i> Nuevo Territorio'; if (!id) resetFormTerritorio(); } else if (tipo === 'conductor') { formId = 'formConductor'; modalTitle.innerHTML = id ? '<i class="fa-solid fa-pen"></i> Editar Conductor' : '<i class="fa-solid fa-user-tie"></i> Registrar Conductor'; if (!id) resetFormConductor(); } else if (tipo === 'turno') { formId = 'formTurno'; modalTitle.innerHTML = id ? '<i class="fa-solid fa-pen"></i> Editar Turno' : '<i class="fa-solid fa-clock"></i> Crear Turno de Predicación'; if (!id) resetFormTurno(); } else if (tipo === 'bitacora') { formId = 'formBitacora'; modalTitle.innerHTML = id ? '<i class="fa-solid fa-pen"></i> Editar Registro de Bitácora' : '<i class="fa-solid fa-pen-to-square"></i> Registrar Avance en Bitácora'; if (!id) resetFormBitacora(); }
    const form = document.getElementById(formId); if (form) { form.style.display = 'grid'; modalBody.appendChild(form); } modalWrapper.classList.add('active');
}
function cerrarModal() {
    const modalWrapper = document.getElementById('mainModal');
    const modalBox = modalWrapper?.querySelector('.modal-box');
    if (modalBox) modalBox.classList.remove('modal-wide');
    const modalBody = document.getElementById('modalBody');
    const formsContainer = document.getElementById('formsContainer');
    modalWrapper.classList.remove('active');
    if (typeof cerrarVCal === 'function') cerrarVCal();
    while (modalBody.firstChild) {
        formsContainer.appendChild(modalBody.firstChild);
    }
}

