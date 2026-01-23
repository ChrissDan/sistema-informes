function toggleSidebar(force) { const sb = document.getElementById('sidebar'); const ov = document.getElementById('sidebarOverlay'); if (force === false) { sb.classList.remove('active'); ov.classList.remove('active'); } else { sb.classList.toggle('active'); ov.classList.toggle('active'); } }
const session = JSON.parse(localStorage.getItem('user_session')); if (!session) window.location.href = '/index.html';
function logout() { localStorage.removeItem('user_session'); window.location.href = '/index.html'; } document.getElementById('btnLogoutSide').addEventListener('click', logout);
const isAdmin = session.grupo == 0; const isSupervisor = session.grupo == 9; const isGlobal = (isAdmin || isSupervisor);
const sidebarTitle = document.getElementById('sidebarTitle'); if (isAdmin) { sidebarTitle.textContent = "ADMINISTRADOR"; document.getElementById('userRole').textContent = "Acceso Total"; } else if (isSupervisor) { sidebarTitle.textContent = "SUPERVISOR"; document.getElementById('userRole').textContent = "Auditoría"; } else { sidebarTitle.textContent = "GRUPO " + session.grupo; document.getElementById('userRole').textContent = "Encargado"; }
document.getElementById('userName').textContent = session.nombre; document.getElementById('userAvatar').textContent = session.nombre.charAt(0).toUpperCase();

if (isAdmin) {
    document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'block');
    document.querySelectorAll('.global-view').forEach(el => el.style.display = 'block');
    document.querySelectorAll('th.admin-only, td.admin-only').forEach(el => el.style.display = 'table-cell');
    document.querySelectorAll('th.global-view, td.global-view').forEach(el => el.style.display = 'table-cell');
}
else if (isSupervisor) {
    document.querySelectorAll('#sidebar .global-view').forEach(el => el.style.display = 'block');
    document.querySelectorAll('th.global-view, td.global-view').forEach(el => el.style.display = 'table-cell');
    document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'none');
}
else {
    document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.global-view').forEach(el => el.style.display = 'none');
    document.getElementById('nav-usuarios').parentElement.style.display = 'none';
    document.getElementById('nav-reportes').parentElement.style.display = 'none';
    document.getElementById('nav-reuniones').parentElement.style.display = 'none';
}

const Toast = Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer: 3000, timerProgressBar: true });
const MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
let mesActual = new Date().getMonth(); let mesIndexActual = (mesActual === 0) ? 11 : mesActual - 1; let mesIndexInformes = mesIndexActual;

const formMesSelect = document.getElementById('formMesSelect'); const dashMesSelect = document.getElementById('dashMesSelect'); const repMesSelect = document.getElementById('repMesSelect'); const reuMesSelect = document.getElementById('reuMesSelect'); const reuFilterMes = document.getElementById('reuFilterMes'); const infFiltroMes = document.getElementById('infFiltroMes');
formMesSelect.innerHTML = '<option value="">-- Seleccione --</option>';
MESES.forEach(m => { const opt = document.createElement('option'); opt.value = m; opt.textContent = m; formMesSelect.appendChild(opt); dashMesSelect.appendChild(opt.cloneNode(true)); repMesSelect.appendChild(opt.cloneNode(true)); reuMesSelect.appendChild(opt.cloneNode(true)); reuFilterMes.appendChild(opt.cloneNode(true)); infFiltroMes.appendChild(opt.cloneNode(true)); });
dashMesSelect.value = MESES[mesIndexActual];

// --- INICIALIZAR Y ASEGURAR CARGA ---
window.onload = function () {
    verificarInactivos();
};

function cambiarMesInformes(direccion) { mesIndexInformes += direccion; if (mesIndexInformes > 11) mesIndexInformes = 0; if (mesIndexInformes < 0) mesIndexInformes = 11; document.getElementById('infMesLabel').textContent = MESES[mesIndexInformes]; cargarTablaInformes(); }

// --- VERIFICAR INACTIVOS (LOGICA DEL CLIENTE) ---
async function verificarInactivos() { try { const grp = isGlobal ? 0 : session.grupo; const res = await fetch(`/api/check-inactivos?grupo=${grp}`); const data = await res.json(); if (data.candidatos && data.candidatos.length > 0) { let listaHtml = `<ul style="text-align:left; font-size:0.9rem; max-height:200px; overflow-y:auto;">`; data.candidatos.forEach(c => { listaHtml += `<li><b>G${c.grupo}</b> - ${c.nombre} <span style="color:#ef4444; font-weight:bold;">(Hace ${c.meses_sin_informar} meses)</span></li>`; }); listaHtml += `</ul>`; Swal.fire({ title: '⚠️ Irregulares Detectados', html: `Los siguientes publicadores llevan varios <b>meses cerrados</b> consecutivos sin informar:<br><br>${listaHtml}`, icon: 'warning', confirmButtonText: 'Entendido' }); } } catch (e) { console.error("Error checking inactives", e); } }

function showView(viewName) {
    document.querySelectorAll('.section-view').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-links a').forEach(el => el.classList.remove('active'));
    document.getElementById(`view-${viewName}`).classList.add('active');
    document.getElementById(`nav-${viewName}`).classList.add('active');
    const titles = { 'dashboard': 'Dashboard General', 'informes': 'Gestión de Informes', 'publicadores': 'Directorio Publicadores', 'usuarios': 'Administración Usuarios', 'reportes': 'Centro de Reportes', 'reuniones': 'Asistencia Reuniones' };
    const icons = { 'dashboard': 'gauge-high', 'informes': 'file-lines', 'publicadores': 'users', 'usuarios': 'user-shield', 'reportes': 'print', 'reuniones': 'users-rectangle' };
    document.getElementById('pageTitle').innerHTML = `<i class="fa-solid fa-${icons[viewName]}" style="color:var(--primary)"></i> ${titles[viewName]}`;
    if (viewName === 'informes') { document.getElementById('infMesLabel').textContent = MESES[mesIndexInformes]; cargarTablaInformes(); cargarPublicadoresSelect(isGlobal ? 1 : session.grupo, 'pending'); verificarCierres(); }
    if (viewName === 'publicadores') cargarTablaPublicadores(); if (viewName === 'usuarios') cargarTablaUsuarios(); if (viewName === 'dashboard') cargarDashboard(); if (viewName === 'reuniones') cargarTablaReuniones(); if (viewName === 'reportes') document.getElementById('labelMesReporte');
}

