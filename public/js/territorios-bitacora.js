// Territorios: conductores, turnos, bitácora, formularios y S-13
// (script clásico: comparte el ámbito global con el resto de archivos; el orden de carga está en dashboard.html)
async function cargarConductoresData() {
    try {
        const res = await fetch('/api/conductores');
        cacheConductores = await res.json();
        const countEl = document.getElementById('countTerrConductores');
        if (countEl) countEl.textContent = cacheConductores.length;

        const tbody = document.getElementById('tablaConductores');
        if (!tbody) return;
        if (cacheConductores.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:20px; color:#8f8f8f;">No hay conductores registrados.</td></tr>';
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
                    <td><strong>${esc(c.nombre)}</strong></td>
                    <td>${esc(c.telefono || '-')}</td>
                    <td>${c.activo === 0 ? '<span class="badge badge-gray">INACTIVO</span>' : '<span class="badge badge-si">ACTIVO</span>'}</td>
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
                    <td><strong>${esc(t.nombre)}</strong></td>
                    <td>${esc(t.horario || '-')}</td>
                    <td class="admin-only" style="display:${isAdmin ? 'table-cell' : 'none'}">${acciones}</td>
                </tr>
            `;
        });
    } catch (e) { console.error(e); }
}

function poblarOpcionesFiltrosBitacora() {
    const selTerr = document.getElementById('fBitTerritorio');
    if (selTerr) {
        const prev = selTerr.value;
        const nums = cacheTerritorios.length
            ? cacheTerritorios.map(t => String(t.numero))
            : Array.from(new Set(cacheBitacoraTerr.map(b => String(b.territorio_numero)))).sort((a, b) => Number(a) - Number(b));
        selTerr.innerHTML = '<option value="">Todos</option>' + nums.map(n => `<option value="${n}">Territorio ${n}</option>`).join('');
        selTerr.value = prev;
    }

    const selCiclo = document.getElementById('fBitCiclo');
    if (selCiclo) {
        const prev = selCiclo.value;
        const ciclos = Array.from(new Set(cacheBitacoraTerr.map(b => b.ciclo || 1))).sort((a, b) => a - b);
        selCiclo.innerHTML = '<option value="">Todas</option>' + ciclos.map(c => `<option value="${c}">Vuelta #${c}</option>`).join('');
        selCiclo.value = prev;
    }

    const selTurno = document.getElementById('fBitTurno');
    if (selTurno) {
        const prev = selTurno.value;
        const turnos = Array.from(new Set(cacheBitacoraTerr.map(b => (b.turno_nombre || '').trim()).filter(Boolean))).sort();
        selTurno.innerHTML = '<option value="">Todos</option>' + turnos.map(t => `<option value="${t}">${t}</option>`).join('');
        selTurno.value = prev;
    }

    const selCond = document.getElementById('fBitConductor');
    if (selCond) {
        const prev = selCond.value;
        const conds = Array.from(new Set(cacheBitacoraTerr.map(b => (b.conductor_nombre || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
        selCond.innerHTML = '<option value="">Todos</option>' + conds.map(c => `<option value="${c}">${c}</option>`).join('');
        selCond.value = prev;
    }
}

function limpiarRangoFechaBitacora(inputId, ev) {
    if (ev) ev.stopPropagation();
    const el = document.getElementById(inputId);
    if (el) {
        el.value = '';
        el.dataset.from = '';
        el.dataset.to = '';
        el.classList.remove('has-range');
    }
    const clearBtn = document.getElementById(inputId + 'Clear');
    if (clearBtn) clearBtn.style.display = 'none';
    if (vcalState.activeInput && vcalState.activeInput.id === inputId) {
        cerrarVCal();
    }
    renderTablaBitacoraFiltrada();
}

function limpiarFiltrosBitacora() {
    ['fBitFechaReg', 'fBitFechaIni', 'fBitFechaFin'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.value = '';
            el.dataset.from = '';
            el.dataset.to = '';
            el.classList.remove('has-range');
        }
        const clearBtn = document.getElementById(id + 'Clear');
        if (clearBtn) clearBtn.style.display = 'none';
    });
    ['fBitTerritorio', 'fBitCiclo', 'fBitManzanas', 'fBitEstManz', 'fBitTurno', 'fBitConductor', 'fBitEstTerr'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    cerrarVCal();
    renderTablaBitacoraFiltrada();
}

async function cargarBitacoraTerritorios() {
    try {
        const res = await fetch('/api/territorios/bitacora');
        cacheBitacoraTerr = await res.json();
        poblarOpcionesFiltrosBitacora();
        renderTablaBitacoraFiltrada();
        renderGraficaTerritorios();
    } catch (e) { console.error(e); }
}

function parseDetalleManzanasRowCliente(b) {
    const map = {};
    if (b && b.manzanas_detalle) {
        try {
            const parsed = typeof b.manzanas_detalle === 'string' ? JSON.parse(b.manzanas_detalle) : b.manzanas_detalle;
            if (parsed && typeof parsed === 'object') {
                for (const [k, v] of Object.entries(parsed)) {
                    const num = parseInt(k, 10);
                    if (!isNaN(num) && num >= 1) {
                        map[num] = v === 'COMPLETO' ? 'COMPLETO' : 'INCOMPLETO';
                    }
                }
            }
        } catch (e) {}
    }
    if (Object.keys(map).length === 0 && b && b.manzanas) {
        const estDef = b.estado_manzanas === 'INCOMPLETO' ? 'INCOMPLETO' : 'COMPLETO';
        String(b.manzanas).split(',').map(x => parseInt(x.trim(), 10)).filter(n => !isNaN(n) && n >= 1).forEach(m => {
            map[m] = estDef;
        });
    }
    const completas = [];
    const incompletas = [];
    Object.keys(map).map(Number).sort((a, b) => a - b).forEach(m => {
        if (map[m] === 'COMPLETO') completas.push(m);
        else incompletas.push(m);
    });
    return { map, completas, incompletas };
}

function renderTablaBitacoraFiltrada() {
    const tbody = document.getElementById('tablaBitacoraTerritorios');
    if (!tbody) return;

    const elReg = document.getElementById('fBitFechaReg');
    const fRegFrom = elReg?.dataset.from || '';
    const fRegTo = elReg?.dataset.to || '';

    const elIni = document.getElementById('fBitFechaIni');
    const fIniFrom = elIni?.dataset.from || '';
    const fIniTo = elIni?.dataset.to || '';

    const elFin = document.getElementById('fBitFechaFin');
    const fFinFrom = elFin?.dataset.from || '';
    const fFinTo = elFin?.dataset.to || '';

    const fTerr = document.getElementById('fBitTerritorio')?.value || '';
    const fCiclo = document.getElementById('fBitCiclo')?.value || '';
    const fManz = (document.getElementById('fBitManzanas')?.value || '').trim().toLowerCase();
    const fEstManz = document.getElementById('fBitEstManz')?.value || '';
    const fTurno = document.getElementById('fBitTurno')?.value || '';
    const fCond = document.getElementById('fBitConductor')?.value || '';
    const fEstTerr = document.getElementById('fBitEstTerr')?.value || '';

    const filtrados = cacheBitacoraTerr.filter(b => {
        const fechaStr = b.fecha ? String(b.fecha).split('T')[0] : '';
        const esCierreEst = b.estado_territorio === 'CIERRE' || b.estado_territorio === 'INICIO - CIERRE';
        const fechaCierreRaw = b.fecha_cierre ? String(b.fecha_cierre).split('T')[0] : (esCierreEst ? fechaStr : '');
        const fechaRegStr = b.fecha_registro ? String(b.fecha_registro).split('T')[0] : (fechaCierreRaw || fechaStr);

        if (fRegFrom || fRegTo) {
            if (!fechaRegStr) return false;
            if (fRegFrom && fechaRegStr < fRegFrom) return false;
            if (fRegTo && fechaRegStr > fRegTo) return false;
        }
        if (fIniFrom || fIniTo) {
            if (!fechaStr) return false;
            if (fIniFrom && fechaStr < fIniFrom) return false;
            if (fIniTo && fechaStr > fIniTo) return false;
        }
        if (fFinFrom || fFinTo) {
            if (!fechaCierreRaw) return false;
            if (fFinFrom && fechaCierreRaw < fFinFrom) return false;
            if (fFinTo && fechaCierreRaw > fFinTo) return false;
        }
        if (fTerr && String(b.territorio_numero) !== String(fTerr)) return false;
        if (fCiclo && String(b.ciclo || 1) !== String(fCiclo)) return false;
        if (fManz) {
            const listaM = String(b.manzanas || '').split(',').map(s => s.trim());
            const coincideExacto = listaM.includes(fManz);
            const coincideSub = String(b.manzanas || '').toLowerCase().includes(fManz);
            if (!coincideExacto && !coincideSub) return false;
        }
        if (fEstManz) {
            const { completas, incompletas } = parseDetalleManzanasRowCliente(b);
            if (fEstManz === 'COMPLETO' && completas.length === 0 && b.estado_manzanas !== 'COMPLETO') return false;
            if (fEstManz === 'INCOMPLETO' && incompletas.length === 0 && b.estado_manzanas !== 'INCOMPLETO') return false;
        }
        if (fTurno && (b.turno_nombre || '').trim() !== fTurno) return false;
        if (fCond && (b.conductor_nombre || '').trim() !== fCond) return false;
        if (fEstTerr && b.estado_territorio !== fEstTerr) return false;
        return true;
    });

    if (filtrados.length === 0) {
        tbody.innerHTML = '<tr><td colspan="11" style="text-align:center; padding:24px; color:#8f8f8f;">No se encontraron registros con los filtros seleccionados.</td></tr>';
        return;
    }

    tbody.innerHTML = '';
    filtrados.forEach(b => {
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
            badgeManz = '<span class="badge badge-no">INCOMPLETO</span>';
        } else {
            badgeManz = '<span class="badge badge-si">COMPLETO</span>';
        }
        const badgeTerr = b.estado_territorio === 'INICIO - CIERRE'
            ? '<span class="badge badge-si">INICIO - CIERRE</span>'
            : (b.estado_territorio === 'CIERRE'
                ? '<span class="badge badge-si">CIERRE</span>'
                : (b.estado_territorio === 'AVANCE' ? '<span class="badge badge-no">AVANCE</span>' : '<span class="badge badge-grp">INICIO</span>'));
        const acciones = isAdmin
            ? `<button class="btn-action btn-edit" onclick="editarBitacora(${b.id})" title="Editar registro"><i class="fa-solid fa-pen-to-square"></i></button>
               <button class="btn-action btn-del" onclick="eliminar('territorios/bitacora', ${b.id})" title="Eliminar registro"><i class="fa-solid fa-trash-can"></i></button>`
            : '-';
        tbody.innerHTML += `
            <tr>
                <td><span style="color:#64748b; font-weight:500;">${fechaRegStr}</span></td>
                <td>${fechaStr}</td>
                <td>${fechaCierreHtml}</td>
                <td><strong>Territorio ${esc(b.territorio_numero)}</strong></td>
                <td><span class="badge badge-gray">Vuelta #${b.ciclo}</span></td>
                <td>Manz. <strong>${b.manzanas}</strong></td>
                <td>${badgeManz}</td>
                <td>${esc(b.turno_nombre)}</td>
                <td>${esc(b.conductor_nombre)}</td>
                <td>${badgeTerr}</td>
                <td class="admin-only" style="display:${isAdmin ? 'table-cell' : 'none'}">${acciones}</td>
            </tr>
        `;
    });
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
                sel.innerHTML += `<option value="${p.id}" data-nombre="${esc(p.nombre)}" data-tel="${esc(p.telefono || '')}">${esc(p.nombre)} (G${p.grupo})</option>`;
            });
        } catch (e) {}
    }
}

