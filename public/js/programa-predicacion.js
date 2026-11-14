// Programa del servicio del campo (pestaña Programa: tabla editable, imagen, PDF A4 y WhatsApp)
// (script clásico: comparte el ámbito global con el resto de archivos; el orden de carga está en dashboard.html)
/* ==========================================================================
   PROGRAMA DEL SERVICIO DEL CAMPO
   - Se guarda UN programa por tipo de reunión (Vie–Dom y Dom–Jue) en la base de datos; crear uno nuevo del mismo
     tipo reemplaza al anterior.
   - Las filas se pueden editar en su sitio (clic en la fila o en el lápiz) y se guardan solas.
   - Impresión A4: Vie–Dom = 2 programas por hoja, Dom–Jue = 3 por hoja, con la letra lo más grande posible.
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

const PROG_TIPOS = {
    VIE_DOM: { nombre: 'Vie – Dom', porHoja: 2, dia: 'Viernes', diaSemanaInicio: 5, duracion: 2, descripcion: 'Programa del fin de semana (Viernes a Domingo)' },
    DOM_JUE: { nombre: 'Dom – Jue', porHoja: 3, dia: 'Domingo', diaSemanaInicio: 0, duracion: 4, descripcion: 'Programa de entre semana (Domingo a Jueves)' }
};

let programaTipo = null;          // 'VIE_DOM' | 'DOM_JUE' (el que se está viendo/editando)
let programaFilas = [];
let progEditIdx = -1;             // fila que se está editando (-1 = ninguna)
let progGuardadoRemoto = null;    // { VIE_DOM: {...}|null, DOM_JUE: {...}|null } tal como está en la base de datos
let progTimerGuardado = null;
const progManzanasSet = new Set();

/* ---------- Datos auxiliares ---------- */
function poblarPuntosReunionDatalist() {
    const dl = document.getElementById('listaPuntosReunion');
    if (!dl) return;
    let extras = [];
    try { extras = JSON.parse(localStorage.getItem('puntos_reunion_custom') || '[]'); } catch (e) {}
    const todos = Array.from(new Set([...PUNTOS_REUNION_BASE, ...extras]));
    dl.innerHTML = todos.map(p => `<option value="${esc(p)}"></option>`).join('');
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

// Respaldo de teléfonos guardados antes en este navegador (ahora el teléfono vive en la base de datos)
function telefonoLocalAntiguo(nombre) {
    try { return (JSON.parse(localStorage.getItem('conductores_telefonos_map') || '{}')[nombre]) || ''; } catch (e) { return ''; }
}

function telefonoDeConductor(nombre) {
    const c = cacheConductores.find(x => x.nombre === nombre);
    return soloDigitosTel((c && c.telefono) || telefonoLocalAntiguo(nombre) || '');
}

function asegurarOpcionSelect(sel, valor, etiqueta) {
    if (!sel || !valor) return;
    if (!Array.from(sel.options).some(o => o.value === valor)) {
        const o = document.createElement('option'); o.value = valor; o.textContent = etiqueta || valor; sel.appendChild(o);
    }
}

/* ---------- Entrada a la pestaña ---------- */
async function iniciarVistaPrograma() {
    if (cacheTurnos.length === 0) await cargarTurnosData();
    if (cacheConductores.length === 0) await cargarConductoresData();
    if (cacheTerritorios.length === 0) await cargarTerritoriosData();

    poblarPuntosReunionDatalist();
    poblarSelectoresPrograma();
    await cargarProgramasGuardados();

    if (!isAdmin) document.querySelectorAll('#subview-terr-programa .prog-edit-only').forEach(el => { el.style.display = 'none'; });

    seleccionarTipoPrograma(programaTipo || tipoProgramaPorDefecto());
}

function tipoProgramaPorDefecto() {
    const dow = new Date().getDay();
    return (dow === 3 || dow === 4 || dow === 5) ? 'VIE_DOM' : 'DOM_JUE';
}

function poblarSelectoresPrograma() {
    const selTurno = document.getElementById('progTurno');
    if (selTurno) {
        selTurno.innerHTML = cacheTurnos.length
            ? cacheTurnos.map(t => `<option value="${esc(t.nombre)}" data-horario="${esc(t.horario || '')}">${esc(t.nombre)}${t.horario ? ' (' + esc(t.horario) + ')' : ''}</option>`).join('')
            : '<option value="Mañana" data-horario="8:20 am">Mañana</option><option value="Tarde" data-horario="3:30 pm">Tarde</option>';
    }
    const inpHora = document.getElementById('progHora');
    if (inpHora && !inpHora.value) alCambiarTurnoPrograma();

    const optsTerr = cacheTerritorios.map(t => {
        const enCurso = t.estado_actual === 'INICIO' || t.estado_actual === 'AVANCE';
        const { faltantes } = obtenerManzanasFaltantesTerritorio(t);
        const infoExtra = enCurso
            ? `⚡ En curso — Faltan manz: ${faltantes.join(', ')}`
            : `Manz. 1 a ${t.cantidad_manzanas} (${t.estado_actual})`;
        return `<option value="${esc(t.numero)}" data-id="${t.id}">Territorio ${esc(t.numero)} · ${infoExtra}</option>`;
    }).join('');
    const sel1 = document.getElementById('progTerritorio');
    const sel2 = document.getElementById('progTerritorio2');
    if (sel1) sel1.innerHTML = '<option value="">-- Seleccionar territorio --</option>' + optsTerr;
    if (sel2) sel2.innerHTML = '<option value="">-- Ninguno --</option>' + optsTerr;

    const selCond = document.getElementById('progConductor');
    if (selCond) {
        selCond.innerHTML = '<option value="">-- En blanco / Sin asignar --</option>' +
            cacheConductores.filter(c => c.activo !== 0).map(c => `<option value="${esc(c.nombre)}">${esc(c.nombre)}</option>`).join('');
        // El teléfono se completa solo con el del directorio (se puede cambiar a mano)
        selCond.onchange = () => {
            const telEl = document.getElementById('progConductorTel');
            if (telEl) telEl.value = telefonoDeConductor(selCond.value);
        };
    }
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

/* ---------- Guardado en la base de datos (un programa por tipo) ---------- */
async function cargarProgramasGuardados() {
    try {
        const res = await fetch('/api/programas');
        if (res.ok) progGuardadoRemoto = await res.json();
    } catch (e) { console.error(e); }
    if (!progGuardadoRemoto) progGuardadoRemoto = { VIE_DOM: null, DOM_JUE: null };
    await migrarProgramaLocalAntiguo();
}

// El programa que antes se guardaba solo en este navegador se pasa a la base de datos (una sola vez)
async function migrarProgramaLocalAntiguo() {
    if (!isAdmin || (progGuardadoRemoto.VIE_DOM || progGuardadoRemoto.DOM_JUE)) return;
    try {
        const raw = localStorage.getItem('programa_predicacion_state');
        if (!raw) return;
        const p = JSON.parse(raw);
        if (!Array.isArray(p.filas) || p.filas.length === 0) { localStorage.removeItem('programa_predicacion_state'); return; }
        const ini = normalizarFechaYMD(p.fechaIni);
        const dow = ini ? new Date(ini + 'T00:00:00').getDay() : new Date().getDay();
        const tipo = (dow === 0) ? 'DOM_JUE' : 'VIE_DOM';
        const payload = { fechaIni: ini || '', fechaFin: normalizarFechaYMD(p.fechaFin) || '', mostrarGrupo: p.mostrarGrupo !== false, filas: p.filas.map(f => ({ ...f, id: String(f.id ?? Date.now()) })) };
        const res = await fetch(`/api/programas/${tipo}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (res.ok) { progGuardadoRemoto[tipo] = payload; localStorage.removeItem('programa_predicacion_state'); }
    } catch (e) { console.error(e); }
}

function construirPayloadPrograma() {
    return {
        fechaIni: normalizarFechaYMD(document.getElementById('progFechaIni')?.value) || '',
        fechaFin: normalizarFechaYMD(document.getElementById('progFechaFin')?.value) || '',
        mostrarGrupo: Boolean(document.getElementById('progMostrarColGrupo')?.checked),
        filas: programaFilas.map(f => ({ ...f }))
    };
}

function estadoProg(clase, texto) {
    const el = document.getElementById('progEstadoGuardado');
    if (!el) return;
    el.className = 'prog-estado' + (clase ? ' ' + clase : '');
    el.innerHTML = texto ? (clase === 'ok' ? '<i class="fa-solid fa-circle-check"></i> ' : clase === 'error' ? '<i class="fa-solid fa-triangle-exclamation"></i> ' : '<i class="fa-solid fa-spinner fa-spin"></i> ') + esc(texto) : '';
}

function programarGuardadoPrograma() {
    if (!isAdmin || !programaTipo) return;
    estadoProg('', 'Guardando…');
    clearTimeout(progTimerGuardado);
    progTimerGuardado = setTimeout(guardarProgramaRemoto, 700);
}

async function guardarProgramaRemoto() {
    progTimerGuardado = null;
    if (!isAdmin || !programaTipo) return;
    const tipo = programaTipo;
    const payload = construirPayloadPrograma();            // se arma YA, antes de cualquier espera
    if (!progGuardadoRemoto) progGuardadoRemoto = { VIE_DOM: null, DOM_JUE: null };
    progGuardadoRemoto[tipo] = payload;
    try {
        const res = await fetch(`/api/programas/${tipo}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || json.ok === false) throw new Error(json.msg || 'Error al guardar');
        if (tipo === programaTipo) estadoProg('ok', 'Guardado ' + new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' }));
    } catch (e) {
        console.error(e);
        if (tipo === programaTipo) estadoProg('error', 'No se pudo guardar. Se reintentará al hacer otro cambio.');
    }
}

/* ---------- Tipo de programa (Vie–Dom / Dom–Jue) ---------- */
function seleccionarTipoPrograma(tipo) {
    if (!PROG_TIPOS[tipo]) return;
    // Si hay un guardado pendiente del programa que se deja, se envía ahora
    if (progTimerGuardado) { clearTimeout(progTimerGuardado); guardarProgramaRemoto(); }

    programaTipo = tipo;
    progEditIdx = -1;
    const cfg = PROG_TIPOS[tipo];
    const g = progGuardadoRemoto ? progGuardadoRemoto[tipo] : null;
    const elIni = document.getElementById('progFechaIni');
    const elFin = document.getElementById('progFechaFin');
    const chk = document.getElementById('progMostrarColGrupo');

    if (g && Array.isArray(g.filas)) {
        programaFilas = g.filas.map(f => ({ ...f }));
        if (elIni) elIni.value = g.fechaIni || '';
        if (elFin) elFin.value = g.fechaFin || '';
        if (chk) chk.checked = g.mostrarGrupo !== false;
    } else {
        programaFilas = [];
        fijarRangoPrograma(tipo, new Date());
        if (chk) chk.checked = true;
    }

    const selDia = document.getElementById('progDia'); if (selDia) selDia.value = cfg.dia;
    document.getElementById('btnProgVieDom')?.classList.toggle('active', tipo === 'VIE_DOM');
    document.getElementById('btnProgDomJue')?.classList.toggle('active', tipo === 'DOM_JUE');
    const sub = document.getElementById('progTipoSub');
    if (sub) sub.textContent = `${cfg.descripcion} · se imprimen ${cfg.porHoja} programas por hoja`;
    document.querySelectorAll('.progNHoja').forEach(el => { el.textContent = cfg.porHoja; });
    const tv = document.getElementById('progTituloVista');
    if (tv) tv.textContent = `3. Vista Previa del Programa (${cfg.nombre})`;

    salirModoEdicionPrograma();
    estadoProg('', g ? '' : 'Programa nuevo (aún sin guardar)');
    cargarManzanasProgramaSelect();
    renderTablaProgramaPreview();
}

// Fija inicio y fin del programa: el próximo viernes (Vie–Dom) o domingo (Dom–Jue) a partir de la fecha base
function fijarRangoPrograma(tipo, base) {
    const cfg = PROG_TIPOS[tipo];
    const dBase = new Date(base.getFullYear(), base.getMonth(), base.getDate());
    const diff = (cfg.diaSemanaInicio - dBase.getDay() + 7) % 7;
    const dIni = new Date(dBase.getFullYear(), dBase.getMonth(), dBase.getDate() + diff);
    const dFin = new Date(dIni.getFullYear(), dIni.getMonth(), dIni.getDate() + cfg.duracion);
    const elIni = document.getElementById('progFechaIni');
    const elFin = document.getElementById('progFechaFin');
    if (elIni) elIni.value = vcalFormatYMD(dIni);
    if (elFin) elFin.value = vcalFormatYMD(dFin);
}

async function nuevoProgramaSemanaSiguiente() {
    const cfg = PROG_TIPOS[programaTipo];
    const r = await Swal.fire({
        icon: 'question', title: '¿Empezar un programa nuevo?',
        html: `Se <b>reemplazará</b> el programa actual de <b>${esc(cfg.nombre)}</b> por uno en blanco para la semana siguiente.`,
        showCancelButton: true, confirmButtonText: 'Sí, empezar nuevo', cancelButtonText: 'Cancelar'
    });
    if (!r.isConfirmed) return;
    const fin = normalizarFechaYMD(document.getElementById('progFechaFin')?.value);
    let base = new Date();
    if (fin) { const [y, m, d] = fin.split('-').map(Number); base = new Date(y, m - 1, d + 1); }
    fijarRangoPrograma(programaTipo, base);
    programaFilas = [];
    salirModoEdicionPrograma();
    renderTablaProgramaPreview();
    guardarProgramaRemoto();
    Toast.fire({ icon: 'success', title: 'Programa nuevo listo. Agrega los turnos.' });
}

function actualizarCabeceraPrograma() {
    renderTablaProgramaPreview();
    programarGuardadoPrograma();
}

/* ---------- Manzanas ---------- */
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

/* ---------- Filas: agregar / editar en su lugar / quitar ---------- */
function leerFormularioFilaPrograma() {
    const t1 = document.getElementById('progTerritorio')?.value || '';
    const t2 = document.getElementById('progTerritorio2')?.value || '';
    if (!t1) {
        Swal.fire('Falta Territorio', 'Selecciona al menos el Territorio Principal para esta salida.', 'warning');
        return null;
    }
    const punto = (document.getElementById('progPunto')?.value || '').trim();
    if (punto) registrarPuntoReunionCustom(punto);
    return {
        dia: document.getElementById('progDia')?.value || 'Viernes',
        turno: document.getElementById('progTurno')?.value || 'Mañana',
        hora: (document.getElementById('progHora')?.value || '8:20 am').trim(),
        grupo: document.getElementById('progGrupo')?.value || 'T',
        punto: punto || '-',
        territorios: t2 && t2 !== t1 ? `${t1}, ${t2}` : `${t1}`,
        manzanas: progManzanasSet.size > 0 ? Array.from(progManzanasSet).sort((a, b) => a - b).join(', ') : '',
        conductor: document.getElementById('progConductor')?.value || '',
        telefono: soloDigitosTel(document.getElementById('progConductorTel')?.value)
    };
}

function agregarFilaPrograma() {
    const datos = leerFormularioFilaPrograma();
    if (!datos) return;
    if (progEditIdx >= 0 && programaFilas[progEditIdx]) {
        // Edición: la fila se actualiza EN LA MISMA POSICIÓN (no se crea una nueva)
        const n = progEditIdx + 1;
        programaFilas[progEditIdx] = { ...programaFilas[progEditIdx], ...datos };
        salirModoEdicionPrograma();
        Toast.fire({ icon: 'success', title: `Fila #${n} actualizada` });
    } else {
        programaFilas.push({ id: String(Date.now()) + Math.floor(Math.random() * 1000), ...datos });
        Toast.fire({ icon: 'success', title: `Agregado: ${datos.dia} (${datos.hora}) · T: ${datos.territorios}` });
    }
    renderTablaProgramaPreview();
    programarGuardadoPrograma();
}

function editarFilaPrograma(idx) {
    if (!isAdmin) return;
    const f = programaFilas[idx];
    if (!f) return;
    progEditIdx = idx;

    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    set('progDia', f.dia);
    asegurarOpcionSelect(document.getElementById('progTurno'), f.turno);
    set('progTurno', f.turno);
    set('progHora', f.hora);
    set('progGrupo', f.grupo);
    set('progPunto', f.punto === '-' ? '' : f.punto);

    const [t1, t2 = ''] = String(f.territorios || '').split(',').map(x => x.trim());
    asegurarOpcionSelect(document.getElementById('progTerritorio'), t1, `Territorio ${t1}`);
    set('progTerritorio', t1);
    asegurarOpcionSelect(document.getElementById('progTerritorio2'), t2, `Territorio ${t2}`);
    set('progTerritorio2', t2);
    cargarManzanasProgramaSelect();                              // reconstruye las manzanas del territorio
    String(f.manzanas || '').split(',').map(x => parseInt(x.trim(), 10)).filter(n => n >= 1).forEach(m => {
        progManzanasSet.add(m);
        document.querySelector(`#progManzanasGrid .manzana-chip[data-manzana="${m}"]`)?.classList.add('selected');
    });

    asegurarOpcionSelect(document.getElementById('progConductor'), f.conductor);
    set('progConductor', f.conductor);
    set('progConductorTel', soloDigitosTel(f.telefono));

    const btn = document.getElementById('btnAgregarFilaProg');
    if (btn) btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Guardar cambios';
    const cancelar = document.getElementById('btnCancelarEdicionProg'); if (cancelar) cancelar.style.display = '';
    const titulo = document.getElementById('progTituloFila');
    if (titulo) { titulo.classList.add('editando'); titulo.innerHTML = `<i class="fa-solid fa-pen"></i> 2. Editando la fila #${idx + 1} (${esc(f.dia)} · ${esc(f.hora)})`; }
    renderTablaProgramaPreview();
    if (titulo && titulo.scrollIntoView) titulo.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// Vuelve el formulario al modo "agregar" (sin tocar la tabla)
function salirModoEdicionPrograma() {
    progEditIdx = -1;
    const btn = document.getElementById('btnAgregarFilaProg');
    if (btn) btn.innerHTML = '<i class="fa-solid fa-plus"></i> Agregar al Programa';
    const cancelar = document.getElementById('btnCancelarEdicionProg'); if (cancelar) cancelar.style.display = 'none';
    const titulo = document.getElementById('progTituloFila');
    if (titulo) { titulo.classList.remove('editando'); titulo.innerHTML = '<i class="fa-solid fa-plus-circle"></i> 2. Agregar Turno / Salida al Programa'; }
}

function cancelarEdicionFilaPrograma() {
    salirModoEdicionPrograma();
    renderTablaProgramaPreview();
}

async function eliminarFilaPrograma(idx) {
    const f = programaFilas[idx];
    if (!f) return;
    const r = await Swal.fire({ icon: 'warning', title: '¿Quitar esta fila?', text: `${f.dia} · ${f.hora} · T: ${f.territorios}`, showCancelButton: true, confirmButtonText: 'Sí, quitar', cancelButtonText: 'Cancelar', confirmButtonColor: '#ef4444' });
    if (!r.isConfirmed) return;
    if (progEditIdx === idx) salirModoEdicionPrograma();
    else if (progEditIdx > idx) progEditIdx--;
    programaFilas.splice(idx, 1);
    renderTablaProgramaPreview();
    programarGuardadoPrograma();
}

async function limpiarFilasPrograma() {
    if (programaFilas.length === 0) return;
    const r = await Swal.fire({ icon: 'warning', title: '¿Vaciar la tabla?', text: 'Se quitarán todas las filas del programa actual.', showCancelButton: true, confirmButtonText: 'Sí, vaciar', cancelButtonText: 'Cancelar', confirmButtonColor: '#ef4444' });
    if (!r.isConfirmed) return;
    programaFilas = [];
    salirModoEdicionPrograma();
    renderTablaProgramaPreview();
    programarGuardadoPrograma();
}

/* ---------- Cabecera y colores ---------- */
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

// Para cada fila: cuántas filas seguidas ocupa su día (la primera del bloque) o 0 si es continuación
function calcularSpansDiaPrograma(filas) {
    const spans = new Array(filas.length).fill(0);
    let idxInicio = 0;
    for (let i = 0; i < filas.length; i++) {
        if (i === 0 || filas[i].dia !== filas[idxInicio].dia) {
            idxInicio = i;
            spans[idxInicio] = 1;
        } else {
            spans[idxInicio]++;
            spans[i] = 0;
        }
    }
    return spans;
}

/* ---------- Vista previa en pantalla ---------- */
function renderTablaProgramaPreview() {
    const wrap = document.getElementById('progTablaPreviewWrap');
    const chipsCont = document.getElementById('progFilasAdminList');
    if (!wrap) return;

    const { rangoTexto, mesVertical } = obtenerInfoCabeceraPrograma();
    const mostrarGrupo = Boolean(document.getElementById('progMostrarColGrupo')?.checked);

    if (programaFilas.length === 0) {
        wrap.innerHTML = `<div style="text-align:center; padding:26px; color:#71717a; font-size:0.84rem;">Agrega turnos usando el formulario de arriba para construir la tabla del <strong>Programa del Servicio del Campo (${esc(rangoTexto)})</strong>.</div>`;
        if (chipsCont) chipsCont.innerHTML = '';
        return;
    }

    const spansDia = calcularSpansDiaPrograma(programaFilas);
    const mesVerticalHtml = mesVertical.split('').join('<br>');
    let rowsHtml = '';
    programaFilas.forEach((f, idx) => {
        const tdMes = idx === 0
            ? `<td class="prog-cell-mes" rowspan="${programaFilas.length}">${mesVerticalHtml}</td>`
            : '';
        const tdDia = spansDia[idx] > 0
            ? `<td class="prog-cell-dia ${claseColorDiaPrograma(f.dia)}" rowspan="${spansDia[idx]}">${esc(f.dia)}</td>`
            : '';
        const tdGrupo = mostrarGrupo ? `<td>${esc(f.grupo)}</td>` : '';
        const terrHtml = `<div><strong>T: ${esc(f.territorios)}</strong></div>` + (f.manzanas ? `<div style="font-size:0.78rem; font-weight:700;">Mz: ${esc(f.manzanas)}</div>` : '');
        const condTexto = f.conductor
            ? `<div>${esc(f.conductor)}</div>${f.telefono ? `<div>(${esc(f.telefono)})</div>` : ''}`
            : `&nbsp;`;
        const clases = (isAdmin ? 'prog-fila-click ' : '') + (idx === progEditIdx ? 'prog-fila-editando' : '');
        const click = isAdmin ? ` onclick="editarFilaPrograma(${idx})" title="Clic para editar esta fila"` : '';

        rowsHtml += `
            <tr class="${clases}"${click}>
                ${tdMes}
                ${tdDia}
                <td>${esc(f.hora)}</td>
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
                <div>${esc(rangoTexto)}</div>
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
                <strong>#${i + 1} ${esc(f.dia)}</strong> (${esc(f.hora)}) · T:${esc(f.territorios)}
                ${isAdmin ? `<button type="button" class="chip-edit" title="Editar fila" onclick="editarFilaPrograma(${i})"><i class="fa-solid fa-pen"></i></button>
                <button type="button" title="Quitar fila" onclick="eliminarFilaPrograma(${i})"><i class="fa-solid fa-xmark"></i></button>` : ''}
            </span>
        `).join('');
    }
}

/* ---------- Imagen para WhatsApp / portapapeles (diseño original, ancho fijo) ---------- */
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

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, totalW, totalH);

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, totalW, bannerH);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 17px Arial, sans-serif';
    ctx.fillText('PROGRAMA DEL SERVICIO DEL CAMPO', totalW / 2, 19);
    ctx.font = 'bold 16px Arial, sans-serif';
    ctx.fillText(rangoTexto, totalW / 2, 41);

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, bannerH);
    ctx.lineTo(totalW, bannerH);
    ctx.stroke();

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

    const spansDia = calcularSpansDiaPrograma(programaFilas);

    const colDia = cols[1];
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

/* ==========================================================================
   IMPRESIÓN A4 — diseño adaptativo: la letra más grande que quepa en el hueco
   Vie–Dom: 2 programas por hoja · Dom–Jue: 3 programas por hoja
   ========================================================================== */
const A4_PDF = { pageW: 210, pageH: 297, margenArriba: 6, margenAbajo: 6, margenLado: 8, separacion: 5 };

function porHojaPrograma() { return (PROG_TIPOS[programaTipo] || PROG_TIPOS.DOM_JUE).porHoja; }

// Tamaño (mm) del hueco de cada programa en la hoja
function dimensionesHuecoPrograma(n) {
    const w = A4_PDF.pageW - A4_PDF.margenLado * 2;
    const alto = A4_PDF.pageH - A4_PDF.margenArriba - A4_PDF.margenAbajo;
    return { w, h: (alto - A4_PDF.separacion * (n - 1)) / n };
}

// Calcula el diseño (anchos de columna) para una letra de tamaño f (px lógicos) y un "nivel de compactación":
//   nivel 0: Territorio y Mz en dos líneas; conductor y teléfono en líneas separadas (el aspecto original)
//   nivel 1: conductor y teléfono en la misma línea (ahorra alto)
//   nivel 2: además "T: x  Mz: y" en la misma línea (máximo ahorro de alto)
function textoCondPrograma(c, nivel) { return nivel >= 1 ? (c.cond + (c.cond && c.tel ? ' ' + c.tel : '')).trim() : c.cond; }
function textoTerrPrograma(c, nivel) { return nivel >= 2 ? (c.terr + (c.mz ? '   ' + c.mz : '')) : c.terr; }

function calcularDisenoProgramaImpresion(f, datos, nivel) {
    const { celdas, mostrarGrupo, medir, anchoMinimo } = datos;
    const pad = f * 1.0;
    const fh = f * 0.78;                                   // letra de los encabezados
    const ancho = {};
    const max = (arr) => arr.reduce((a, b) => Math.max(a, b), 0);
    ancho.mes = Math.max(f * 1.9, medir('MES', fh, true) + f * 0.9);
    ancho.dia = max(celdas.map(c => medir(c.dia, f, true))) + pad;
    ancho.hora = max(celdas.map(c => medir(c.hora, f, false))) + pad;
    ancho.grupo = Math.max(max(celdas.map(c => medir(c.grupo, f, false))), medir('GRUPO', fh, true)) + pad;
    ancho.punto = max(celdas.map(c => anchoMinimo(c.punto, f, false))) + pad;
    ancho.terr = max(celdas.map(c => nivel >= 2
        ? anchoMinimo(textoTerrPrograma(c, nivel), f, true)
        : Math.max(medir(c.terr, f, true), c.mz ? anchoMinimo(c.mz, f * 0.88, true) : 0))) + pad;
    ancho.cond = max(celdas.map(c => nivel >= 1
        ? anchoMinimo(textoCondPrograma(c, nivel), f, false)
        : Math.max(anchoMinimo(c.cond, f, false), c.tel ? medir(c.tel, f, false) : 0))) + pad + f * 1.8;
    const titulos = { mes: 'MES', dia: 'DÍA', hora: 'HORA', grupo: 'GRUPO', punto: 'PUNTO DE REUNIÓN', terr: 'TERRITORIO(S)', cond: 'CONDUCTOR' };
    const claves = mostrarGrupo ? ['mes', 'dia', 'hora', 'grupo', 'punto', 'terr', 'cond'] : ['mes', 'dia', 'hora', 'punto', 'terr', 'cond'];
    claves.forEach(k => { if (k !== 'mes') ancho[k] = Math.max(ancho[k], anchoMinimo(titulos[k], fh, true) + pad); });
    const total = claves.reduce((a, k) => a + ancho[k], 0);
    return { f, pad, fh, ancho, claves, titulos, total, nivel };
}

// Alto de cada fila (líneas necesarias) con los anchos ya definidos
function calcularAlturasProgramaImpresion(d, datos) {
    const { celdas, medir, partir } = datos;
    const { f, pad, ancho, nivel } = d;
    const lineaH = f * 1.22;
    const filasH = celdas.map(c => {
        const lPunto = partir(c.punto, f, false, ancho.punto - pad).length;
        const lTerr = nivel >= 2
            ? partir(textoTerrPrograma(c, nivel), f, true, ancho.terr - pad).length
            : 1 + (c.mz ? partir(c.mz, f * 0.88, true, ancho.terr - pad).length : 0);
        const anchoCond = ancho.cond - pad - f * 1.8;
        const lCond = nivel >= 1
            ? (c.cond ? partir(textoCondPrograma(c, nivel), f, false, anchoCond).length : 0)
            : (c.cond ? partir(c.cond, f, false, anchoCond).length : 0) + (c.tel ? 1 : 0);
        return Math.max(1, lPunto, lTerr, lCond) * lineaH + f * 0.8;
    });
    const hdrDosLineas = d.claves.some(k => k !== 'mes' && medir(d.titulos[k], d.fh, true) > ancho[k] - pad + 0.5);
    const th = (hdrDosLineas ? 2 : 1) * d.fh * 1.25 + f * 0.8;
    const banner = f * 2.5;
    return { filasH, th, banner, hdrDosLineas, alto: banner + th + filasH.reduce((a, b) => a + b, 0) };
}

function generarCanvasProgramaImpresion(nPorHoja, scale = 3) {
    if (programaFilas.length === 0) return null;
    const { rangoTexto, mesVertical } = obtenerInfoCabeceraPrograma();
    const mostrarGrupo = Boolean(document.getElementById('progMostrarColGrupo')?.checked);
    const hueco = dimensionesHuecoPrograma(nPorHoja);
    const W = 1000;
    const Hmax = W * hueco.h / hueco.w;

    const m = document.createElement('canvas').getContext('2d');
    const medir = (t, px, bold) => { m.font = `${bold ? 'bold ' : ''}${px}px Arial, sans-serif`; return m.measureText(String(t)).width; };
    // Parte un texto en como máximo 2 líneas equilibradas (solo si no cabe en anchoMax)
    const partir = (t, px, bold, anchoMax) => {
        t = String(t || '').trim();
        if (!t) return [''];
        if (medir(t, px, bold) <= anchoMax) return [t];
        const pal = t.split(/\s+/);
        if (pal.length < 2) return [t];
        let mejor = null;
        for (let k = 1; k < pal.length; k++) {
            const a = pal.slice(0, k).join(' '), b = pal.slice(k).join(' ');
            const w = Math.max(medir(a, px, bold), medir(b, px, bold));
            if (!mejor || w < mejor.w) mejor = { w, l: [a, b] };
        }
        return mejor.l;
    };
    const anchoMinimo = (t, px, bold) => {
        t = String(t || '').trim();
        if (!t) return 0;
        const pal = t.split(/\s+/);
        if (pal.length < 2) return medir(t, px, bold);
        let mejor = Infinity;
        for (let k = 1; k < pal.length; k++) mejor = Math.min(mejor, Math.max(medir(pal.slice(0, k).join(' '), px, bold), medir(pal.slice(k).join(' '), px, bold)));
        return mejor;
    };

    const celdas = programaFilas.map(f => ({
        dia: f.dia, hora: f.hora, grupo: String(f.grupo),
        punto: f.punto || '-', terr: `T: ${f.territorios}`, mz: f.manzanas ? `Mz: ${f.manzanas}` : '',
        cond: f.conductor || '', tel: (f.conductor && f.telefono) ? `(${f.telefono})` : ''
    }));
    const datos = { celdas, mostrarGrupo, medir, partir, anchoMinimo };

    // La letra más grande para la que todo cabe en ancho y alto. A igual letra se prefiere el aspecto original (nivel 0)
    let elegido = null;
    buscar: for (let f = 30; f >= 10; f -= 0.5) {
        for (let nivel = 0; nivel <= 2; nivel++) {
            const d = calcularDisenoProgramaImpresion(f, datos, nivel);
            if (d.total > W) continue;
            const h = calcularAlturasProgramaImpresion(d, datos);
            if (h.alto <= Hmax) { elegido = { d, h }; break buscar; }
        }
    }
    if (!elegido) { const d = calcularDisenoProgramaImpresion(10, datos, 2); elegido = { d, h: calcularAlturasProgramaImpresion(d, datos) }; }
    const { d } = elegido;
    const f = d.f;
    const nivel = d.nivel;
    const Wf = Math.max(W, d.total);
    generarCanvasProgramaImpresion.ultimo = { f, nivel };      // (diagnóstico)

    // Reparte el ancho sobrante entre las columnas (menos MES) y recalcula las alturas con los anchos finales
    const extra = Wf - d.total;
    const sumaSinMes = d.claves.filter(k => k !== 'mes').reduce((a, k) => a + d.ancho[k], 0);
    d.claves.forEach(k => { if (k !== 'mes') d.ancho[k] += extra * d.ancho[k] / sumaSinMes; });
    const h = calcularAlturasProgramaImpresion(d, datos);
    // Si sobra alto, las filas se estiran un poco (con tope) para aprovechar el hueco
    const sobra = Math.max(0, Hmax - h.alto);
    const estira = Math.min(sobra / celdas.length, f * 1.2);
    const filasH = h.filasH.map(x => x + estira);
    const bodyH = filasH.reduce((a, b) => a + b, 0);
    const Hf = h.banner + h.th + bodyH;

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(Wf * scale);
    canvas.height = Math.round(Hf * scale);
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, Wf, Hf);

    // Dibuja líneas de texto centradas verticalmente en (cx, cy)
    const bloque = (items, cx, cy) => {
        const total = items.reduce((a, it) => a + it.px * 1.22, 0);
        let y = cy - total / 2;
        items.forEach(it => {
            ctx.font = `${it.b ? 'bold ' : ''}${it.px}px Arial, sans-serif`;
            ctx.fillStyle = it.color || '#000000';
            ctx.fillText(it.t, cx, y + it.px * 0.61);
            y += it.px * 1.22;
        });
    };

    // Banner
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, Wf, h.banner);
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${f * 1.02}px Arial, sans-serif`;
    ctx.fillText('PROGRAMA DEL SERVICIO DEL CAMPO', Wf / 2, h.banner * 0.33);
    ctx.font = `bold ${f * 0.95}px Arial, sans-serif`;
    ctx.fillText(rangoTexto, Wf / 2, h.banner * 0.74);

    // Posición de cada columna
    const x = {}; let xc = 0;
    d.claves.forEach(k => { x[k] = xc; xc += d.ancho[k]; });

    // Encabezados
    d.claves.forEach(k => {
        ctx.fillStyle = '#000000';
        ctx.fillRect(x[k], h.banner, d.ancho[k], h.th);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.strokeRect(x[k], h.banner, d.ancho[k], h.th);
        const lineas = partir(d.titulos[k], d.fh, true, d.ancho[k] - d.pad);
        bloque(lineas.map(t => ({ t, px: d.fh, b: true, color: '#ffffff' })), x[k] + d.ancho[k] / 2, h.banner + h.th / 2);
    });

    const bodyTop = h.banner + h.th;
    const yFila = []; let ya = bodyTop;
    filasH.forEach(hh => { yFila.push(ya); ya += hh; });

    // Columna MES (vertical)
    ctx.fillStyle = '#000000';
    ctx.fillRect(x.mes, bodyTop, d.ancho.mes, bodyH);
    const letras = mesVertical.split('');
    const paso = Math.min(f * 1.2, (bodyH - f) / Math.max(1, letras.length));
    const y0 = bodyTop + (bodyH - (letras.length - 1) * paso) / 2;
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${f * 0.9}px Arial, sans-serif`;
    letras.forEach((ch, i) => ctx.fillText(ch, x.mes + d.ancho.mes / 2, y0 + i * paso));

    // Columna DÍA agrupada por bloques
    const spans = calcularSpansDiaPrograma(programaFilas);
    for (let i = 0; i < programaFilas.length; i++) {
        if (spans[i] === 0) continue;
        const yTop = yFila[i];
        const hBloque = filasH.slice(i, i + spans[i]).reduce((a, b) => a + b, 0);
        ctx.fillStyle = hexColorDiaPrograma(programaFilas[i].dia);
        ctx.fillRect(x.dia, yTop, d.ancho.dia, hBloque);
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1;
        ctx.strokeRect(x.dia, yTop, d.ancho.dia, hBloque);
        bloque([{ t: programaFilas[i].dia, px: f, b: true }], x.dia + d.ancho.dia / 2, yTop + hBloque / 2);
    }

    // Resto de celdas
    celdas.forEach((c, i) => {
        const yTop = yFila[i], hh = filasH[i];
        d.claves.filter(k => k !== 'mes' && k !== 'dia').forEach(k => {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(x[k], yTop, d.ancho[k], hh);
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 1;
            ctx.strokeRect(x[k], yTop, d.ancho[k], hh);
            const cx = x[k] + d.ancho[k] / 2, cy = yTop + hh / 2;
            if (k === 'hora') bloque([{ t: c.hora, px: f }], cx, cy);
            else if (k === 'grupo') bloque([{ t: c.grupo, px: f }], cx, cy);
            else if (k === 'punto') bloque(partir(c.punto, f, false, d.ancho.punto - d.pad).map(t => ({ t, px: f })), cx, cy);
            else if (k === 'terr') {
                if (nivel >= 2) bloque(partir(textoTerrPrograma(c, nivel), f, true, d.ancho.terr - d.pad).map(t => ({ t, px: f, b: true })), cx, cy);
                else {
                    const its = [{ t: c.terr, px: f, b: true }];
                    if (c.mz) partir(c.mz, f * 0.88, true, d.ancho.terr - d.pad).forEach(t => its.push({ t, px: f * 0.88, b: true }));
                    bloque(its, cx, cy);
                }
            } else if (k === 'cond') {
                // Cápsula gris con el nombre (y teléfono) del conductor
                const pp = f * 0.3, px = x[k] + pp, py = yTop + f * 0.26, pw = d.ancho[k] - pp * 2, ph = hh - f * 0.52, r = Math.min(f * 0.7, ph / 2);
                ctx.fillStyle = '#e5e7eb';
                ctx.beginPath();
                ctx.moveTo(px + r, py);
                ctx.lineTo(px + pw - r, py);
                ctx.quadraticCurveTo(px + pw, py, px + pw, py + r);
                ctx.lineTo(px + pw, py + ph - r);
                ctx.quadraticCurveTo(px + pw, py + ph, px + pw - r, py + ph);
                ctx.lineTo(px + r, py + ph);
                ctx.quadraticCurveTo(px, py + ph, px, py + ph - r);
                ctx.lineTo(px, py + r);
                ctx.quadraticCurveTo(px, py, px + r, py);
                ctx.closePath();
                ctx.fill();
                const anchoCond = d.ancho.cond - d.pad - f * 1.8;
                const its = [];
                if (nivel >= 1) {
                    if (c.cond) partir(textoCondPrograma(c, nivel), f, false, anchoCond).forEach(t => its.push({ t, px: f, color: '#111827' }));
                } else {
                    if (c.cond) partir(c.cond, f, false, anchoCond).forEach(t => its.push({ t, px: f, color: '#111827' }));
                    if (c.tel) its.push({ t: c.tel, px: f, color: '#111827' });
                }
                bloque(its, cx - f * 0.45, cy);
                ctx.fillStyle = '#374151';
                ctx.font = `${f * 0.6}px Arial, sans-serif`;
                ctx.fillText('▼', px + pw - f * 0.75, cy);
            }
        });
    });

    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, Wf, Hf);
    return canvas;
}

