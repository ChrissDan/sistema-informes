// Importar avances de territorio desde el chat de WhatsApp (solo super admin).
// El chat se lee en el navegador (whatsapp-parser.js); al servidor solo viajan los avances ya revisados.
let waFilas = [];
const WA_LS_AUTORES = 'wa_autor_conductor';
const WA_LS_DESDE = 'wa_importar_desde';

function waLS(clave, valor) {
    try {
        if (valor === undefined) return JSON.parse(localStorage.getItem(clave) || 'null');
        localStorage.setItem(clave, JSON.stringify(valor));
    } catch (e) { /* sin almacenamiento: se ignora */ }
    return null;
}

function abrirImportarWA() {
    abrirModal('importarWA');
    const modalBox = document.getElementById('mainModal')?.querySelector('.modal-box');
    if (modalBox) modalBox.classList.add('modal-wide');
    const d = document.getElementById('waDesde');
    if (d && !d.value) d.value = waLS(WA_LS_DESDE) || '';
    if (typeof cacheConductores === 'undefined' || !cacheConductores.length) { try { cargarConductoresData(); } catch (e) { /* se recarga al analizar */ } }
}

async function waLeerArchivo(file) {
    if (/\.zip$/i.test(file.name) || file.type === 'application/zip') {
        if (typeof JSZip === 'undefined') throw new Error('No se pudo leer el ZIP. Sube el archivo .txt que está dentro.');
        const zip = await JSZip.loadAsync(await file.arrayBuffer());
        const txt = Object.values(zip.files).find(f => !f.dir && /\.txt$/i.test(f.name));
        if (!txt) throw new Error('El ZIP no contiene un archivo .txt de chat.');
        return txt.async('string');
    }
    return file.text();
}