/* --- LOGICA MODAL --- */
function abrirModal(tipo, id = null) {
    const modalWrapper = document.getElementById('mainModal'); const modalBody = document.getElementById('modalBody'); const modalTitle = document.getElementById('modalTitle'); modalBody.innerHTML = ''; let formId = '';
    if (tipo === 'informe') { formId = 'formInforme'; modalTitle.innerHTML = id ? '<i class="fa-solid fa-pen"></i> Editar Informe' : '<i class="fa-solid fa-circle-plus"></i> Nuevo Informe'; if (!id) resetFormInforme(true); } else if (tipo === 'publicador') { formId = 'formPublicador'; modalTitle.innerHTML = id ? '<i class="fa-solid fa-pen"></i> Editar Publicador' : '<i class="fa-solid fa-user-plus"></i> Nuevo Publicador'; if (!id) resetFormPub(); } else if (tipo === 'reunion') { formId = 'formReunion'; modalTitle.innerHTML = id ? '<i class="fa-solid fa-pen"></i> Editar Asistencia' : '<i class="fa-solid fa-calendar-plus"></i> Registrar Asistencia'; if (!id) resetFormReu(); } else if (tipo === 'usuario') { formId = 'formUsuario'; modalTitle.innerHTML = id ? '<i class="fa-solid fa-pen"></i> Editar Usuario' : '<i class="fa-solid fa-user-shield"></i> Crear Usuario'; if (!id) resetFormUser(); }
    const form = document.getElementById(formId); if (form) { form.style.display = 'grid'; modalBody.appendChild(form); } modalWrapper.classList.add('active');
}
function cerrarModal() { const modalWrapper = document.getElementById('mainModal'); const modalBody = document.getElementById('modalBody'); const formsContainer = document.getElementById('formsContainer'); modalWrapper.classList.remove('active'); while (modalBody.firstChild) { formsContainer.appendChild(modalBody.firstChild); } }

/* --- CRUD Y LOGICA --- */
let cachePublicadores = []; let cacheInformes = []; let cacheUsuarios = []; let cacheReuniones = [];
async function cargarPublicadoresSelect(grupoId, mode = 'pending') { try { let url = `/api/publicadores?grupo=${grupoId}`; if (mode === 'pending') url += `&pendientes=true`; const res = await fetch(url); cachePublicadores = await res.json(); const sel = document.getElementById('selectPubInfo'); const currentVal = sel.value; sel.innerHTML = '<option value="">-- Seleccione --</option>'; cachePublicadores.forEach(p => { sel.innerHTML += `<option value="${p.id}">${p.nombre}</option>`; }); if (mode === 'all' && currentVal && cachePublicadores.find(p => p.id == currentVal)) sel.value = currentVal; } catch (e) { console.error(e); } }
function cargarDatosPub() { const id = document.getElementById('selectPubInfo').value; const pub = cachePublicadores.find(p => p.id == id); if (pub) { document.getElementById('readPriv3').value = pub.priv3; actualizarEstadoHoras(pub.priv3); } else { document.getElementById('readPriv3').value = ""; document.getElementById('inputHoras').disabled = true; } }
function actualizarEstadoHoras(privilegio) { const inputHoras = document.getElementById('inputHoras'); const inputCredito = document.getElementById('inputCredito'); const p = (privilegio || "").trim().toUpperCase(); const reportan = ['ESP', 'REG', 'AUX I', 'AUX M', 'AUX']; const reportanCredito = ['REG', 'ESP']; if (reportan.includes(p)) { inputHoras.disabled = false; } else { inputHoras.disabled = true; inputHoras.value = ""; } if (reportanCredito.includes(p)) { inputCredito.disabled = false; } else { inputCredito.disabled = true; inputCredito.value = ""; } }
function limpiarFiltrosInformes() { if (isGlobal) document.getElementById('infFiltroGrupo').value = ''; document.getElementById('infFiltroPriv3').value = ''; document.getElementById('infFiltroNombre').value = ''; cargarTablaInformes(); }