function construirPDFProgramaA4Doc() {
    const n = porHojaPrograma();
    const canvas = generarCanvasProgramaImpresion(n, 3);
    if (!canvas) return null;

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const imgData = canvas.toDataURL('image/png');
    const hueco = dimensionesHuecoPrograma(n);

    const aspect = canvas.width / canvas.height;
    let drawW = hueco.w;
    let drawH = drawW / aspect;
    if (drawH > hueco.h) { drawH = hueco.h; drawW = drawH * aspect; }
    const drawX = (A4_PDF.pageW - drawW) / 2;

    for (let i = 0; i < n; i++) {
        const slotTop = A4_PDF.margenArriba + i * (hueco.h + A4_PDF.separacion);
        const drawY = slotTop + (hueco.h - drawH) / 2;
        doc.addImage(imgData, 'PNG', drawX, drawY, drawW, drawH, undefined, 'FAST');
        if (i < n - 1) {
            const cutY = slotTop + hueco.h + A4_PDF.separacion / 2;
            doc.setDrawColor(160, 160, 160);
            doc.setLineWidth(0.25);
            doc.setLineDashPattern([2, 2], 0);
            doc.line(A4_PDF.margenLado, cutY, A4_PDF.pageW - A4_PDF.margenLado, cutY);
            doc.setLineDashPattern([], 0);
        }
    }
    return doc;
}