async function waAnalizarEntrada() {
    const out = document.getElementById('waResultado');
    const btn = document.getElementById('btnWaAnalizar');
    const desde = document.getElementById('waDesde').value;
    if (!desde) { Swal.fire('Falta la fecha', 'Indica desde qué fecha importar. Si el mapa de territorios cambió, los avisos anteriores no corresponden a los números actuales.', 'info'); return; }
    waLS(WA_LS_DESDE, desde);
    try {
        btn.disabled = true;
        const file = document.getElementById('waArchivo').files[0];
        const texto = file ? await waLeerArchivo(file) : document.getElementById('waTexto').value;
        if (!texto.trim()) { Swal.fire('Sin chat', 'Sube el archivo del chat o pega el texto.', 'info'); return; }
        const esJson = (file && /\.json$/i.test(file.name)) || /^\s*\[\s*\{/.test(texto);
        const avances = esJson ? waAvancesDeJson(texto, desde) : waAnalizarChat(texto, desde);
        if (avances.length === 0) { out.style.display = 'block'; out.innerHTML = '<p style="padding:12px;">No se encontraron avisos de avance de territorio desde esa fecha.</p>'; waFilas = []; return; }
        if (typeof cacheConductores === 'undefined' || !cacheConductores.length) await cargarConductoresData();
        waFilas = avances.map((a, i) => ({ ...a, i, sel: true, estado: null }));
        waDibujar();
    } catch (e) {
        Swal.fire('No se pudo leer', e.message || String(e), 'error');
    } finally { btn.disabled = false; }
}

// Archivo de avances ya extraído y revisado (lista de {origen, fecha, autor, territorio, hechas, faltan, cierre, texto})
function waAvancesDeJson(texto, desde) {
    let lista;
    try { lista = JSON.parse(texto); } catch (e) { throw new Error('El archivo de avances no es un JSON válido.'); }
    if (!Array.isArray(lista)) throw new Error('El archivo de avances debe ser una lista.');
    const nums = (v) => (Array.isArray(v) && v.length ? v.map(Number).filter(n => n >= 1) : null);
    return lista.filter(x => x && /^\d{4}-\d{2}-\d{2}$/.test(String(x.fecha)) && x.territorio && (!desde || x.fecha >= desde))
        .map(x => ({
            origen: String(x.origen || ('json:' + x.fecha + ':' + x.territorio)).slice(0, 80),
            fecha: x.fecha, autor: String(x.autor || ''), territorio: String(x.territorio),
            hechas: nums(x.hechas), faltan: nums(x.faltan), cierre: Boolean(x.cierre), texto: String(x.texto || '').slice(0, 220)
        }));
}

function waCondPorAutor(autor) {
    const mapa = waLS(WA_LS_AUTORES) || {};
    if (mapa[autor] !== undefined) return mapa[autor];
    const limpia = (s) => normalizarTexto(String(s).replace(/\b(hnos?|hnas?|fam)\b\.?/gi, '')).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    const a = limpia(autor);
    const c = a && (cacheConductores || []).find(x => limpia(x.nombre) === a);
    return c ? String(c.id) : '';
}

function waDibujar() {
    const out = document.getElementById('waResultado');
    const autores = [...new Set(waFilas.map(f => f.autor))].sort();
    const opcionesCond = (sel) => '<option value="">— sin conductor —</option>' + (cacheConductores || []).filter(c => c.activo !== 0)
        .map(c => `<option value="${c.id}" ${String(c.id) === String(sel) ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('');
    const panelAutores = autores.map(a => `<label style="display:flex; gap:8px; align-items:center; margin:4px 0; font-size:0.8rem;">
        <span style="min-width:150px;">${esc(a)}</span>
        <select data-autor="${esc(a)}" onchange="waCambiarAutor(this)" style="flex:1; padding:4px;">${opcionesCond(waCondPorAutor(a))}</select></label>`).join('');
    const filas = waFilas.map(f => {
        const cond = waCondPorAutor(f.autor);
        return `<tr data-i="${f.i}">
            <td><input type="checkbox" ${f.sel ? 'checked' : ''} onchange="waFilas[${f.i}].sel=this.checked"></td>
            <td><input type="date" value="${esc(f.fecha)}" onchange="waFilas[${f.i}].fecha=this.value" style="width:132px;"></td>
            <td><input type="text" inputmode="numeric" value="${esc(f.territorio)}" onchange="waFilas[${f.i}].territorio=this.value.trim()" style="width:46px;"></td>
            <td><input type="text" value="${esc((f.hechas || []).join(', '))}" placeholder="hechas" onchange="waFilas[${f.i}].hechas=waListaManzanas(this.value)" style="width:100px;"></td>
            <td><input type="text" value="${esc((f.faltan || []).join(', '))}" placeholder="faltan" onchange="waFilas[${f.i}].faltan=waListaManzanas(this.value)" style="width:80px;"></td>
            <td style="text-align:center;"><input type="checkbox" ${f.cierre ? 'checked' : ''} onchange="waFilas[${f.i}].cierre=this.checked"></td>
            <td style="font-size:0.75rem;">${esc(f.autor)}</td>
            <td class="wa-estado" style="font-size:0.75rem; min-width:120px;">${waEstadoHtml(f)}</td>
        </tr><tr><td></td><td colspan="7" style="font-size:0.72rem; color:#8f8f8f; padding-top:0;">${esc(f.texto)}</td></tr>`;
    }).join('');
    out.style.display = 'block';
    out.innerHTML = `
        <div class="form-section-title" style="margin-top:8px;">${waFilas.length} avisos encontrados</div>
        <p style="font-size:0.8rem; margin:4px 0;">Elige el conductor de cada hermano (se recuerda para la próxima vez). Revisa y corrige: <b>hechas</b> = manzanas completadas; <b>faltan</b> = lo que no se alcanzó (se registra el resto). Un aviso sin manzanas ni cierre no se puede guardar.</p>
        <div style="margin:8px 0;">${panelAutores}</div>
        <div class="table-container" style="max-height:46vh; overflow:auto;">
            <table><thead><tr><th></th><th>Fecha</th><th>Terr.</th><th>Hechas</th><th>Faltan</th><th>Cierre</th><th>Autor</th><th>Estado</th></tr></thead>
            <tbody>${filas}</tbody></table>
        </div>
        <div class="form-submit-row" style="margin-top:12px; display:flex; gap:8px; flex-wrap:wrap;">
            <button type="button" class="btn-cancel" onclick="waEnviar(true)"><i class="fa-solid fa-vial"></i> Simular (no guarda)</button>
            <button type="button" class="btn-primary" onclick="waEnviar(false)"><i class="fa-solid fa-floppy-disk"></i> Guardar seleccionados</button>
        </div>`;
}

function waEstadoHtml(f) {
    if (!f.estado) return '';
    const r = f.estado;
    if (r.ok) return `<span style="color:#0a7d33;">✔ ${esc(r.estado)} · mz ${esc(r.manzanas.join(', '))}</span>`;
    return `<span style="color:${r.duplicado ? '#8f8f8f' : '#c0392b'};">${r.duplicado ? '↺ ' : '✖ '}${esc(r.msg)}</span>`;
}

function waCambiarAutor(sel) {
    const mapa = waLS(WA_LS_AUTORES) || {};
    mapa[sel.dataset.autor] = sel.value;
    waLS(WA_LS_AUTORES, mapa);
}

async function waEnviar(simular) {
    const elegidas = waFilas.filter(f => f.sel && !(f.estado && (f.estado.duplicado || (!simular && f.estado.guardado))));
    if (elegidas.length === 0) { Swal.fire('Nada que enviar', 'Marca al menos un aviso.', 'info'); return; }
    if (!simular) {
        const c = await Swal.fire({ title: `¿Guardar ${elegidas.length} avances en la bitácora?`, text: 'Se aplican en orden de fecha. Los que tengan error se omiten y puedes corregirlos.', icon: 'question', showCancelButton: true, confirmButtonText: 'Guardar', cancelButtonText: 'Cancelar' });
        if (!c.isConfirmed) return;
    }
    const registros = elegidas.map(f => {
        const cid = waCondPorAutor(f.autor);
        const cond = (cacheConductores || []).find(x => String(x.id) === String(cid));
        return {
            origen: f.origen, fecha_registro: f.fecha, territorio: f.territorio,
            manzanas: f.hechas || [], faltan: f.faltan || [], cierre: Boolean(f.cierre),
            conductor_id: cond ? cond.id : null, conductor_nombre: cond ? cond.nombre : ''
        };
    });
    try {
        const res = await fetch('/api/territorios/bitacora/lote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registros, dry_run: simular }) });
        const json = await res.json();
        if (!res.ok || !json.ok) { Swal.fire('Error', json.msg || 'No se pudo importar', 'error'); return; }
        elegidas.forEach((f, k) => { f.estado = { ...json.resultados[k], guardado: !simular && json.resultados[k].ok }; if (!simular && json.resultados[k].ok) f.sel = false; });
        waDibujar();
        if (!simular) {
            Toast.fire({ icon: json.guardados ? 'success' : 'info', title: `${json.guardados} avances guardados` });
            if (json.guardados && typeof cargarVistaTerritorios === 'function') cargarVistaTerritorios();
        } else {
            const ok = json.resultados.filter(r => r.ok).length;
            Toast.fire({ icon: 'info', title: `Simulación: ${ok} se guardarían, ${json.resultados.length - ok} con observaciones` });
        }
    } catch (e) { Swal.fire('Error', 'No se pudo conectar con el servidor.', 'error'); }
}