// --- INFORMES ---
async function cargarTablaInformes() {
    let mes = MESES[mesIndexInformes]; let grp = isGlobal ? 0 : session.grupo; const fGrupo = document.getElementById('infFiltroGrupo') ? document.getElementById('infFiltroGrupo').value : null; if (isGlobal && fGrupo) grp = fGrupo; const fPriv3 = document.getElementById('infFiltroPriv3').value; const fNombre = document.getElementById('infFiltroNombre').value; const params = new URLSearchParams({ grupo: grp }); if (mes) params.append('mes', mes); if (fPriv3) params.append('priv3', fPriv3); if (fNombre) params.append('nombre', fNombre);
    const res = await fetch(`/api/informes?${params.toString()}`); cacheInformes = await res.json(); const tbody = document.getElementById('tablaInformes'); tbody.innerHTML = '';
    if (cacheInformes.length === 0) { tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:30px; color:#94a3b8;">No se encontraron resultados para ${mes}.</td></tr>`; return; }
    cacheInformes.forEach(d => {
        const badge = d.predico === 'SI' ? '<span class="badge badge-si"><i class="fa-solid fa-check"></i> SÍ</span>' : '<span class="badge badge-no"><i class="fa-solid fa-xmark"></i> NO</span>'; const grpCell = isGlobal ? `<td><span class="badge-grp">G${d.grupo}</span></td>` : ''; const deleteBtn = isAdmin ? `<button class="btn-action btn-del" onclick="eliminar('informes', ${d.id})" title="Eliminar"><i class="fa-solid fa-trash-can"></i></button>` : ''; const canEdit = (isGlobal || d.grupo == session.grupo); const editBtn = canEdit ? `<button class="btn-action btn-edit" onclick="editarInforme(${d.id})" title="Editar"><i class="fa-solid fa-pen-to-square"></i></button>` : ''; const credDisplay = d.credito_hrs > 0 ? `<span style="color:#d97706; font-size:0.8em">+${d.credito_hrs}</span>` : '';
        tbody.innerHTML += `<tr>${grpCell}<td>${d.nombre_publicador || d.publicador_nombre}</td><td><span class="badge badge-gray">${d.priv3}</span></td><td style="text-align:center"><b>${d.horas}</b> ${credDisplay}</td><td style="text-align:center">${d.cursos}</td><td style="text-align:center">${d.credito_hrs || '-'}</td><td style="text-align:center">${badge}</td><td style="font-size:0.8em; color:#666;">${d.comentarios || ''}</td><td>${editBtn} ${deleteBtn}</td></tr>`;
    }); if (isGlobal) { document.querySelectorAll('.global-view').forEach(el => { if (el.tagName === 'TH') el.style.display = 'table-cell'; }); }
}
function editarInforme(id) { const obj = cacheInformes.find(i => i.id == id); if (!obj) return; const f = document.getElementById('formInforme'); document.getElementById('informeId').value = obj.id; f.mes.value = obj.mes; const processEdit = () => { f.publicador_id.value = obj.publicador_id; cargarDatosPub(); f.predico.value = obj.predico; f.horas.value = obj.horas; f.cursos.value = obj.cursos; f.comentarios.value = obj.comentarios; f.credito_hrs.value = obj.credito_hrs; }; const grupoTarget = isGlobal ? obj.grupo : session.grupo; if (isGlobal) document.getElementById('infGrupoSelect').value = grupoTarget; cargarPublicadoresSelect(grupoTarget, 'all').then(processEdit); abrirModal('informe', id); }
function resetFormInforme(manualClean = false) { document.getElementById('formInforme').reset(); document.getElementById('informeId').value = ""; document.getElementById('inputHoras').disabled = true; document.getElementById('inputCredito').disabled = true; if (manualClean) { document.getElementById('readPriv3').value = ""; const grp = isGlobal ? document.getElementById('infGrupoSelect').value : session.grupo; cargarPublicadoresSelect(grp, 'pending'); } }
document.getElementById('formInforme').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target; const rawData = Object.fromEntries(new FormData(f)); rawData.horas = f.horas.disabled ? 0 : (f.horas.value || 0); rawData.cursos = f.cursos.value || 0; rawData.credito_hrs = f.credito_hrs.disabled ? 0 : (f.credito_hrs.value || 0); const h = parseFloat(rawData.horas) || 0; const c = parseFloat(rawData.credito_hrs) || 0;

    let maxCredito = 55 - h;
    if (maxCredito < 0) maxCredito = 0;
    if (c > maxCredito) { Swal.fire({ icon: 'warning', title: 'Límite Excedido', text: `Con ${h} horas reales, el crédito máximo es ${maxCredito}.` }); return; }

    const id = document.getElementById('informeId').value; const method = id ? 'PUT' : 'POST'; const url = id ? `/api/informes/${id}` : '/api/informes'; rawData.grupo = isGlobal ? document.getElementById('infGrupoSelect').value : session.grupo; rawData.requester_group = session.grupo; if (!id) { const pub = cachePublicadores.find(p => p.id == rawData.publicador_id); if (pub) { rawData.publicador_nombre = pub.nombre; rawData.priv1 = pub.priv1; rawData.priv2 = pub.priv2; rawData.priv3 = pub.priv3; } } if (id) rawData.mes = f.mes.value; const res = await fetch(url, { method: method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rawData) }); const json = await res.json(); if (res.ok) { Toast.fire({ icon: 'success', title: id ? 'Informe actualizado' : 'Informe guardado' }); cerrarModal(); resetFormInforme(true); cargarTablaInformes(); } else { Swal.fire('Error', json.msg || 'No se pudo guardar', 'error'); }
});

// --- PUBLICADORES ---
async function cargarTablaPublicadores() {
    let grp = isGlobal ? 0 : session.grupo;
    const fGrupo = document.getElementById('pubFiltroGrupo') ? document.getElementById('pubFiltroGrupo').value : null;
    const fNombre = document.getElementById('pubFiltroNombre').value;
    const fPriv3 = document.getElementById('pubFiltroPriv3').value;

    if (isGlobal && fGrupo) grp = fGrupo;

    const params = new URLSearchParams({ grupo: grp });
    if (fNombre) params.append('nombre', fNombre);
    if (fPriv3) params.append('priv3', fPriv3);

    const res = await fetch(`/api/publicadores?${params.toString()}`);
    cachePublicadores = await res.json();
    const tbody = document.getElementById('tablaPublicadores');
    tbody.innerHTML = '';

    // Iniciar contadores
    let stats = { total: 0, reg: 0, esp: 0, aux: 0, pub: 0, groups: {} };
    for (let i = 1; i <= 8; i++) stats.groups[i] = 0;

    if (cachePublicadores.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:20px; color:#94a3b8;">No se encontraron resultados.</td></tr>`;
        return;
    }

    cachePublicadores.forEach(d => {
        if (d.activo) {
            stats.total++;
            const p = (d.priv3 || '').toUpperCase();
            if (p === 'REG') stats.reg++;
            else if (p.includes('ESP')) stats.esp++;
            else if (p.includes('AUX')) stats.aux++;
            else if (p.includes('PUB') || p.includes('PNB')) stats.pub++;
            if (stats.groups[d.grupo] !== undefined) stats.groups[d.grupo]++;
        }

        const rowClass = d.activo ? '' : 'row-inactivo';

        // --- CAMBIO A SWITCH ---
        // Generamos el HTML del switch solo si es admin, sino el badge normal.
        const switchHtml = isAdmin ? `
            <div class="switch-container">
                <label class="switch">
                    <input type="checkbox" ${d.activo ? 'checked' : ''} onchange="toggleEstado(${d.id}, this.checked, this)">
                    <span class="slider round"></span>
                </label>
                <span class="switch-label" style="font-size:0.8rem; font-weight:600; color:${d.activo ? 'var(--success)' : 'var(--text-muted)'}">
                    ${d.activo ? 'Activo' : 'Baja'}
                </span>
            </div>
        ` : `
            <span class="${d.activo ? 'badge badge-si' : 'badge badge-no'}">
                ${d.activo ? 'ACTIVO' : 'INACTIVO'}
            </span>
        `;

        const deleteBtn = isAdmin ? `<button class="btn-action btn-del" onclick="eliminar('publicadores', ${d.id})" title="Eliminar"><i class="fa-solid fa-trash-can"></i></button>` : '';
        const editBtn = isAdmin ? `<button class="btn-action btn-edit" onclick="editarPub(${d.id})" title="Editar"><i class="fa-solid fa-pen-to-square"></i></button>` : '';

        // Mostrar Info? con badge
        const infoBadge = d.informo === 'SI' ? '<span class="badge badge-si"><i class="fa-solid fa-check"></i> SÍ</span>' : '<span class="badge badge-no"><i class="fa-solid fa-xmark"></i> NO</span>';

        // Formatear fecha
        let fechaTxt = '-';
        if (d.fecha_ingreso) {
            const dateObj = new Date(d.fecha_ingreso);
            const userTimezoneOffset = dateObj.getTimezoneOffset() * 60000;
            const adjustedDate = new Date(dateObj.getTime() + userTimezoneOffset);
            fechaTxt = adjustedDate.toLocaleDateString('es-ES', { month: 'short', year: 'numeric' });
        }

        tbody.innerHTML += `
            <tr class="${rowClass}">
                <td><b>${d.grupo}</b></td>
                <td style="font-weight:500">${d.nombre}</td>
                <td>${d.priv1 || '-'}</td>
                <td>${d.priv2 || '-'}</td>
                <td><span class="badge badge-gray">${d.priv3}</span></td>
                <td>${infoBadge}</td>
                <td style="font-size:0.85rem; color:#64748b; max-width:150px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${d.comentario || ''}">${d.comentario || ''}</td>
                <td class="global-view" style="font-size:0.85em;">${fechaTxt}</td>
                
                <td class="admin-only" style="white-space:nowrap;">${switchHtml}</td>
                
                <td>${editBtn} ${deleteBtn}</td>
            </tr>`;
    });

    // Actualizar contadores
    document.getElementById('pub-stat-total').textContent = stats.total;
    document.getElementById('pub-stat-reg').textContent = stats.reg;
    document.getElementById('pub-stat-esp').textContent = stats.esp;
    document.getElementById('pub-stat-aux').textContent = stats.aux;
    document.getElementById('pub-stat-pub').textContent = stats.pub;

    const groupContainer = document.getElementById('pub-groups-container');
    groupContainer.innerHTML = '';
    Object.keys(stats.groups).forEach(gId => {
        groupContainer.innerHTML += `<div class="group-stat-card"><div class="g-label">G ${gId}</div><div class="g-value">${stats.groups[gId]}</div></div>`;
    });

    // Visibilidad por rol
    if (isAdmin) {
        document.querySelectorAll('.admin-only').forEach(e => e.style.display = 'table-cell');
        document.querySelectorAll('.global-view.badge').forEach(e => e.style.display = 'none');
    }
    if (isGlobal) {
        document.querySelectorAll('.global-view').forEach(e => e.style.display = 'table-cell');
    }
}

