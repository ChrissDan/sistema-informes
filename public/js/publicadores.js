// Publicadores: directorio, alta/edición y estado
// (script clásico: comparte el ámbito global con el resto de archivos; el orden de carga está en dashboard.html)
// --- PUBLICADORES ---
// Marcas junto al nombre: conductor, usuario del sistema y teléfono
function vinculosPub(d) {
    let h = '';
    if (Number(d.es_conductor)) h += ' <i class="fa-solid fa-user-tie" style="color:#0f766e;" title="Puede ser conductor del programa"></i>';
    if (Number(d.es_usuario)) h += ' <i class="fa-solid fa-user-shield" style="color:#2563eb;" title="Tiene usuario en el sistema"></i>';
    if (d.telefono) h += `<div style="font-size:0.74rem; color:var(--text-muted); font-weight:400;"><i class="fa-solid fa-phone" style="font-size:0.65rem;"></i> ${esc(d.telefono)}</div>`;
    return h;
}
async function cargarTablaPublicadores() {
    let grp = isGlobal ? 0 : session.grupo; const fGrupo = document.getElementById('pubFiltroGrupo') ? document.getElementById('pubFiltroGrupo').value : null; const idsNombre = await buscadorPublicadores.idsParaBuscar(); const fPriv3 = document.getElementById('pubFiltroPriv3').value;
    if (isGlobal && fGrupo) grp = fGrupo;
    const params = new URLSearchParams({ grupo: grp }); if (idsNombre) params.append('publicador_ids', idsNombre.join(',') || '0'); if (fPriv3) params.append('priv3', fPriv3);
    const res = await fetch(`/api/publicadores?${params.toString()}`); cachePublicadores = await res.json(); const tbody = document.getElementById('tablaPublicadores'); tbody.innerHTML = '';
    let stats = { total: 0, reg: 0, esp: 0, aux: 0, pub: 0, groups: {} }; for (let i = 1; i <= 8; i++) stats.groups[i] = 0;
    if (cachePublicadores.length === 0) { tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:20px; color:#94a3b8;">No se encontraron resultados.</td></tr>`; return; }
    cachePublicadores.forEach(d => {
        if (d.activo) { stats.total++; const p = (d.priv3 || '').toUpperCase(); if (p === 'REG' || p === 'MISIONERO') stats.reg++; else if (p.includes('ESP')) stats.esp++; else if (p.includes('AUX')) stats.aux++; else if (p.includes('PUB') || p.includes('PNB')) stats.pub++; if (stats.groups[d.grupo] !== undefined) stats.groups[d.grupo]++; }
        const rowClass = d.activo ? '' : 'row-inactivo';
        const switchHtml = isAdmin ? `<div class="switch-container"><label class="switch"><input type="checkbox" ${d.activo ? 'checked' : ''} onchange="toggleEstado(${d.id}, this.checked, this)"><span class="slider round"></span></label></div>` : `<span class="${d.activo ? 'badge badge-si' : 'badge badge-no'}">${d.activo ? 'ACTIVO' : 'INACTIVO'}</span>`;
        const deleteBtn = isAdmin ? `<button class="btn-action btn-del" onclick="eliminar('publicadores', ${d.id})" title="Eliminar"><i class="fa-solid fa-trash-can"></i></button>` : ''; const editBtn = isAdmin ? `<button class="btn-action btn-edit" onclick="editarPub(${d.id})" title="Editar"><i class="fa-solid fa-pen-to-square"></i></button>` : '';
        const infoBadge = d.informo_mes === 'SI' ? '<span class="badge badge-si"><i class="fa-solid fa-check"></i> SÍ</span>' : '<span class="badge badge-no"><i class="fa-solid fa-xmark"></i> NO</span>';
        let fechaTxt = '-'; if (d.fecha_ingreso) { const dateObj = new Date(d.fecha_ingreso); const userTimezoneOffset = dateObj.getTimezoneOffset() * 60000; fechaTxt = new Date(dateObj.getTime() + userTimezoneOffset).toLocaleDateString('es-ES', { month: 'short', year: 'numeric' }); }
        tbody.innerHTML += `<tr class="${rowClass}"><td><b>${d.grupo}</b></td><td style="font-weight:500">${esc(d.nombre)}${vinculosPub(d)}</td><td>${esc(d.priv1 || '-')}</td><td>${esc(d.priv2 || '-')}</td><td><span class="badge badge-gray">${esc(d.priv3)}</span></td><td>${infoBadge}</td><td style="font-size:0.85rem; max-width:150px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(d.comentario || '')}</td><td class="global-view" style="font-size:0.85em;">${fechaTxt}</td><td class="admin-only">${switchHtml}</td><td>${editBtn} ${deleteBtn}</td></tr>`;
    });
    document.getElementById('pub-stat-total').textContent = stats.total; document.getElementById('pub-stat-reg').textContent = stats.reg; document.getElementById('pub-stat-esp').textContent = stats.esp; document.getElementById('pub-stat-aux').textContent = stats.aux; document.getElementById('pub-stat-pub').textContent = stats.pub;
    const groupContainer = document.getElementById('pub-groups-container'); groupContainer.innerHTML = '';
    Object.keys(stats.groups).forEach(gId => { groupContainer.innerHTML += `<div class="group-stat-card"><div class="g-label">G ${gId}</div><div class="g-value">${stats.groups[gId]}</div></div>`; });
    if (isAdmin) { document.querySelectorAll('.admin-only').forEach(e => e.style.display = 'table-cell'); document.querySelectorAll('.global-view.badge').forEach(e => e.style.display = 'none'); }
    if (isGlobal) { document.querySelectorAll('.global-view').forEach(e => e.style.display = 'table-cell'); }
}
async function toggleEstado(id, nuevoEstado, checkbox) { const accionTexto = nuevoEstado ? 'activar' : 'desactivar'; const result = await Swal.fire({ title: `¿${accionTexto} publicador?`, icon: 'warning', showCancelButton: true, confirmButtonText: 'Sí' }); if (result.isConfirmed) { try { const res = await fetch(`/api/publicadores/${id}/estado`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ activo: nuevoEstado, requester_group: session.grupo }) }); const json = await res.json(); if (json.ok) { Toast.fire({ icon: 'success', title: `Listo` }); invalidarBuscadorPublicadores(); cargarTablaPublicadores(); } else { Swal.fire('Error', json.msg, 'error'); checkbox.checked = !nuevoEstado; } } catch (e) { checkbox.checked = !nuevoEstado; } } else { checkbox.checked = !nuevoEstado; } }

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
    f.telefono.value = obj.telefono || '';
    document.getElementById('pubEsConductor').checked = Boolean(Number(obj.es_conductor));

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
    data.es_conductor = document.getElementById('pubEsConductor').checked; 
    
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
        invalidarBuscadorPublicadores(); 
        cargarTablaPublicadores(); 
    } else { 
        Swal.fire('Error', json.msg, 'error'); 
    } 
});

