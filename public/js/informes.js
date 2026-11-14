// Informes: formulario, tabla y selección de publicadores
// (script clásico: comparte el ámbito global con el resto de archivos; el orden de carga está en dashboard.html)
let cachePublicadores = []; let cacheInformes = []; let cacheUsuarios = []; let cacheReuniones = [];
// Año de servicio para registrar: los no-admin siempre usan el del mes activo; el admin el del selector global
function anioFormInforme() { return (!isAdmin && mesActivo) ? mesActivo.anio_servicio : getAnio(); }
async function cargarPublicadoresSelect(grupoId, mode = 'pending') { try { let url = `/api/publicadores?grupo=${grupoId}`; if (mode === 'pending') { const NM = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE']; const mesForm = document.getElementById('formMesSelect').value || NM[(new Date().getMonth() + 11) % 12]; url += `&sin_informe_mes=${encodeURIComponent(mesForm)}&anio_servicio=${anioFormInforme()}`; } const res = await fetch(url); cachePublicadores = await res.json(); const sel = document.getElementById('selectPubInfo'); const currentVal = sel.value; sel.innerHTML = mode === 'pending' ? (cachePublicadores.length ? `<option value="">-- Seleccione (${cachePublicadores.length} pendientes) --</option>` : '<option value="">✔ Todos ya informaron este mes</option>') : '<option value="">-- Seleccione --</option>'; cachePublicadores.forEach(p => { sel.innerHTML += `<option value="${p.id}">${esc(p.nombre)}</option>`; }); if (mode === 'all' && currentVal && cachePublicadores.find(p => p.id == currentVal)) sel.value = currentVal; return cachePublicadores; } catch (e) { console.error(e); return []; } }
function cargarDatosPub() { const id = document.getElementById('selectPubInfo').value; const pub = cachePublicadores.find(p => p.id == id); if (pub) { document.getElementById('readPriv3').value = pub.priv3; actualizarEstadoHoras(pub.priv3); } else { document.getElementById('readPriv3').value = ""; document.getElementById('inputHoras').disabled = true; } }
function actualizarEstadoHoras(privilegio) { const inputHoras = document.getElementById('inputHoras'); const inputCredito = document.getElementById('inputCredito'); const p = (privilegio || "").trim().toUpperCase(); const reportan = ['ESP', 'REG', 'AUX I', 'AUX M', 'AUX', 'AUX C']; const reportanCredito = ['REG', 'ESP']; if (reportan.includes(p)) { inputHoras.disabled = false; } else { inputHoras.disabled = true; inputHoras.value = ""; } if (reportanCredito.includes(p)) { inputCredito.disabled = false; } else { inputCredito.disabled = true; inputCredito.value = ""; } }
function limpiarFiltrosInformes() { if (isGlobal) document.getElementById('infFiltroGrupo').value = ''; document.getElementById('infFiltroPriv3').value = ''; buscadorInformes.limpiar(); cargarTablaInformes(); }

// --- INFORMES ---
async function cargarTablaInformes() {
    let mes = MESES[mesIndexInformes]; let grp = isGlobal ? 0 : session.grupo; const fGrupo = document.getElementById('infFiltroGrupo') ? document.getElementById('infFiltroGrupo').value : null; if (isGlobal && fGrupo) grp = fGrupo; const fPriv3 = document.getElementById('infFiltroPriv3').value; const idsNombre = await buscadorInformes.idsParaBuscar(); 
    const params = new URLSearchParams({ grupo: grp, anio_servicio: getAnio() }); // AÑO AÑADIDO
    if (mes) params.append('mes', mes); if (fPriv3) params.append('priv3', fPriv3); if (idsNombre) params.append('publicador_ids', idsNombre.join(',') || '0');
    if (!mesActivo) await cargarMesActivo(); const res = await fetch(`/api/informes?${params.toString()}`); cacheInformes = await res.json(); const tbody = document.getElementById('tablaInformes'); tbody.innerHTML = '';
    if (cacheInformes.length === 0) { tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:30px; color:#94a3b8;">No se encontraron resultados para ${mes} del año ${getAnio()}.</td></tr>`; return; }

    const mesEstaCerrado = (typeof mesesCerrados !== 'undefined' ? mesesCerrados : []).includes(mes);

    cacheInformes.forEach(d => {
        const badge = d.predico === 'SI' ? '<span class="badge badge-si"><i class="fa-solid fa-check"></i> SÍ</span>' : '<span class="badge badge-no"><i class="fa-solid fa-xmark"></i> NO</span>'; const grpCell = isGlobal ? `<td><span class="badge-grp">G${d.grupo}</span></td>` : '';
        let editBtn = ''; let deleteBtn = '';
        if (!mesEstaCerrado) {
            if (isAdmin) deleteBtn = `<button class="btn-action btn-del" onclick="eliminar('informes', ${d.id})" title="Eliminar"><i class="fa-solid fa-trash-can"></i></button>`;
            const esMesActivo = !!mesActivo && mes === mesActivo.mes && String(getAnio()) === String(mesActivo.anio_servicio); // el encargado solo edita el mes activo
            if (isGlobal || (d.grupo == session.grupo && esMesActivo)) editBtn = `<button class="btn-action btn-edit" onclick="editarInforme(${d.id})" title="Editar"><i class="fa-solid fa-pen-to-square"></i></button>`;
        }
        const credDisplay = d.credito_hrs > 0 ? `<span style="color:#d97706; font-size:0.8em">+${d.credito_hrs}</span>` : '';
        tbody.innerHTML += `<tr>${grpCell}<td>${esc(d.nombre_publicador || d.publicador_nombre)}</td><td><span class="badge badge-gray">${esc(d.priv3)}</span></td><td style="text-align:center"><b>${d.horas}</b> ${credDisplay}</td><td style="text-align:center">${d.cursos}</td><td style="text-align:center">${d.credito_hrs || '-'}</td><td style="text-align:center">${badge}</td><td style="font-size:0.8em; color:#666;">${esc(d.comentarios || '')}</td><td>${editBtn} ${deleteBtn}</td></tr>`;
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