function autocompletarConductor() {
    const sel = document.getElementById('selectPubConductor');
    const opt = sel.options[sel.selectedIndex];
    const nombre = opt ? opt.getAttribute('data-nombre') : '';
    if (nombre) document.getElementById('inputNombreConductor').value = nombre;
    const tel = opt ? opt.getAttribute('data-tel') : '';
    if (tel) document.getElementById('inputTelConductor').value = tel;   // el teléfono del publicador se completa solo
}

async function editarConductor(id) {
    const obj = cacheConductores.find(c => c.id == id);
    if (!obj) return;
    await resetFormConductor();
    document.getElementById('conductorId').value = obj.id;
    document.getElementById('inputNombreConductor').value = obj.nombre;
    document.getElementById('inputTelConductor').value = obj.telefono || '';
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

function normalizarFechaYMD(raw) {
    if (!raw) return '';
    const s = String(raw).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }
    return s;
}

function formatearFechaCortaEs(ymd) {
    const clean = normalizarFechaYMD(ymd);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;
    const [y, m, d] = clean.split('-').map(Number);
    const mesesCortos = ['ene.', 'feb.', 'mar.', 'abr.', 'may.', 'jun.', 'jul.', 'ago.', 'sep.', 'oct.', 'nov.', 'dic.'];
    return `${String(d).padStart(2, '0')} ${mesesCortos[m - 1] || ''} ${y}`;
}

