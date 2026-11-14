// Programa del servicio del campo (tabla, imagen, PDF y WhatsApp)
// (script clásico: comparte el ámbito global con el resto de archivos; el orden de carga está en dashboard.html)
/* ==========================================================================
   CREADOR DE PROGRAMA DEL SERVICIO DEL CAMPO (TABLA + WHATSAPP)
   ========================================================================== */
const PUNTOS_REUNION_BASE = [
    'Salón del Reino',
    'Plaza Umachiri (15)',
    'Casa Hna. Elsa Paja (3)',
    'Casa Fam. Mejía (10)',
    'Casa Hna. Julia Zanabria (12)',
    'Colegio Berlín (27)',
    'Alfonso Ugarte / Simón Bolivar',
    'Cancha Revolución (16)',
    'Madre de Dios / Av. República'
];

let programaFilas = [];
const progManzanasSet = new Set();

function cargarProgramaGuardadoLocal() {
    try {
        const raw = localStorage.getItem('programa_predicacion_state');
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.filas)) programaFilas = parsed.filas;
        const fIni = document.getElementById('progFechaIni');
        const fFin = document.getElementById('progFechaFin');
        if (fIni && parsed.fechaIni) fIni.value = parsed.fechaIni;
        if (fFin && parsed.fechaFin) fFin.value = parsed.fechaFin;
        const chkGrp = document.getElementById('progMostrarColGrupo');
        if (chkGrp && typeof parsed.mostrarGrupo === 'boolean') chkGrp.checked = parsed.mostrarGrupo;
    } catch (e) {}
}

function guardarProgramaLocal() {
    try {
        const fIni = document.getElementById('progFechaIni')?.value || '';
        const fFin = document.getElementById('progFechaFin')?.value || '';
        const mostrarGrupo = Boolean(document.getElementById('progMostrarColGrupo')?.checked);
        localStorage.setItem('programa_predicacion_state', JSON.stringify({
            fechaIni: fIni,
            fechaFin: fFin,
            mostrarGrupo,
            filas: programaFilas
        }));
    } catch (e) {}
}

function poblarPuntosReunionDatalist() {
    const dl = document.getElementById('listaPuntosReunion');
    if (!dl) return;
    let extras = [];
    try {
        extras = JSON.parse(localStorage.getItem('puntos_reunion_custom') || '[]');
    } catch (e) {}
    const todos = Array.from(new Set([...PUNTOS_REUNION_BASE, ...extras]));
    dl.innerHTML = todos.map(p => `<option value="${p}"></option>`).join('');
}

function registrarPuntoReunionCustom(punto) {
    const p = (punto || '').trim();
    if (!p || PUNTOS_REUNION_BASE.includes(p)) return;
    try {
        const extras = JSON.parse(localStorage.getItem('puntos_reunion_custom') || '[]');
        if (!extras.includes(p)) {
            extras.push(p);
            localStorage.setItem('puntos_reunion_custom', JSON.stringify(extras));
            poblarPuntosReunionDatalist();
        }
    } catch (e) {}
}

function obtenerMapaTelefonosConductores() {
    try {
        return JSON.parse(localStorage.getItem('conductores_telefonos_map') || '{}');
    } catch (e) { return {}; }
}

function guardarTelefonoConductorLocal(nombreConductor, tel) {
    if (!nombreConductor || !tel) return;
    try {
        const map = obtenerMapaTelefonosConductores();
        map[nombreConductor] = tel.trim();
        localStorage.setItem('conductores_telefonos_map', JSON.stringify(map));
    } catch (e) {}
}

