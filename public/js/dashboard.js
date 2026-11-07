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

async function verificarInactivos() { try { const grp = isGlobal ? 0 : session.grupo; const res = await fetch(`/api/check-inactivos?grupo=${grp}`); const data = await res.json(); if (data.candidatos && data.candidatos.length > 0) { let listaHtml = `<ul style="text-align:left; font-size:0.9rem; max-height:200px; overflow-y:auto;">`; data.candidatos.forEach(c => { listaHtml += `<li><b>G${c.grupo}</b> - ${c.nombre} <span style="color:#ef4444; font-weight:bold;">(Hace ${c.meses_sin_informar} meses)</span></li>`; }); listaHtml += `</ul>`; Swal.fire({ title: '⚠️ Irregulares Detectados', html: `Los siguientes publicadores llevan varios <b>meses cerrados</b> sin informar:<br><br>${listaHtml}`, icon: 'warning', confirmButtonText: 'Entendido' }); } } catch (e) { console.error(e); } }

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
function cerrarModal() { const modalWrapper = document.getElementById('mainModal'); const modalBody = document.getElementById('modalBody'); const formsContainer = document.getElementById('formsContainer'); modalWrapper.classList.remove('active'); while (modalBody.firstChild) { formsContainer.appendChild(modalBody.firstChild); } }

let cachePublicadores = []; let cacheInformes = []; let cacheUsuarios = []; let cacheReuniones = [];
// Año de servicio para registrar: los no-admin siempre usan el del mes activo; el admin el del selector global
function anioFormInforme() { return (!isAdmin && mesActivo) ? mesActivo.anio_servicio : getAnio(); }
async function cargarPublicadoresSelect(grupoId, mode = 'pending') { try { let url = `/api/publicadores?grupo=${grupoId}`; if (mode === 'pending') { const NM = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE']; const mesForm = document.getElementById('formMesSelect').value || NM[(new Date().getMonth() + 11) % 12]; url += `&sin_informe_mes=${encodeURIComponent(mesForm)}&anio_servicio=${anioFormInforme()}`; } const res = await fetch(url); cachePublicadores = await res.json(); const sel = document.getElementById('selectPubInfo'); const currentVal = sel.value; sel.innerHTML = mode === 'pending' ? (cachePublicadores.length ? `<option value="">-- Seleccione (${cachePublicadores.length} pendientes) --</option>` : '<option value="">✔ Todos ya informaron este mes</option>') : '<option value="">-- Seleccione --</option>'; cachePublicadores.forEach(p => { sel.innerHTML += `<option value="${p.id}">${p.nombre}</option>`; }); if (mode === 'all' && currentVal && cachePublicadores.find(p => p.id == currentVal)) sel.value = currentVal; return cachePublicadores; } catch (e) { console.error(e); return []; } }
function cargarDatosPub() { const id = document.getElementById('selectPubInfo').value; const pub = cachePublicadores.find(p => p.id == id); if (pub) { document.getElementById('readPriv3').value = pub.priv3; actualizarEstadoHoras(pub.priv3); } else { document.getElementById('readPriv3').value = ""; document.getElementById('inputHoras').disabled = true; } }
function actualizarEstadoHoras(privilegio) { const inputHoras = document.getElementById('inputHoras'); const inputCredito = document.getElementById('inputCredito'); const p = (privilegio || "").trim().toUpperCase(); const reportan = ['ESP', 'REG', 'AUX I', 'AUX M', 'AUX', 'AUX C']; const reportanCredito = ['REG', 'ESP']; if (reportan.includes(p)) { inputHoras.disabled = false; } else { inputHoras.disabled = true; inputHoras.value = ""; } if (reportanCredito.includes(p)) { inputCredito.disabled = false; } else { inputCredito.disabled = true; inputCredito.value = ""; } }
function limpiarFiltrosInformes() { if (isGlobal) document.getElementById('infFiltroGrupo').value = ''; document.getElementById('infFiltroPriv3').value = ''; document.getElementById('infFiltroNombre').value = ''; cargarTablaInformes(); }

// --- INFORMES ---
async function cargarTablaInformes() {
    let mes = MESES[mesIndexInformes]; let grp = isGlobal ? 0 : session.grupo; const fGrupo = document.getElementById('infFiltroGrupo') ? document.getElementById('infFiltroGrupo').value : null; if (isGlobal && fGrupo) grp = fGrupo; const fPriv3 = document.getElementById('infFiltroPriv3').value; const fNombre = document.getElementById('infFiltroNombre').value; 
    const params = new URLSearchParams({ grupo: grp, anio_servicio: getAnio() }); // AÑO AÑADIDO
    if (mes) params.append('mes', mes); if (fPriv3) params.append('priv3', fPriv3); if (fNombre) params.append('nombre', fNombre);
    const res = await fetch(`/api/informes?${params.toString()}`); cacheInformes = await res.json(); const tbody = document.getElementById('tablaInformes'); tbody.innerHTML = '';
    if (cacheInformes.length === 0) { tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:30px; color:#94a3b8;">No se encontraron resultados para ${mes} del año ${getAnio()}.</td></tr>`; return; }

    const mesEstaCerrado = (typeof mesesCerrados !== 'undefined' ? mesesCerrados : []).includes(mes);

    cacheInformes.forEach(d => {
        const badge = d.predico === 'SI' ? '<span class="badge badge-si"><i class="fa-solid fa-check"></i> SÍ</span>' : '<span class="badge badge-no"><i class="fa-solid fa-xmark"></i> NO</span>'; const grpCell = isGlobal ? `<td><span class="badge-grp">G${d.grupo}</span></td>` : '';
        let editBtn = ''; let deleteBtn = '';
        if (!mesEstaCerrado) {
            if (isAdmin) deleteBtn = `<button class="btn-action btn-del" onclick="eliminar('informes', ${d.id})" title="Eliminar"><i class="fa-solid fa-trash-can"></i></button>`;
            if (isGlobal || d.grupo == session.grupo) editBtn = `<button class="btn-action btn-edit" onclick="editarInforme(${d.id})" title="Editar"><i class="fa-solid fa-pen-to-square"></i></button>`;
        }
        const credDisplay = d.credito_hrs > 0 ? `<span style="color:#d97706; font-size:0.8em">+${d.credito_hrs}</span>` : '';
        tbody.innerHTML += `<tr>${grpCell}<td>${d.nombre_publicador || d.publicador_nombre}</td><td><span class="badge badge-gray">${d.priv3}</span></td><td style="text-align:center"><b>${d.horas}</b> ${credDisplay}</td><td style="text-align:center">${d.cursos}</td><td style="text-align:center">${d.credito_hrs || '-'}</td><td style="text-align:center">${badge}</td><td style="font-size:0.8em; color:#666;">${d.comentarios || ''}</td><td>${editBtn} ${deleteBtn}</td></tr>`;
    }); 
    if (isGlobal) { document.querySelectorAll('.global-view').forEach(el => { if (el.tagName === 'TH') el.style.display = 'table-cell'; }); }
}

function editarInforme(id) { const obj = cacheInformes.find(i => i.id == id); if (!obj) return; const f = document.getElementById('formInforme'); document.getElementById('informeId').value = obj.id; f.mes.value = obj.mes; f.mes.disabled = true; const processEdit = () => { f.publicador_id.value = obj.publicador_id; cargarDatosPub(); f.predico.value = obj.predico; f.horas.value = obj.horas; f.cursos.value = obj.cursos; f.comentarios.value = obj.comentarios; f.credito_hrs.value = obj.credito_hrs; }; const grupoTarget = isGlobal ? obj.grupo : session.grupo; if (isGlobal) document.getElementById('infGrupoSelect').value = grupoTarget; cargarPublicadoresSelect(grupoTarget, 'all').then(processEdit); abrirModal('informe', id); }
// Mes automático según el servidor (mes calendario anterior, cambia automáticamente al siguiente mes)
async function cargarMesActivo() { try { const r = await fetch('/api/mes-activo'); mesActivo = await r.json(); } catch (e) { mesActivo = null; } return mesActivo; }
// Solo superadmin (grupo 0): puede cambiar el mes a cualquier mes abierto; los demás usuarios lo tienen bloqueado
async function habilitarMesesPasadosAdmin(f) {
    const anio = parseInt(getAnio()); let cerrados = [];
    try { const r = await fetch(`/api/cierres?anio_servicio=${anio}`); cerrados = await r.json(); } catch (e) {}
    Array.from(f.mes.options).forEach(o => {
        if (!o.value) return;
        const cerrado = cerrados.includes(o.value);
        o.disabled = cerrado;
        o.textContent = o.value + (cerrado ? ' (Cerrado)' : '');
    });
    aplicarBloqueoMesForm(f.mes);
}
async function resetFormInforme(manualClean = false, keepGroup = false) { 
    const f = document.getElementById('formInforme'); const gPrev = isGlobal ? document.getElementById('infGrupoSelect').value : null; const mesPrev = f.mes.value; f.reset(); if (keepGroup && gPrev) document.getElementById('infGrupoSelect').value = gPrev; document.getElementById('informeId').value = ""; document.getElementById('inputHoras').disabled = true; document.getElementById('inputCredito').disabled = true;
    const mesAuto = getMesAutomatico();
    if (f.mes) {
        await cargarMesActivo();
        const mesDefecto = (mesActivo && mesActivo.mes) ? mesActivo.mes : mesAuto;
        f.mes.value = (keepGroup && isAdmin && mesPrev) ? mesPrev : mesDefecto;
        aplicarBloqueoMesForm(f.mes);
    }
    if (manualClean) { 
        document.getElementById('readPriv3').value = ""; 
        if (isAdmin && f.mes) await habilitarMesesPasadosAdmin(f);
        const grpSel = isGlobal ? document.getElementById('infGrupoSelect').value : session.grupo; await cargarPublicadoresSelect(grpSel, 'pending');
    } 
}

document.getElementById('formMesSelect').addEventListener('change', () => {
    if (!isAdmin && !document.getElementById('informeId').value) { aplicarBloqueoMesForm(formMesSelect); return; }
    if (!document.getElementById('informeId').value) cargarPublicadoresSelect(isGlobal ? document.getElementById('infGrupoSelect').value : session.grupo, 'pending');
});
document.getElementById('formInforme').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target;
    const btnSubmit = f.querySelector('button[type="submit"]'); const textoOriginal = btnSubmit.innerHTML;
    if (btnSubmit) { btnSubmit.disabled = true; btnSubmit.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Guardando...'; }

    const rawData = Object.fromEntries(new FormData(f));
    if (!isAdmin && !document.getElementById('informeId').value) {
        f.mes.value = (mesActivo && mesActivo.mes) ? mesActivo.mes : getMesAutomatico();
    }
    rawData.mes = f.mes.value || getMesAutomatico(); 
    rawData.horas = f.horas.disabled ? 0 : (f.horas.value || 0);
    rawData.cursos = f.cursos.value || 0;
    rawData.credito_hrs = f.credito_hrs.disabled ? 0 : (f.credito_hrs.value || 0);
    rawData.anio_servicio = document.getElementById('informeId').value ? getAnio() : anioFormInforme(); // AÑO AÑADIDO

    const h = parseFloat(rawData.horas) || 0; const c = parseFloat(rawData.credito_hrs) || 0;
    const privilegio = (document.getElementById('readPriv3').value || "").trim().toUpperCase();
    
    const esRegular = privilegio === 'REG' || privilegio === 'ESP';
    const esAux30 = privilegio === 'AUX I' || privilegio === 'AUX M' || privilegio === 'AUX';
    const esAux15 = privilegio === 'AUX C';
    const esPrecursor = esRegular || esAux30 || esAux15;

    if (esPrecursor && h <= 0) { Swal.fire({ icon: 'error', title: 'Horas en cero', text: `Un ${privilegio} no puede reportar 0 horas.` }); if(btnSubmit) { btnSubmit.disabled = false; btnSubmit.innerHTML = textoOriginal; } return; }

    let metaMinima = 0; if (esAux30) metaMinima = 30; if (esAux15) metaMinima = 15;
    if (metaMinima > 0 && h < metaMinima) {
        if (!isGlobal) { 
            Swal.fire({ icon: 'error', title: 'Meta no alcanzada', html: `El publicador es <b>${privilegio}</b> (Meta: ${metaMinima} hrs) pero solo reportó <b>${h} horas</b>.<br><br>No tienes permisos. El Secretario debe evaluarlo.` });
            if(btnSubmit) { btnSubmit.disabled = false; btnSubmit.innerHTML = textoOriginal; } return;
        } else { 
            const confirmacion = await Swal.fire({ icon: 'warning', title: 'Aprobación Especial', html: `Este <b>${privilegio}</b> reportó <b>${h} horas</b> (su meta es de ${metaMinima} hrs).<br><br>¿Aprobar?`, showCancelButton: true, confirmButtonColor: '#f59e0b', confirmButtonText: 'Sí, aprobar' });
            if (!confirmacion.isConfirmed) { if(btnSubmit) { btnSubmit.disabled = false; btnSubmit.innerHTML = textoOriginal; } return; }
        }
    }
    let maxCredito = 55 - h; if (maxCredito < 0) maxCredito = 0;
    if (c > maxCredito) { Swal.fire({ icon: 'warning', title: 'Límite Excedido', text: `Con ${h}h, el crédito máximo es ${maxCredito}.` }); if (btnSubmit) { btnSubmit.disabled = false; btnSubmit.innerHTML = textoOriginal; } return; }

    const id = document.getElementById('informeId').value; const method = id ? 'PUT' : 'POST'; const url = id ? `/api/informes/${id}` : '/api/informes';
    rawData.grupo = isGlobal ? document.getElementById('infGrupoSelect').value : session.grupo; rawData.requester_group = session.grupo;
    if (!id) { const pub = cachePublicadores.find(p => p.id == rawData.publicador_id); if (pub) { rawData.publicador_nombre = pub.nombre; rawData.priv1 = pub.priv1; rawData.priv2 = pub.priv2; rawData.priv3 = pub.priv3; } }

    try {
        const res = await fetch(url, { method: method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rawData) });
        const json = await res.json();
        if (res.ok) {
            cargarTablaInformes();
            if (id) { Toast.fire({ icon: 'success', title: 'Informe guardado' }); cerrarModal(); resetFormInforme(true); }
            else {
                await resetFormInforme(true, true); // quita de la lista al que ya informó
                const quedan = Math.max(cachePublicadores.length, 0);
                if (quedan === 0) { cerrarModal(); Toast.fire({ icon: 'success', title: 'Informe guardado. ¡Todos informaron!' }); }
                else Toast.fire({ icon: 'success', title: `Guardado. Faltan ${quedan}` });
            }
        } 
        else Swal.fire('Error', json.msg || 'No se pudo guardar', 'error');
    } catch (error) { Swal.fire('Error', 'Hubo un problema de conexión.', 'error'); } 
    finally { if (btnSubmit) { btnSubmit.disabled = false; btnSubmit.innerHTML = textoOriginal; } }
});

// --- PUBLICADORES ---
async function cargarTablaPublicadores() {
    let grp = isGlobal ? 0 : session.grupo; const fGrupo = document.getElementById('pubFiltroGrupo') ? document.getElementById('pubFiltroGrupo').value : null; const fNombre = document.getElementById('pubFiltroNombre').value; const fPriv3 = document.getElementById('pubFiltroPriv3').value;
    if (isGlobal && fGrupo) grp = fGrupo;
    const params = new URLSearchParams({ grupo: grp }); if (fNombre) params.append('nombre', fNombre); if (fPriv3) params.append('priv3', fPriv3);
    const res = await fetch(`/api/publicadores?${params.toString()}`); cachePublicadores = await res.json(); const tbody = document.getElementById('tablaPublicadores'); tbody.innerHTML = '';
    let stats = { total: 0, reg: 0, esp: 0, aux: 0, pub: 0, groups: {} }; for (let i = 1; i <= 8; i++) stats.groups[i] = 0;
    if (cachePublicadores.length === 0) { tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:20px; color:#94a3b8;">No se encontraron resultados.</td></tr>`; return; }
    cachePublicadores.forEach(d => {
        if (d.activo) { stats.total++; const p = (d.priv3 || '').toUpperCase(); if (p === 'REG') stats.reg++; else if (p.includes('ESP')) stats.esp++; else if (p.includes('AUX')) stats.aux++; else if (p.includes('PUB') || p.includes('PNB')) stats.pub++; if (stats.groups[d.grupo] !== undefined) stats.groups[d.grupo]++; }
        const rowClass = d.activo ? '' : 'row-inactivo';
        const switchHtml = isAdmin ? `<div class="switch-container"><label class="switch"><input type="checkbox" ${d.activo ? 'checked' : ''} onchange="toggleEstado(${d.id}, this.checked, this)"><span class="slider round"></span></label></div>` : `<span class="${d.activo ? 'badge badge-si' : 'badge badge-no'}">${d.activo ? 'ACTIVO' : 'INACTIVO'}</span>`;
        const deleteBtn = isAdmin ? `<button class="btn-action btn-del" onclick="eliminar('publicadores', ${d.id})" title="Eliminar"><i class="fa-solid fa-trash-can"></i></button>` : ''; const editBtn = isAdmin ? `<button class="btn-action btn-edit" onclick="editarPub(${d.id})" title="Editar"><i class="fa-solid fa-pen-to-square"></i></button>` : '';
        const infoBadge = d.informo_mes === 'SI' ? '<span class="badge badge-si"><i class="fa-solid fa-check"></i> SÍ</span>' : '<span class="badge badge-no"><i class="fa-solid fa-xmark"></i> NO</span>';
        let fechaTxt = '-'; if (d.fecha_ingreso) { const dateObj = new Date(d.fecha_ingreso); const userTimezoneOffset = dateObj.getTimezoneOffset() * 60000; fechaTxt = new Date(dateObj.getTime() + userTimezoneOffset).toLocaleDateString('es-ES', { month: 'short', year: 'numeric' }); }
        tbody.innerHTML += `<tr class="${rowClass}"><td><b>${d.grupo}</b></td><td style="font-weight:500">${d.nombre}</td><td>${d.priv1 || '-'}</td><td>${d.priv2 || '-'}</td><td><span class="badge badge-gray">${d.priv3}</span></td><td>${infoBadge}</td><td style="font-size:0.85rem; max-width:150px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${d.comentario || ''}</td><td class="global-view" style="font-size:0.85em;">${fechaTxt}</td><td class="admin-only">${switchHtml}</td><td>${editBtn} ${deleteBtn}</td></tr>`;
    });
    document.getElementById('pub-stat-total').textContent = stats.total; document.getElementById('pub-stat-reg').textContent = stats.reg; document.getElementById('pub-stat-esp').textContent = stats.esp; document.getElementById('pub-stat-aux').textContent = stats.aux; document.getElementById('pub-stat-pub').textContent = stats.pub;
    const groupContainer = document.getElementById('pub-groups-container'); groupContainer.innerHTML = '';
    Object.keys(stats.groups).forEach(gId => { groupContainer.innerHTML += `<div class="group-stat-card"><div class="g-label">G ${gId}</div><div class="g-value">${stats.groups[gId]}</div></div>`; });
    if (isAdmin) { document.querySelectorAll('.admin-only').forEach(e => e.style.display = 'table-cell'); document.querySelectorAll('.global-view.badge').forEach(e => e.style.display = 'none'); }
    if (isGlobal) { document.querySelectorAll('.global-view').forEach(e => e.style.display = 'table-cell'); }
}
async function toggleEstado(id, nuevoEstado, checkbox) { const accionTexto = nuevoEstado ? 'activar' : 'desactivar'; const result = await Swal.fire({ title: `¿${accionTexto} publicador?`, icon: 'warning', showCancelButton: true, confirmButtonText: 'Sí' }); if (result.isConfirmed) { try { const res = await fetch(`/api/publicadores/${id}/estado`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ activo: nuevoEstado, requester_group: session.grupo }) }); const json = await res.json(); if (json.ok) { Toast.fire({ icon: 'success', title: `Listo` }); cargarTablaPublicadores(); } else { Swal.fire('Error', json.msg, 'error'); checkbox.checked = !nuevoEstado; } } catch (e) { checkbox.checked = !nuevoEstado; } } else { checkbox.checked = !nuevoEstado; } }