function aplicarEstadoInputFechaInicioBitacora(fechaInicioCiclo = null) {
    const fEl = document.getElementById('bitFecha');
    const hintEl = document.getElementById('bitFechaHint');
    if (!fEl) return;
    const cleanYMD = normalizarFechaYMD(fechaInicioCiclo);
    if (cleanYMD) {
        fEl.value = cleanYMD;
        fEl.readOnly = true;
        fEl.dataset.locked = '1';
        if (hintEl) hintEl.textContent = `Iniciado el ${formatearFechaCortaEs(cleanYMD)}`;
    } else {
        if (fEl.dataset.locked === '1' || !fEl.value) {
            fEl.value = vcalTodayStr(); // fecha local (toISOString usa UTC y adelanta el día después de las 19:00 en Perú)
        }
        fEl.readOnly = false;
        fEl.dataset.locked = '';
        if (hintEl) hintEl.textContent = '';
    }
}

async function resetFormBitacora() {
    const f = document.getElementById('formBitacora');
    if (!f) return;
    f.reset();
    document.getElementById('bitacoraId').value = '';
    manzanasEstadoSeleccionadoMap.clear();
    infoManzanasActual = null;
    const fRegEl = document.getElementById('bitFechaRegistro');
    if (fRegEl) fRegEl.value = vcalTodayStr();
    aplicarEstadoInputFechaInicioBitacora(null);
    const fcEl = document.getElementById('bitFechaCierre');
    if (fcEl) fcEl.value = '';

    if (cacheTurnos.length === 0) await cargarTurnosData();
    if (cacheConductores.length === 0) await cargarConductoresData();
    if (cacheTerritorios.length === 0) await cargarTerritoriosData();

    const selTurno = document.getElementById('bitTurnoSelect');
    selTurno.innerHTML = cacheTurnos.length
        ? cacheTurnos.map(t => `<option value="${t.id}" data-nombre="${esc(t.nombre)}">${esc(t.nombre)}${t.horario ? ' (' + esc(t.horario) + ')' : ''}</option>`).join('')
        : '<option value="">-- Primero crea un turno --</option>';

    const selCond = document.getElementById('bitConductorSelect');
    selCond.innerHTML = cacheConductores.length
        ? cacheConductores.map(c => `<option value="${c.id}" data-nombre="${esc(c.nombre)}">${esc(c.nombre)}</option>`).join('')
        : '<option value="">-- Primero registra un conductor --</option>';

    const selTerr = document.getElementById('bitTerritorioSelect');
    selTerr.innerHTML = '<option value="">-- Seleccione territorio --</option>' +
        cacheTerritorios.map(t => `<option value="${t.id}">Territorio ${esc(t.numero)} (${t.completadas}/${t.cantidad_manzanas} manz. · ${t.porcentaje}%)</option>`).join('');

    document.getElementById('bitInfoTerritorio').textContent = 'Selecciona un territorio para ver sus manzanas (1 a N)...';
    document.getElementById('bitManzanasGrid').innerHTML = '';
    actualizarResumenSeleccionManzanas();
}