async function abrirModalPrograma() {
    if (cacheTurnos.length === 0) await cargarTurnosData();
    if (cacheConductores.length === 0) await cargarConductoresData();
    if (cacheTerritorios.length === 0) await cargarTerritoriosData();

    const modalWrapper = document.getElementById('mainModal');
    const modalBox = modalWrapper.querySelector('.modal-box');
    const modalBody = document.getElementById('modalBody');
    const modalTitle = document.getElementById('modalTitle');

    modalBody.innerHTML = '';
    if (modalBox) modalBox.classList.add('modal-wide');
    modalTitle.innerHTML = '<i class="fa-solid fa-calendar-check"></i> Creador de Programa del Servicio del Campo';

    const form = document.getElementById('formProgramaPredicacion');
    if (form) {
        form.style.display = 'grid';
        modalBody.appendChild(form);
    }

    poblarPuntosReunionDatalist();

    // Poblar Turnos
    const selTurno = document.getElementById('progTurno');
    if (selTurno) {
        selTurno.innerHTML = cacheTurnos.length
            ? cacheTurnos.map(t => `<option value="${esc(t.nombre)}" data-horario="${esc(t.horario || '')}">${esc(t.nombre)}${t.horario ? ' (' + esc(t.horario) + ')' : ''}</option>`).join('')
            : '<option value="Mañana" data-horario="8:20 am">Mañana</option><option value="Tarde" data-horario="3:30 pm">Tarde</option>';
    }
    const inpHora = document.getElementById('progHora');
    if (inpHora && !inpHora.value) {
        alCambiarTurnoPrograma();
    }

    // Poblar Territorios (priorizando en curso primero, o en orden numérico con indicador)
    const selTerr1 = document.getElementById('progTerritorio');
    const selTerr2 = document.getElementById('progTerritorio2');
    const optsTerr = cacheTerritorios.map(t => {
        const enCurso = t.estado_actual === 'INICIO' || t.estado_actual === 'AVANCE';
        const { faltantes } = obtenerManzanasFaltantesTerritorio(t);
        const infoExtra = enCurso
            ? `⚡ En curso — Faltan manz: ${faltantes.join(', ')}`
            : `Manz. 1 a ${t.cantidad_manzanas} (${t.estado_actual})`;
        return `<option value="${esc(t.numero)}" data-id="${t.id}">Territorio ${esc(t.numero)} · ${infoExtra}</option>`;
    }).join('');
    if (selTerr1) selTerr1.innerHTML = '<option value="">-- Seleccionar territorio --</option>' + optsTerr;
    if (selTerr2) selTerr2.innerHTML = '<option value="">-- Ninguno --</option>' + optsTerr;

    // Poblar Conductores
    const selCond = document.getElementById('progConductor');
    if (selCond) {
        selCond.innerHTML = '<option value="">-- En blanco / Sin asignar --</option>' +
            cacheConductores.map(c => `<option value="${esc(c.nombre)}">${esc(c.nombre)}</option>`).join('');
        selCond.onchange = () => {
            const mapTel = obtenerMapaTelefonosConductores();
            const telEl = document.getElementById('progConductorTel');
            if (telEl) telEl.value = mapTel[selCond.value] || '';
        };
    }

    cargarProgramaGuardadoLocal();
    const fIni = document.getElementById('progFechaIni');
    const fFin = document.getElementById('progFechaFin');
    if (fIni && fFin && (!fIni.value || !fFin.value)) {
        const dow = new Date().getDay();
        aplicarRangoRapidoPrograma((dow === 3 || dow === 4 || dow === 5) ? 'finde' : 'semana');
    }

    cargarManzanasProgramaSelect();
    renderTablaProgramaPreview();
    modalWrapper.classList.add('active');
}

function alCambiarTurnoPrograma() {
    const selTurno = document.getElementById('progTurno');
    const inpHora = document.getElementById('progHora');
    if (!selTurno || !inpHora) return;
    const opt = selTurno.options[selTurno.selectedIndex];
    const horario = opt?.getAttribute('data-horario') || '';
    const nom = (selTurno.value || '').toLowerCase();
    if (horario) inpHora.value = horario;
    else if (nom.includes('tarde')) inpHora.value = '3:30 pm';
    else if (nom.includes('mañana') || nom.includes('manana')) inpHora.value = '8:20 am';
}

function aplicarRangoRapidoPrograma(modo) {
    const hoy = new Date();
    const dBase = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
    let dIni, dFin;
    if (modo === 'finde') {
        const diffVie = (5 - dBase.getDay() + 7) % 7;
        dIni = new Date(dBase.getFullYear(), dBase.getMonth(), dBase.getDate() + diffVie);
        dFin = new Date(dIni.getFullYear(), dIni.getMonth(), dIni.getDate() + 2);
        const selDia = document.getElementById('progDia');
        if (selDia) selDia.value = 'Viernes';
    } else {
        const diffDom = (0 - dBase.getDay() + 7) % 7;
        dIni = new Date(dBase.getFullYear(), dBase.getMonth(), dBase.getDate() + diffDom);
        dFin = new Date(dIni.getFullYear(), dIni.getMonth(), dIni.getDate() + 4);
        const selDia = document.getElementById('progDia');
        if (selDia) selDia.value = 'Domingo';
    }
    const elIni = document.getElementById('progFechaIni');
    const elFin = document.getElementById('progFechaFin');
    if (elIni) elIni.value = vcalFormatYMD(dIni);
    if (elFin) elFin.value = vcalFormatYMD(dFin);
    actualizarCabeceraPrograma();
}

function actualizarCabeceraPrograma() {
    guardarProgramaLocal();
    renderTablaProgramaPreview();
}

