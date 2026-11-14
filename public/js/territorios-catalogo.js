// Territorios: datos, tarjetas, catálogo, gráfica y planificador
// (script clásico: comparte el ámbito global con el resto de archivos; el orden de carga está en dashboard.html)
// ==========================================================================
// MÓDULO DE TERRITORIOS (Catálogo, Conductores, Turnos, Bitácora y S-13)
// ==========================================================================
let cacheTerritorios = [];
let cacheConductores = [];
let cacheTurnos = [];
let cacheBitacoraTerr = [];
let chartTerritoriosInstance = null;
let manzanasEstadoSeleccionadoMap = new Map();
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

        poblarOpcionesFiltrosBitacora();

        renderTarjetasTerritorios();
        renderTablaCatalogoTerritorios();
        renderGraficaTerritorios();
    } catch (e) { console.error(e); }
}

const TERR_POR_PAGINA = 8;
let paginaActualTerritorios = 1;

function cambiarPaginaTerritorios(nuevaPag) {
    const totalPaginas = Math.max(1, Math.ceil(cacheTerritorios.length / TERR_POR_PAGINA));
    if (nuevaPag < 1 || nuevaPag > totalPaginas) return;
    paginaActualTerritorios = nuevaPag;
    renderTarjetasTerritorios();
}

