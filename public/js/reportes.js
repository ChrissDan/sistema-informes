// Reportes: búsqueda, PDF, precursores y cursos
// (script clásico: comparte el ámbito global con el resto de archivos; el orden de carga está en dashboard.html)
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
        tbody.innerHTML += `<tr><td>${r.mes}</td><td>${r.grupo}</td><td>${esc(r.nombre_publicador || r.publicador_nombre)}</td><td><span class="badge badge-gray">${esc(r.priv3)}</span></td><td>${r.horas}</td><td>${r.cursos}</td><td>${r.credito_hrs || '-'}</td><td>${esc(r.predico)}</td><td>${esc(r.comentarios || '')}</td><td style="text-align: center;"><button type="button" class="btn-action" onclick="iniciarRellenadoTarjeta(${idPublicador})" title="Rellenar S-21" style="background: none; border: none; cursor: pointer;"><i class="fa-solid fa-file-signature" style="color: #059669; font-size: 1.2rem;"></i></button></td></tr>`;
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
            if (p === 'REG' || p === 'ESP' || p === 'MISIONERO') { stats.reg.cant++; stats.reg.horas += h; stats.reg.cursos += c; } else if (p.includes('AUX')) { stats.aux.cant++; stats.aux.horas += h; stats.aux.cursos += c; } else { stats.pub.cant++; stats.pub.cursos += c; }
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
            html += `<tr><td><span class="badge badge-gray">${p.grupo}</span></td><td style="font-weight:600; color:#334155;">${esc(p.nombre)}</td><td>${mesesHtml}</td><td style="text-align:right; font-weight:800; color:var(--primary); font-size:1.1em;">${p.total}</td></tr>`;
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
        modalBody.innerHTML = `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; flex-wrap:wrap; gap:10px;"><div style="display:flex; gap:15px;"><span style="background:#eff6ff; color:#1d4ed8; padding:5px 10px; border-radius:6px; font-weight:bold; font-size:0.9rem;">Conducen: ${data.totales.conducen}</span><span style="background:#fff7ed; color:#c2410c; padding:5px 10px; border-radius:6px; font-weight:bold; font-size:0.9rem;">Sin Cursos: ${data.totales.no_conducen}</span></div><button class="btn-cancel" onclick="generarPDFCursos()" style="background:#475569; color:white; width:auto; padding:8px 16px; font-size:0.85rem;"><i class="fa-solid fa-file-pdf"></i> Descargar PDF</button></div><div style="max-height:60vh; overflow-y:auto; padding-right:5px;"><h4 style="color:#1d4ed8; border-bottom:2px solid #bfdbfe; padding-bottom:5px; margin-bottom:10px;">1. Publicadores que conducen cursos</h4><table style="width:100%; border-collapse:collapse; font-size:0.85rem; margin-bottom:20px;"><thead><tr style="background:#f1f5f9; text-align:left;"><th style="padding:8px; border-bottom:1px solid #cbd5e1; width:50px;">Grp</th><th style="padding:8px; border-bottom:1px solid #cbd5e1;">Nombre</th><th style="padding:8px; border-bottom:1px solid #cbd5e1;">Meses</th></tr></thead><tbody>${data.conducen.length === 0 ? '<tr><td colspan="3" style="padding:8px; text-align:center; color:#64748b;">No hay publicadores</td></tr>' : ''}${data.conducen.map(p => `<tr style="border-bottom:1px solid #e2e8f0;"><td style="padding:8px;"><b>${p.grupo}</b></td><td style="padding:8px; font-weight:600; color:#334155;">${esc(p.nombre)}</td><td style="padding:8px; color:#64748b;">${esc(p.meses)}</td></tr>`).join('')}</tbody></table><h4 style="color:#c2410c; border-bottom:2px solid #fed7aa; padding-bottom:5px; margin-bottom:10px;">2. Publicadores sin cursos</h4><table style="width:100%; border-collapse:collapse; font-size:0.85rem;"><thead><tr style="background:#f1f5f9; text-align:left;"><th style="padding:8px; border-bottom:1px solid #cbd5e1; width:50px;">Grp</th><th style="padding:8px; border-bottom:1px solid #cbd5e1;">Nombre</th></tr></thead><tbody>${data.no_conducen.length === 0 ? '<tr><td colspan="2" style="padding:8px; text-align:center; color:#64748b;">No hay publicadores</td></tr>' : ''}${data.no_conducen.map(p => `<tr style="border-bottom:1px solid #e2e8f0;"><td style="padding:8px;"><b>${p.grupo}</b></td><td style="padding:8px; font-weight:600; color:#334155;">${esc(p.nombre)}</td></tr>`).join('')}</tbody></table></div>`;
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

async function iniciarRellenadoTarjeta(id) {
    publicadorIdSeleccionado = id;
    ejecutarProcesoModificacion(); // la plantilla S-21 en blanco se carga sola desde /plantillas/S-21.pdf
}

async function ejecutarProcesoModificacion() {
    if (!publicadorIdSeleccionado) return;
    Swal.fire({ title: 'Generando PDF...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    
    try {
        // 1. Pedimos los datos al servidor
        const res = await fetch(`/api/publicador/${publicadorIdSeleccionado}/tarjeta?anio_servicio=${getAnio()}`); 
        const data = await res.json(); 
        
        // 2. Cargamos la plantilla S-21 en blanco incluida en el proyecto
        const plantillaBuffer = await obtenerPlantillaS21();
        
        // 3. Llenamos usando la función maestra actualizada
        const pdfBytes = await rellenarPlantillaPersonalizada(plantillaBuffer, data, data.publicador); 
        
        // 4. Descarga segura mediante Blob (Crea un archivo nuevo)
        const blob = new Blob([pdfBytes], { type: "application/pdf" });
        const nombreSeguro = (data.publicador.nombre || "S21").replace(/[^a-zA-Z0-9]/g, '_');
        Swal.close();
        await entregarArchivo(blob, `S21_${nombreSeguro}_${getAnio()}.pdf`, 'Tarjeta S-21 lista');
        if (!esMovil()) Toast.fire({ icon: 'success', title: 'Tarjeta Descargada' });
        
    } catch (error) { 
        console.error(error);
        Swal.fire('Error', 'No se pudo generar el PDF.', 'error'); 
    }
}