function cargarManzanasProgramaSelect() {
    const numTerr = document.getElementById('progTerritorio')?.value || '';
    const wrap = document.getElementById('progManzanasWrap');
    const grid = document.getElementById('progManzanasGrid');
    progManzanasSet.clear();
    if (!wrap || !grid) return;

    const terr = cacheTerritorios.find(t => String(t.numero) === String(numTerr));
    if (!terr) {
        wrap.style.display = 'none';
        grid.innerHTML = '';
        return;
    }

    wrap.style.display = 'flex';
    grid.innerHTML = '';
    const det = terr.manzanas_detalle || {};
    const enCurso = terr.estado_actual === 'INICIO' || terr.estado_actual === 'AVANCE';

    for (let m = 1; m <= terr.cantidad_manzanas; m++) {
        const st = enCurso ? det[m] : null;
        const chip = document.createElement('div');
        chip.className = 'manzana-chip' + (st === 'INCOMPLETO' ? ' incompleto' : '');
        chip.dataset.manzana = m;
        chip.innerHTML = `<span>Mz. ${m}</span><small>${st === 'COMPLETO' ? '✔ Hecha' : (st === 'INCOMPLETO' ? 'A medias' : 'Disp.')}</small>`;
        chip.addEventListener('click', () => {
            if (progManzanasSet.has(m)) {
                progManzanasSet.delete(m);
                chip.classList.remove('selected');
            } else {
                progManzanasSet.add(m);
                chip.classList.add('selected');
            }
        });
        grid.appendChild(chip);
    }
}

function seleccionarManzanasPendientesPrograma() {
    const numTerr = document.getElementById('progTerritorio')?.value || '';
    const terr = cacheTerritorios.find(t => String(t.numero) === String(numTerr));
    if (!terr) return;
    progManzanasSet.clear();
    const { faltantes } = obtenerManzanasFaltantesTerritorio(terr);
    const aMarcar = (terr.estado_actual === 'INICIO' || terr.estado_actual === 'AVANCE') ? faltantes : [];
    document.querySelectorAll('#progManzanasGrid .manzana-chip').forEach(chip => {
        const m = parseInt(chip.dataset.manzana, 10);
        if (aMarcar.includes(m)) {
            progManzanasSet.add(m);
            chip.classList.add('selected');
        } else {
            chip.classList.remove('selected');
        }
    });
}

function limpiarManzanasPrograma() {
    progManzanasSet.clear();
    document.querySelectorAll('#progManzanasGrid .manzana-chip').forEach(chip => chip.classList.remove('selected'));
}

function agregarFilaPrograma() {
    const dia = document.getElementById('progDia')?.value || 'Viernes';
    const turno = document.getElementById('progTurno')?.value || 'Mañana';
    const hora = (document.getElementById('progHora')?.value || '8:20 am').trim();
    const grupo = document.getElementById('progGrupo')?.value || 'T';
    const punto = (document.getElementById('progPunto')?.value || '').trim();
    const t1 = document.getElementById('progTerritorio')?.value || '';
    const t2 = document.getElementById('progTerritorio2')?.value || '';
    const conductor = document.getElementById('progConductor')?.value || '';
    const tel = (document.getElementById('progConductorTel')?.value || '').trim();

    if (!t1) {
        Swal.fire('Falta Territorio', 'Selecciona al menos el Territorio Principal para esta salida.', 'warning');
        return;
    }

    if (punto) registrarPuntoReunionCustom(punto);
    if (conductor && tel) guardarTelefonoConductorLocal(conductor, tel);

    const territoriosStr = t2 && t2 !== t1 ? `${t1}, ${t2}` : `${t1}`;
    const manzanasStr = progManzanasSet.size > 0
        ? Array.from(progManzanasSet).sort((a, b) => a - b).join(', ')
        : '';

    programaFilas.push({
        id: Date.now() + Math.random(),
        dia,
        turno,
        hora,
        grupo,
        punto: punto || '-',
        territorios: territoriosStr,
        manzanas: manzanasStr,
        conductor,
        telefono: tel
    });

    guardarProgramaLocal();
    renderTablaProgramaPreview();
    Toast.fire({ icon: 'success', title: `Agregado: ${dia} (${hora}) · T: ${territoriosStr}` });
}

function eliminarFilaPrograma(idx) {
    programaFilas.splice(idx, 1);
    guardarProgramaLocal();
    renderTablaProgramaPreview();
}

function limpiarFilasPrograma() {
    programaFilas = [];
    guardarProgramaLocal();
    renderTablaProgramaPreview();
}