function aplicarEstadoVisualChipManzana(m, chipEl, estadoSel) {
    if (!chipEl) return;
    const stPrevio = (!infoManzanasActual?.nueva_vuelta && infoManzanasActual?.manzanas) ? infoManzanasActual.manzanas[m] : null;
    if (estadoSel === 'INCOMPLETO') {
        chipEl.className = 'manzana-chip selected-incompleto';
        chipEl.innerHTML = `<span>Manz. ${m}</span><small>◐ Incompleta</small>`;
    } else if (estadoSel === 'COMPLETO') {
        chipEl.className = 'manzana-chip selected-completo';
        chipEl.innerHTML = `<span>Manz. ${m}</span><small>✔ Completa</small>`;
    } else {
        chipEl.className = 'manzana-chip' + (stPrevio === 'INCOMPLETO' ? ' incompleto' : '');
        chipEl.innerHTML = `<span>Manz. ${m}</span><small>${stPrevio === 'INCOMPLETO' ? 'A medias' : 'Disponible'}</small>`;
    }
}

function actualizarResumenSeleccionManzanas() {
    const resEl = document.getElementById('bitResumenSeleccionManzanas');
    if (!resEl) return;
    if (manzanasEstadoSeleccionadoMap.size === 0) {
        resEl.style.display = 'none';
        resEl.innerHTML = '';
        return;
    }
    const completas = [];
    const incompletas = [];
    Array.from(manzanasEstadoSeleccionadoMap.keys()).sort((a, b) => a - b).forEach(m => {
        if (manzanasEstadoSeleccionadoMap.get(m) === 'COMPLETO') completas.push(m);
        else incompletas.push(m);
    });
    const badges = [];
    if (incompletas.length > 0) {
        badges.push(`<span class="badge badge-no">◐ Incompletas: Manz. ${incompletas.join(', ')}</span>`);
    }
    if (completas.length > 0) {
        badges.push(`<span class="badge badge-si">✔ Completas: Manz. ${completas.join(', ')}</span>`);
    }
    resEl.style.display = 'flex';
    resEl.innerHTML = `<span style="font-weight:600; color:#52525b;">Seleccionadas:</span> ${badges.join(' ')}`;
}