function renderTarjetasTerritorios() {
    const cont = document.getElementById('gridTarjetasTerritorios');
    const pagCont = document.getElementById('paginacionTarjetasTerritorios');
    if (!cont) return;
    if (cacheTerritorios.length === 0) {
        cont.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:24px; color:#8f8f8f;">No hay territorios registrados aún. Usa el botón "Nuevo Territorio" para empezar.</div>';
        if (pagCont) pagCont.innerHTML = '';
        return;
    }
    const total = cacheTerritorios.length;
    const totalPaginas = Math.max(1, Math.ceil(total / TERR_POR_PAGINA));
    if (paginaActualTerritorios > totalPaginas) paginaActualTerritorios = totalPaginas;
    if (paginaActualTerritorios < 1) paginaActualTerritorios = 1;

    const inicioIdx = (paginaActualTerritorios - 1) * TERR_POR_PAGINA;
    const finIdx = Math.min(inicioIdx + TERR_POR_PAGINA, total);
    const paginaItems = cacheTerritorios.slice(inicioIdx, finIdx);

    cont.innerHTML = '';
    paginaItems.forEach(t => {
        let pills = '';
        const det = t.manzanas_detalle || {};
        for (let m = 1; m <= t.cantidad_manzanas; m++) {
            const st = det[m];
            const cls = st === 'COMPLETO' ? 'is-completo' : (st === 'INCOMPLETO' ? 'is-incompleto' : '');
            const title = st === 'COMPLETO' ? 'Manzana ' + m + ': Completa' : (st === 'INCOMPLETO' ? 'Manzana ' + m + ': Incompleta (a medias)' : 'Manzana ' + m + ': Pendiente');
            pills += `<span class="manzana-pill ${cls}" title="${title}">${m}</span>`;
        }
        const badgeEstado = t.estado_actual === 'INICIO - CIERRE'
            ? '<span class="badge badge-si">INICIO - CIERRE (100%)</span>'
            : (t.estado_actual === 'CIERRE'
                ? '<span class="badge badge-si">CIERRE (100%)</span>'
                : (t.estado_actual === 'AVANCE' ? '<span class="badge badge-no">AVANCE (En curso)</span>' : (t.estado_actual === 'INICIO' ? '<span class="badge badge-grp">INICIO</span>' : '<span class="badge badge-gray">SIN INICIAR</span>')));

        const vComp = t.vueltas_completas || 0;
        const vIncomp = t.vueltas_incompletas || 0;
        const fechasCardHtml = t.fecha_inicio
            ? `<div>Inicio: <strong>${String(t.fecha_inicio).split('T')[0]}</strong></div>
               <div>Cierre: <strong>${t.fecha_cierre ? String(t.fecha_cierre).split('T')[0] : 'En curso'}</strong></div>`
            : `<div>Sin registros</div>`;
        cont.innerHTML += `
            <div class="terr-card" onclick="abrirModalBitacoraTerritorio('${t.id}')" title="Clic para ver bitácora y registrar avance">
                <div class="terr-card-head">
                    <div>
                        <div class="terr-card-title"><i class="fa-solid fa-map-pin" style="color:var(--primary); font-size:0.85rem;"></i> Territorio ${esc(t.numero)}${t.nombre ? ' · ' + esc(t.nombre) : ''}</div>
                        <div class="terr-card-sub" style="margin-top:3px; line-height:1.45;">${fechasCardHtml}</div>
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
                <div class="terr-card-btn-row">
                    <button type="button" class="btn-primary btn-terr-card-action" onclick="event.stopPropagation(); abrirModalBitacoraTerritorio('${t.id}')">
                        <i class="fa-solid fa-book-open"></i> Ver Bitácora / Registrar Avance
                    </button>
                </div>
            </div>
        `;
    });

    if (pagCont) {
        if (totalPaginas <= 1) {
            pagCont.innerHTML = `<div class="terr-page-info">Mostrando ${total} de ${total} territorios</div><div></div>`;
        } else {
            let btnsHtml = `<button type="button" class="terr-page-btn" onclick="cambiarPaginaTerritorios(${paginaActualTerritorios - 1})" ${paginaActualTerritorios === 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-left"></i></button>`;
            for (let p = 1; p <= totalPaginas; p++) {
                btnsHtml += `<button type="button" class="terr-page-btn ${p === paginaActualTerritorios ? 'active' : ''}" onclick="cambiarPaginaTerritorios(${p})">${p}</button>`;
            }
            btnsHtml += `<button type="button" class="terr-page-btn" onclick="cambiarPaginaTerritorios(${paginaActualTerritorios + 1})" ${paginaActualTerritorios === totalPaginas ? 'disabled' : ''}><i class="fa-solid fa-chevron-right"></i></button>`;
            pagCont.innerHTML = `
                <div class="terr-page-info">Mostrando territorios <strong>${inicioIdx + 1}–${finIdx}</strong> de <strong>${total}</strong> (Página ${paginaActualTerritorios} de ${totalPaginas})</div>
                <div class="terr-page-controls">${btnsHtml}</div>
            `;
        }
    }
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
        const badge = t.estado_actual === 'INICIO - CIERRE'
            ? '<span class="badge badge-si">INICIO - CIERRE</span>'
            : (t.estado_actual === 'CIERRE'
                ? '<span class="badge badge-si">CIERRE</span>'
                : (t.estado_actual === 'AVANCE' ? '<span class="badge badge-no">AVANCE</span>' : (t.estado_actual === 'INICIO' ? '<span class="badge badge-grp">INICIO</span>' : '<span class="badge badge-gray">SIN INICIAR</span>')));
        const acciones = isAdmin
            ? `<button class="btn-action" onclick="abrirModalBitacoraTerritorio('${t.id}')" title="Ver bitácora y registrar avance"><i class="fa-solid fa-book-open"></i></button>
               <button class="btn-action btn-edit" onclick="editarTerritorio(${t.id})" title="Editar"><i class="fa-solid fa-pen-to-square"></i></button>
               <button class="btn-action btn-del" onclick="eliminar('territorios', ${t.id})" title="Eliminar"><i class="fa-solid fa-trash-can"></i></button>`
            : `<button class="btn-action" onclick="abrirModalBitacoraTerritorio('${t.id}')" title="Ver bitácora"><i class="fa-solid fa-book-open"></i></button>`;
        tbody.innerHTML += `
            <tr>
                <td onclick="abrirModalBitacoraTerritorio('${t.id}')" style="cursor:pointer;" title="Clic para ver bitácora y registrar avance">
                    <strong style="color:var(--primary); display:inline-flex; align-items:center; gap:5px;"><i class="fa-solid fa-map-pin"></i> Territorio ${esc(t.numero)}</strong>
                </td>
                <td>${esc(t.nombre || '-')}</td>
                <td>Manzanas 1 a ${t.cantidad_manzanas} (${t.cantidad_manzanas} en total)</td>
                <td><span class="badge badge-si">Completas: ${t.vueltas_completas || 0}</span> <span class="badge ${(t.vueltas_incompletas || 0) > 0 ? 'badge-no' : 'badge-gray'}">Incompletas: ${t.vueltas_incompletas || 0}</span></td>
                <td>${t.completadas}/${t.cantidad_manzanas} (${t.porcentaje}%)</td>
                <td>${badge}</td>
                <td>${acciones}</td>
            </tr>
        `;
    });
}