function obtenerInfoCabeceraPrograma() {
    const fIni = normalizarFechaYMD(document.getElementById('progFechaIni')?.value);
    const fFin = normalizarFechaYMD(document.getElementById('progFechaFin')?.value);
    const mesesNombres = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

    if (!fIni || !fFin) {
        const hoy = new Date();
        const mesNom = mesesNombres[hoy.getMonth()];
        return { rangoTexto: `Mes de ${mesNom}`, mesVertical: mesNom.toUpperCase() };
    }

    const [, m1, d1] = fIni.split('-').map(Number);
    const [, m2, d2] = fFin.split('-').map(Number);
    const nom1 = mesesNombres[m1 - 1] || '';
    const nom2 = mesesNombres[m2 - 1] || '';

    const rangoTexto = m1 === m2
        ? `${d1} - ${d2} de ${nom2}`
        : `${d1} de ${nom1} - ${d2} de ${nom2}`;
    return {
        rangoTexto,
        mesVertical: (nom2 || nom1).toUpperCase()
    };
}

function claseColorDiaPrograma(dia) {
    const map = {
        'Viernes': 'prog-dia-viernes',
        'Sábado': 'prog-dia-sabado',
        'Domingo': 'prog-dia-domingo',
        'Lunes': 'prog-dia-lunes',
        'Martes': 'prog-dia-martes',
        'Miércoles': 'prog-dia-miercoles',
        'Jueves': 'prog-dia-jueves'
    };
    return map[dia] || 'prog-dia-viernes';
}

function hexColorDiaPrograma(dia) {
    const map = {
        'Viernes': '#fed7aa',
        'Sábado': '#fecdd3',
        'Domingo': '#e9d5ff',
        'Lunes': '#bfdbfe',
        'Martes': '#bae6fd',
        'Miércoles': '#dcfce7',
        'Jueves': '#fef08a'
    };
    return map[dia] || '#fed7aa';
}

function renderTablaProgramaPreview() {
    const wrap = document.getElementById('progTablaPreviewWrap');
    const chipsCont = document.getElementById('progFilasAdminList');
    if (!wrap) return;

    const { rangoTexto, mesVertical } = obtenerInfoCabeceraPrograma();
    const mostrarGrupo = Boolean(document.getElementById('progMostrarColGrupo')?.checked);

    if (programaFilas.length === 0) {
        wrap.innerHTML = `<div style="text-align:center; padding:26px; color:#71717a; font-size:0.84rem;">Agrega turnos usando el formulario de arriba para construir la tabla del <strong>Programa del Servicio del Campo (${rangoTexto})</strong>.</div>`;
        if (chipsCont) chipsCont.innerHTML = '';
        return;
    }

    // Calcular rowspan para bloques consecutivos del mismo Día
    const spansDia = new Array(programaFilas.length).fill(0);
    let idxInicio = 0;
    for (let i = 0; i < programaFilas.length; i++) {
        if (i === 0 || programaFilas[i].dia !== programaFilas[idxInicio].dia) {
            idxInicio = i;
            spansDia[idxInicio] = 1;
        } else {
            spansDia[idxInicio]++;
            spansDia[i] = 0;
        }
    }

    const mesVerticalHtml = mesVertical.split('').join('<br>');
    let rowsHtml = '';
    programaFilas.forEach((f, idx) => {
        const tdMes = idx === 0
            ? `<td class="prog-cell-mes" rowspan="${programaFilas.length}">${mesVerticalHtml}</td>`
            : '';
        const tdDia = spansDia[idx] > 0
            ? `<td class="prog-cell-dia ${claseColorDiaPrograma(f.dia)}" rowspan="${spansDia[idx]}">${f.dia}</td>`
            : '';
        const tdGrupo = mostrarGrupo ? `<td>${f.grupo}</td>` : '';
        const terrHtml = `<div><strong>T: ${f.territorios}</strong></div>` + (f.manzanas ? `<div style="font-size:0.78rem; font-weight:700;">Mz: ${f.manzanas}</div>` : '');
        const condTexto = f.conductor
            ? `<div>${esc(f.conductor)}</div>${f.telefono ? `<div>(${esc(f.telefono)})</div>` : ''}`
            : `&nbsp;`;

        rowsHtml += `
            <tr>
                ${tdMes}
                ${tdDia}
                <td>${f.hora}</td>
                ${tdGrupo}
                <td>${esc(f.punto)}</td>
                <td>${terrHtml}</td>
                <td>
                    <div class="prog-conductor-pill">
                        <div class="prog-conductor-text">${condTexto}</div>
                        <span class="prog-conductor-caret">▼</span>
                    </div>
                </td>
            </tr>
        `;
    });

    wrap.innerHTML = `
        <div class="prog-sheet" id="progSheetElement">
            <div class="prog-sheet-banner">
                <div>PROGRAMA DEL SERVICIO DEL CAMPO</div>
                <div>${rangoTexto}</div>
            </div>
            <table class="prog-sheet-table">
                <thead>
                    <tr>
                        <th>MES</th>
                        <th>DÍA</th>
                        <th>HORA</th>
                        ${mostrarGrupo ? '<th>GRUPO</th>' : ''}
                        <th>PUNTO DE REUNIÓN</th>
                        <th>TERRITORIO(S)</th>
                        <th>CONDUCTOR</th>
                    </tr>
                </thead>
                <tbody>
                    ${rowsHtml}
                </tbody>
            </table>
        </div>
    `;

    if (chipsCont) {
        chipsCont.innerHTML = programaFilas.map((f, i) => `
            <span class="prog-row-chip">
                <strong>#${i + 1} ${f.dia}</strong> (${f.hora}) · T:${f.territorios}
                <button type="button" title="Quitar fila" onclick="eliminarFilaPrograma(${i})"><i class="fa-solid fa-xmark"></i></button>
            </span>
        `).join('');
    }
}