async function editarBitacora(id) {
    const obj = cacheBitacoraTerr.find(b => b.id == id);
    if (!obj) return;
    await resetFormBitacora();
    document.getElementById('bitacoraId').value = obj.id;
    const fRegEl = document.getElementById('bitFechaRegistro');
    if (fRegEl) fRegEl.value = obj.fecha_registro ? String(obj.fecha_registro).split('T')[0] : String(obj.fecha).split('T')[0];
    document.getElementById('bitFecha').value = String(obj.fecha).split('T')[0];
    const fcEl = document.getElementById('bitFechaCierre');
    if (fcEl) fcEl.value = obj.fecha_cierre ? String(obj.fecha_cierre).split('T')[0] : '';
    if (obj.turno_id) document.getElementById('bitTurnoSelect').value = obj.turno_id;
    if (obj.conductor_id) document.getElementById('bitConductorSelect').value = obj.conductor_id;
    document.getElementById('bitTerritorioSelect').value = obj.territorio_id;
    await cargarSelectorManzanasBitacora(obj.id, obj.ciclo);

    const { map } = parseDetalleManzanasRowCliente(obj);
    Object.entries(map).forEach(([mStr, est]) => {
        const m = parseInt(mStr, 10);
        if (!isNaN(m)) {
            manzanasEstadoSeleccionadoMap.set(m, est);
            const chip = document.querySelector(`#bitManzanasGrid .manzana-chip[data-manzana="${m}"]`);
            if (chip) aplicarEstadoVisualChipManzana(m, chip, est);
        }
    });
    actualizarResumenSeleccionManzanas();
    document.getElementById('bitEstadoTerritorio').value = obj.estado_territorio;
    abrirModal('bitacora', id);
}