async function descargarPDFProgramaA4() {
    if (programaFilas.length === 0) {
        Swal.fire('Programa vacío', 'Primero agrega al menos una fila al programa.', 'warning');
        return;
    }
    try {
        const doc = construirPDFProgramaA4Doc();
        if (!doc) return;
        const n = porHojaPrograma();
        const { rangoTexto } = obtenerInfoCabeceraPrograma();
        const safeName = rangoTexto.replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ_-]+/g, '_');
        const nombre = `Programa_Servicio_${safeName}_A4_${n}en_hoja.pdf`;
        if (esMovil()) await entregarArchivo(doc.output('blob'), nombre, `Programa listo (${n} por hoja)`);
        else { doc.save(nombre); Toast.fire({ icon: 'success', title: `PDF A4 (${n} programas por hoja) descargado` }); }
    } catch (e) {
        console.error(e);
        Swal.fire('Error', 'No se pudo generar el PDF en formato A4.', 'error');
    }
}

function imprimirProgramaA4() {
    if (programaFilas.length === 0) {
        Swal.fire('Programa vacío', 'Primero agrega al menos una fila al programa.', 'warning');
        return;
    }
    const n = porHojaPrograma();
    const canvas = generarCanvasProgramaImpresion(n, 3);
    if (!canvas) return;
    const imgData = canvas.toDataURL('image/png');
    const { rangoTexto } = obtenerInfoCabeceraPrograma();
    const tituloVentana = `Programa A4 (${n} por hoja) - ${esc(rangoTexto)}`;

    const win = window.open('', '_blank');
    if (!win) {
        Swal.fire('Ventana bloqueada', 'Permite las ventanas emergentes en el navegador para abrir la vista de impresión.', 'warning');
        return;
    }

    const slots = Array.from({ length: n }, (_, i) => `<div class="prog-slot"><img src="${imgData}" alt="Programa ${i + 1}"></div>`).join('\n        <div class="cut-line"></div>\n        ');

    win.document.write(`<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>${tituloVentana}</title>
    <style>
        @page { size: A4 portrait; margin: 5mm 7mm; }
        * { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        body { background: #e4e4e7; font-family: Arial, Helvetica, sans-serif; display: flex; flex-direction: column; align-items: center; padding: 58px 12px 24px; }
        .print-toolbar { position: fixed; top: 0; left: 0; right: 0; height: 48px; background: #18181b; color: #ffffff; display: flex; align-items: center; justify-content: space-between; padding: 0 20px; z-index: 100; box-shadow: 0 2px 10px rgba(0,0,0,0.25); }
        .print-toolbar-title { font-size: 14px; font-weight: 700; }
        .print-toolbar-actions { display: flex; gap: 8px; }
        .print-btn { background: #ffffff; color: #18181b; border: none; border-radius: 6px; padding: 7px 14px; font-size: 13px; font-weight: 700; cursor: pointer; }
        .print-btn-close { background: #27272a; color: #e4e4e7; border: 1px solid #3f3f46; }
        .a4-sheet { width: 210mm; height: 286mm; background: #ffffff; padding: 4mm 6mm; box-shadow: 0 8px 28px rgba(0,0,0,0.18); display: flex; flex-direction: column; justify-content: space-between; align-items: center; }
        .prog-slot { width: 100%; flex: 1 1 0; min-height: 0; display: flex; align-items: center; justify-content: center; overflow: hidden; }
        .prog-slot img { max-width: 100%; max-height: 100%; width: auto; height: auto; object-fit: contain; display: block; }
        .cut-line { width: 100%; border-top: 1px dashed #a1a1aa; height: 0; margin: 1.5mm 0; flex: 0 0 auto; }
        @media print {
            body { background: #ffffff; padding: 0; }
            .print-toolbar { display: none !important; }
            .a4-sheet { width: 100%; height: 286mm; padding: 0; box-shadow: none; }
        }
    </style>
</head>
<body>
    <div class="print-toolbar">
        <div class="print-toolbar-title">Hoja A4 · ${n} Programas del Servicio del Campo (${esc(rangoTexto)})</div>
        <div class="print-toolbar-actions">
            <button class="print-btn" onclick="if(window.opener && window.opener.descargarPDFProgramaA4){ window.opener.descargarPDFProgramaA4(); }" style="background:#dc2626; color:#fff;">📄 Descargar PDF A4</button>
            <button class="print-btn" onclick="window.print()">🖨️ Imprimir Hoja A4</button>
            <button class="print-btn print-btn-close" onclick="window.close()">Cerrar</button>
        </div>
    </div>
    <div class="a4-sheet">
        ${slots}
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

/* ---------- Texto y WhatsApp ---------- */
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