function generarCanvasPrograma(scale = 2) {
    if (programaFilas.length === 0) return null;
    const { rangoTexto, mesVertical } = obtenerInfoCabeceraPrograma();
    const mostrarGrupo = Boolean(document.getElementById('progMostrarColGrupo')?.checked);

    const cols = mostrarGrupo
        ? [
            { key: 'mes', title: 'MES', w: 46 },
            { key: 'dia', title: 'DIA', w: 108 },
            { key: 'hora', title: 'HORA', w: 92 },
            { key: 'grupo', title: 'GRUPO', w: 74 },
            { key: 'punto', title: 'PUNTO DE REUNION', w: 245 },
            { key: 'terr', title: 'TERRITORIO(S)', w: 145 },
            { key: 'cond', title: 'CONDUCTOR', w: 220 }
        ]
        : [
            { key: 'mes', title: 'MES', w: 46 },
            { key: 'dia', title: 'DÍA', w: 112 },
            { key: 'hora', title: 'HORA', w: 96 },
            { key: 'punto', title: 'PUNTO DE REUNIÓN', w: 275 },
            { key: 'terr', title: 'TERRITORIO(S)', w: 165 },
            { key: 'cond', title: 'CONDUCTOR', w: 236 }
        ];

    const totalW = cols.reduce((acc, c) => acc + c.w, 0);
    const bannerH = 56;
    const thH = 32;
    const rowH = 52;
    const totalH = bannerH + thH + programaFilas.length * rowH;

    const canvas = document.createElement('canvas');
    canvas.width = totalW * scale;
    canvas.height = totalH * scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);

    // Fondo blanco
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, totalW, totalH);

    // Banner negro superior
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, totalW, bannerH);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 17px Arial, sans-serif';
    ctx.fillText('PROGRAMA DEL SERVICIO DEL CAMPO', totalW / 2, 19);
    ctx.font = 'bold 16px Arial, sans-serif';
    ctx.fillText(rangoTexto, totalW / 2, 41);

    // Línea divisoria blanca bajo banner
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, bannerH);
    ctx.lineTo(totalW, bannerH);
    ctx.stroke();

    // Cabecera de columnas
    let xCursor = 0;
    cols.forEach(c => {
        ctx.fillStyle = '#000000';
        ctx.fillRect(xCursor, bannerH, c.w, thH);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.strokeRect(xCursor, bannerH, c.w, thH);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 14px Arial, sans-serif';
        ctx.fillText(c.title, xCursor + c.w / 2, bannerH + thH / 2 + 1);
        c.x = xCursor;
        xCursor += c.w;
    });

    const bodyTop = bannerH + thH;
    const bodyH = programaFilas.length * rowH;

    // Columna 0: MES vertical negro
    const colMes = cols[0];
    ctx.fillStyle = '#000000';
    ctx.fillRect(colMes.x, bodyTop, colMes.w, bodyH);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 15px Arial, sans-serif';
    const letrasMes = mesVertical.split('');
    const stepLetra = Math.min(20, (bodyH - 16) / Math.max(1, letrasMes.length));
    const startYMes = bodyTop + (bodyH - (letrasMes.length - 1) * stepLetra) / 2;
    letrasMes.forEach((ch, idx) => {
        ctx.fillText(ch, colMes.x + colMes.w / 2, startYMes + idx * stepLetra);
    });

    // Calcular spans de DÍA
    const spansDia = new Array(programaFilas.length).fill(0);
    let idxIni = 0;
    for (let i = 0; i < programaFilas.length; i++) {
        if (i === 0 || programaFilas[i].dia !== programaFilas[idxIni].dia) {
            idxIni = i;
            spansDia[idxIni] = 1;
        } else {
            spansDia[idxIni]++;
            spansDia[i] = 0;
        }
    }

    const colDia = cols[1];
    // Dibujar celdas de DÍA agrupadas
    for (let i = 0; i < programaFilas.length; i++) {
        if (spansDia[i] > 0) {
            const yDia = bodyTop + i * rowH;
            const hDia = spansDia[i] * rowH;
            ctx.fillStyle = hexColorDiaPrograma(programaFilas[i].dia);
            ctx.fillRect(colDia.x, yDia, colDia.w, hDia);
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 1;
            ctx.strokeRect(colDia.x, yDia, colDia.w, hDia);
            ctx.fillStyle = '#000000';
            ctx.font = 'bold 15px Arial, sans-serif';
            ctx.fillText(programaFilas[i].dia, colDia.x + colDia.w / 2, yDia + hDia / 2);
        }
    }

    // Dibujar resto de celdas por fila
    programaFilas.forEach((f, rIdx) => {
        const yRow = bodyTop + rIdx * rowH;

        cols.slice(2).forEach(c => {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(c.x, yRow, c.w, rowH);
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 1;
            ctx.strokeRect(c.x, yRow, c.w, rowH);

            ctx.fillStyle = '#000000';
            const cx = c.x + c.w / 2;
            const cy = yRow + rowH / 2;

            if (c.key === 'hora') {
                ctx.font = '15px Arial, sans-serif';
                ctx.fillText(f.hora, cx, cy);
            } else if (c.key === 'grupo') {
                ctx.font = '15px Arial, sans-serif';
                ctx.fillText(f.grupo, cx, cy);
            } else if (c.key === 'punto') {
                ctx.font = '14px Arial, sans-serif';
                ctx.fillText(f.punto, cx, cy, c.w - 12);
            } else if (c.key === 'terr') {
                if (f.manzanas) {
                    ctx.font = 'bold 15px Arial, sans-serif';
                    ctx.fillText(`T: ${f.territorios}`, cx, cy - 8);
                    ctx.font = 'bold 13px Arial, sans-serif';
                    ctx.fillText(`Mz: ${f.manzanas}`, cx, cy + 10);
                } else {
                    ctx.font = 'bold 15px Arial, sans-serif';
                    ctx.fillText(`T: ${f.territorios}`, cx, cy);
                }
            } else if (c.key === 'cond') {
                // Cápsula gris redondeada como en la imagen
                const pillW = c.w - 18;
                const pillH = rowH - 10;
                const px = c.x + 9;
                const py = yRow + 5;
                const r = 12;
                ctx.fillStyle = '#e5e7eb';
                ctx.beginPath();
                ctx.moveTo(px + r, py);
                ctx.lineTo(px + pillW - r, py);
                ctx.quadraticCurveTo(px + pillW, py, px + pillW, py + r);
                ctx.lineTo(px + pillW, py + pillH - r);
                ctx.quadraticCurveTo(px + pillW, py + pillH, px + pillW - r, py + pillH);
                ctx.lineTo(px + r, py + pillH);
                ctx.quadraticCurveTo(px, py + pillH, px, py + pillH - r);
                ctx.lineTo(px, py + r);
                ctx.quadraticCurveTo(px, py, px + r, py);
                ctx.closePath();
                ctx.fill();

                ctx.fillStyle = '#111827';
                if (f.conductor) {
                    if (f.telefono) {
                        ctx.font = '13.5px Arial, sans-serif';
                        ctx.fillText(f.conductor, cx - 6, cy - 8, pillW - 24);
                        ctx.fillText(`(${f.telefono})`, cx - 6, cy + 9, pillW - 24);
                    } else {
                        ctx.font = '14px Arial, sans-serif';
                        ctx.fillText(f.conductor, cx - 6, cy, pillW - 24);
                    }
                }
                ctx.font = '10px Arial, sans-serif';
                ctx.fillText('▼', px + pillW - 12, cy);
            }
        });
    });

    // Borde exterior general
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, totalW, totalH);

    return canvas;
}