function editarPub(id) { 
    if (!isAdmin) return; 
    const obj = cachePublicadores.find(p => p.id == id); 
    if (!obj) return; 
    
    const f = document.getElementById('formPublicador'); 
    document.getElementById('pubId').value = obj.id; 
    document.getElementById('pubGrupoSelect').value = obj.grupo; 
    f.nombre.value = obj.nombre; 
    
    // --- NUEVOS CAMPOS S-21 ---
    if (obj.fecha_nacimiento) {
        f.fecha_nacimiento.value = obj.fecha_nacimiento.split('T')[0];
    } else {
        f.fecha_nacimiento.value = "";
    }
    
    if (obj.fecha_bautismo) {
        f.fecha_bautismo.value = obj.fecha_bautismo.split('T')[0];
    } else {
        f.fecha_bautismo.value = "";
    }
    
    f.sexo.value = obj.sexo || 'Hombre';
    f.esperanza.value = obj.esperanza || 'Otras ovejas';

    // --- LÓGICA PARA CHECKBOXES MÚLTIPLES S-21 ---
    // 1. Limpiamos todas las casillas primero
    document.querySelectorAll('input[name="privilegio_s21"]').forEach(cb => cb.checked = false);
    
    // 2. Marcamos las que correspondan según la base de datos
    if (obj.privilegio_s21) {
        const privs = obj.privilegio_s21.split(','); // Convertimos el texto en un arreglo
        privs.forEach(p => {
            const checkbox = document.querySelector(`input[name="privilegio_s21"][value="${p}"]`);
            if (checkbox) checkbox.checked = true;
        });
    }
    // ---------------------------------------------
    // --------------------------

    f.priv1.value = obj.priv1 || ''; 
    f.priv2.value = obj.priv2 || ''; 
    f.priv3.value = obj.priv3 || ''; 
    f.comentario.value = obj.comentario || ''; 
    
    if (obj.fecha_ingreso) { 
        const dateObj = new Date(obj.fecha_ingreso); 
        f.fecha_ingreso.value = dateObj.toISOString().split('T')[0]; 
    } else { 
        f.fecha_ingreso.value = ""; 
    } 
    
    abrirModal('publicador', id); 
}

function resetFormPub() { document.getElementById('formPublicador').reset(); document.getElementById('pubId').value = ""; }

document.getElementById('formPublicador').addEventListener('submit', async (e) => { 
    e.preventDefault(); 
    const data = Object.fromEntries(new FormData(e.target)); 
    
    // >>> NUEVO: Atrapar múltiples checkboxes y unirlos por comas <<<
    const checkboxes = e.target.querySelectorAll('input[name="privilegio_s21"]:checked');
    data.privilegio_s21 = Array.from(checkboxes).map(cb => cb.value).join(',');
    // >>> FIN NUEVO <<<

    const id = document.getElementById('pubId').value; 
    const method = id ? 'PUT' : 'POST'; 
    const url = id ? `/api/publicadores/${id}` : '/api/publicadores'; 
    data.grupo = isAdmin ? document.getElementById('pubGrupoSelect').value : session.grupo; 
    data.requester_group = session.grupo; 
    
    const res = await fetch(url, { 
        method: method, 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify(data) 
    }); 
    const json = await res.json(); 
    
    if (json.ok) { 
        Toast.fire({ icon: 'success', title: 'Listo' }); 
        cerrarModal(); 
        resetFormPub(); 
        cargarTablaPublicadores(); 
    } else { 
        Swal.fire('Error', json.msg, 'error'); 
    } 
});

// --- DASHBOARD ---
async function cargarDashboard() {
    const mes = document.getElementById('dashMesSelect').value; const grp = isGlobal ? 0 : session.grupo;
    try {
        const res = await fetch(`/api/dashboard?mes=${mes}&grupo=${grp}&anio_servicio=${getAnio()}`); // AÑO AÑADIDO
        const data = await res.json();
        document.getElementById('stat-pub-count').textContent = data.stats.pub.count; document.getElementById('stat-pub-cursos').textContent = data.stats.pub.cursos || 0;
        document.getElementById('stat-aux-count').textContent = data.stats.aux.count; document.getElementById('stat-aux-horas').textContent = data.stats.aux.horas || 0; document.getElementById('stat-aux-cursos').textContent = data.stats.aux.cursos || 0;
        document.getElementById('stat-reg-count').textContent = data.stats.reg.count; document.getElementById('stat-reg-horas').textContent = data.stats.reg.horas || 0; document.getElementById('stat-reg-cursos').textContent = data.stats.reg.cursos || 0;
        const container = document.getElementById('groups-progress-container'); container.innerHTML = '';
        const gruposInfo = {}; data.groups.totals.forEach(g => gruposInfo[g.grupo] = { total: g.total, reported: 0 });
        data.groups.reports.forEach(g => { if (gruposInfo[g.grupo]) gruposInfo[g.grupo].reported = g.count; });
        Object.keys(gruposInfo).forEach(grpNum => { if (grpNum == 0) return; const g = gruposInfo[grpNum]; const percent = Math.round((g.reported / g.total) * 100) || 0; let color = 'var(--primary)'; if (percent === 100) color = 'var(--success)'; if (percent < 50) color = 'var(--danger)'; container.innerHTML += `<div class="group-item"><div class="group-info"><div class="group-name">Grupo ${grpNum} <span>(${g.reported}/${g.total})</span></div><div class="progress-bar-bg"><div class="progress-bar-fill" style="width:${percent}%; background:${color}"></div></div></div><div class="group-perc" style="color:${color}">${percent}%</div></div>`; });
    } catch (error) { console.error(error); }
}