async function cargarSelectorManzanasBitacora(excludeBitacoraId = null, cicloForzado = null) {
    const terrId = document.getElementById('bitTerritorioSelect').value;
    const grid = document.getElementById('bitManzanasGrid');
    const info = document.getElementById('bitInfoTerritorio');
    const editId = excludeBitacoraId || document.getElementById('bitacoraId').value || '';
    manzanasEstadoSeleccionadoMap.clear();
    grid.innerHTML = '';
    actualizarResumenSeleccionManzanas();
    if (!terrId) {
        aplicarEstadoInputFechaInicioBitacora(null);
        info.textContent = 'Selecciona un territorio para ver sus manzanas (1 a N)...';
        return;
    }
    try {
        let q = editId ? `?exclude_id=${editId}` : '';
        if (cicloForzado) q += (q ? '&' : '?') + `ciclo_forzado=${cicloForzado}`;
        const res = await fetch(`/api/territorios/${terrId}/manzanas${q}`);
        const data = await res.json();
        infoManzanasActual = data;
        if (!editId) {
            aplicarEstadoInputFechaInicioBitacora(data.fecha_inicio_ciclo || null);
        } else {
            const fEl = document.getElementById('bitFecha');
            const hintEl = document.getElementById('bitFechaHint');
            if (fEl) { fEl.readOnly = false; fEl.dataset.locked = ''; }
            if (hintEl) hintEl.textContent = '';
        }
        const total = data.territorio.cantidad_manzanas;
        const map = data.manzanas || {};
        const compCount = Object.values(map).filter(v => v === 'COMPLETO').length;

        if (data.nueva_vuelta) {
            info.innerHTML = `<strong>¡Nueva vuelta (#${data.ciclo})!</strong> El recorrido anterior se completó al 100%. Haz <strong>1 clic</strong> para marcar manzana <strong>Incompleta</strong> y <strong>2 clics</strong> para <strong>Completa</strong>.`;
        } else {
            info.innerHTML = `<strong>Territorio ${esc(data.territorio.numero)}</strong> · Vuelta #${data.ciclo} · Completadas: <strong>${compCount} de ${total}</strong>. Haz <strong>1 clic = Incompleta</strong> · <strong>2 clics = Completa</strong>.`;
        }

        for (let m = 1; m <= total; m++) {
            const st = map[m];
            const chip = document.createElement('div');
            if (st === 'COMPLETO') {
                chip.className = 'manzana-chip disabled';
                chip.innerHTML = `<span>Manz. ${m}</span><small>✔ Completa</small>`;
            } else {
                chip.dataset.manzana = m;
                aplicarEstadoVisualChipManzana(m, chip, null);
                chip.addEventListener('click', () => toggleChipManzana(m, chip));
            }
            grid.appendChild(chip);
        }
        const fcEl = document.getElementById('bitFechaCierre');
        if (!editId && fcEl && fcEl.value) {
            seleccionarTodasManzanasDisp('COMPLETO');
        } else {
            sugerirEstadoTerritorio();
        }
    } catch (e) { console.error(e); }
}

function toggleChipManzana(m, chipEl) {
    const actual = manzanasEstadoSeleccionadoMap.get(m);
    let siguiente = null;
    if (!actual) {
        siguiente = 'INCOMPLETO'; // 1er clic: Incompleta
    } else if (actual === 'INCOMPLETO') {
        siguiente = 'COMPLETO';   // 2do clic: Completa
    } else {
        siguiente = null;         // 3er clic: Desmarcar
    }

    if (siguiente) {
        manzanasEstadoSeleccionadoMap.set(m, siguiente);
    } else {
        manzanasEstadoSeleccionadoMap.delete(m);
    }
    aplicarEstadoVisualChipManzana(m, chipEl, siguiente);
    actualizarResumenSeleccionManzanas();
    sugerirEstadoTerritorio();
}

function seleccionarTodasManzanasDisp(modo) {
    const estadoObjetivo = (modo === 'COMPLETO' || modo === true)
        ? 'COMPLETO'
        : (modo === 'INCOMPLETO' ? 'INCOMPLETO' : null);

    document.querySelectorAll('#bitManzanasGrid .manzana-chip:not(.disabled)').forEach(chip => {
        const m = parseInt(chip.dataset.manzana, 10);
        if (estadoObjetivo) {
            manzanasEstadoSeleccionadoMap.set(m, estadoObjetivo);
        } else {
            manzanasEstadoSeleccionadoMap.delete(m);
        }
        aplicarEstadoVisualChipManzana(m, chip, estadoObjetivo);
    });
    actualizarResumenSeleccionManzanas();
    sugerirEstadoTerritorio();
}