async function generarBlobImagenPrograma() {
    const canvas = generarCanvasPrograma(2);
    if (!canvas) return null;
    return new Promise(resolve => canvas.toBlob(blob => resolve(blob), 'image/png'));
}

function construirPDFProgramaA4Doc() {
    const canvas = generarCanvasPrograma(3);
    if (!canvas) return null;

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const imgData = canvas.toDataURL('image/png');

    // Hoja A4: 210mm × 297mm
    const pageW = 210;
    const pageH = 297;
    const marginTop = 6;
    const marginBottom = 6;
    const marginSide = 8;
    const gapBetween = 6;

    const usableW = pageW - marginSide * 2; // 194mm
    const usableH = pageH - marginTop - marginBottom; // 285mm
    const slotH = (usableH - gapBetween * 2) / 3; // ~91mm por copia

    const aspect = canvas.width / canvas.height;
    let drawW = usableW;
    let drawH = drawW / aspect;
    if (drawH > slotH) {
        drawH = slotH;
        drawW = drawH * aspect;
    }

    const drawX = (pageW - drawW) / 2;

    for (let i = 0; i < 3; i++) {
        const slotTop = marginTop + i * (slotH + gapBetween);
        const drawY = slotTop + (slotH - drawH) / 2;
        doc.addImage(imgData, 'PNG', drawX, drawY, drawW, drawH, undefined, 'FAST');

        if (i < 2) {
            const cutY = slotTop + slotH + gapBetween / 2;
            doc.setDrawColor(160, 160, 160);
            doc.setLineWidth(0.25);
            doc.setLineDashPattern([2, 2], 0);
            doc.line(marginSide, cutY, pageW - marginSide, cutY);
            doc.setLineDashPattern([], 0);
        }
    }

    return doc;
}