async function toggleEstado(id, nuevoEstado, checkbox) { const estadoTexto = nuevoEstado ? 'ACTIVO' : 'INACTIVO'; const accionTexto = nuevoEstado ? 'activar' : 'desactivar'; const result = await Swal.fire({ title: `¿${accionTexto.charAt(0).toUpperCase() + accionTexto.slice(1)} publicador?`, text: `El publicador pasará a estado ${estadoTexto}.`, icon: 'warning', showCancelButton: true, confirmButtonColor: '#3085d6', cancelButtonColor: '#d33', confirmButtonText: 'Sí, cambiar', cancelButtonText: 'Cancelar' }); if (result.isConfirmed) { try { const res = await fetch(`/api/publicadores/${id}/estado`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ activo: nuevoEstado, requester_group: session.grupo }) }); const json = await res.json(); if (json.ok) { Toast.fire({ icon: 'success', title: `Publicador ${nuevoEstado ? 'activado' : 'desactivado'}` }); cargarTablaPublicadores(); } else { Swal.fire('Error', json.msg, 'error'); checkbox.checked = !nuevoEstado; } } catch (e) { console.error(e); checkbox.checked = !nuevoEstado; } } else { checkbox.checked = !nuevoEstado; } }

// --- EDITAR PUBLICADOR (CARGANDO FECHA) ---
function editarPub(id) {
    if (!isAdmin) return;
    const obj = cachePublicadores.find(p => p.id == id);
    if (!obj) return;
    const f = document.getElementById('formPublicador');
    document.getElementById('pubId').value = obj.id;
    document.getElementById('pubGrupoSelect').value = obj.grupo;
    f.nombre.value = obj.nombre;
    f.priv1.value = obj.priv1;
    f.priv2.value = obj.priv2;
    f.priv3.value = obj.priv3;
    f.informo.value = obj.informo;
    f.comentario.value = obj.comentario;

    // Cargar fecha en el input date (Formato YYYY-MM-DD)
    if (obj.fecha_ingreso) {
        const dateObj = new Date(obj.fecha_ingreso);
        const isoString = dateObj.toISOString().split('T')[0];
        f.fecha_ingreso.value = isoString;
    } else {
        f.fecha_ingreso.value = "";
    }

    abrirModal('publicador', id);
}
function resetFormPub() { document.getElementById('formPublicador').reset(); document.getElementById('pubId').value = ""; }
document.getElementById('formPublicador').addEventListener('submit', async (e) => { e.preventDefault(); const data = Object.fromEntries(new FormData(e.target)); const id = document.getElementById('pubId').value; if (!id) data.informo = 'NO'; const method = id ? 'PUT' : 'POST'; const url = id ? `/api/publicadores/${id}` : '/api/publicadores'; data.grupo = isAdmin ? document.getElementById('pubGrupoSelect').value : session.grupo; data.requester_group = session.grupo; const res = await fetch(url, { method: method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); const json = await res.json(); if (json.ok) { Toast.fire({ icon: 'success', title: id ? 'Actualizado' : 'Creado' }); cerrarModal(); resetFormPub(); cargarTablaPublicadores(); } else { Swal.fire('Error', json.msg, 'error'); } });

// --- DASHBOARD (LOGICA SIMPLE) ---
async function cargarDashboard() {
    const mes = document.getElementById('dashMesSelect').value;
    const grp = isGlobal ? 0 : session.grupo;
    try {
        const res = await fetch(`/api/dashboard?mes=${mes}&grupo=${grp}`);
        const data = await res.json();
        document.getElementById('stat-pub-count').textContent = data.stats.pub.count;
        document.getElementById('stat-pub-cursos').textContent = data.stats.pub.cursos || 0;
        document.getElementById('stat-aux-count').textContent = data.stats.aux.count;
        document.getElementById('stat-aux-horas').textContent = data.stats.aux.horas || 0;
        document.getElementById('stat-aux-cursos').textContent = data.stats.aux.cursos || 0;
        document.getElementById('stat-reg-count').textContent = data.stats.reg.count;
        document.getElementById('stat-reg-horas').textContent = data.stats.reg.horas || 0;
        document.getElementById('stat-reg-cursos').textContent = data.stats.reg.cursos || 0;
        const container = document.getElementById('groups-progress-container'); container.innerHTML = '';

        // Usamos la estructura antigua/simple 'data.groups.totals'
        const gruposInfo = {};
        data.groups.totals.forEach(g => gruposInfo[g.grupo] = { total: g.total, reported: 0 });
        data.groups.reports.forEach(g => { if (gruposInfo[g.grupo]) gruposInfo[g.grupo].reported = g.count; });

        Object.keys(gruposInfo).forEach(grpNum => {
            if (grpNum == 0) return;
            const g = gruposInfo[grpNum];
            const percent = Math.round((g.reported / g.total) * 100) || 0;
            let color = 'var(--primary)'; if (percent === 100) color = 'var(--success)'; if (percent < 50) color = 'var(--danger)';
            container.innerHTML += `<div class="group-item"><div class="group-info"><div class="group-name">Grupo ${grpNum} <span style="font-weight:400; font-size:0.85em; color:#64748b;">(${g.reported}/${g.total})</span></div><div class="progress-bar-bg"><div class="progress-bar-fill" style="width:${percent}%; background:${color}"></div></div></div><div class="group-perc" style="color:${color}">${percent}%</div></div>`;
        });
    } catch (error) { console.error("Error cargando dashboard:", error); }
}

// --- REUNIONES ---
async function cargarTablaReuniones() { const filterMes = document.getElementById('reuFilterMes').value; const url = filterMes ? `/api/reuniones?mes=${filterMes}` : '/api/reuniones'; const res = await fetch(url); cacheReuniones = await res.json(); const tbody = document.getElementById('tbodyReuniones'); tbody.innerHTML = ''; const summaryContainer = document.getElementById('resumenReunionesContainer'); summaryContainer.innerHTML = ''; let totalPromedioMensual = 0; let datosPorMes = {}; cacheReuniones.forEach(r => { if (!datosPorMes[r.mes]) datosPorMes[r.mes] = { totalSemanal: 0, countMeetings: 0 }; const s1 = r.sem1 || 0; const s2 = r.sem2 || 0; const s3 = r.sem3 || 0; const s4 = r.sem4 || 0; const s5 = r.sem5 || 0; const sumaSem = s1 + s2 + s3 + s4 + s5; let weeksCount = 0; if (s1 > 0) weeksCount++; if (s2 > 0) weeksCount++; if (s3 > 0) weeksCount++; if (s4 > 0) weeksCount++; if (s5 > 0) weeksCount++; const promedio = weeksCount > 0 ? Math.round(sumaSem / weeksCount) : 0; const iconTipo = r.tipo === 'ENTRE SEMANA' ? '<i class="fa-solid fa-calendar-days" style="color:#64748b"></i>' : '<i class="fa-solid fa-calendar-week" style="color:#d97706"></i>'; const iconMod = r.modalidad === 'PRESENCIAL' ? '<span class="badge badge-grp">PRES</span>' : '<span class="badge badge-gray">ZOOM</span>'; const deleteBtn = isAdmin ? `<button class="btn-action btn-del" onclick="eliminar('reuniones', ${r.id})"><i class="fa-solid fa-trash-can"></i></button>` : ''; const editBtn = isAdmin ? `<button class="btn-action btn-edit" onclick='editarReunion(${JSON.stringify(r)})'><i class="fa-solid fa-pen"></i></button>` : ''; tbody.innerHTML += `<tr><td style="font-weight:bold">${r.mes}</td><td>${iconTipo} <span style="font-size:0.8em">${r.tipo}</span></td><td>${iconMod}</td><td style="text-align:center">${r.sem1 || '-'}</td><td style="text-align:center">${r.sem2 || '-'}</td><td style="text-align:center">${r.sem3 || '-'}</td><td style="text-align:center">${r.sem4 || '-'}</td><td style="text-align:center">${r.sem5 || '-'}</td><td style="text-align:center; font-weight:bold; color:var(--primary)">${promedio}</td><td>${editBtn} ${deleteBtn}</td></tr>`; }); const mathData = {}; cacheReuniones.forEach(r => { const key = r.mes + '|' + r.tipo; if (!mathData[key]) mathData[key] = { mes: r.mes, tipo: r.tipo, total: 0, weeks: new Set() };[r.sem1, r.sem2, r.sem3, r.sem4, r.sem5].forEach((val, idx) => { if (val > 0) { mathData[key].total += val; mathData[key].weeks.add(idx); } }); }); Object.values(mathData).forEach(d => { const semanasCount = d.weeks.size; const promedio = semanasCount > 0 ? Math.round(d.total / semanasCount) : 0; totalPromedioMensual += promedio; const cardHtml = `<div class="reu-stat-box" style="margin-bottom:10px;"><div><div class="reu-stat-title" style="color:var(--primary)">${d.mes} - ${d.tipo}</div><div class="reu-stat-sub">Asist: ${d.total} | Semanas: ${semanasCount}</div></div><div class="reu-stat-val">${promedio}</div></div>`; summaryContainer.innerHTML += cardHtml; }); const promedioFinalAnual = Math.round(totalPromedioMensual / 12); document.getElementById('reuTotalAnual').textContent = promedioFinalAnual; }
function editarReunion(r) { if (!isAdmin) return; const f = document.getElementById('formReunion'); document.getElementById('reunionId').value = r.id; f.mes.value = r.mes; f.tipo.value = r.tipo; f.modalidad.value = r.modalidad; f.sem1.value = r.sem1 || 0; f.sem2.value = r.sem2 || 0; f.sem3.value = r.sem3 || 0; f.sem4.value = r.sem4 || 0; f.sem5.value = r.sem5 || 0; abrirModal('reunion', r.id); }
function resetFormReu() { document.getElementById('formReunion').reset(); document.getElementById('reunionId').value = ""; }
document.getElementById('formReunion').addEventListener('submit', async (e) => { e.preventDefault(); const data = Object.fromEntries(new FormData(e.target)); data.requester_group = session.grupo; const id = document.getElementById('reunionId').value; const method = id ? 'PUT' : 'POST'; const url = id ? `/api/reuniones/${id}` : '/api/reuniones'; const res = await fetch(url, { method: method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); if (res.ok) { Toast.fire({ icon: 'success', title: 'Guardado correctamente' }); cerrarModal(); resetFormReu(); cargarTablaReuniones(); } else { Swal.fire('Error', 'No se pudo guardar', 'error'); } });

// --- LÓGICA CIERRE ---
async function verificarCierres() { try { const res = await fetch('/api/cierres'); mesesCerrados = await res.json(); Array.from(formMesSelect.options).forEach(opt => { if (mesesCerrados.includes(opt.value)) { opt.disabled = true; opt.textContent += " (Cerrado)"; } }); } catch (e) { console.error(e); } }
async function cerrarMes() { const mes = document.getElementById('dashMesSelect').value; const confirm = await Swal.fire({ title: `¿Cerrar ${mes}?`, html: "Esta acción validará 'SI' y reseteará a 'NO'.", icon: 'warning', showCancelButton: true, confirmButtonText: 'Sí, Cerrar' }); if (confirm.isConfirmed) { const res = await fetch('/api/cerrar-mes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mes, requester_group: session.grupo }) }); const json = await res.json(); if (json.ok) { Swal.fire('Cerrado', `Mes ${mes} cerrado.`, 'success'); verificarCierres(); } else { Swal.fire('Error', json.msg, 'error'); } } }
function limpiarFiltrosReporte() { document.getElementById('formReporte').reset(); document.getElementById('reporteResultados').style.display = 'none'; currentReportData = []; }
function limpiarFiltrosPub() { document.getElementById('pubFiltroNombre').value = ''; document.getElementById('pubFiltroPriv3').value = ''; if (isAdmin) document.getElementById('pubFiltroGrupo').value = ''; cargarTablaPublicadores(); }

/* --- REPORTES --- */
async function generarReporte() { const form = document.getElementById('formReporte'); const data = { mes: form.mes.value, grupo: form.grupo.value, priv3: form.priv3.value, nombre: form.nombre.value }; const res = await fetch('/api/reportes/advanced', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); currentReportData = await res.json(); document.getElementById('reporteResultados').style.display = 'block'; document.getElementById('repTotalRows').textContent = currentReportData.length; const tbody = document.getElementById('tbodyReporte'); tbody.innerHTML = ''; let sumHoras = 0; let sumCursos = 0; let sumCredito = 0; let counts = {}; currentReportData.forEach(r => { sumHoras += parseFloat(r.horas || 0); sumCursos += parseInt(r.cursos || 0); sumCredito += parseFloat(r.credito_hrs || 0); const cat = r.priv3 || 'OTROS'; counts[cat] = (counts[cat] || 0) + 1; tbody.innerHTML += `<tr><td>${r.mes}</td><td>${r.grupo}</td><td>${r.nombre_publicador || r.publicador_nombre}</td><td><span class="badge badge-gray">${r.priv3}</span></td><td>${r.horas}</td><td>${r.cursos}</td><td>${r.credito_hrs || '-'}</td><td>${r.predico}</td><td>${r.comentarios || ''}</td></tr>`; }); document.getElementById('repSumHoras').textContent = sumHoras; document.getElementById('repSumCursos').textContent = sumCursos; document.getElementById('repSumCredito').textContent = sumCredito; let catsHtml = ''; for (const [key, value] of Object.entries(counts)) { catsHtml += `<div>${key}: <b>${value}</b></div>`; } document.getElementById('repCats').innerHTML = catsHtml; }

async function descargarPDF() {
    const mesSelect = document.getElementById('repMesSelect');
    // Si no hay valor, usamos '' (vacío) para la API
    const mes = mesSelect.value || ''; 
    const grupo = document.getElementById('formReporte').grupo.value;
    
    // Validamos solo que haya datos en la tabla, NO obligamos a seleccionar mes
    if (currentReportData.length === 0) { 
        Swal.fire('Vacío', 'Primero presiona "Buscar" para cargar los datos.', 'info'); 
        return; 
    }

    try {
        // 1. Obtener datos externos (La API ahora soporta mes vacío)
        const res = await fetch(`/api/reportes/datos-extra?mes=${mes}&grupo=${grupo}`);
        const extra = await res.json();

        // 2. Calcular totales DESDE LA TABLA
        let stats = {
            pub: { cant: 0, horas: 0, cursos: 0 },
            aux: { cant: 0, horas: 0, cursos: 0 },
            reg: { cant: 0, horas: 0, cursos: 0 }
        };

        currentReportData.forEach(r => {
            const p = (r.priv3 || '').toUpperCase();
            const h = parseFloat(r.horas) || 0;
            const c = parseInt(r.cursos) || 0;

            if (p === 'REG' || p === 'ESP') {
                stats.reg.cant++;
                stats.reg.horas += h;
                stats.reg.cursos += c;
            } else if (p.includes('AUX')) { 
                stats.aux.cant++;
                stats.aux.horas += h;
                stats.aux.cursos += c;
            } else { 
                stats.pub.cant++;
                stats.pub.cursos += c;
            }
        });

        // 3. Generar PDF
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        // Título Dinámico
        const tituloReporte = mes === '' ? 'REPORTE ANUAL' : `REPORTE - ${mes}`;

        // Encabezado
        doc.setFontSize(16); doc.setFont("helvetica", "bold");
        doc.text(tituloReporte, 105, 20, null, null, "center");
        
        doc.setFontSize(10); doc.setFont("helvetica", "normal");
        doc.text(`Generado: ${new Date().toLocaleDateString()}`, 105, 26, null, null, "center");

        // --- RESUMEN (S-21) ---
        let y = 35;
        const xL = 14; 
        
        doc.setFillColor(245, 247, 250); 
        doc.rect(xL, y-5, 182, 16, 'F'); 
        doc.setFont("helvetica", "bold");
        
        // Ajustamos etiqueta si es reporte anual
        const labelAsistencia = mes === '' ? 'Promedio Asistencia (Anual):' : 'Promedio Asistencia (Fin Sem):';
        
        doc.text(`Publicadores Activos: ${extra.activos}`, xL + 5, y + 2);
        doc.text(`${labelAsistencia} ${extra.asistencia}`, xL + 80, y + 2);
        
        y += 20;

        // Columnas
        const col1 = xL; 
        const col2 = xL + 60; 
        const col3 = xL + 120;

        doc.setFontSize(11); doc.setTextColor(37, 99, 235);
        doc.text("PUBLICADORES", col1, y);
        doc.text("AUXILIARES", col2, y);
        doc.text("REGULARES", col3, y);
        y += 7;
        doc.setTextColor(0,0,0); doc.setFontSize(10);

        // Filas de datos
        doc.text(`Cantidad: ${stats.pub.cant}`, col1, y);
        doc.text(`Cantidad: ${stats.aux.cant}`, col2, y);
        doc.text(`Cantidad: ${stats.reg.cant}`, col3, y);
        y += 6;

        doc.text(`Cursos: ${stats.pub.cursos}`, col1, y);
        doc.text(`Horas: ${stats.aux.horas}`, col2, y);
        doc.text(`Horas: ${stats.reg.horas}`, col3, y);
        y += 6;

        doc.text(``, col1, y); 
        doc.text(`Cursos: ${stats.aux.cursos}`, col2, y);
        doc.text(`Cursos: ${stats.reg.cursos}`, col3, y);
        
        y += 12;

        // Tabla
        const body = currentReportData.map(r => [
            r.mes, r.grupo, r.nombre_publicador || r.publicador_nombre, 
            r.priv3, r.horas, r.cursos, r.credito_hrs, r.predico, r.comentarios
        ]);

        doc.autoTable({ 
            startY: y, 
            head: [['Mes', 'Grp', 'Nombre', 'Priv', 'Hrs', 'Cur', 'Cred', 'Pred', 'Com']], 
            body: body, 
            theme: 'grid', 
            styles: { fontSize: 8, cellPadding: 2 }, 
            headStyles: { fillColor: [37, 99, 235] } 
        });

        const nombreArchivo = mes === '' ? 'Reporte_Anual.pdf' : `Reporte_${mes}.pdf`;
        doc.save(nombreArchivo);

    } catch (e) {
        console.error(e);
        Swal.fire('Error', 'No se pudo generar el reporte.', 'error');
    }
}

/* =========================================
   REPORTE ESPECIAL: PRECURSORES
   ========================================= */

function abrirModalPrecursores() {
    const modalWrapper = document.getElementById('mainModal');
    const modalBody = document.getElementById('modalBody');
    const modalTitle = document.getElementById('modalTitle');
    
    modalTitle.innerHTML = '<i class="fa-solid fa-stopwatch"></i> Progreso de Precursores';
    
    // HTML del Selector de Tipo dentro del Modal
    modalBody.innerHTML = `
        <div style="display:flex; gap:10px; justify-content:center; margin-bottom:20px;">
            <button class="btn-primary" onclick="cargarDatosPrecursores('REG')" style="flex:1;">
                Regulares
            </button>
            <button class="btn-primary" onclick="cargarDatosPrecursores('AUX')" style="background:#059669; flex:1;">
                Auxiliares
            </button>
        </div>
        <div id="loadingPrec" style="text-align:center; display:none; color:var(--text-muted);">
            <i class="fa-solid fa-circle-notch fa-spin"></i> Cargando datos...
        </div>
        <div id="tablaPrecContainer" class="table-container" style="max-height:60vh;">
            <p style="text-align:center; color:#64748b; margin-top:20px;">Selecciona una categoría arriba para ver el reporte.</p>
        </div>
    `;
    
    modalWrapper.classList.add('active');
}

/* =========================================
   REPORTE ESPECIAL: PRECURSORES (CON PDF)
   ========================================= */

// Variables temporales para este reporte
let currentPrecData = [];
let currentPrecTipo = '';

function abrirModalPrecursores() {
    const modalWrapper = document.getElementById('mainModal');
    const modalBody = document.getElementById('modalBody');
    const modalTitle = document.getElementById('modalTitle');
    
    modalTitle.innerHTML = '<i class="fa-solid fa-stopwatch"></i> Progreso de Precursores';
    
    // HTML del Modal con el botón PDF añadido (oculto por defecto)
    modalBody.innerHTML = `
        <div style="display:flex; gap:10px; justify-content:center; margin-bottom:15px;">
            <button class="btn-primary" onclick="cargarDatosPrecursores('REG')" style="flex:1;">
                Regulares
            </button>
            <button class="btn-primary" onclick="cargarDatosPrecursores('AUX')" style="background:#059669; flex:1;">
                Auxiliares
            </button>
        </div>

        <div id="precPdfContainer" style="display:none; justify-content:flex-end; margin-bottom:10px; border-bottom:1px solid #e2e8f0; padding-bottom:10px;">
            <button class="btn-cancel" onclick="descargarPDFPrecursores()" style="background:#475569; color:white; width:auto; padding:8px 16px; font-size:0.85rem;">
                <i class="fa-solid fa-file-pdf"></i> Descargar PDF
            </button>
        </div>

        <div id="loadingPrec" style="text-align:center; display:none; color:var(--text-muted); margin:20px 0;">
            <i class="fa-solid fa-circle-notch fa-spin"></i> Cargando datos...
        </div>
        
        <div id="tablaPrecContainer" class="table-container" style="max-height:55vh;">
            <p style="text-align:center; color:#64748b; margin-top:20px;">Selecciona una categoría arriba.</p>
        </div>
    `;
    
    modalWrapper.classList.add('active');
}

async function cargarDatosPrecursores(tipo) {
    const container = document.getElementById('tablaPrecContainer');
    const loading = document.getElementById('loadingPrec');
    const pdfBtn = document.getElementById('precPdfContainer');
    
    container.innerHTML = '';
    loading.style.display = 'block';
    pdfBtn.style.display = 'none'; // Ocultar botón mientras carga
    
    try {
        const res = await fetch(`/api/reportes/precursores?tipo=${tipo}`);
        const data = await res.json();
        
        // Guardamos en variables globales para el PDF
        currentPrecData = data;
        currentPrecTipo = tipo;

        loading.style.display = 'none';
        
        if (data.length === 0) {
            container.innerHTML = `<div style="text-align:center; padding:20px; color:#64748b;">No hay precursores ${tipo} con datos.</div>`;
            return;
        }

        // Mostrar botón PDF si hay datos
        pdfBtn.style.display = 'flex';

        // Construir tabla HTML
        let html = `
            <table style="font-size:0.85rem;">
                <thead style="position:sticky; top:0; background:#f8fafc; z-index:10;">
                    <tr>
                        <th style="width:50px;">Grp</th>
                        <th style="width:120px;">Nombre</th>
                        <th>Detalle Meses</th>
                        <th style="text-align:right; width:60px;">Total</th>
                    </tr>
                </thead>
                <tbody>
        `;

        data.forEach(p => {
            let mesesHtml = '';
            if(p.informes.length === 0) {
                mesesHtml = '<span style="color:#cbd5e1; font-size:0.8em;">-</span>';
            } else {
                mesesHtml = '<div style="display:flex; flex-wrap:wrap; gap:4px;">';
                p.informes.forEach(inf => {
                    mesesHtml += `
                        <span style="background:#eff6ff; color:#1e40af; border:1px solid #dbeafe; padding:2px 6px; border-radius:4px; font-size:0.75em; white-space:nowrap;">
                            <b>${inf.mes}</b>: ${inf.horas}
                        </span>
                    `;
                });
                mesesHtml += '</div>';
            }

            const totalStyle = "font-weight:800; color:var(--primary); font-size:1.1em;";

            html += `
                <tr>
                    <td><span class="badge badge-gray">${p.grupo}</span></td>
                    <td style="font-weight:600; color:#334155;">${p.nombre}</td>
                    <td>${mesesHtml}</td>
                    <td style="text-align:right; ${totalStyle}">${p.total}</td>
                </tr>
            `;
        });

        html += `</tbody></table>`;
        container.innerHTML = html;

    } catch (e) {
        console.error(e);
        loading.style.display = 'none';
        Swal.fire('Error', 'No se pudieron cargar los datos.', 'error');
    }
}

function descargarPDFPrecursores() {
    if (currentPrecData.length === 0) return;

    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        
        // Título del PDF
        const titulo = currentPrecTipo === 'REG' ? 'PRECURSORES REGULARES' : 'PRECURSORES AUXILIARES';
        
        doc.setFontSize(16);
        doc.setFont("helvetica", "bold");
        doc.text(`Reporte de Progreso - ${titulo}`, 105, 20, null, null, "center");
        
        doc.setFontSize(10);
        doc.setFont("helvetica", "normal");
        doc.text(`Generado: ${new Date().toLocaleDateString()}`, 105, 26, null, null, "center");

        // Preparar cuerpo de la tabla para el PDF
        const body = currentPrecData.map(p => {
            // Convertir el array de informes en un texto legible
            // Ejemplo: "SEP: 50, OCT: 60"
            const detalleTexto = p.informes.map(i => `${i.mes}: ${i.horas}`).join(',  ');
            
            return [
                p.grupo,
                p.nombre,
                detalleTexto || '-', // Si no hay informes pone guión
                p.total
            ];
        });

        doc.autoTable({ 
            startY: 35, 
            head: [['Grp', 'Nombre', 'Detalle de Horas (Meses)', 'Total']], 
            body: body, 
            theme: 'grid', 
            styles: { fontSize: 9, cellPadding: 3, valign: 'middle' }, 
            headStyles: { fillColor: currentPrecTipo === 'REG' ? [37, 99, 235] : [5, 150, 105] }, // Azul o Verde según tipo
            columnStyles: {
                0: { halign: 'center', width: 15 }, // Grupo
                3: { halign: 'right', fontStyle: 'bold', width: 20 } // Total
            }
        });

        doc.save(`Progreso_${titulo}.pdf`);

    } catch (e) {
        console.error(e);
        Swal.fire('Error', 'No se pudo generar el PDF.', 'error');
    }
}

/* --- USUARIOS --- */
function editarUser(id) { const obj = cacheUsuarios.find(u => u.id == id); if (!obj) return; const f = document.getElementById('formUsuario'); document.getElementById('userId').value = obj.id; f.nombre.value = obj.nombre; f.correo.value = obj.correo; f.password.value = obj.password; f.grupo.value = obj.grupo; abrirModal('usuario', id); }
function resetFormUser() { document.getElementById('formUsuario').reset(); document.getElementById('userId').value = ""; }
document.getElementById('formUsuario').addEventListener('submit', async (e) => { e.preventDefault(); const data = Object.fromEntries(new FormData(e.target)); const id = document.getElementById('userId').value; const method = id ? 'PUT' : 'POST'; const url = id ? `/api/usuarios/${id}` : '/api/usuarios'; data.requester_group = session.grupo; await fetch(url, { method: method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); Toast.fire({ icon: 'success', title: id ? 'Usuario actualizado' : 'Usuario creado' }); cerrarModal(); resetFormUser(); cargarTablaUsuarios(); });
async function cargarTablaUsuarios() { if (!isAdmin) return; const res = await fetch('/api/usuarios'); cacheUsuarios = await res.json(); const tbody = document.getElementById('tablaUsuarios'); tbody.innerHTML = ''; cacheUsuarios.forEach(d => { const editBtn = `<button class="btn-action btn-edit" onclick="editarUser(${d.id})" title="Editar"><i class="fa-solid fa-pen-to-square"></i></button>`; tbody.innerHTML += `<tr><td>${d.nombre}</td><td>${d.correo}</td><td>Grupo ${d.grupo}</td><td>${d.password}</td><td>${editBtn} <button class="btn-action btn-del" onclick="eliminar('usuarios', ${d.id})" title="Eliminar"><i class="fa-solid fa-trash-can"></i></button></td></tr>`; }); }
async function eliminar(entidad, id) { const result = await Swal.fire({ title: '¿Estás seguro?', text: "Esta acción no se puede deshacer.", icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', cancelButtonColor: '#94a3b8', confirmButtonText: 'Sí, eliminar', cancelButtonText: 'Cancelar' }); if (result.isConfirmed) { const params = new URLSearchParams(); params.append('requester_group', session.grupo); if (entidad === 'informes') { const inf = cacheInformes.find(i => i.id == id); if (inf) params.append('mes', inf.mes); } const res = await fetch(`/api/${entidad}/${id}?${params.toString()}`, { method: 'DELETE' }); const json = await res.json(); if (json.ok) { Toast.fire({ icon: 'success', title: 'Eliminado correctamente' }); if (entidad === 'informes') cargarTablaInformes(); if (entidad === 'publicadores') cargarTablaPublicadores(); if (entidad === 'usuarios') cargarTablaUsuarios(); if (entidad === 'reuniones') cargarTablaReuniones(); if (entidad === 'publicadores' && document.getElementById('view-publicadores').classList.contains('active')) cargarTablaPublicadores(); } else { Swal.fire('Error', json.msg, 'error'); } } }
showView('dashboard');