let ultimoTextoResumenPrograma = '';

function obtenerManzanasFaltantesTerritorio(t) {
    const det = t.manzanas_detalle || {};
    const faltantes = [];
    const aMedias = [];
    for (let m = 1; m <= t.cantidad_manzanas; m++) {
        if (det[m] !== 'COMPLETO') {
            faltantes.push(m);
            if (det[m] === 'INCOMPLETO') aMedias.push(m);
        }
    }
    return { faltantes, aMedias };
}

function renderGraficaTerritorios() {
    const panel = document.getElementById('panelPlanificadorTerritorios');
    const subEl = document.getElementById('subtituloSemanaTerritorios');
    if (!panel) return;

    const hoy = new Date();
    const hoyStr = vcalFormatYMD(hoy);
    const hace7 = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 7);
    const hace7Str = vcalFormatYMD(hace7);

    if (subEl) {
        subEl.innerHTML = `Semana actual: <strong>${formatearFechaCortaEs(hace7Str)}</strong> al <strong>${formatearFechaCortaEs(hoyStr)}</strong> · Guía para armar el reparto del <strong>Jueves</strong> (Vie–Dom) y del <strong>Domingo</strong> (Lun–Jue).`;
    }

    // 1. Movimientos de la última semana (a partir del día actual hacia atrás 7 días)
    const regsUltimaSemana = cacheBitacoraTerr.filter(b => {
        const fReg = b.fecha_registro ? String(b.fecha_registro).split('T')[0] : '';
        const fFin = b.fecha_cierre ? String(b.fecha_cierre).split('T')[0] : '';
        const fIni = b.fecha ? String(b.fecha).split('T')[0] : '';
        const fechaRef = fFin || fIni || fReg;
        return (fechaRef >= hace7Str && fechaRef <= hoyStr) || (fIni >= hace7Str && fIni <= hoyStr) || (fFin >= hace7Str && fFin <= hoyStr);
    });

    const mostrandoRecientesFallback = regsUltimaSemana.length === 0 && cacheBitacoraTerr.length > 0;
    const listaSemanaMostrar = mostrandoRecientesFallback ? cacheBitacoraTerr.slice(0, 6) : regsUltimaSemana;

    let htmlUltimaSemana = '';
    if (listaSemanaMostrar.length === 0) {
        htmlUltimaSemana = `<div style="color:#71717a; font-size:0.78rem; padding:10px 4px;">Sin registros en la bitácora aún.</div>`;
    } else {
        if (mostrandoRecientesFallback) {
            htmlUltimaSemana += `<div style="font-size:0.72rem; color:#d97706; background:#fffbeb; border:1px solid #fde68a; padding:5px 8px; border-radius:6px;">Sin actividad en los últimos 7 días (${hace7Str} a ${hoyStr}). Mostrando los últimos territorios trabajados:</div>`;
        }
        listaSemanaMostrar.forEach(b => {
            const fIni = b.fecha ? String(b.fecha).split('T')[0] : '-';
            const fFin = b.fecha_cierre ? String(b.fecha_cierre).split('T')[0] : '';
            const terrObj = cacheTerritorios.find(t => String(t.id) === String(b.territorio_id) || String(t.numero) === String(b.territorio_numero));
            const badge = b.estado_territorio === 'INICIO - CIERRE'
                ? '<span class="badge badge-si">INICIO - CIERRE</span>'
                : (b.estado_territorio === 'CIERRE'
                    ? '<span class="badge badge-si">CIERRE</span>'
                    : (b.estado_territorio === 'AVANCE' ? '<span class="badge badge-no">AVANCE</span>' : '<span class="badge badge-grp">INICIO</span>'));
            let extraPend = '';
            if (terrObj && (terrObj.estado_actual === 'INICIO' || terrObj.estado_actual === 'AVANCE')) {
                const { faltantes } = obtenerManzanasFaltantesTerritorio(terrObj);
                if (faltantes.length > 0) extraPend = ` · <strong style="color:#d97706;">Faltan manz: ${faltantes.join(', ')}</strong>`;
            }
            htmlUltimaSemana += `
                <div class="terr-planner-item terr-clickable-btn" onclick="abrirModalBitacoraTerritorio('${terrObj ? terrObj.id : Number(b.territorio_id)}')" title="Clic para ver bitácora y registrar avance">
                    <div class="terr-planner-item-main">
                        <div class="terr-planner-item-title"><i class="fa-solid fa-map-pin" style="color:var(--primary); font-size:0.8rem;"></i> Territorio ${esc(b.territorio_numero)} <span style="font-weight:400; color:#71717a;">(Manz. ${esc(b.manzanas)})</span></div>
                        <div class="terr-planner-item-sub">${fFin ? `Cerrado: ${fFin}` : `Iniciado: ${fIni}`} · ${esc(b.conductor_nombre || '-')}${extraPend}</div>
                    </div>
                    <div style="display:flex; align-items:center; gap:8px;">
                        ${badge}
                        <span class="btn-terr-mini"><i class="fa-solid fa-book-open"></i> Bitácora</span>
                    </div>
                </div>
            `;
        });
    }

    // 2. Territorios EN CURSO (Incompletos que tienen prioridad para terminarse)
    const enCursoList = cacheTerritorios.filter(t => t.estado_actual === 'INICIO' || t.estado_actual === 'AVANCE');
    let htmlEnCurso = '';
    if (enCursoList.length === 0) {
        htmlEnCurso = `<div style="color:#16a34a; font-size:0.78rem; padding:10px 4px;"><i class="fa-solid fa-circle-check"></i> ¡Todos los territorios iniciados están cerrados al 100%!</div>`;
    } else {
        enCursoList.forEach(t => {
            const { faltantes, aMedias } = obtenerManzanasFaltantesTerritorio(t);
            const fIni = t.fecha_inicio ? String(t.fecha_inicio).split('T')[0] : '-';
            htmlEnCurso += `
                <div class="terr-planner-item terr-clickable-btn" onclick="abrirModalBitacoraTerritorio('${t.id}')" title="Clic para ver bitácora y registrar avance">
                    <div class="terr-planner-item-main">
                        <div class="terr-planner-item-title"><i class="fa-solid fa-map-pin" style="color:var(--primary); font-size:0.8rem;"></i> Territorio ${esc(t.numero)} <span style="font-weight:500; color:#d97706;">(Faltan manz: ${faltantes.join(', ') || 'ninguna'})</span></div>
                        <div class="terr-planner-item-sub">Iniciado: ${fIni} · Avance: ${t.completadas}/${t.cantidad_manzanas} (${t.porcentaje}%)${aMedias.length ? ` · A medias: ${aMedias.join(', ')}` : ''}</div>
                    </div>
                    <div style="display:flex; align-items:center; gap:8px;">
                        <span class="badge ${t.estado_actual === 'AVANCE' ? 'badge-no' : 'badge-grp'}">${t.estado_actual}</span>
                        <span class="btn-terr-mini"><i class="fa-solid fa-book-open"></i> Bitácora</span>
                    </div>
                </div>
            `;
        });
    }

    // 3. Siguientes territorios recomendados para iniciar nueva vuelta (Sin iniciar primero, luego cierre más antiguo)
    const disponiblesParaIniciar = cacheTerritorios
        .filter(t => t.estado_actual !== 'INICIO' && t.estado_actual !== 'AVANCE')
        .slice()
        .sort((a, b) => {
            const aSin = a.estado_actual === 'SIN INICIAR' ? 0 : 1;
            const bSin = b.estado_actual === 'SIN INICIAR' ? 0 : 1;
            if (aSin !== bSin) return aSin - bSin;
            const fA = a.fecha_cierre ? String(a.fecha_cierre).split('T')[0] : '0000-00-00';
            const fB = b.fecha_cierre ? String(b.fecha_cierre).split('T')[0] : '0000-00-00';
            if (fA !== fB) return fA.localeCompare(fB);
            return (a.vueltas_completas || 0) - (b.vueltas_completas || 0);
        });

    const topRecomendados = disponiblesParaIniciar.slice(0, 8);
    let htmlRecomendados = '';
    topRecomendados.forEach((t, idx) => {
        const ultCierre = t.fecha_cierre ? String(t.fecha_cierre).split('T')[0] : 'Nunca predicado';
        htmlRecomendados += `
            <div class="terr-planner-item terr-clickable-btn" onclick="abrirModalBitacoraTerritorio('${t.id}')" title="Clic para ver bitácora y registrar avance">
                <div class="terr-planner-item-main">
                    <div class="terr-planner-item-title">#${idx + 1} · <i class="fa-solid fa-map-pin" style="color:var(--primary); font-size:0.8rem;"></i> Territorio ${esc(t.numero)} <span style="font-weight:400; color:#71717a;">(Manz. 1 a ${t.cantidad_manzanas})</span></div>
                    <div class="terr-planner-item-sub">Últ. cierre: <strong>${ultCierre}</strong> · Vueltas comp.: ${t.vueltas_completas || 0}</div>
                </div>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span class="badge badge-gray">${t.cantidad_manzanas} manz.</span>
                    <span class="btn-terr-mini"><i class="fa-solid fa-book-open"></i> Bitácora</span>
                </div>
            </div>
        `;
    });

    // 4. Armar cola priorizada de asignaciones para los bloques del Jueves (Vie, Sáb, Dom) y Domingo (Lun, Mar, Mié, Jue)
    const colaSugerencias = [
        ...enCursoList.map(t => {
            const { faltantes } = obtenerManzanasFaltantesTerritorio(t);
            return {
                terrId: t.id,
                etiqueta: `Territorio ${esc(t.numero)}`,
                detalle: `Terminar manz: ${faltantes.join(', ')}`,
                tipo: 'CONTINUAR (En curso)',
                badgeCls: 'badge-no'
            };
        }),
        ...disponiblesParaIniciar.slice(0, 10).map(t => ({
            terrId: t.id,
            etiqueta: `Territorio ${esc(t.numero)}`,
            detalle: `Manzanas 1 a ${t.cantidad_manzanas}`,
            tipo: t.estado_actual === 'SIN INICIAR' ? 'NUEVO (Sin iniciar)' : `INICIAR (Últ: ${t.fecha_cierre ? String(t.fecha_cierre).split('T')[0] : '-'})`,
            badgeCls: 'badge-si'
        }))
    ];

    // Calcular fechas próximas para Viernes, Sábado, Domingo y Lunes, Martes, Miércoles, Jueves
    function proxFechaDiaSemana(targetDow) {
        // targetDow: 0=Dom, 1=Lun, ..., 5=Vie, 6=Sáb
        const d = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
        const diff = (targetDow - d.getDay() + 7) % 7;
        d.setDate(d.getDate() + diff);
        return d;
    }

    const dVie = proxFechaDiaSemana(5);
    const dSab = new Date(dVie.getFullYear(), dVie.getMonth(), dVie.getDate() + 1);
    const dDom = new Date(dVie.getFullYear(), dVie.getMonth(), dVie.getDate() + 2);

    const dLun = proxFechaDiaSemana(1);
    const dMar = new Date(dLun.getFullYear(), dLun.getMonth(), dLun.getDate() + 1);
    const dMie = new Date(dLun.getFullYear(), dLun.getMonth(), dLun.getDate() + 2);
    const dJue = new Date(dLun.getFullYear(), dLun.getMonth(), dLun.getDate() + 3);

    const diasBloqueJueves = [
        { nombre: 'Viernes', fecha: vcalFormatYMD(dVie), sug: colaSugerencias[0] },
        { nombre: 'Sábado', fecha: vcalFormatYMD(dSab), sug: colaSugerencias[1] },
        { nombre: 'Domingo', fecha: vcalFormatYMD(dDom), sug: colaSugerencias[2] }
    ];

    const diasBloqueDomingo = [
        { nombre: 'Lunes', fecha: vcalFormatYMD(dLun), sug: colaSugerencias[3] || colaSugerencias[0] },
        { nombre: 'Martes', fecha: vcalFormatYMD(dMar), sug: colaSugerencias[4] || colaSugerencias[1] },
        { nombre: 'Miércoles', fecha: vcalFormatYMD(dMie), sug: colaSugerencias[5] || colaSugerencias[2] },
        { nombre: 'Jueves', fecha: vcalFormatYMD(dJue), sug: colaSugerencias[6] || colaSugerencias[3] }
    ];

    const dowHoy = hoy.getDay(); // 3=Mié, 4=Jue -> preparando bloque Jueves; 0=Dom, 6=Sáb -> preparando bloque Domingo
    const esTurnoJueves = (dowHoy === 3 || dowHoy === 4 || dowHoy === 5);

    const renderFilasDias = (listaDias) => listaDias.map(d => `
        <div class="terr-schedule-day-row">
            <div class="terr-schedule-day-name">
                <span>${d.nombre}</span>
                <small>${formatearFechaCortaEs(d.fecha)}</small>
            </div>
            <div class="terr-schedule-day-sug ${d.sug && d.sug.terrId ? 'terr-clickable-btn' : ''}" ${d.sug && d.sug.terrId ? `onclick="abrirModalBitacoraTerritorio('${d.sug.terrId}')" title="Clic para ver bitácora y registrar avance"` : ''}>
                ${d.sug ? `<div><strong><i class="fa-solid fa-map-pin" style="color:var(--primary); font-size:0.75rem;"></i> ${d.sug.etiqueta}</strong> · <span>${d.sug.detalle}</span></div><div style="display:flex; gap:6px; align-items:center;"><span class="badge ${d.sug.badgeCls}">${d.sug.tipo}</span><span class="btn-terr-mini"><i class="fa-solid fa-book-open"></i></span></div>` : '<span style="color:#71717a;">Sin sugerencia</span>'}
            </div>
        </div>
    `).join('');

    // Preparar texto para copiar a portapapeles / WhatsApp
    ultimoTextoResumenPrograma = [
        `📋 *RESUMEN PARA PROGRAMA DE PREDICACIÓN (${hoyStr})*`,
        ``,
        `⚠️ *1. TERRITORIOS EN CURSO (Prioridad para terminar):*`,
        ...(enCursoList.length
            ? enCursoList.map(t => {
                const { faltantes } = obtenerManzanasFaltantesTerritorio(t);
                return `• *Territorio ${t.numero}*: Faltan manzanas ${faltantes.join(', ')} (Iniciado: ${String(t.fecha_inicio).split('T')[0]})`;
            })
            : [`• Ninguno pendiente (todos cerrados)`]),
        ``,
        `🆕 *2. PRÓXIMOS TERRITORIOS SUGERIDOS (Más antiguos / Sin iniciar):*`,
        ...topRecomendados.slice(0, 6).map(t => `• *Territorio ${t.numero}* (Manz. 1 a ${t.cantidad_manzanas}) — Últ. cierre: ${t.fecha_cierre ? String(t.fecha_cierre).split('T')[0] : 'Sin iniciar'}`),
        ``,
        `📅 *REPARTO DEL JUEVES (Viernes, Sábado y Domingo):*`,
        ...diasBloqueJueves.map(d => `• *${d.nombre} (${d.fecha})*: ${d.sug ? `${d.sug.etiqueta} (${d.sug.detalle})` : '-'}`),
        ``,
        `📅 *REPARTO DEL DOMINGO (Lunes, Martes, Miércoles y Jueves):*`,
        ...diasBloqueDomingo.map(d => `• *${d.nombre} (${d.fecha})*: ${d.sug ? `${d.sug.etiqueta} (${d.sug.detalle})` : '-'}`)
    ].join('\n');

    panel.innerHTML = `
        <div class="terr-planner-top-grid">
            <div class="terr-planner-box">
                <div class="terr-planner-box-head">
                    <div class="terr-planner-box-title"><i class="fa-solid fa-clock-rotate-left"></i> Últimos Territorios (Última Semana)</div>
                    <span class="badge badge-gray">${regsUltimaSemana.length} en 7 días</span>
                </div>
                <div class="terr-planner-list">${htmlUltimaSemana}</div>
            </div>

            <div class="terr-planner-box">
                <div class="terr-planner-box-head">
                    <div class="terr-planner-box-title"><i class="fa-solid fa-triangle-exclamation" style="color:#d97706;"></i> Prioridad 1: En Curso (Por Terminar)</div>
                    <span class="badge ${enCursoList.length > 0 ? 'badge-no' : 'badge-si'}">${enCursoList.length} abiertos</span>
                </div>
                <div class="terr-planner-list">${htmlEnCurso}</div>
            </div>

            <div class="terr-planner-box">
                <div class="terr-planner-box-head">
                    <div class="terr-planner-box-title"><i class="fa-solid fa-wand-magic-sparkles" style="color:#0284c7;"></i> Prioridad 2: Siguientes a Iniciar</div>
                    <span class="badge badge-grp">Por antigüedad</span>
                </div>
                <div class="terr-planner-list">${htmlRecomendados}</div>
            </div>
        </div>

        <div class="terr-schedule-grid">
            <div class="terr-schedule-card ${esTurnoJueves ? 'is-active-block' : ''}">
                <div class="terr-schedule-head">
                    <div>
                        <div class="terr-schedule-title"><i class="fa-solid fa-calendar-day"></i> Reparto del Jueves → Viernes, Sábado y Domingo</div>
                        <div class="terr-schedule-sub">Propuesta automática priorizando territorios inconclusos y los más antiguos</div>
                    </div>
                    <span class="badge ${esTurnoJueves ? 'badge-si' : 'badge-gray'}">3 días (Vie–Dom)</span>
                </div>
                <div class="terr-schedule-days">${renderFilasDias(diasBloqueJueves)}</div>
            </div>

            <div class="terr-schedule-card ${!esTurnoJueves ? 'is-active-block' : ''}">
                <div class="terr-schedule-head">
                    <div>
                        <div class="terr-schedule-title"><i class="fa-solid fa-calendar-week"></i> Reparto del Domingo → Lunes, Martes, Miércoles y Jueves</div>
                        <div class="terr-schedule-sub">Continuación sugerida para los 4 días de predicación entre semana</div>
                    </div>
                    <span class="badge ${!esTurnoJueves ? 'badge-si' : 'badge-gray'}">4 días (Lun–Jue)</span>
                </div>
                <div class="terr-schedule-days">${renderFilasDias(diasBloqueDomingo)}</div>
            </div>
        </div>
    `;
}