async function descargarPDFProgramaA4TresCopias() {
    if (programaFilas.length === 0) {
        Swal.fire('Programa vacío', 'Primero agrega al menos una fila al programa.', 'warning');
        return;
    }
    try {
        const doc = construirPDFProgramaA4Doc();
        if (!doc) return;
        const { rangoTexto } = obtenerInfoCabeceraPrograma();
        const safeName = rangoTexto.replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ_-]+/g, '_');
        doc.save(`Programa_Servicio_${safeName}_A4_3copias.pdf`);
        Toast.fire({ icon: 'success', title: 'PDF A4 (3 programas por hoja) descargado' });
    } catch (e) {
        console.error(e);
        Swal.fire('Error', 'No se pudo generar el PDF en formato A4.', 'error');
    }
}

function imprimirProgramaA4TresCopias() {
    if (programaFilas.length === 0) {
        Swal.fire('Programa vacío', 'Primero agrega al menos una fila al programa.', 'warning');
        return;
    }
    const canvas = generarCanvasPrograma(3);
    if (!canvas) return;
    const imgData = canvas.toDataURL('image/png');
    const { rangoTexto } = obtenerInfoCabeceraPrograma();

    const win = window.open('', '_blank');
    if (!win) {
        Swal.fire('Ventana bloqueada', 'Permite las ventanas emergentes en el navegador para abrir la vista de impresión.', 'warning');
        return;
    }

    win.document.write(`<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Imprimir Programa A4 (3 Copias) - ${rangoTexto}</title>
    <style>
        @page {
            size: A4 portrait;
            margin: 5mm 7mm;
        }
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
        }
        body {
            background: #e4e4e7;
            font-family: Arial, Helvetica, sans-serif;
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: 58px 12px 24px;
        }
        .print-toolbar {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            height: 48px;
            background: #18181b;
            color: #ffffff;
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0 20px;
            z-index: 100;
            box-shadow: 0 2px 10px rgba(0,0,0,0.25);
        }
        .print-toolbar-title {
            font-size: 14px;
            font-weight: 700;
        }
        .print-toolbar-actions {
            display: flex;
            gap: 8px;
        }
        .print-btn {
            background: #ffffff;
            color: #18181b;
            border: none;
            border-radius: 6px;
            padding: 7px 14px;
            font-size: 13px;
            font-weight: 700;
            cursor: pointer;
        }
        .print-btn-close {
            background: #27272a;
            color: #e4e4e7;
            border: 1px solid #3f3f46;
        }
        .a4-sheet {
            width: 210mm;
            height: 286mm;
            background: #ffffff;
            padding: 4mm 6mm;
            box-shadow: 0 8px 28px rgba(0,0,0,0.18);
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            align-items: center;
        }
        .prog-slot {
            width: 100%;
            height: 31.8%;
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
        }
        .prog-slot img {
            max-width: 100%;
            max-height: 100%;
            width: auto;
            height: auto;
            object-fit: contain;
            display: block;
        }
        .cut-line {
            width: 100%;
            border-top: 1px dashed #a1a1aa;
            position: relative;
            height: 0;
        }
        @media print {
            body {
                background: #ffffff;
                padding: 0;
            }
            .print-toolbar {
                display: none !important;
            }
            .a4-sheet {
                width: 100%;
                height: 286mm;
                padding: 0;
                box-shadow: none;
            }
        }
    </style>
</head>
<body>
    <div class="print-toolbar">
        <div class="print-toolbar-title">Hoja A4 · 3 Programas del Servicio del Campo (${rangoTexto})</div>
        <div class="print-toolbar-actions">
            <button class="print-btn" onclick="if(window.opener && window.opener.descargarPDFProgramaA4TresCopias){ window.opener.descargarPDFProgramaA4TresCopias(); }" style="background:#dc2626; color:#fff;">📄 Descargar PDF A4</button>
            <button class="print-btn" onclick="window.print()">🖨️ Imprimir Hoja A4</button>
            <button class="print-btn print-btn-close" onclick="window.close()">Cerrar</button>
        </div>
    </div>
    <div class="a4-sheet">
        <div class="prog-slot"><img src="${imgData}" alt="Programa 1"></div>
        <div class="cut-line"></div>
        <div class="prog-slot"><img src="${imgData}" alt="Programa 2"></div>
        <div class="cut-line"></div>
        <div class="prog-slot"><img src="${imgData}" alt="Programa 3"></div>
    </div>
    <script>
        window.onload = function() {
            setTimeout(function() { window.print(); }, 250);
        };
    <\/script>
</body>
</html>`);
    win.document.close();
}