function alCambiarFechaCierreBitacora() {
    const fcEl = document.getElementById('bitFechaCierre');
    if (fcEl && fcEl.value) {
        // Si se coloca fecha de cierre, marcar todas las manzanas disponibles como COMPLETAS automáticamente
        seleccionarTodasManzanasDisp('COMPLETO');
    }
    sugerirEstadoTerritorio();
}

function sugerirEstadoTerritorio() {
    const selEstTerr = document.getElementById('bitEstadoTerritorio');
    const fEl = document.getElementById('bitFecha');
    const fcEl = document.getElementById('bitFechaCierre');
    if (!selEstTerr) return;

    const fechaIni = normalizarFechaYMD(fEl?.value);
    const fechaFin = normalizarFechaYMD(fcEl?.value);
    if (fechaFin) {
        const fechaInicioCicloReal = (infoManzanasActual && !infoManzanasActual.nueva_vuelta && infoManzanasActual.fecha_inicio_ciclo)
            ? normalizarFechaYMD(infoManzanasActual.fecha_inicio_ciclo)
            : fechaIni;
        selEstTerr.value = (fechaInicioCicloReal && fechaInicioCicloReal === fechaFin) ? 'INICIO - CIERRE' : 'CIERRE';
        return;
    }

    if (!infoManzanasActual) {
        selEstTerr.value = 'INICIO';
        return;
    }

    // Si el territorio ya tiene registros en la vuelta abierta actual y no se está cerrando -> AVANCE
    // Si venía cerrado (nueva_vuelta) o no tenía registros -> INICIO
    const yaIniciadoEnVuelta = (infoManzanasActual.registros_en_ciclo || 0) > 0 && !infoManzanasActual.nueva_vuelta;
    selEstTerr.value = yaIniciadoEnVuelta ? 'AVANCE' : 'INICIO';
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
        body: JSON.stringify({ publicador_id: sel.value || null, nombre, telefono: document.getElementById('inputTelConductor').value })
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
    if (manzanasEstadoSeleccionadoMap.size === 0) {
        Swal.fire('Faltan manzanas', 'Selecciona al menos una manzana predicada en este turno (1 clic = Incompleta, 2 clics = Completa).', 'warning');
        return;
    }
    const selTurno = document.getElementById('bitTurnoSelect');
    const selCond = document.getElementById('bitConductorSelect');
    const turnoNombre = selTurno.options[selTurno.selectedIndex]?.getAttribute('data-nombre') || selTurno.value;
    const condNombre = selCond.options[selCond.selectedIndex]?.getAttribute('data-nombre') || selCond.value;

    const listaOrdenada = Array.from(manzanasEstadoSeleccionadoMap.keys()).sort((a, b) => a - b);
    const manzanasDetalleObj = {};
    let tieneIncompletas = false;
    listaOrdenada.forEach(m => {
        const est = manzanasEstadoSeleccionadoMap.get(m);
        manzanasDetalleObj[m] = est;
        if (est === 'INCOMPLETO') tieneIncompletas = true;
    });

    const payload = {
        fecha_registro: document.getElementById('bitFechaRegistro')?.value || vcalTodayStr(),
        fecha: document.getElementById('bitFecha').value,
        fecha_cierre: document.getElementById('bitFechaCierre')?.value || null,
        territorio_id: document.getElementById('bitTerritorioSelect').value,
        manzanas: listaOrdenada.join(', '),
        estado_manzanas: tieneIncompletas ? 'INCOMPLETO' : 'COMPLETO',
        manzanas_detalle: manzanasDetalleObj,
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
        await cargarVistaTerritorios();
        if (payload.territorio_id) {
            abrirModalBitacoraTerritorio(payload.territorio_id);
        } else {
            cerrarModal();
        }
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

