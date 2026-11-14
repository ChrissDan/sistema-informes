// Territorios: modal de bitácora y registro de avance
// (script clásico: comparte el ámbito global con el resto de archivos; el orden de carga está en dashboard.html)
function copiarResumenProgramaPredicacion() {
    mostrarSubTabTerritorio('programa');
}

/* ==========================================================================
   MODAL DE BITÁCORA Y REGISTRO DE AVANCE POR TERRITORIO INDIVIDUAL
   ========================================================================== */
async function abrirModalBitacoraTerritorio(terrId) {
    if (!terrId) return;
    if (cacheTerritorios.length === 0) await cargarTerritoriosData();
    if (cacheBitacoraTerr.length === 0) await cargarBitacoraTerritorios();

    const t = cacheTerritorios.find(x => String(x.id) === String(terrId) || String(x.numero) === String(terrId));
    if (!t) {
        Swal.fire('Territorio no encontrado', 'No se encontró la información del territorio seleccionado.', 'warning');
        return;
    }

    const modalWrapper = document.getElementById('mainModal');
    const modalBox = modalWrapper?.querySelector('.modal-box');
    const modalBody = document.getElementById('modalBody');
    const modalTitle = document.getElementById('modalTitle');
    const formsContainer = document.getElementById('formsContainer');

    // Mover cualquier formulario previo de regreso al contenedor seguro
    while (modalBody.firstChild) {
        formsContainer.appendChild(modalBody.firstChild);
    }

    if (modalBox) modalBox.classList.add('modal-wide');
    modalTitle.innerHTML = `<i class="fa-solid fa-map-location-dot"></i> Territorio ${esc(t.numero)}${t.nombre ? ' · ' + esc(t.nombre) : ''} — Bitácora y Estado`;

    // Filtrar registros de la bitácora general solo de este territorio
    const regsTerr = cacheBitacoraTerr.filter(b => String(b.territorio_id) === String(t.id) || String(b.territorio_numero) === String(t.numero));
    regsTerr.sort((a, b) => {
        const fa = a.fecha_registro || a.fecha || '';
        const fb = b.fecha_registro || b.fecha || '';
        return String(fb).localeCompare(String(fa)) || (b.id - a.id);
    });

    const badgeEstado = t.estado_actual === 'INICIO - CIERRE'
        ? '<span class="badge badge-si">INICIO - CIERRE</span>'
        : (t.estado_actual === 'CIERRE'
            ? '<span class="badge badge-si">CIERRE</span>'
            : (t.estado_actual === 'AVANCE' ? '<span class="badge badge-no">AVANCE</span>' : (t.estado_actual === 'INICIO' ? '<span class="badge badge-grp">INICIO</span>' : '<span class="badge badge-gray">SIN INICIAR</span>')));

    // Manzanas detalle del estado actual
    let pills = '';
    const det = t.manzanas_detalle || {};
    let completasCount = 0;
    let incompletasCount = 0;
    for (let m = 1; m <= t.cantidad_manzanas; m++) {
        const st = det[m];
        if (st === 'COMPLETO') completasCount++;
        else if (st === 'INCOMPLETO') incompletasCount++;
        const cls = st === 'COMPLETO' ? 'is-completo' : (st === 'INCOMPLETO' ? 'is-incompleto' : '');
        const title = st === 'COMPLETO' ? 'Manzana ' + m + ': Completa' : (st === 'INCOMPLETO' ? 'Manzana ' + m + ': Incompleta' : 'Manzana ' + m + ': Pendiente');
        pills += `<span class="manzana-pill ${cls}" style="padding:4px 8px; font-size:0.8rem;" title="${title}">${m}</span>`;
    }

    const fIniStr = t.fecha_inicio ? String(t.fecha_inicio).split('T')[0] : 'Sin iniciar';
    const fCierreStr = t.fecha_cierre ? String(t.fecha_cierre).split('T')[0] : 'En curso';

    let filasBitacora = '';
    if (regsTerr.length === 0) {
        filasBitacora = `
            <tr>
                <td colspan="10" style="text-align:center; padding:28px 16px; color:#71717a;">
                    <i class="fa-solid fa-clipboard" style="font-size:2rem; color:#cbd5e1; margin-bottom:8px; display:block;"></i>
                    No hay registros de salidas en la bitácora para este territorio aún.<br>
                    ${isAdmin ? '<span style="font-size:0.82rem; color:#0284c7; font-weight:600; display:inline-block; margin-top:6px;">Usa el botón de arriba para registrar el primer avance.</span>' : ''}
                </td>
            </tr>
        `;
    } else {
        regsTerr.forEach(b => {
            const fechaStr = b.fecha ? String(b.fecha).split('T')[0] : '-';
            const esCierreEst = b.estado_territorio === 'CIERRE' || b.estado_territorio === 'INICIO - CIERRE';
            const fechaCierreRaw = b.fecha_cierre ? String(b.fecha_cierre).split('T')[0] : (esCierreEst ? fechaStr : '');
            const fechaRegStr = b.fecha_registro ? String(b.fecha_registro).split('T')[0] : (fechaCierreRaw || fechaStr);
            const fechaCierreHtml = fechaCierreRaw ? `<span class="badge badge-si">${fechaCierreRaw}</span>` : '<span style="color:#8f8f8f; font-size:0.8rem;">En curso</span>';
            const { completas, incompletas } = parseDetalleManzanasRowCliente(b);
            let badgeManz = '';
            if (completas.length > 0 && incompletas.length > 0) {
                badgeManz = `
                    <div style="display:flex; flex-direction:column; gap:3px; align-items:flex-start;">
                        <span class="badge badge-si">COMPLETO (Mz. ${completas.join(', ')})</span>
                        <span class="badge badge-no">INCOMPLETO (Mz. ${incompletas.join(', ')})</span>
                    </div>
                `;
            } else if (incompletas.length > 0 || b.estado_manzanas === 'INCOMPLETO') {
                badgeManz = `<span class="badge badge-no">INCOMPLETO (Mz. ${incompletas.join(', ') || b.manzanas})</span>`;
            } else {
                badgeManz = `<span class="badge badge-si">COMPLETO (Mz. ${completas.join(', ') || b.manzanas})</span>`;
            }
            const badgeTerr = b.estado_territorio === 'INICIO - CIERRE'
                ? '<span class="badge badge-si">INICIO - CIERRE</span>'
                : (b.estado_territorio === 'CIERRE'
                    ? '<span class="badge badge-si">CIERRE</span>'
                    : (b.estado_territorio === 'AVANCE' ? '<span class="badge badge-no">AVANCE</span>' : '<span class="badge badge-grp">INICIO</span>'));

            const acciones = isAdmin
                ? `<button class="btn-action btn-edit" onclick="editarBitacora(${b.id})" title="Editar registro"><i class="fa-solid fa-pen-to-square"></i></button>
                   <button class="btn-action btn-del" onclick="eliminarBitacoraDesdeModalTerritorio(${b.id}, '${t.id}')" title="Eliminar registro"><i class="fa-solid fa-trash-can"></i></button>`
                : '-';

            filasBitacora += `
                <tr>
                    <td><span style="color:#64748b; font-weight:500;">${fechaRegStr}</span></td>
                    <td>${fechaStr}</td>
                    <td>${fechaCierreHtml}</td>
                    <td><span class="badge badge-gray">Vuelta #${b.ciclo}</span></td>
                    <td>Manz. <strong>${b.manzanas}</strong></td>
                    <td>${badgeManz}</td>
                    <td>${esc(b.turno_nombre || '-')}</td>
                    <td>${esc(b.conductor_nombre || '-')}</td>
                    <td>${badgeTerr}</td>
                    <td class="admin-only" style="display:${isAdmin ? 'table-cell' : 'none'}">${acciones}</td>
                </tr>
            `;
        });
    }

    modalBody.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:16px;">
            <!-- TARJETA RESUMEN DEL TERRITORIO -->
            <div style="background:var(--bg-card, #ffffff); border:1px solid var(--border-color, #e4e4e7); border-radius:12px; padding:16px; box-shadow:0 1px 3px rgba(0,0,0,0.04);">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:12px; margin-bottom:12px;">
                    <div>
                        <div style="font-size:1.18rem; font-weight:700; color:var(--text-color, #18181b); display:flex; align-items:center; gap:8px;">
                            <i class="fa-solid fa-map-pin" style="color:var(--primary, #0284c7);"></i>
                            Territorio ${esc(t.numero)} ${t.nombre ? '· <span style="font-weight:500; font-size:1rem; color:#71717a;">' + esc(t.nombre) + '</span>' : ''}
                        </div>
                        <div style="font-size:0.82rem; color:#71717a; margin-top:4px;">
                            Vuelta actual: <strong>#${t.ciclo_actual || 1}</strong> · Vueltas completadas: <strong>${t.vueltas_completas || 0}</strong> · Total manzanas: <strong>1 a ${t.cantidad_manzanas}</strong>
                        </div>
                    </div>
                    <div style="display:flex; align-items:center; gap:8px;">
                        ${badgeEstado}
                        <span class="badge badge-gray">Vuelta #${t.ciclo_actual || 1}</span>
                    </div>
                </div>

                <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:12px; margin-bottom:14px; background:var(--bg-body, #fafafa); padding:10px 14px; border-radius:8px;">
                    <div>
                        <span style="font-size:0.72rem; color:#71717a; text-transform:uppercase; font-weight:600; display:block;">Inicio Vuelta</span>
                        <strong style="font-size:0.85rem; color:var(--text-color, #18181b);">${fIniStr}</strong>
                    </div>
                    <div>
                        <span style="font-size:0.72rem; color:#71717a; text-transform:uppercase; font-weight:600; display:block;">Último Cierre</span>
                        <strong style="font-size:0.85rem; color:var(--text-color, #18181b);">${fCierreStr}</strong>
                    </div>
                    <div>
                        <span style="font-size:0.72rem; color:#71717a; text-transform:uppercase; font-weight:600; display:block;">Progreso Vuelta Actual</span>
                        <strong style="font-size:0.85rem; color:var(--text-color, #18181b);">${t.completadas || 0} de ${t.cantidad_manzanas} manz. (${t.porcentaje || 0}%)</strong>
                    </div>
                </div>

                <div style="margin-bottom:10px;">
                    <div style="display:flex; justify-content:space-between; font-size:0.75rem; color:#71717a; margin-bottom:4px;">
                        <span>Avance del recorrido</span>
                        <strong>${t.porcentaje || 0}%</strong>
                    </div>
                    <div class="progress-bar-bg" style="height:7px;"><div class="progress-bar-fill" style="width:${t.porcentaje || 0}%"></div></div>
                </div>

                <div>
                    <div style="font-size:0.76rem; font-weight:600; color:#52525b; margin-bottom:6px;">
                        Estado de Manzanas (1 a ${t.cantidad_manzanas}):
                        <span style="font-weight:400; font-size:0.72rem; margin-left:6px; color:#71717a;">
                            <span style="color:#16a34a;">●</span> Completas: ${completasCount} &nbsp;
                            <span style="color:#ea580c;">●</span> Incompletas: ${incompletasCount} &nbsp;
                            <span style="color:#a1a1aa;">●</span> Pendientes: ${t.cantidad_manzanas - completasCount - incompletasCount}
                        </span>
                    </div>
                    <div class="manzanas-mini-grid" style="gap:4px; flex-wrap:wrap; display:flex;">${pills}</div>
                </div>
            </div>

            <!-- BARRA DE ACCIÓN: REGISTRAR AVANCE -->
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; border-bottom:1px solid var(--border-color, #e4e4e7); padding-bottom:12px;">
                <div style="font-size:0.95rem; font-weight:700; color:var(--text-color, #18181b); display:flex; align-items:center; gap:8px;">
                    <i class="fa-solid fa-clock-rotate-left" style="color:var(--primary, #0284c7);"></i>
                    Historial de Bitácora del Territorio ${esc(t.numero)}
                    <span class="badge badge-gray">${regsTerr.length} salidas</span>
                </div>
                ${isAdmin ? `
                    <button type="button" class="btn-primary" onclick="abrirFormularioRegistroAvanceTerritorio('${t.id}')" style="font-weight:600; padding:8px 16px; display:inline-flex; align-items:center; gap:8px;">
                        <i class="fa-solid fa-pen-to-square"></i> Registrar Avance en Territorio ${esc(t.numero)}
                    </button>
                ` : ''}
            </div>

            <!-- TABLA DE HISTORIAL DE BITÁCORA DEL TERRITORIO -->
            <div class="table-container" style="max-height:45vh; overflow-y:auto;">
                <table style="width:100%;">
                    <thead>
                        <tr>
                            <th>Fecha Reg.</th>
                            <th>Fecha Salida</th>
                            <th>Fecha Cierre</th>
                            <th>Vuelta</th>
                            <th>Manzanas</th>
                            <th>Estado Mz.</th>
                            <th>Turno</th>
                            <th>Conductor</th>
                            <th>Estado</th>
                            <th class="admin-only" style="display:${isAdmin ? 'table-cell' : 'none'}">Acciones</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${filasBitacora}
                    </tbody>
                </table>
            </div>
        </div>
    `;

    modalWrapper.classList.add('active');
}

async function abrirFormularioRegistroAvanceTerritorio(terrId) {
    if (!isAdmin) return;
    if (cacheTerritorios.length === 0) await cargarTerritoriosData();
    const t = cacheTerritorios.find(x => String(x.id) === String(terrId) || String(x.numero) === String(terrId));

    const modalWrapper = document.getElementById('mainModal');
    const modalBox = modalWrapper?.querySelector('.modal-box');
    const modalBody = document.getElementById('modalBody');
    const modalTitle = document.getElementById('modalTitle');
    const formsContainer = document.getElementById('formsContainer');

    // Regresar hijos al contenedor seguro de formularios
    while (modalBody.firstChild) {
        formsContainer.appendChild(modalBody.firstChild);
    }

    if (modalBox) modalBox.classList.remove('modal-wide');
    modalTitle.innerHTML = `<i class="fa-solid fa-pen-to-square"></i> Registrar Avance en Territorio ${t ? t.numero : ''}`;

    await resetFormBitacora();

    const selTerr = document.getElementById('bitTerritorioSelect');
    if (selTerr && t) {
        selTerr.value = t.id;
        await cargarSelectorManzanasBitacora();
    }

    const form = document.getElementById('formBitacora');
    if (form) {
        form.style.display = 'grid';
        modalBody.appendChild(form);
    }
    modalWrapper.classList.add('active');
}

async function eliminarBitacoraDesdeModalTerritorio(id, terrId) {
    const result = await Swal.fire({
        title: '¿Eliminar registro?',
        text: 'Se eliminará esta entrada de la bitácora.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        confirmButtonText: 'Sí, eliminar',
        cancelButtonText: 'Cancelar'
    });
    if (result.isConfirmed) {
        try {
            const res = await fetch(`/api/territorios/bitacora/${id}`, { method: 'DELETE' });
            const json = await res.json();
            if (json.ok) {
                Toast.fire({ icon: 'success', title: 'Registro eliminado' });
                await cargarVistaTerritorios();
                abrirModalBitacoraTerritorio(terrId);
            } else {
                Swal.fire('Error', json.msg || 'No se pudo eliminar', 'error');
            }
        } catch (e) {
            Swal.fire('Error', 'No se pudo comunicar con el servidor', 'error');
        }
    }
}

function volverModalTerritorioDesdeFormBitacora() {
    const terrId = document.getElementById('bitTerritorioSelect')?.value;
    if (terrId) {
        abrirModalBitacoraTerritorio(terrId);
    } else {
        cerrarModal();
    }
}