// --- REUNIONES ---
async function cargarTablaReuniones() { 
    const filterMes = document.getElementById('reuFilterMes').value; 
    const url = `/api/reuniones?anio_servicio=${getAnio()}` + (filterMes ? `&mes=${filterMes}` : ''); // AÑO AÑADIDO
    const res = await fetch(url); cacheReuniones = await res.json(); const tbody = document.getElementById('tbodyReuniones'); tbody.innerHTML = ''; const summaryContainer = document.getElementById('resumenReunionesContainer'); summaryContainer.innerHTML = ''; let totalPromedioMensual = 0; let datosPorMes = {}; 
    cacheReuniones.forEach(r => { 
        if (!datosPorMes[r.mes]) datosPorMes[r.mes] = { totalSemanal: 0, countMeetings: 0 }; 
        const s1 = r.sem1 || 0; const s2 = r.sem2 || 0; const s3 = r.sem3 || 0; const s4 = r.sem4 || 0; const s5 = r.sem5 || 0; const sumaSem = s1 + s2 + s3 + s4 + s5; 
        let weeksCount = 0; if (s1 > 0) weeksCount++; if (s2 > 0) weeksCount++; if (s3 > 0) weeksCount++; if (s4 > 0) weeksCount++; if (s5 > 0) weeksCount++; const promedio = weeksCount > 0 ? Math.round(sumaSem / weeksCount) : 0; 
        const iconTipo = r.tipo === 'ENTRE SEMANA' ? '<i class="fa-solid fa-calendar-days" style="color:#64748b"></i>' : '<i class="fa-solid fa-calendar-week" style="color:#d97706"></i>'; const iconMod = r.modalidad === 'PRESENCIAL' ? '<span class="badge badge-grp">PRES</span>' : '<span class="badge badge-gray">ZOOM</span>'; const deleteBtn = isAdmin ? `<button class="btn-action btn-del" onclick="eliminar('reuniones', ${r.id})"><i class="fa-solid fa-trash-can"></i></button>` : ''; const editBtn = isAdmin ? `<button class="btn-action btn-edit" onclick='editarReunion(${JSON.stringify(r)})'><i class="fa-solid fa-pen"></i></button>` : ''; tbody.innerHTML += `<tr><td style="font-weight:bold">${r.mes}</td><td>${iconTipo} <span style="font-size:0.8em">${r.tipo}</span></td><td>${iconMod}</td><td style="text-align:center">${r.sem1 || '-'}</td><td style="text-align:center">${r.sem2 || '-'}</td><td style="text-align:center">${r.sem3 || '-'}</td><td style="text-align:center">${r.sem4 || '-'}</td><td style="text-align:center">${r.sem5 || '-'}</td><td style="text-align:center; font-weight:bold; color:var(--primary)">${promedio}</td><td>${editBtn} ${deleteBtn}</td></tr>`; 
    }); 
    const mathData = {}; cacheReuniones.forEach(r => { const key = r.mes + '|' + r.tipo; if (!mathData[key]) mathData[key] = { mes: r.mes, tipo: r.tipo, total: 0, weeks: new Set() };[r.sem1, r.sem2, r.sem3, r.sem4, r.sem5].forEach((val, idx) => { if (val > 0) { mathData[key].total += val; mathData[key].weeks.add(idx); } }); }); 
    Object.values(mathData).forEach(d => { const semanasCount = d.weeks.size; const promedio = semanasCount > 0 ? Math.round(d.total / semanasCount) : 0; totalPromedioMensual += promedio; const cardHtml = `<div class="reu-stat-box" style="margin-bottom:10px;"><div><div class="reu-stat-title" style="color:var(--primary)">${d.mes} - ${d.tipo}</div><div class="reu-stat-sub">Asist: ${d.total} | Semanas: ${semanasCount}</div></div><div class="reu-stat-val">${promedio}</div></div>`; summaryContainer.innerHTML += cardHtml; }); const promedioFinalAnual = Math.round(totalPromedioMensual / 12); document.getElementById('reuTotalAnual').textContent = promedioFinalAnual; 
}
function editarReunion(r) { if (!isAdmin) return; const f = document.getElementById('formReunion'); document.getElementById('reunionId').value = r.id; f.mes.value = r.mes; f.tipo.value = r.tipo; f.modalidad.value = r.modalidad; f.sem1.value = r.sem1 || 0; f.sem2.value = r.sem2 || 0; f.sem3.value = r.sem3 || 0; f.sem4.value = r.sem4 || 0; f.sem5.value = r.sem5 || 0; abrirModal('reunion', r.id); }
function resetFormReu() { document.getElementById('formReunion').reset(); document.getElementById('reunionId').value = ""; }
document.getElementById('formReunion').addEventListener('submit', async (e) => { e.preventDefault(); const data = Object.fromEntries(new FormData(e.target)); data.requester_group = session.grupo; data.anio_servicio = getAnio(); /* AÑO AÑADIDO */ const id = document.getElementById('reunionId').value; const method = id ? 'PUT' : 'POST'; const url = id ? `/api/reuniones/${id}` : '/api/reuniones'; const res = await fetch(url, { method: method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); if (res.ok) { Toast.fire({ icon: 'success', title: 'Guardado' }); cerrarModal(); resetFormReu(); cargarTablaReuniones(); } else { Swal.fire('Error', 'No se pudo guardar', 'error'); } });

// --- CIERRES ---
async function verificarCierres() {
    try {
        const res = await fetch(`/api/cierres?anio_servicio=${getAnio()}`); // AÑO AÑADIDO
        mesesCerrados = await res.json();
        Array.from(formMesSelect.options).forEach(opt => {
            if (opt.value !== "") { opt.disabled = false; opt.textContent = opt.value; }
            if (mesesCerrados.includes(opt.value)) { opt.disabled = true; opt.textContent += " (Cerrado)"; }
        });
        if (!document.getElementById('informeId').value) aplicarBloqueoMesForm(formMesSelect);
    } catch (e) { console.error(e); }
}

async function cerrarMes() {
    const mes = document.getElementById('dashMesSelect').value;
    const confirm = await Swal.fire({ title: `¿Cerrar ${mes}?`, icon: 'warning', showCancelButton: true, confirmButtonText: 'Sí, Cerrar' });
    if (confirm.isConfirmed) {
        const res = await fetch('/api/cerrar-mes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mes, requester_group: session.grupo, anio_servicio: getAnio() }) });
        const json = await res.json();
        if (json.ok) { Swal.fire('Cerrado', `Mes ${mes} cerrado.`, 'success'); verificarCierres(); } else { Swal.fire('Error', json.msg, 'error'); }
    }
}

async function cargarTablaCierres() {
    try {
        // Asegúrate de usar la ruta con el año actual
        const res = await fetch(`/api/cierres?anio_servicio=${getAnio()}`); 
        let meses = await res.json();
        const contenedor = document.getElementById('listaCierresFlex');

        if (!contenedor) return;

        contenedor.innerHTML = '';

        if (meses.length === 0) {
            contenedor.innerHTML = '<div style="text-align:center; padding:30px; color:#94a3b8; font-size:0.95rem;">No hay meses cerrados en este año.</div>';
            return;
        }

        const ORDEN_AÑO = [
            'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE', 
            'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO'
        ];

        meses.sort((a, b) => {
            return ORDEN_AÑO.indexOf(b) - ORDEN_AÑO.indexOf(a);
        });

        meses.forEach(mes => {
            contenedor.innerHTML += `
            <div style="display: flex; justify-content: space-between; align-items: center; background: #f8fafc; padding: 12px 15px; border-radius: 8px; border: 1px solid #e2e8f0; margin-bottom: 10px;">
                <span style="font-weight: bold; color: #334155; font-size: 0.95rem;">${mes}</span>
                
                <!-- Le quitamos la clase btn-action y le dimos formato de botón rectangular -->
                <button type="button" onclick="reabrirMes('${mes}')" style="background:#f59e0b; color:white; padding:8px 16px; border-radius:6px; border:none; cursor:pointer; font-weight: 600; display: inline-flex; align-items: center; justify-content: center; gap: 8px; font-size: 0.85rem; box-shadow: 0 2px 4px rgba(245, 158, 11, 0.2); transition: all 0.2s ease;" title="Reabrir Mes" onmouseover="this.style.background='#d97706'" onmouseout="this.style.background='#f59e0b'">
                    <i class="fa-solid fa-unlock-keyhole"></i> Reabrir
                </button>
            </div>`;
        });
    } catch (error) {
        console.error("Error al cargar cierres:", error);
    }
}

async function reabrirMes(mes) {
    const confirm = await Swal.fire({ title: `¿Reabrir ${mes}?`, icon: 'warning', showCancelButton: true, confirmButtonColor: '#f59e0b', confirmButtonText: 'Sí, Reabrir' });
    if (confirm.isConfirmed) {
        try {
            const res = await fetch('/api/reabrir-mes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mes: mes, requester_group: session.grupo, anio_servicio: getAnio() }) });
            const json = await res.json();
            if (json.ok) { Swal.fire('Reabierto', `Listo.`, 'success'); cargarTablaCierres(); verificarCierres(); } else { Swal.fire('Error', json.msg, 'error'); }
        } catch (error) { console.error(error); }
    }
}

// --- REPORTES ---
function limpiarFiltrosReporte() { document.getElementById('formReporte').reset(); document.getElementById('reporteResultados').style.display = 'none'; currentReportData = []; }
function limpiarFiltrosPub() { document.getElementById('pubFiltroNombre').value = ''; document.getElementById('pubFiltroPriv3').value = ''; if (isAdmin) document.getElementById('pubFiltroGrupo').value = ''; cargarTablaPublicadores(); }

async function generarReporte() {
    const form = document.getElementById('formReporte');
    const data = { mes: form.mes.value, grupo: form.grupo.value, priv3: form.priv3.value, nombre: form.nombre.value, anio_servicio: getAnio() }; // AÑO AÑADIDO
    const res = await fetch('/api/reportes/advanced', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    currentReportData = await res.json(); document.getElementById('reporteResultados').style.display = 'block'; document.getElementById('repTotalRows').textContent = currentReportData.length;
    const tbody = document.getElementById('tbodyReporte'); tbody.innerHTML = ''; let sumHoras = 0; let sumCursos = 0; let sumCredito = 0; let counts = {};
    currentReportData.forEach(r => {
        sumHoras += parseFloat(r.horas || 0); sumCursos += parseInt(r.cursos || 0); sumCredito += parseFloat(r.credito_hrs || 0); const cat = r.priv3 || 'OTROS'; counts[cat] = (counts[cat] || 0) + 1; const idPublicador = r.publicador_id || r.id;
        tbody.innerHTML += `<tr><td>${r.mes}</td><td>${r.grupo}</td><td>${r.nombre_publicador || r.publicador_nombre}</td><td><span class="badge badge-gray">${r.priv3}</span></td><td>${r.horas}</td><td>${r.cursos}</td><td>${r.credito_hrs || '-'}</td><td>${r.predico}</td><td>${r.comentarios || ''}</td><td style="text-align: center;"><button type="button" class="btn-action" onclick="iniciarRellenadoTarjeta(${idPublicador})" title="Rellenar S-21" style="background: none; border: none; cursor: pointer;"><i class="fa-solid fa-file-signature" style="color: #059669; font-size: 1.2rem;"></i></button></td></tr>`;
    });
    document.getElementById('repSumHoras').textContent = sumHoras; document.getElementById('repSumCursos').textContent = sumCursos; document.getElementById('repSumCredito').textContent = sumCredito;
    let catsHtml = ''; for (const [key, value] of Object.entries(counts)) { catsHtml += `<div>${key}: <b>${value}</b></div>`; } document.getElementById('repCats').innerHTML = catsHtml;
}

async function descargarPDF() {
    const mes = document.getElementById('repMesSelect').value || ''; const grupo = document.getElementById('formReporte').grupo.value;
    if (currentReportData.length === 0) { Swal.fire('Vacío', 'Presiona "Buscar" primero.', 'info'); return; }
    try {
        const res = await fetch(`/api/reportes/datos-extra?mes=${mes}&grupo=${grupo}&anio_servicio=${getAnio()}`); // AÑO AÑADIDO
        const extra = await res.json();
        let stats = { pub: { cant: 0, horas: 0, cursos: 0 }, aux: { cant: 0, horas: 0, cursos: 0 }, reg: { cant: 0, horas: 0, cursos: 0 } };
        currentReportData.forEach(r => {
            const p = (r.priv3 || '').toUpperCase(); const h = parseFloat(r.horas) || 0; const c = parseInt(r.cursos) || 0;
            if (p === 'REG' || p === 'ESP') { stats.reg.cant++; stats.reg.horas += h; stats.reg.cursos += c; } else if (p.includes('AUX')) { stats.aux.cant++; stats.aux.horas += h; stats.aux.cursos += c; } else { stats.pub.cant++; stats.pub.cursos += c; }
        });
        const { jsPDF } = window.jspdf; const doc = new jsPDF();
        const tituloReporte = mes === '' ? 'REPORTE ANUAL' : `REPORTE - ${mes}`; doc.setFontSize(16); doc.setFont("helvetica", "bold"); doc.text(tituloReporte, 105, 20, null, null, "center"); doc.setFontSize(10); doc.setFont("helvetica", "normal"); doc.text(`Generado: ${new Date().toLocaleDateString()} | Año: ${getAnio()}`, 105, 26, null, null, "center");
        let y = 35; const xL = 14; doc.setFillColor(245, 247, 250); doc.rect(xL, y - 5, 182, 16, 'F'); doc.setFont("helvetica", "bold");
        const labelAsistencia = mes === '' ? 'Promedio Asistencia (Anual):' : 'Promedio Asistencia (Fin Sem):';
        doc.text(`Publicadores Activos: ${extra.activos}`, xL + 5, y + 2); doc.text(`${labelAsistencia} ${extra.asistencia}`, xL + 80, y + 2);
        y += 20; const col1 = xL; const col2 = xL + 60; const col3 = xL + 120;
        doc.setFontSize(11); doc.setTextColor(37, 99, 235); doc.text("PUBLICADORES", col1, y); doc.text("AUXILIARES", col2, y); doc.text("REGULARES", col3, y); y += 7;
        doc.setTextColor(0, 0, 0); doc.setFontSize(10);
        doc.text(`Cantidad: ${stats.pub.cant}`, col1, y); doc.text(`Cantidad: ${stats.aux.cant}`, col2, y); doc.text(`Cantidad: ${stats.reg.cant}`, col3, y); y += 6;
        doc.text(`Cursos: ${stats.pub.cursos}`, col1, y); doc.text(`Horas: ${stats.aux.horas}`, col2, y); doc.text(`Horas: ${stats.reg.horas}`, col3, y); y += 6;
        doc.text(``, col1, y); doc.text(`Cursos: ${stats.aux.cursos}`, col2, y); doc.text(`Cursos: ${stats.reg.cursos}`, col3, y); y += 12;
        const body = currentReportData.map(r => [ r.mes, r.grupo, r.nombre_publicador || r.publicador_nombre, r.priv3, r.horas, r.cursos, r.credito_hrs, r.predico, r.comentarios ]);
        doc.autoTable({ startY: y, head: [['Mes', 'Grp', 'Nombre', 'Priv', 'Hrs', 'Cur', 'Cred', 'Pred', 'Com']], body: body, theme: 'grid', styles: { fontSize: 8, cellPadding: 2 }, headStyles: { fillColor: [37, 99, 235] } });
        doc.save(mes === '' ? `Reporte_Anual_${getAnio()}.pdf` : `Reporte_${mes}_${getAnio()}.pdf`);
    } catch (e) { console.error(e); }
}

let currentPrecData = []; let currentPrecTipo = '';
function abrirModalPrecursores() {
    const modalWrapper = document.getElementById('mainModal'); const modalBody = document.getElementById('modalBody'); const modalTitle = document.getElementById('modalTitle');
    modalTitle.innerHTML = '<i class="fa-solid fa-stopwatch"></i> Progreso de Precursores';
    modalBody.innerHTML = `<div style="display:flex; gap:10px; justify-content:center; margin-bottom:15px;"><button class="btn-primary" onclick="cargarDatosPrecursores('REG')" style="flex:1;">Regulares</button><button class="btn-primary" onclick="cargarDatosPrecursores('AUX')" style="background:#059669; flex:1;">Auxiliares</button></div><div id="precPdfContainer" style="display:none; justify-content:flex-end; margin-bottom:10px; border-bottom:1px solid #e2e8f0; padding-bottom:10px;"><button class="btn-cancel" onclick="descargarPDFPrecursores()" style="background:#475569; color:white; width:auto; padding:8px 16px; font-size:0.85rem;"><i class="fa-solid fa-file-pdf"></i> PDF</button></div><div id="loadingPrec" style="text-align:center; display:none; color:var(--text-muted); margin:20px 0;"><i class="fa-solid fa-circle-notch fa-spin"></i> Cargando datos...</div><div id="tablaPrecContainer" class="table-container" style="max-height:55vh;"><p style="text-align:center; color:#64748b; margin-top:20px;">Selecciona una categoría arriba.</p></div>`;
    modalWrapper.classList.add('active');
}

async function cargarDatosPrecursores(tipo) {
    const container = document.getElementById('tablaPrecContainer'); const loading = document.getElementById('loadingPrec'); const pdfBtn = document.getElementById('precPdfContainer');
    container.innerHTML = ''; loading.style.display = 'block'; pdfBtn.style.display = 'none';
    try {
        const res = await fetch(`/api/reportes/precursores?tipo=${tipo}&anio_servicio=${getAnio()}`); // AÑO AÑADIDO
        const data = await res.json(); currentPrecData = data; currentPrecTipo = tipo; loading.style.display = 'none';
        if (data.length === 0) { container.innerHTML = `<div style="text-align:center; padding:20px; color:#64748b;">No hay precursores ${tipo} con datos.</div>`; return; }
        pdfBtn.style.display = 'flex';
        let html = `<table style="font-size:0.85rem;"><thead style="position:sticky; top:0; background:#f8fafc; z-index:10;"><tr><th style="width:50px;">Grp</th><th style="width:120px;">Nombre</th><th>Detalle Meses</th><th style="text-align:right; width:60px;">Total</th></tr></thead><tbody>`;
        data.forEach(p => {
            let mesesHtml = '';
            if (p.informes.length === 0) mesesHtml = '<span style="color:#cbd5e1; font-size:0.8em;">-</span>';
            else { mesesHtml = '<div style="display:flex; flex-wrap:wrap; gap:4px;">'; p.informes.forEach(inf => { const credTxt = parseFloat(inf.credito_hrs) > 0 ? ` <span style="color:#d97706; font-weight:bold;">(+${inf.credito_hrs})</span>` : ''; mesesHtml += `<span style="background:#eff6ff; color:#1e40af; border:1px solid #dbeafe; padding:2px 6px; border-radius:4px; font-size:0.75em; white-space:nowrap;"><b>${inf.mes}</b>: ${inf.horas}${credTxt}</span>`; }); mesesHtml += '</div>'; }
            html += `<tr><td><span class="badge badge-gray">${p.grupo}</span></td><td style="font-weight:600; color:#334155;">${p.nombre}</td><td>${mesesHtml}</td><td style="text-align:right; font-weight:800; color:var(--primary); font-size:1.1em;">${p.total}</td></tr>`;
        });
        html += `</tbody></table>`; container.innerHTML = html;
    } catch (e) { console.error(e); }
}

function descargarPDFPrecursores() {
    if (currentPrecData.length === 0) return;
    try {
        const { jsPDF } = window.jspdf; const doc = new jsPDF(); const titulo = currentPrecTipo === 'REG' ? 'PRECURSORES REGULARES' : 'PRECURSORES AUXILIARES';
        doc.setFontSize(16); doc.setFont("helvetica", "bold"); doc.text(`Reporte de Progreso - ${titulo}`, 105, 20, null, null, "center"); doc.setFontSize(10); doc.setFont("helvetica", "normal"); doc.text(`Generado: ${new Date().toLocaleDateString()} | Año: ${getAnio()}`, 105, 26, null, null, "center");
        const body = currentPrecData.map(p => [p.grupo, p.nombre, p.informes.map(i => `${i.mes}: ${i.horas}` + (parseFloat(i.credito_hrs) > 0 ? ` (+${i.credito_hrs})` : '')).join(',  ') || '-', p.total]);
        doc.autoTable({ startY: 35, head: [['Grp', 'Nombre', 'Detalle de Horas (Meses)', 'Total']], body: body, theme: 'grid', styles: { fontSize: 9, cellPadding: 3, valign: 'middle' }, headStyles: { fillColor: currentPrecTipo === 'REG' ? [37, 99, 235] : [5, 150, 105] }, columnStyles: { 0: { halign: 'center', width: 15 }, 3: { halign: 'right', fontStyle: 'bold', width: 20 } } });
        doc.save(`Progreso_${titulo}_${getAnio()}.pdf`);
    } catch (e) { console.error(e); }
}

let currentCursosData = null; let currentCursosGrupo = '';
async function abrirModalCursos() {
    const grupo = document.getElementById('formReporte').grupo.value; currentCursosGrupo = grupo;
    const modalWrapper = document.getElementById('mainModal'); const modalBody = document.getElementById('modalBody'); const modalTitle = document.getElementById('modalTitle');
    modalTitle.innerHTML = '<i class="fa-solid fa-book-open-reader" style="color:#f97316;"></i> Reporte Detallado de Cursos';
    modalBody.innerHTML = `<div id="loadingCursos" style="text-align:center; padding:20px;"><i class="fa-solid fa-circle-notch fa-spin"></i> Cargando...</div>`; modalWrapper.classList.add('active');
    try {
        const res = await fetch(`/api/reportes/detalle-cursos?grupo=${grupo}&anio_servicio=${getAnio()}`); // AÑO AÑADIDO
        const data = await res.json(); currentCursosData = data;
        modalBody.innerHTML = `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; flex-wrap:wrap; gap:10px;"><div style="display:flex; gap:15px;"><span style="background:#eff6ff; color:#1d4ed8; padding:5px 10px; border-radius:6px; font-weight:bold; font-size:0.9rem;">Conducen: ${data.totales.conducen}</span><span style="background:#fff7ed; color:#c2410c; padding:5px 10px; border-radius:6px; font-weight:bold; font-size:0.9rem;">Sin Cursos: ${data.totales.no_conducen}</span></div><button class="btn-cancel" onclick="generarPDFCursos()" style="background:#475569; color:white; width:auto; padding:8px 16px; font-size:0.85rem;"><i class="fa-solid fa-file-pdf"></i> Descargar PDF</button></div><div style="max-height:60vh; overflow-y:auto; padding-right:5px;"><h4 style="color:#1d4ed8; border-bottom:2px solid #bfdbfe; padding-bottom:5px; margin-bottom:10px;">1. Publicadores que conducen cursos</h4><table style="width:100%; border-collapse:collapse; font-size:0.85rem; margin-bottom:20px;"><thead><tr style="background:#f1f5f9; text-align:left;"><th style="padding:8px; border-bottom:1px solid #cbd5e1; width:50px;">Grp</th><th style="padding:8px; border-bottom:1px solid #cbd5e1;">Nombre</th><th style="padding:8px; border-bottom:1px solid #cbd5e1;">Meses</th></tr></thead><tbody>${data.conducen.length === 0 ? '<tr><td colspan="3" style="padding:8px; text-align:center; color:#64748b;">No hay publicadores</td></tr>' : ''}${data.conducen.map(p => `<tr style="border-bottom:1px solid #e2e8f0;"><td style="padding:8px;"><b>${p.grupo}</b></td><td style="padding:8px; font-weight:600; color:#334155;">${p.nombre}</td><td style="padding:8px; color:#64748b;">${p.meses}</td></tr>`).join('')}</tbody></table><h4 style="color:#c2410c; border-bottom:2px solid #fed7aa; padding-bottom:5px; margin-bottom:10px;">2. Publicadores sin cursos</h4><table style="width:100%; border-collapse:collapse; font-size:0.85rem;"><thead><tr style="background:#f1f5f9; text-align:left;"><th style="padding:8px; border-bottom:1px solid #cbd5e1; width:50px;">Grp</th><th style="padding:8px; border-bottom:1px solid #cbd5e1;">Nombre</th></tr></thead><tbody>${data.no_conducen.length === 0 ? '<tr><td colspan="2" style="padding:8px; text-align:center; color:#64748b;">No hay publicadores</td></tr>' : ''}${data.no_conducen.map(p => `<tr style="border-bottom:1px solid #e2e8f0;"><td style="padding:8px;"><b>${p.grupo}</b></td><td style="padding:8px; font-weight:600; color:#334155;">${p.nombre}</td></tr>`).join('')}</tbody></table></div>`;
    } catch (e) { modalBody.innerHTML = `<div style="color:#ef4444; text-align:center; padding:20px;"><b>Error:</b> No se pudieron cargar los datos.</div>`; }
}

function generarPDFCursos() {
    if (!currentCursosData) return;
    try {
        const { jsPDF } = window.jspdf; const doc = new jsPDF(); const data = currentCursosData; const grupo = currentCursosGrupo; let y = 20;
        doc.setFontSize(16); doc.setFont("helvetica", "bold"); doc.text("REPORTE DE CURSOS BÍBLICOS", 105, y, null, null, "center"); y += 8;
        doc.setFontSize(10); doc.setFont("helvetica", "normal"); doc.text(`Generado: ${new Date().toLocaleDateString()} | Grupo: ${grupo || 'TODOS'} | Año: ${getAnio()}`, 105, y, null, null, "center"); y += 15;
        const xL = 14; doc.setFillColor(245, 247, 250); doc.rect(xL, y - 5, 182, 16, 'F'); doc.setFont("helvetica", "bold"); doc.setTextColor(37, 99, 235); doc.text(`Publicadores QUE CONDUCEN: ${data.totales.conducen}`, xL + 5, y + 2); doc.setTextColor(249, 115, 22); doc.text(`Publicadores SIN CURSOS: ${data.totales.no_conducen}`, xL + 100, y + 2); y += 20;
        doc.setTextColor(0, 0, 0); doc.setFontSize(12); doc.text("1. Publicadores que conducen cursos", xL, y); y += 5;
        doc.autoTable({ startY: y, head: [['Grp', 'Nombre', 'Meses con Actividad de Cursos']], body: data.conducen.map(p => [p.grupo, p.nombre, p.meses]), theme: 'grid', styles: { fontSize: 9, cellPadding: 3 }, headStyles: { fillColor: [37, 99, 235] }, columnStyles: { 0: { halign: 'center', width: 15 }, 1: { width: 60 } } });
        y = doc.lastAutoTable.finalY + 15; if (y > 250) { doc.addPage(); y = 20; }
        doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.text("2. Publicadores sin cursos reportados", xL, y); y += 5;
        doc.autoTable({ startY: y, head: [['Grp', 'Nombre']], body: data.no_conducen.map(p => [p.grupo, p.nombre]), theme: 'grid', styles: { fontSize: 9, cellPadding: 3 }, headStyles: { fillColor: [249, 115, 22] }, columnStyles: { 0: { halign: 'center', width: 15 } } });
        doc.save(`Reporte_Cursos_${grupo || 'Global'}_${getAnio()}.pdf`);
    } catch (e) { console.error(e); }
}

let publicadorIdSeleccionado = null; 
let fileHandleS21 = null;

async function iniciarRellenadoTarjeta(id) { 
    publicadorIdSeleccionado = id; 
    try { 
        [fileHandleS21] = await window.showOpenFilePicker({ 
            types: [{ description: 'Documentos PDF (S-21)', accept: { 'application/pdf': ['.pdf'] } }], 
            multiple: false 
        }); 
        ejecutarProcesoModificacion(); 
    } catch (error) { 
        if (error.name !== 'AbortError') Swal.fire('Error', 'Tu navegador no soporta esta función.', 'error'); 
    } 
}

async function ejecutarProcesoModificacion() {
    if (!fileHandleS21 || !publicadorIdSeleccionado) return; 
    Swal.fire({ title: 'Generando PDF...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    
    try {
        // 1. Pedimos los datos al servidor
        const res = await fetch(`/api/publicador/${publicadorIdSeleccionado}/tarjeta?anio_servicio=${getAnio()}`); 
        const data = await res.json(); 
        
        // 2. Leemos la plantilla seleccionada
        const file = await fileHandleS21.getFile(); 
        const plantillaBuffer = await file.arrayBuffer(); 
        
        // 3. Llenamos usando la función maestra actualizada
        const pdfBytes = await rellenarPlantillaPersonalizada(plantillaBuffer, data, data.publicador); 
        
        // 4. Descarga segura mediante Blob (Crea un archivo nuevo)
        const blob = new Blob([pdfBytes], { type: "application/pdf" });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        
        const nombreSeguro = (data.publicador.nombre || "S21").replace(/[^a-zA-Z0-9]/g, '_');
        link.download = `S21_${nombreSeguro}_${getAnio()}.pdf`;
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        Swal.close(); 
        Toast.fire({ icon: 'success', title: 'Tarjeta Descargada' });
        
    } catch (error) { 
        console.error(error);
        Swal.fire('Error', 'No se pudo generar el PDF.', 'error'); 
    }
}


// --- GENERACIÓN MASIVA DE TARJETAS S-21 EN ZIP ---
async function generarTarjetasMasivasZIP() {
    try {
        const [fileHandle] = await window.showOpenFilePicker({
            types: [{ description: 'Plantilla PDF', accept: { 'application/pdf': ['.pdf'] } }],
            multiple: false
        });
        const file = await fileHandle.getFile();
        const plantillaBuffer = await file.arrayBuffer(); 

        Swal.fire({ 
            title: 'Generando Tarjetas...', 
            html: 'Procesando historial y organizando en carpetas.<br><b>No cierres esta ventana.</b>', 
            allowOutsideClick: false, 
            didOpen: () => Swal.showLoading() 
        });

        const zip = new JSZip(); 
        const anio = getAnio();

        const resPubs = await fetch(`/api/publicadores?grupo=0`); 
        const publicadores = await resPubs.json();
        const activos = publicadores.filter(p => p.activo === 1 || p.activo === true);

        for (let pub of activos) {
            const resHist = await fetch(`/api/publicador/${pub.id}/tarjeta?anio_servicio=${anio}`);
            if (!resHist.ok) continue;
            const dataHist = await resHist.json();

            const pdfBytes = await rellenarPlantillaPersonalizada(plantillaBuffer, dataHist, pub);
            
            const nombreSeguro = pub.nombre.replace(/[^a-zA-Z0-9]/g, '_');
            
            // >>> AQUÍ ESTÁ LA MAGIA DE LAS SUBCARPETAS <<<
            const nombreCarpeta = `Grupo ${pub.grupo}`;
            zip.folder(nombreCarpeta).file(`S21_${nombreSeguro}.pdf`, pdfBytes);
        }

        const contenidoZip = await zip.generateAsync({ type: 'blob' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(contenidoZip);
        link.download = `Tarjetas_S21_${anio}.zip`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        Swal.fire('¡Éxito!', 'Las tarjetas han sido organizadas por grupos y descargadas.', 'success');

    } catch (error) {
        console.error(error);
        if (error.name !== 'AbortError') Swal.fire('Error', 'Hubo un problema en la generación masiva.', 'error');
    }
}

async function rellenarPlantillaPersonalizada(plantillaBuffer, dataHistorial, pub) {
    const { PDFDocument } = PDFLib; 
    const pdfDoc = await PDFDocument.load(plantillaBuffer); 
    const form = pdfDoc.getForm();

    const safeSetText = (field, text) => { try { const f = form.getTextField(field); if (f) f.setText(text ? text.toString() : ''); } catch (e) {} };
    const safeCheck = (field, condition) => { try { const f = form.getCheckBox(field); if (f && condition) f.check(); } catch (e) {} };

    // >>> NUEVO: Función auxiliar para invertir la fecha (De YYYY-MM-DD a DD-MM-YYYY) <<<
    const formatearFecha = (fechaIso) => {
        if (!fechaIso) return '';
        const soloFecha = fechaIso.split('T')[0]; // Toma la fecha limpia
        const partes = soloFecha.split('-'); // Corta en [YYYY, MM, DD]
        if (partes.length !== 3) return soloFecha;
        return `${partes[2]}-${partes[1]}-${partes[0]}`; // Lo arma al revés
    };

    // --- DATOS PERSONALES ---
    const nombreFinal = pub.nombre_completo || pub.nombre || '';
    safeSetText('900_1_Text_SanSerif', nombreFinal);
    
    // >>> ACTUALIZADO: Usamos la nueva función formatearFecha <<<
    safeSetText('900_2_Text_SanSerif', formatearFecha(pub.fecha_nacimiento));
    safeSetText('900_5_Text_SanSerif', formatearFecha(pub.fecha_bautismo));

    // Sexo y Esperanza
    if (pub.sexo === 'Hombre') safeCheck('900_3_CheckBox', true);
    if (pub.sexo === 'Mujer') safeCheck('900_4_CheckBox', true);
    if (pub.esperanza === 'Otras ovejas') safeCheck('900_6_CheckBox', true);
    if (pub.esperanza === 'Ungido') safeCheck('900_7_CheckBox', true);

    // Privilegios (Múltiples)
    const privsS21 = pub.privilegio_s21 || '';
    if (privsS21.includes('Anciano')) safeCheck('900_8_CheckBox', true);
    if (privsS21.includes('Siervo ministerial')) safeCheck('900_9_CheckBox', true);
    if (privsS21.includes('Precursor regular')) safeCheck('900_10_CheckBox', true);
    if (privsS21.includes('Precursor especial')) safeCheck('900_11_CheckBox', true);
    if (privsS21.includes('Misionero que sirve en el campo')) safeCheck('900_12_CheckBox', true);

    // Año de servicio
    safeSetText('900_13_Text_C_SanSerif', getAnio().toString());

    // --- INFORMES MENSUALES ---
    const mapaMeses = { 'septiembre': 20, 'octubre': 21, 'noviembre': 22, 'diciembre': 23, 'enero': 24, 'febrero': 25, 'marzo': 26, 'abril': 27, 'mayo': 28, 'junio': 29, 'julio': 30, 'agosto': 31 };
    let totalHoras = 0;

    if (dataHistorial && dataHistorial.informes) {
        dataHistorial.informes.forEach(inf => {
            const mesNombre = (inf.mes || '').toLowerCase().trim();
            const index = mapaMeses[mesNombre];
            if (index) {
                safeCheck(`901_${index}_CheckBox`, (inf.horas > 0 || inf.cursos > 0 || inf.predico === 'SI' || inf.predico === 1));
                if (inf.cursos > 0) safeSetText(`902_${index}_Text_C_SanSerif`, inf.cursos.toString());
                safeCheck(`903_${index}_CheckBox`, (inf.priv3 || '').toUpperCase().includes('AUX'));
                
                const hrs = parseFloat(inf.horas) || 0;
                if (hrs > 0) { 
                    safeSetText(`904_${index}_S21_Value`, hrs.toString()); 
                    totalHoras += hrs; 
                }
                if (inf.comentarios) safeSetText(`905_${index}_Text_SanSerif`, inf.comentarios);
            }
        });
    }
    
    if (totalHoras > 0) safeSetText('904_32_S21_Value', totalHoras.toString());
    
    form.flatten(); 
    return await pdfDoc.save();
}

// --- GENERACIÓN DE REPORTES TOTALES DE CONGREGACIÓN (S-21) ---
async function descargarTotalesS21() {
    try {
        const [fileHandle] = await window.showOpenFilePicker({
            types: [{ description: 'Plantilla PDF', accept: { 'application/pdf': ['.pdf'] } }],
            multiple: false
        });
        const file = await fileHandle.getFile();
        const plantillaBuffer = await file.arrayBuffer(); 

        Swal.fire({ title: 'Generando Totales...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

        const anio = getAnio();
        const res = await fetch(`/api/reportes/totales-s21?anio_servicio=${anio}`);
        const rawData = await res.json();

        // Estructura en blanco para los 12 meses
        const mesesEstructura = () => ({ SEPTIEMBRE: null, OCTUBRE: null, NOVIEMBRE: null, DICIEMBRE: null, ENERO: null, FEBRERO: null, MARZO: null, ABRIL: null, MAYO: null, JUNIO: null, JULIO: null, AGOSTO: null });
        
        let dataCong = mesesEstructura();
        let dataReg = mesesEstructura();
        let dataAux = mesesEstructura();
        let dataPub = mesesEstructura();

        // Agrupar los datos de la base de datos
        rawData.forEach(r => {
            const m = r.mes.toUpperCase().trim();
            if (!dataCong[m]) dataCong[m] = { cantidad: 0, horas: 0, cursos: 0 };
            
            // Sumar al total general de la congregación
            dataCong[m].cantidad += r.cantidad;
            dataCong[m].horas += parseFloat(r.total_horas) || 0;
            dataCong[m].cursos += parseInt(r.total_cursos) || 0;

            // Asignar al grupo específico
            if (r.categoria === 'REG') dataReg[m] = { cantidad: r.cantidad, horas: r.total_horas, cursos: r.total_cursos };
            if (r.categoria === 'AUX') dataAux[m] = { cantidad: r.cantidad, horas: r.total_horas, cursos: r.total_cursos };
            if (r.categoria === 'PUB') dataPub[m] = { cantidad: r.cantidad, horas: r.total_horas, cursos: r.total_cursos };
        });

        const zip = new JSZip();

        // 1. Tarjeta Congregación (Muestra Horas)
        zip.file(`S21_Totales_Congregacion_${anio}.pdf`, await rellenarTarjetaTotales(plantillaBuffer, dataCong, `Totales congregación Melgar (${anio})`, 'Publicadores', true));
        
        // 2. Tarjeta Precursores Regulares (Muestra Horas)
        zip.file(`S21_Totales_Regulares_${anio}.pdf`, await rellenarTarjetaTotales(plantillaBuffer, dataReg, `Totales precursores regulares (${anio})`, 'precursores regulares', true));
        
        // 3. Tarjeta Precursores Auxiliares (Muestra Horas)
        zip.file(`S21_Totales_Auxiliares_${anio}.pdf`, await rellenarTarjetaTotales(plantillaBuffer, dataAux, `Totales precursores auxiliares (${anio})`, 'precursores auxiliares', true));
        
        // 4. Tarjeta Publicadores (NO Muestra Horas)
        zip.file(`S21_Totales_Publicadores_${anio}.pdf`, await rellenarTarjetaTotales(plantillaBuffer, dataPub, `Totales publicadores (${anio})`, 'publicadores', false));

        // Descargar el ZIP
        const contenidoZip = await zip.generateAsync({ type: 'blob' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(contenidoZip);
        link.download = `Totales_S21_Congregacion_${anio}.zip`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        Swal.fire('¡Éxito!', 'Los 4 reportes consolidados han sido descargados en un archivo ZIP.', 'success');

    } catch (error) {
        console.error(error);
        if (error.name !== 'AbortError') Swal.fire('Error', 'No se pudieron generar los reportes.', 'error');
    }
}

// MOTOR ESPECIAL PARA TARJETAS CONSOLIDADAS
// MOTOR ESPECIAL PARA TARJETAS CONSOLIDADAS
async function rellenarTarjetaTotales(plantillaBuffer, datosMeses, titulo, etiquetaNotas, mostrarHoras) {
    const { PDFDocument } = PDFLib; 
    const pdfDoc = await PDFDocument.load(plantillaBuffer); 
    const form = pdfDoc.getForm();
    
    const safeSetText = (f, t) => { try { const field = form.getTextField(f); if (field) field.setText(t ? t.toString() : ''); } catch (e) {} };
    const safeCheck = (f, c) => { try { const field = form.getCheckBox(f); if (field && c) field.check(); } catch (e) {} };

    // Establecer Título y Año
    safeSetText('900_1_Text_SanSerif', titulo);
    safeSetText('900_13_Text_C_SanSerif', getAnio().toString());

    const mapaMeses = { 'SEPTIEMBRE': 20, 'OCTUBRE': 21, 'NOVIEMBRE': 22, 'DICIEMBRE': 23, 'ENERO': 24, 'FEBRERO': 25, 'MARZO': 26, 'ABRIL': 27, 'MAYO': 28, 'JUNIO': 29, 'JULIO': 30, 'AGOSTO': 31 };
    
    let sumaTotalHoras = 0;

    Object.keys(datosMeses).forEach(mes => {
        const data = datosMeses[mes];
        const idx = mapaMeses[mes];
        
        if (data && idx) {
            // Checkbox de participación
            safeCheck(`901_${idx}_CheckBox`, true);
            
            // Cursos Bíblicos
            if (data.cursos > 0) safeSetText(`902_${idx}_Text_C_SanSerif`, data.cursos.toString());
            
            // CONVERSIÓN SEGURA A NÚMERO
            const horasNum = parseFloat(data.horas) || 0;
            
            // Horas (Si la tarjeta lo permite)
            if (mostrarHoras && horasNum > 0) {
                // Formatear a entero si no tiene decimales
                const hrsLimpias = horasNum % 1 === 0 ? horasNum.toString() : horasNum.toFixed(1);
                safeSetText(`904_${idx}_S21_Value`, hrsLimpias);
                sumaTotalHoras += horasNum;
            }
            
            // Columna de Notas (Cantidad de publicadores)
            safeSetText(`905_${idx}_Text_SanSerif`, `${data.cantidad} ${etiquetaNotas}`);
        }
    });

    // Suma final anual de horas
    if (mostrarHoras && sumaTotalHoras > 0) {
        const hrsTotalesLimpias = sumaTotalHoras % 1 === 0 ? sumaTotalHoras.toString() : sumaTotalHoras.toFixed(1);
        safeSetText('904_32_S21_Value', hrsTotalesLimpias);
    }

    form.flatten();
    return await pdfDoc.save();
}

let chartCursosInstance = null;
async function cargarGraficaCursos() {
    const ctx = document.getElementById('graficaCursos'); if (!ctx) return; const grp = isGlobal ? 0 : session.grupo;
    try {
        if (chartCursosInstance) chartCursosInstance.destroy();
        const res = await fetch(`/api/dashboard/cursos-por-mes?grupo=${grp}&anio_servicio=${getAnio()}`);
        const data = await res.json();
        const ORDEN_AÑO = ['SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE', 'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO'];
        const datosPorMes = {}; ORDEN_AÑO.forEach(m => datosPorMes[m] = { pub: 0, aux: 0, reg: 0, hasData: false });
        data.forEach(r => { const m = (r.mes || '').toUpperCase().trim(); if (datosPorMes[m]) { datosPorMes[m].hasData = true; datosPorMes[m].pub = parseInt(r.pub) || 0; datosPorMes[m].aux = parseInt(r.aux) || 0; datosPorMes[m].reg = parseInt(r.reg) || 0; } });
        const labelsMeses = []; const dataPub = []; const dataAux = []; const dataReg = [];
        ORDEN_AÑO.forEach(m => { if (datosPorMes[m].hasData) { labelsMeses.push(m.substring(0, 3)); dataPub.push(datosPorMes[m].pub); dataAux.push(datosPorMes[m].aux); dataReg.push(datosPorMes[m].reg); } });
        if (labelsMeses.length === 0) { labelsMeses.push("Sin Datos"); dataPub.push(0); dataAux.push(0); dataReg.push(0); }
        chartCursosInstance = new Chart(ctx, { type: 'bar', data: { labels: labelsMeses, datasets: [{ label: 'PUB+PNB', data: dataPub, backgroundColor: '#3b82f6', borderRadius: 4 }, { label: 'AUX I+M+C', data: dataAux, backgroundColor: '#8b5cf6', borderRadius: 4 }, { label: 'REGULARES', data: dataReg, backgroundColor: '#10b981', borderRadius: 4 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: true, position: 'bottom' }, tooltip: { mode: 'index', intersect: false, callbacks: { footer: function (ti) { let t = 0; ti.forEach(function (i) { t += i.raw; }); return '\nTotal: ' + t; } } } }, scales: { y: { beginAtZero: true, grid: { borderDash: [5, 5], color: isDarkTheme() ? '#242424' : '#e2e8f0' } }, x: { grid: { display: false } } } } });
    } catch (e) {}
}

let chartComparativaInstance = null;
async function cargarGraficaComparativa() {
    const ctx = document.getElementById('graficaComparativa'); if (!ctx) return; const grp = isGlobal ? 0 : session.grupo;
    try {
        if (chartComparativaInstance) chartComparativaInstance.destroy();
        const res = await fetch(`/api/dashboard/cursos-comparativa?grupo=${grp}&anio_servicio=${getAnio()}`); // AÑO AÑADIDO
        const data = await res.json();
        const ORDEN_AÑO = ['SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE', 'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO'];
        const datosPorMes = {}; ORDEN_AÑO.forEach(m => datosPorMes[m] = { con: 0, sin: 0, hasData: false });
        data.forEach(r => { const m = (r.mes || '').toUpperCase().trim(); if (datosPorMes[m]) { datosPorMes[m].hasData = true; datosPorMes[m].con = parseInt(r.con_cursos) || 0; datosPorMes[m].sin = parseInt(r.sin_cursos) || 0; } });
        const labelsMeses = []; const dataConCursos = []; const dataSinCursos = [];
        ORDEN_AÑO.forEach(m => { if (datosPorMes[m].hasData) { labelsMeses.push(m.substring(0, 3)); dataConCursos.push(datosPorMes[m].con); dataSinCursos.push(datosPorMes[m].sin); } });
        if (labelsMeses.length === 0) { labelsMeses.push("Sin Datos"); dataConCursos.push(0); dataSinCursos.push(0); }
        chartComparativaInstance = new Chart(ctx, { type: 'line', data: { labels: labelsMeses, datasets: [{ label: 'INFORMAN CURSOS', data: dataConCursos, borderColor: '#3b82f6', backgroundColor: '#3b82f6', tension: 0.3, pointRadius: 5, borderWidth: 3 }, { label: 'NO INFORMAN CURSOS', data: dataSinCursos, borderColor: '#f97316', backgroundColor: '#f97316', tension: 0.3, pointRadius: 5, borderWidth: 3 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: true, position: 'bottom' }, tooltip: { mode: 'index', intersect: false, callbacks: { label: function (context) { let v = context.raw; let t = 0; context.chart.data.datasets.forEach(d => { t += d.data[context.dataIndex]; }); let p = t > 0 ? Math.round((v / t) * 100) : 0; return ` ${context.dataset.label}: ${v} (${p}%)`; } } } }, scales: { y: { beginAtZero: true, grid: { borderDash: [5, 5], color: isDarkTheme() ? '#242424' : '#e2e8f0' } }, x: { grid: { display: false } } } } });
    } catch (e) {}
}

let chartAsistenciaInstance = null;
async function cargarGraficaAsistencia() {
    const ctx = document.getElementById('graficaAsistencia'); if (!ctx) return;
    try {
        if (chartAsistenciaInstance) chartAsistenciaInstance.destroy();
        const res = await fetch(`/api/dashboard/asistencia-comparativa?anio_servicio=${getAnio()}`); // AÑO AÑADIDO
        const data = await res.json();
        const ORDEN_AÑO = ['SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE', 'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO'];
        const labelsMeses = []; const dataPresencial = []; const dataZoom = [];
        ORDEN_AÑO.forEach(m => { let mesAbrev = m.substring(0, 3); if (mesAbrev === 'SEP') mesAbrev = 'SET'; labelsMeses.push([mesAbrev, 'ES']); labelsMeses.push([mesAbrev, 'FS']); });
        for(let i = 0; i < 24; i++) { dataPresencial.push(0); dataZoom.push(0); }
        data.forEach(r => {
            const m = (r.mes || '').toUpperCase().trim(); const mesIndex = ORDEN_AÑO.indexOf(m);
            if (mesIndex !== -1) {
                const finalIndex = (mesIndex * 2) + (r.tipo === 'ENTRE SEMANA' ? 0 : 1);
                if (r.modalidad === 'PRESENCIAL') dataPresencial[finalIndex] = r.promedio; else if (r.modalidad === 'ZOOM') dataZoom[finalIndex] = r.promedio;
            }
        });
        let lastDataIndex = 23; while(lastDataIndex >= 0 && dataPresencial[lastDataIndex] === 0 && dataZoom[lastDataIndex] === 0) { lastDataIndex--; }
        let finalLabels = labelsMeses.slice(0, lastDataIndex + 1); let finalPres = dataPresencial.slice(0, lastDataIndex + 1); let finalZoom = dataZoom.slice(0, lastDataIndex + 1);
        if (finalLabels.length === 0) { finalLabels = [['Sin', 'Datos']]; finalPres = [0]; finalZoom = [0]; }
        chartAsistenciaInstance = new Chart(ctx, { type: 'bar', data: { labels: finalLabels, datasets: [{ label: 'PRESENCIAL', data: finalPres, backgroundColor: '#4472c4' }, { label: 'ZOOM', data: finalZoom, backgroundColor: '#ed7d31' }] }, options: { responsive: true, maintainAspectRatio: false, scales: { x: { stacked: true, grid: { display: false }, ticks: { font: { size: 10, weight: 'bold' }, color: isDarkTheme() ? '#a1a1a1' : '#64748b' } }, y: { stacked: true, beginAtZero: true, grid: { color: isDarkTheme() ? '#242424' : '#e2e8f0' } } }, plugins: { legend: { display: true, position: 'bottom', labels: { usePointStyle: true, boxWidth: 10 } }, tooltip: { mode: 'index', intersect: false, callbacks: { footer: function(ti) { let t = 0; ti.forEach(function(i) { t += i.raw; }); return '\nTotal: ' + t; } } } } } });
    } catch (e) {}
}

// --- REPORTE ANUAL DE ASISTENCIA EN PDF (TODOS LOS REGISTROS) ---
async function descargarReporteAsistencia() {
    const anio = getAnio();
    Swal.fire({ title: 'Generando Reporte...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    try {
        const res = await fetch(`/api/reuniones?anio_servicio=${anio}`);
        const reuniones = await res.json();

        if (reuniones.length === 0) {
            Swal.fire('Vacío', 'No hay datos de reuniones registrados para este año.', 'info');
            return;
        }

        // 1. Calcular las matemáticas para los promedios anuales
        let semanasEntre = 0; let semanasFin = 0;
        let totalEntrePres = 0; let totalEntreZoom = 0;
        let totalFinPres = 0; let totalFinZoom = 0;

        let mesesMap = {};
        reuniones.forEach(r => {
            const key = `${r.mes}-${r.tipo}`;
            if (!mesesMap[key]) mesesMap[key] = { semanas: 0 };
            
            const s1 = parseInt(r.sem1) || 0; const s2 = parseInt(r.sem2) || 0; 
            const s3 = parseInt(r.sem3) || 0; const s4 = parseInt(r.sem4) || 0; 
            const s5 = parseInt(r.sem5) || 0;
            const suma = s1 + s2 + s3 + s4 + s5;
            
            let weeks = 0;
            if (s1 > 0) weeks++; if (s2 > 0) weeks++; if (s3 > 0) weeks++; 
            if (s4 > 0) weeks++; if (s5 > 0) weeks++;
            
            if (weeks > mesesMap[key].semanas) mesesMap[key].semanas = weeks;

            if (r.tipo === 'ENTRE SEMANA') {
                if (r.modalidad === 'PRESENCIAL') totalEntrePres += suma;
                if (r.modalidad === 'ZOOM') totalEntreZoom += suma;
            } else {
                if (r.modalidad === 'PRESENCIAL') totalFinPres += suma;
                if (r.modalidad === 'ZOOM') totalFinZoom += suma;
            }
        });

        // Sumamos las semanas reales que tuvo el año por cada tipo de reunión
        Object.keys(mesesMap).forEach(key => {
            if (key.includes('ENTRE SEMANA')) semanasEntre += mesesMap[key].semanas;
            if (key.includes('FIN DE SEMANA')) semanasFin += mesesMap[key].semanas;
        });

        // Promedios Desglosados
        const promEntrePres = semanasEntre > 0 ? Math.round(totalEntrePres / semanasEntre) : 0;
        const promEntreZoom = semanasEntre > 0 ? Math.round(totalEntreZoom / semanasEntre) : 0;
        const promEntreTot = promEntrePres + promEntreZoom;

        const promFinPres = semanasFin > 0 ? Math.round(totalFinPres / semanasFin) : 0;
        const promFinZoom = semanasFin > 0 ? Math.round(totalFinZoom / semanasFin) : 0;
        const promFinTot = promFinPres + promFinZoom;

        // Promedio Global Anual (La media de ambas reuniones)
        const promGlobalPres = Math.round((promEntrePres + promFinPres) / 2);
        const promGlobalZoom = Math.round((promEntreZoom + promFinZoom) / 2);
        const promGlobalTot = promGlobalPres + promGlobalZoom;

        // 2. Construir la Tabla de Todos los Registros
        const tablaRegistros = [];
        const ORDEN_MESES = ['SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE', 'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO'];
        
        reuniones.sort((a, b) => {
            const mA = ORDEN_MESES.indexOf(a.mes.toUpperCase());
            const mB = ORDEN_MESES.indexOf(b.mes.toUpperCase());
            if (mA !== mB) return mA - mB;
            if (a.tipo !== b.tipo) return a.tipo.localeCompare(b.tipo);
            return a.modalidad.localeCompare(b.modalidad);
        });

        reuniones.forEach(r => {
            const s1 = parseInt(r.sem1) || 0; const s2 = parseInt(r.sem2) || 0; 
            const s3 = parseInt(r.sem3) || 0; const s4 = parseInt(r.sem4) || 0; 
            const s5 = parseInt(r.sem5) || 0;
            const suma = s1 + s2 + s3 + s4 + s5;
            
            let weeks = 0;
            if (s1 > 0) weeks++; if (s2 > 0) weeks++; if (s3 > 0) weeks++; 
            if (s4 > 0) weeks++; if (s5 > 0) weeks++;
            
            const prom = weeks > 0 ? Math.round(suma / weeks) : 0;
            
            tablaRegistros.push([
                r.mes, 
                r.tipo === 'ENTRE SEMANA' ? 'Entre Sem' : 'Fin Sem', 
                r.modalidad === 'PRESENCIAL' ? 'Pres' : 'Zoom', 
                s1 || '-', s2 || '-', s3 || '-', s4 || '-', s5 || '-', 
                prom
            ]);
        });

        // 3. Dibujar el PDF
        const { jsPDF } = window.jspdf; 
        const doc = new jsPDF();
        
        let y = 15;
        doc.setFontSize(14); doc.setFont("helvetica", "bold"); 
        doc.text("REGISTROS DE ASISTENCIA A LAS REUNIONES", 105, y, null, null, "center"); y += 6;
        
        doc.setFontSize(10); doc.setFont("helvetica", "normal"); 
        doc.text(`Año de Servicio: ${anio} | Generado: ${new Date().toLocaleDateString()}`, 105, y, null, null, "center"); y += 10;

        // --- SECCIÓN ARRIBA: PROMEDIO ANUAL GLOBAL ---
        doc.setFillColor(238, 242, 255); 
        doc.rect(14, y, 182, 20, 'F');
        
        doc.setFontSize(10); doc.setFont("helvetica", "bold"); doc.setTextColor(67, 56, 202);
        doc.text("PROMEDIO ANUAL GLOBAL", 105, y + 6, null, null, "center");
        
        doc.setFontSize(10); doc.setTextColor(30, 41, 59);
        doc.text(`Presencial: ${promGlobalPres}   |   Zoom: ${promGlobalZoom}   |   Total: ${promGlobalTot}`, 105, y + 14, null, null, "center");
        y += 24;

        // --- SECCIÓN ABAJO: DESGLOSE POR TIPO DE REUNIÓN ---
        doc.setFillColor(241, 245, 249); 
        doc.rect(14, y, 88, 22, 'F');
        doc.rect(108, y, 88, 22, 'F');
        
        doc.setFontSize(10); doc.setFont("helvetica", "bold"); doc.setTextColor(37, 99, 235);
        doc.text("ENTRE SEMANA", 58, y + 6, null, null, "center");
        doc.text("FIN DE SEMANA", 152, y + 6, null, null, "center");
        
        doc.setFontSize(9); doc.setTextColor(71, 85, 105); doc.setFont("helvetica", "normal");
        doc.text(`Presencial: ${promEntrePres}   |   Zoom: ${promEntreZoom}`, 58, y + 13, null, null, "center");
        doc.text(`Total: ${promEntreTot}`, 58, y + 18, null, null, "center");

        doc.text(`Presencial: ${promFinPres}   |   Zoom: ${promFinZoom}`, 152, y + 13, null, null, "center");
        doc.text(`Total: ${promFinTot}`, 152, y + 18, null, null, "center");
        
        y += 28;

        // --- TABLA DETALLADA: TODOS LOS REGISTROS ---
        doc.autoTable({ 
            startY: y, 
            head: [['Mes', 'Reunión', 'Modalidad', 'S1', 'S2', 'S3', 'S4', 'S5', 'Promedio']], 
            body: tablaRegistros, 
            theme: 'grid', 
            styles: { fontSize: 8, cellPadding: 2, halign: 'center', valign: 'middle' }, 
            headStyles: { fillColor: [71, 85, 105] },
            columnStyles: { 
                0: { halign: 'left', fontStyle: 'bold' },
                1: { halign: 'left' }
            }
        });

        doc.save(`Registros_Asistencia_${anio}.pdf`);
        Swal.close();

    } catch (error) {
        console.error(error);
        Swal.fire('Error', 'No se pudo generar el reporte.', 'error');
    }
}

document.addEventListener("DOMContentLoaded", () => {
    cargarGraficaCursos();
    cargarGraficaComparativa();
    cargarGraficaAsistencia();
});

// --- USUARIOS ---
function editarUser(id) { const obj = cacheUsuarios.find(u => u.id == id); if (!obj) return; const f = document.getElementById('formUsuario'); document.getElementById('userId').value = obj.id; f.nombre.value = obj.nombre; f.correo.value = obj.correo; f.password.value = ''; f.grupo.value = obj.grupo; abrirModal('usuario', id); }
function resetFormUser() { document.getElementById('formUsuario').reset(); document.getElementById('userId').value = ""; }
document.getElementById('formUsuario').addEventListener('submit', async (e) => { e.preventDefault(); const data = Object.fromEntries(new FormData(e.target)); const id = document.getElementById('userId').value; const method = id ? 'PUT' : 'POST'; const url = id ? `/api/usuarios/${id}` : '/api/usuarios'; data.requester_group = session.grupo; await fetch(url, { method: method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); Toast.fire({ icon: 'success', title: id ? 'Actualizado' : 'Creado' }); cerrarModal(); resetFormUser(); cargarTablaUsuarios(); });
async function cargarTablaUsuarios() { if (!isAdmin) return; const res = await fetch('/api/usuarios'); cacheUsuarios = await res.json(); const tbody = document.getElementById('tablaUsuarios'); tbody.innerHTML = ''; cacheUsuarios.forEach(d => { tbody.innerHTML += `<tr><td>${d.nombre}</td><td>${d.correo}</td><td>Grupo ${d.grupo}</td><td>••••••</td><td><button class="btn-action btn-edit" onclick="editarUser(${d.id})"><i class="fa-solid fa-pen-to-square"></i></button> <button class="btn-action btn-del" onclick="eliminar('usuarios', ${d.id})"><i class="fa-solid fa-trash-can"></i></button></td></tr>`; }); }
async function eliminar(entidad, id) { const result = await Swal.fire({ title: '¿Eliminar?', icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444' }); if (result.isConfirmed) { const params = new URLSearchParams(); params.append('requester_group', session.grupo); params.append('anio_servicio', getAnio()); if (entidad === 'informes') { const inf = cacheInformes.find(i => i.id == id); if (inf) params.append('mes', inf.mes); } const res = await fetch(`/api/${entidad}/${id}?${params.toString()}`, { method: 'DELETE' }); const json = await res.json(); if (json.ok) { Toast.fire({ icon: 'success', title: 'Listo' }); if (entidad === 'informes') cargarTablaInformes(); if (entidad === 'publicadores') cargarTablaPublicadores(); if (entidad === 'usuarios') cargarTablaUsuarios(); if (entidad === 'reuniones') cargarTablaReuniones(); if (entidad === 'territorios') cargarVistaTerritorios(); if (entidad === 'conductores') cargarConductoresData(); if (entidad === 'turnos') cargarTurnosData(); if (entidad === 'territorios/bitacora') cargarVistaTerritorios(); } else { Swal.fire('Error', json.msg, 'error'); } } }

// ==========================================================================
// MÓDULO DE TERRITORIOS (Catálogo, Conductores, Turnos, Bitácora y S-13)
// ==========================================================================
let cacheTerritorios = [];
let cacheConductores = [];
let cacheTurnos = [];
let cacheBitacoraTerr = [];
let chartTerritoriosInstance = null;
let manzanasSeleccionadasSet = new Set();
let infoManzanasActual = null;

function mostrarSubTabTerritorio(tab) {
    document.querySelectorAll('.terr-tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.terr-subview').forEach(v => v.classList.remove('active'));
    const btn = document.getElementById('tab-terr-' + tab);
    const view = document.getElementById('subview-terr-' + tab);
    if (btn) btn.classList.add('active');
    if (view) view.classList.add('active');
}

async function cargarVistaTerritorios() {
    await Promise.all([
        cargarTerritoriosData(),
        cargarConductoresData(),
        cargarTurnosData(),
        cargarBitacoraTerritorios()
    ]);
}

async function cargarTerritoriosData() {
    try {
        const res = await fetch('/api/territorios');
        cacheTerritorios = await res.json();
        const countEl = document.getElementById('countTerrCatalogo');
        if (countEl) countEl.textContent = cacheTerritorios.length;

        // Llenar filtro de bitácora
        const filtro = document.getElementById('filtroBitacoraTerritorio');
        if (filtro) {
            const valPrev = filtro.value;
            filtro.innerHTML = '<option value="">(Todos los territorios)</option>';
            cacheTerritorios.forEach(t => {
                filtro.innerHTML += `<option value="${t.id}">Territorio ${t.numero} ${t.nombre ? '- ' + t.nombre : ''}</option>`;
            });
            filtro.value = valPrev;
        }

        renderTarjetasTerritorios();
        renderTablaCatalogoTerritorios();
        renderGraficaTerritorios();
    } catch (e) { console.error(e); }
}

function renderTarjetasTerritorios() {
    const cont = document.getElementById('gridTarjetasTerritorios');
    if (!cont) return;
    if (cacheTerritorios.length === 0) {
        cont.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:24px; color:#8f8f8f;">No hay territorios registrados aún. Usa el botón "Nuevo Territorio" para empezar.</div>';
        return;
    }
    cont.innerHTML = '';
    cacheTerritorios.forEach(t => {
        let pills = '';
        const det = t.manzanas_detalle || {};
        for (let m = 1; m <= t.cantidad_manzanas; m++) {
            const st = det[m];
            const cls = st === 'COMPLETO' ? 'is-completo' : (st === 'INCOMPLETO' ? 'is-incompleto' : '');
            const title = st === 'COMPLETO' ? 'Manzana ' + m + ': Completa' : (st === 'INCOMPLETO' ? 'Manzana ' + m + ': Incompleta (a medias)' : 'Manzana ' + m + ': Pendiente');
            pills += `<span class="manzana-pill ${cls}" title="${title}">${m}</span>`;
        }
        const badgeEstado = t.estado_actual === 'CIERRE'
            ? '<span class="badge badge-si">CIERRE (100%)</span>'
            : (t.estado_actual === 'INICIO' ? '<span class="badge badge-grp">INICIO (En curso)</span>' : '<span class="badge badge-gray">SIN INICIAR</span>');

        const vComp = t.vueltas_completas || 0;
        const vIncomp = t.vueltas_incompletas || 0;
        cont.innerHTML += `
            <div class="terr-card">
                <div class="terr-card-head">
                    <div>
                        <div class="terr-card-title">Territorio ${t.numero}</div>
                        <div class="terr-card-sub">${t.nombre ? t.nombre + ' · ' : ''}${t.fecha_inicio ? 'Inicio: ' + String(t.fecha_inicio).split('T')[0] : 'Sin registros'}${t.fecha_cierre ? ' · Cierre: ' + String(t.fecha_cierre).split('T')[0] : ''}</div>
                    </div>
                    ${badgeEstado}
                </div>
                <div style="display:flex; gap:6px; flex-wrap:wrap; margin:4px 0 6px 0;">
                    <span class="badge badge-si" style="font-size:0.72rem;">Vueltas completas: ${vComp}</span>
                    <span class="badge ${vIncomp > 0 ? 'badge-no' : 'badge-gray'}" style="font-size:0.72rem;">Vueltas incompletas: ${vIncomp}</span>
                </div>
                <div>
                    <div style="display:flex; justify-content:space-between; font-size:0.78rem; margin-bottom:4px;">
                        <span>Manzanas: <strong>${t.completadas}/${t.cantidad_manzanas}</strong> completas</span>
                        <strong>${t.porcentaje}%</strong>
                    </div>
                    <div class="progress-bar-bg"><div class="progress-bar-fill" style="width:${t.porcentaje}%"></div></div>
                </div>
                <div class="manzanas-mini-grid">${pills}</div>
            </div>
        `;
    });
}

function renderTablaCatalogoTerritorios() {
    const tbody = document.getElementById('tablaCatalogoTerritorios');
    if (!tbody) return;
    if (cacheTerritorios.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:20px; color:#8f8f8f;">Sin territorios registrados.</td></tr>';
        return;
    }
    tbody.innerHTML = '';
    cacheTerritorios.forEach(t => {
        const badge = t.estado_actual === 'CIERRE'
            ? '<span class="badge badge-si">CIERRE</span>'
            : (t.estado_actual === 'INICIO' ? '<span class="badge badge-grp">INICIO</span>' : '<span class="badge badge-gray">SIN INICIAR</span>');
        const acciones = isAdmin
            ? `<button class="btn-action btn-edit" onclick="editarTerritorio(${t.id})" title="Editar"><i class="fa-solid fa-pen-to-square"></i></button>
               <button class="btn-action btn-del" onclick="eliminar('territorios', ${t.id})" title="Eliminar"><i class="fa-solid fa-trash-can"></i></button>`
            : '-';
        tbody.innerHTML += `
            <tr>
                <td><strong>Territorio ${t.numero}</strong></td>
                <td>${t.nombre || '-'}</td>
                <td>Manzanas 1 a ${t.cantidad_manzanas} (${t.cantidad_manzanas} en total)</td>
                <td><span class="badge badge-si">Completas: ${t.vueltas_completas || 0}</span> <span class="badge ${(t.vueltas_incompletas || 0) > 0 ? 'badge-no' : 'badge-gray'}">Incompletas: ${t.vueltas_incompletas || 0}</span></td>
                <td>${t.completadas}/${t.cantidad_manzanas} (${t.porcentaje}%)</td>
                <td>${badge}</td>
                <td class="admin-only" style="display:${isAdmin ? 'table-cell' : 'none'}">${acciones}</td>
            </tr>
        `;
    });
}

function renderGraficaTerritorios() {
    const canvas = document.getElementById('graficaTerritorios');
    if (!canvas) return;
    if (chartTerritoriosInstance) chartTerritoriosInstance.destroy();
    const labels = cacheTerritorios.length ? cacheTerritorios.map(t => 'T-' + t.numero) : ['Sin territorios'];
    const valores = cacheTerritorios.length ? cacheTerritorios.map(t => t.porcentaje) : [0];
    const dark = typeof isDarkTheme === 'function' && isDarkTheme();

    chartTerritoriosInstance = new Chart(canvas, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: '% Cobertura (Vuelta Actual)',
                data: valores,
                backgroundColor: valores.map(p => p >= 100 ? '#10b981' : (dark ? '#ededed' : '#171717')),
                borderRadius: 5
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, max: 100, grid: { color: dark ? '#242424' : '#e2e8f0' } },
                x: { grid: { display: false } }
            }
        }
    });
}

async function cargarConductoresData() {
    try {
        const res = await fetch('/api/conductores');
        cacheConductores = await res.json();
        const countEl = document.getElementById('countTerrConductores');
        if (countEl) countEl.textContent = cacheConductores.length;

        const tbody = document.getElementById('tablaConductores');
        if (!tbody) return;
        if (cacheConductores.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding:20px; color:#8f8f8f;">No hay conductores registrados.</td></tr>';
            return;
        }
        tbody.innerHTML = '';
        cacheConductores.forEach(c => {
            const acciones = isAdmin
                ? `<button class="btn-action btn-edit" onclick="editarConductor(${c.id})" title="Editar"><i class="fa-solid fa-pen-to-square"></i></button>
                   <button class="btn-action btn-del" onclick="eliminar('conductores', ${c.id})" title="Eliminar"><i class="fa-solid fa-trash-can"></i></button>`
                : '-';
            tbody.innerHTML += `
                <tr>
                    <td><strong>${c.nombre}</strong></td>
                    <td><span class="badge badge-si">ACTIVO</span></td>
                    <td class="admin-only" style="display:${isAdmin ? 'table-cell' : 'none'}">${acciones}</td>
                </tr>
            `;
        });
    } catch (e) { console.error(e); }
}

async function cargarTurnosData() {
    try {
        const res = await fetch('/api/turnos');
        cacheTurnos = await res.json();
        const countEl = document.getElementById('countTerrTurnos');
        if (countEl) countEl.textContent = cacheTurnos.length;

        const tbody = document.getElementById('tablaTurnos');
        if (!tbody) return;
        if (cacheTurnos.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding:20px; color:#8f8f8f;">No hay turnos creados.</td></tr>';
            return;
        }
        tbody.innerHTML = '';
        cacheTurnos.forEach(t => {
            const acciones = isAdmin
                ? `<button class="btn-action btn-edit" onclick="editarTurno(${t.id})" title="Editar"><i class="fa-solid fa-pen-to-square"></i></button>
                   <button class="btn-action btn-del" onclick="eliminar('turnos', ${t.id})" title="Eliminar"><i class="fa-solid fa-trash-can"></i></button>`
                : '-';
            tbody.innerHTML += `
                <tr>
                    <td><strong>${t.nombre}</strong></td>
                    <td>${t.horario || '-'}</td>
                    <td class="admin-only" style="display:${isAdmin ? 'table-cell' : 'none'}">${acciones}</td>
                </tr>
            `;
        });
    } catch (e) { console.error(e); }
}

async function cargarBitacoraTerritorios() {
    try {
        const fTerr = document.getElementById('filtroBitacoraTerritorio')?.value || '';
        const url = fTerr ? `/api/territorios/bitacora?territorio_id=${fTerr}` : '/api/territorios/bitacora';
        const res = await fetch(url);
        cacheBitacoraTerr = await res.json();

        const tbody = document.getElementById('tablaBitacoraTerritorios');
        if (!tbody) return;
        if (cacheBitacoraTerr.length === 0) {
            tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; padding:24px; color:#8f8f8f;">No hay registros en la bitácora todavía.</td></tr>';
            return;
        }
        tbody.innerHTML = '';
        cacheBitacoraTerr.forEach(b => {
            const fechaStr = b.fecha ? String(b.fecha).split('T')[0] : '-';
            const fechaCierreRaw = b.fecha_cierre ? String(b.fecha_cierre).split('T')[0] : (b.estado_territorio === 'CIERRE' ? fechaStr : '');
            const fechaCierreHtml = fechaCierreRaw ? `<span class="badge badge-si">${fechaCierreRaw}</span>` : '<span style="color:#8f8f8f; font-size:0.8rem;">En curso</span>';
            const badgeManz = b.estado_manzanas === 'COMPLETO'
                ? '<span class="badge badge-si">COMPLETO</span>'
                : '<span class="badge badge-no">INCOMPLETO</span>';
            const badgeTerr = b.estado_territorio === 'CIERRE'
                ? '<span class="badge badge-si">CIERRE</span>'
                : '<span class="badge badge-grp">INICIO</span>';
            const acciones = isAdmin
                ? `<button class="btn-action btn-edit" onclick="editarBitacora(${b.id})" title="Editar registro"><i class="fa-solid fa-pen-to-square"></i></button>
                   <button class="btn-action btn-del" onclick="eliminar('territorios/bitacora', ${b.id})" title="Eliminar registro"><i class="fa-solid fa-trash-can"></i></button>`
                : '-';
            tbody.innerHTML += `
                <tr>
                    <td>${fechaStr}</td>
                    <td>${fechaCierreHtml}</td>
                    <td><strong>Territorio ${b.territorio_numero}</strong></td>
                    <td><span class="badge badge-gray">Vuelta #${b.ciclo}</span></td>
                    <td>Manz. <strong>${b.manzanas}</strong></td>
                    <td>${badgeManz}</td>
                    <td>${b.turno_nombre}</td>
                    <td>${b.conductor_nombre}</td>
                    <td>${badgeTerr}</td>
                    <td class="admin-only" style="display:${isAdmin ? 'table-cell' : 'none'}">${acciones}</td>
                </tr>
            `;
        });
    } catch (e) { console.error(e); }
}

// Formularios y modales de Territorios
function resetFormTerritorio() {
    const f = document.getElementById('formTerritorio');
    if (!f) return;
    f.reset();
    document.getElementById('territorioId').value = '';
}

function editarTerritorio(id) {
    const obj = cacheTerritorios.find(t => t.id == id);
    if (!obj) return;
    const f = document.getElementById('formTerritorio');
    document.getElementById('territorioId').value = obj.id;
    f.numero.value = obj.numero;
    f.cantidad_manzanas.value = obj.cantidad_manzanas;
    f.nombre.value = obj.nombre || '';
    abrirModal('territorio', id);
}

async function resetFormConductor() {
    const f = document.getElementById('formConductor');
    if (!f) return;
    f.reset();
    document.getElementById('conductorId').value = '';
    const sel = document.getElementById('selectPubConductor');
    if (sel) {
        sel.innerHTML = '<option value="">-- Escribir nombre manualmente o elegir publicador --</option>';
        try {
            const res = await fetch('/api/publicadores?grupo=0');
            const pubs = await res.json();
            pubs.filter(p => p.activo).forEach(p => {
                sel.innerHTML += `<option value="${p.id}" data-nombre="${p.nombre}">${p.nombre} (G${p.grupo})</option>`;
            });
        } catch (e) {}
    }
}

function autocompletarConductor() {
    const sel = document.getElementById('selectPubConductor');
    const opt = sel.options[sel.selectedIndex];
    const nombre = opt ? opt.getAttribute('data-nombre') : '';
    if (nombre) document.getElementById('inputNombreConductor').value = nombre;
}

async function editarConductor(id) {
    const obj = cacheConductores.find(c => c.id == id);
    if (!obj) return;
    await resetFormConductor();
    document.getElementById('conductorId').value = obj.id;
    document.getElementById('inputNombreConductor').value = obj.nombre;
    if (obj.publicador_id) document.getElementById('selectPubConductor').value = obj.publicador_id;
    abrirModal('conductor', id);
}

function resetFormTurno() {
    const f = document.getElementById('formTurno');
    if (f) f.reset();
    document.getElementById('turnoId').value = '';
}

function editarTurno(id) {
    const obj = cacheTurnos.find(t => t.id == id);
    if (!obj) return;
    const f = document.getElementById('formTurno');
    document.getElementById('turnoId').value = obj.id;
    f.nombre.value = obj.nombre;
    f.horario.value = obj.horario || '';
    abrirModal('turno', id);
}

async function resetFormBitacora() {
    const f = document.getElementById('formBitacora');
    if (!f) return;
    f.reset();
    document.getElementById('bitacoraId').value = '';
    manzanasSeleccionadasSet.clear();
    infoManzanasActual = null;
    document.getElementById('bitFecha').value = new Date().toISOString().split('T')[0];
    const fcEl = document.getElementById('bitFechaCierre');
    if (fcEl) fcEl.value = '';

    if (cacheTurnos.length === 0) await cargarTurnosData();
    if (cacheConductores.length === 0) await cargarConductoresData();
    if (cacheTerritorios.length === 0) await cargarTerritoriosData();

    const selTurno = document.getElementById('bitTurnoSelect');
    selTurno.innerHTML = cacheTurnos.length
        ? cacheTurnos.map(t => `<option value="${t.id}" data-nombre="${t.nombre}">${t.nombre}${t.horario ? ' (' + t.horario + ')' : ''}</option>`).join('')
        : '<option value="">-- Primero crea un turno --</option>';

    const selCond = document.getElementById('bitConductorSelect');
    selCond.innerHTML = cacheConductores.length
        ? cacheConductores.map(c => `<option value="${c.id}" data-nombre="${c.nombre}">${c.nombre}</option>`).join('')
        : '<option value="">-- Primero registra un conductor --</option>';

    const selTerr = document.getElementById('bitTerritorioSelect');
    selTerr.innerHTML = '<option value="">-- Seleccione territorio --</option>' +
        cacheTerritorios.map(t => `<option value="${t.id}">Territorio ${t.numero} (${t.completadas}/${t.cantidad_manzanas} manz. · ${t.porcentaje}%)</option>`).join('');

    document.getElementById('bitInfoTerritorio').textContent = 'Selecciona un territorio para ver sus manzanas (1 a N)...';
    document.getElementById('bitManzanasGrid').innerHTML = '';
}

async function editarBitacora(id) {
    const obj = cacheBitacoraTerr.find(b => b.id == id);
    if (!obj) return;
    await resetFormBitacora();
    document.getElementById('bitacoraId').value = obj.id;
    document.getElementById('bitFecha').value = String(obj.fecha).split('T')[0];
    const fcEl = document.getElementById('bitFechaCierre');
    if (fcEl) fcEl.value = obj.fecha_cierre ? String(obj.fecha_cierre).split('T')[0] : '';
    if (obj.turno_id) document.getElementById('bitTurnoSelect').value = obj.turno_id;
    if (obj.conductor_id) document.getElementById('bitConductorSelect').value = obj.conductor_id;
    document.getElementById('bitTerritorioSelect').value = obj.territorio_id;
    await cargarSelectorManzanasBitacora(obj.id, obj.ciclo);

    const prevManz = String(obj.manzanas).split(',').map(x => parseInt(x.trim(), 10)).filter(n => !isNaN(n));
    prevManz.forEach(m => {
        manzanasSeleccionadasSet.add(m);
        const chip = document.querySelector(`#bitManzanasGrid .manzana-chip[data-manzana="${m}"]`);
        if (chip) chip.classList.add('selected');
    });
    document.getElementById('bitEstadoManzanas').value = obj.estado_manzanas;
    document.getElementById('bitEstadoTerritorio').value = obj.estado_territorio;
    abrirModal('bitacora', id);
}

async function cargarSelectorManzanasBitacora(excludeBitacoraId = null, cicloForzado = null) {
    const terrId = document.getElementById('bitTerritorioSelect').value;
    const grid = document.getElementById('bitManzanasGrid');
    const info = document.getElementById('bitInfoTerritorio');
    const editId = excludeBitacoraId || document.getElementById('bitacoraId').value || '';
    manzanasSeleccionadasSet.clear();
    grid.innerHTML = '';
    if (!terrId) {
        info.textContent = 'Selecciona un territorio para ver sus manzanas (1 a N)...';
        return;
    }
    try {
        let q = editId ? `?exclude_id=${editId}` : '';
        if (cicloForzado) q += (q ? '&' : '?') + `ciclo_forzado=${cicloForzado}`;
        const res = await fetch(`/api/territorios/${terrId}/manzanas${q}`);
        const data = await res.json();
        infoManzanasActual = data;
        const total = data.territorio.cantidad_manzanas;
        const map = data.manzanas || {};
        const compCount = Object.values(map).filter(v => v === 'COMPLETO').length;

        if (data.nueva_vuelta) {
            info.innerHTML = `<strong>¡Nueva vuelta (#${data.ciclo})!</strong> El recorrido anterior se completó al 100%. Todas las manzanas (1 a ${total}) están disponibles nuevamente.`;
        } else {
            info.innerHTML = `<strong>Territorio ${data.territorio.numero}</strong> · Vuelta #${data.ciclo} · Completadas: <strong>${compCount} de ${total}</strong> manzanas. Las manzanas ya completas están bloqueadas.`;
        }

        for (let m = 1; m <= total; m++) {
            const st = map[m];
            const chip = document.createElement('div');
            if (st === 'COMPLETO') {
                chip.className = 'manzana-chip disabled';
                chip.innerHTML = `<span>Manz. ${m}</span><small>✔ Completa</small>`;
            } else {
                chip.className = 'manzana-chip' + (st === 'INCOMPLETO' ? ' incompleto' : '');
                chip.dataset.manzana = m;
                chip.innerHTML = `<span>Manz. ${m}</span><small>${st === 'INCOMPLETO' ? 'A medias' : 'Disponible'}</small>`;
                chip.addEventListener('click', () => toggleChipManzana(m, chip));
            }
            grid.appendChild(chip);
        }
        sugerirEstadoTerritorio();
    } catch (e) { console.error(e); }
}

function toggleChipManzana(m, chipEl) {
    if (manzanasSeleccionadasSet.has(m)) {
        manzanasSeleccionadasSet.delete(m);
        chipEl.classList.remove('selected');
    } else {
        manzanasSeleccionadasSet.add(m);
        chipEl.classList.add('selected');
    }
    sugerirEstadoTerritorio();
}

function seleccionarTodasManzanasDisp(marcar) {
    document.querySelectorAll('#bitManzanasGrid .manzana-chip:not(.disabled)').forEach(chip => {
        const m = parseInt(chip.dataset.manzana, 10);
        if (marcar) { manzanasSeleccionadasSet.add(m); chip.classList.add('selected'); }
        else { manzanasSeleccionadasSet.delete(m); chip.classList.remove('selected'); }
    });
    sugerirEstadoTerritorio();
}

function sugerirEstadoTerritorio() {
    if (!infoManzanasActual) return;
    const total = infoManzanasActual.territorio.cantidad_manzanas;
    const map = infoManzanasActual.manzanas || {};
    const estadoManz = document.getElementById('bitEstadoManzanas').value;
    const selEstTerr = document.getElementById('bitEstadoTerritorio');

    const compSet = new Set(Object.keys(map).filter(k => map[k] === 'COMPLETO').map(Number));
    if (estadoManz === 'COMPLETO') {
        manzanasSeleccionadasSet.forEach(m => compSet.add(m));
    }
    if (compSet.size >= total) selEstTerr.value = 'CIERRE';
    else selEstTerr.value = 'INICIO';
    sincronizarFechaCierreBitacora();
}

function sincronizarFechaCierreBitacora() {
    const selEstTerr = document.getElementById('bitEstadoTerritorio');
    const fcEl = document.getElementById('bitFechaCierre');
    const fiEl = document.getElementById('bitFecha');
    if (!selEstTerr || !fcEl) return;
    if (selEstTerr.value === 'CIERRE' && !fcEl.value) {
        fcEl.value = (fiEl && fiEl.value) ? fiEl.value : new Date().toISOString().split('T')[0];
    }
}

document.getElementById('formTerritorio')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const id = document.getElementById('territorioId').value;
    const data = Object.fromEntries(new FormData(f));
    const url = id ? `/api/territorios/${id}` : '/api/territorios';
    const method = id ? 'PUT' : 'POST';
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const json = await res.json();
    if (res.ok && json.ok) {
        Toast.fire({ icon: 'success', title: id ? 'Territorio actualizado' : 'Territorio registrado' });
        cerrarModal();
        cargarTerritoriosData();
    } else {
        Swal.fire('Error', json.msg || 'No se pudo guardar el territorio', 'error');
    }
});

document.getElementById('formConductor')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('conductorId').value;
    const sel = document.getElementById('selectPubConductor');
    const nombre = document.getElementById('inputNombreConductor').value;
    const res = await fetch(id ? `/api/conductores/${id}` : '/api/conductores', {
        method: id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicador_id: sel.value || null, nombre })
    });
    const json = await res.json();
    if (res.ok && json.ok) {
        Toast.fire({ icon: 'success', title: id ? 'Conductor actualizado' : 'Conductor registrado' });
        cerrarModal();
        cargarConductoresData();
    } else {
        Swal.fire('Error', json.msg || 'No se pudo guardar el conductor', 'error');
    }
});

document.getElementById('formTurno')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('turnoId').value;
    const data = Object.fromEntries(new FormData(e.target));
    const res = await fetch(id ? `/api/turnos/${id}` : '/api/turnos', {
        method: id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    const json = await res.json();
    if (res.ok && json.ok) {
        Toast.fire({ icon: 'success', title: id ? 'Turno actualizado' : 'Turno creado' });
        cerrarModal();
        cargarTurnosData();
    } else {
        Swal.fire('Error', json.msg || 'No se pudo guardar el turno', 'error');
    }
});

document.getElementById('formBitacora')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (manzanasSeleccionadasSet.size === 0) {
        Swal.fire('Faltan manzanas', 'Selecciona al menos una manzana predicada en este turno.', 'warning');
        return;
    }
    const selTurno = document.getElementById('bitTurnoSelect');
    const selCond = document.getElementById('bitConductorSelect');
    const turnoNombre = selTurno.options[selTurno.selectedIndex]?.getAttribute('data-nombre') || selTurno.value;
    const condNombre = selCond.options[selCond.selectedIndex]?.getAttribute('data-nombre') || selCond.value;

    const payload = {
        fecha: document.getElementById('bitFecha').value,
        fecha_cierre: document.getElementById('bitFechaCierre')?.value || null,
        territorio_id: document.getElementById('bitTerritorioSelect').value,
        manzanas: Array.from(manzanasSeleccionadasSet).sort((a, b) => a - b).join(', '),
        estado_manzanas: document.getElementById('bitEstadoManzanas').value,
        turno_id: selTurno.value || null,
        turno_nombre: turnoNombre,
        conductor_id: selCond.value || null,
        conductor_nombre: condNombre,
        estado_territorio: document.getElementById('bitEstadoTerritorio').value
    };

    const id = document.getElementById('bitacoraId').value;
    const res = await fetch(id ? `/api/territorios/bitacora/${id}` : '/api/territorios/bitacora', {
        method: id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (res.ok && json.ok) {
        Toast.fire({ icon: 'success', title: id ? 'Registro de bitácora actualizado' : 'Avance guardado en bitácora' });
        cerrarModal();
        cargarVistaTerritorios();
    } else {
        Swal.fire('Error', json.msg || 'No se pudo guardar en bitácora', 'error');
    }
});

async function descargarS13PDF() {
    try {
        const res = await fetch('/api/territorios/s13');
        const data = await res.json();
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        doc.setFontSize(14);
        doc.setFont("helvetica", "bold");
        doc.text("REGISTRO DE ASIGNACIÓN DE TERRITORIO (S-13)", 105, 15, { align: "center" });

        const rows = [];
        data.forEach(item => {
            const t = item.territorio;
            if (item.ciclos.length === 0) {
                rows.push([t.numero, t.nombre || '-', `1 - ${t.cantidad_manzanas}`, '-', 'Sin iniciar', '-', '-', '0%']);
            } else {
                item.ciclos.forEach(c => {
                    const fIni = c.fecha_inicio ? String(c.fecha_inicio).split('T')[0] : '-';
                    const fFin = c.fecha_cierre ? String(c.fecha_cierre).split('T')[0] : 'En curso';
                    const porc = Math.min(100, Math.round((c.completadas / c.total_manzanas) * 100)) + '%';
                    rows.push([
                        t.numero,
                        t.nombre || '-',
                        `Vuelta #${c.ciclo}`,
                        c.conductor_inicio || '-',
                        fIni,
                        c.conductor_cierre || '-',
                        fFin,
                        `${c.completadas}/${c.total_manzanas} (${porc})`
                    ]);
                });
            }
        });

        doc.autoTable({
            startY: 22,
            head: [['Terr. N°', 'Zona', 'Ciclo', 'Conductor Inicio', 'Fecha Inicio', 'Conductor Cierre', 'Fecha Cierre', 'Cobertura']],
            body: rows,
            theme: 'grid',
            styles: { fontSize: 8, cellPadding: 2.5, valign: 'middle' },
            headStyles: { fillColor: [23, 23, 23] }
        });
        doc.save('Registro_Territorios_S13.pdf');
    } catch (e) {
        console.error(e);
        Swal.fire('Error', 'No se pudo generar el PDF S-13.', 'error');
    }
}

showView('dashboard');