function construirTextoWhatsAppPrograma() {
    const { rangoTexto } = obtenerInfoCabeceraPrograma();
    const lineas = [
        `📋 *PROGRAMA DEL SERVICIO DEL CAMPO*`,
        `🗓️ *${rangoTexto}*`,
        ``
    ];
    let diaActual = '';
    programaFilas.forEach(f => {
        if (f.dia !== diaActual) {
            diaActual = f.dia;
            lineas.push(`🔹 *${diaActual.toUpperCase()}*`);
        }
        const grpTxt = f.grupo && f.grupo !== 'T' ? ` [Grupo ${f.grupo}]` : ' [Todos]';
        const mzTxt = f.manzanas ? ` (Mz: ${f.manzanas})` : '';
        const condTxt = f.conductor ? ` — 👤 ${f.conductor}${f.telefono ? ' (' + f.telefono + ')' : ''}` : '';
        lineas.push(`• *${f.hora}*${grpTxt} | 📍 ${f.punto} | *T: ${f.territorios}*${mzTxt}${condTxt}`);
    });
    return lineas.join('\n');
}

async function copiarTextoProgramaWhatsApp() {
    if (programaFilas.length === 0) {
        Swal.fire('Programa vacío', 'Primero agrega al menos una fila al programa.', 'warning');
        return;
    }
    const txt = construirTextoWhatsAppPrograma();
    await navigator.clipboard.writeText(txt);
    Toast.fire({ icon: 'success', title: 'Texto del programa copiado al portapapeles' });
}

async function copiarImagenProgramaPortapapeles() {
    if (programaFilas.length === 0) {
        Swal.fire('Programa vacío', 'Primero agrega al menos una fila al programa.', 'warning');
        return;
    }
    try {
        const blob = await generarBlobImagenPrograma();
        if (navigator.clipboard && window.ClipboardItem && blob) {
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
            Toast.fire({ icon: 'success', title: '¡Imagen de la tabla copiada! Pégala con Ctrl+V en WhatsApp' });
            return true;
        }
    } catch (e) {
        console.error(e);
    }
    await copiarTextoProgramaWhatsApp();
    return false;
}

async function compartirProgramaWhatsApp() {
    if (programaFilas.length === 0) {
        Swal.fire('Programa vacío', 'Primero agrega al menos una fila al programa.', 'warning');
        return;
    }
    const { rangoTexto } = obtenerInfoCabeceraPrograma();
    const txt = construirTextoWhatsAppPrograma();
    try {
        const blob = await generarBlobImagenPrograma();
        if (blob) {
            const file = new File([blob], `Programa_${rangoTexto.replace(/\s+/g, '_')}.png`, { type: 'image/png' });
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                await navigator.share({
                    title: `Programa del Servicio del Campo (${rangoTexto})`,
                    text: txt,
                    files: [file]
                });
                return;
            }
            if (navigator.clipboard && window.ClipboardItem) {
                await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
            }
        }
    } catch (e) {
        if (e && e.name === 'AbortError') return;
    }

    const urlWa = `https://wa.me/?text=${encodeURIComponent(txt)}`;
    window.open(urlWa, '_blank');
    Toast.fire({ icon: 'info', title: 'Abriendo WhatsApp (la imagen también quedó copiada para pegar con Ctrl+V)' });
}

