// Gráficas del dashboard y reporte anual de asistencia en PDF
// (script clásico: comparte el ámbito global con el resto de archivos; el orden de carga está en dashboard.html)
let chartCursosInstance = null;
async function cargarGraficaCursos() {
    const ctx = document.getElementById('graficaCursos'); if (!ctx) return; const grp = isGlobal ? 0 : session.grupo;
    try {
        if (chartCursosInstance) chartCursosInstance.destroy();
        const res = await fetch(`/api/dashboard/cursos-por-mes?grupo=${grp}&anio_servicio=${getAnio()}`);
        const data = await res.json();
        const ORDEN_AÑO = ['SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE', 'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO'];
        const datosPorMes = {}; ORDEN_AÑO.forEach(m => datosPorMes[m] = { pub: 0, aux: 0, reg: 0, hasData: false });
        data.forEach(r => { const m = (r.mes || '').toUpperCase().trim(); if (datosPorMes[m]) { datosPorMes[m].hasData = true; datosPorMes[m].pub = parseInt(r.pub) || 0; datosPorMes[m].aux = parseInt(r.aux) || 0; datosPorMes[m].reg = parseInt(r.reg) || 0; } });
        const labelsMeses = []; const dataPub = []; const dataAux = []; const dataReg = [];
        ORDEN_AÑO.forEach(m => { if (datosPorMes[m].hasData) { labelsMeses.push(m.substring(0, 3)); dataPub.push(datosPorMes[m].pub); dataAux.push(datosPorMes[m].aux); dataReg.push(datosPorMes[m].reg); } });
        if (labelsMeses.length === 0) { labelsMeses.push("Sin Datos"); dataPub.push(0); dataAux.push(0); dataReg.push(0); }
        chartCursosInstance = new Chart(ctx, { type: 'bar', data: { labels: labelsMeses, datasets: [{ label: 'PUB+PNB', data: dataPub, backgroundColor: '#3b82f6', borderRadius: 4 }, { label: 'AUX I+M+C', data: dataAux, backgroundColor: '#8b5cf6', borderRadius: 4 }, { label: 'REGULARES', data: dataReg, backgroundColor: '#10b981', borderRadius: 4 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: true, position: 'bottom' }, tooltip: { mode: 'index', intersect: false, callbacks: { footer: function (ti) { let t = 0; ti.forEach(function (i) { t += i.raw; }); return '\nTotal: ' + t; } } } }, scales: { y: { beginAtZero: true, grid: { borderDash: [5, 5], color: isDarkTheme() ? '#242424' : '#e2e8f0' } }, x: { grid: { display: false } } } } });
    } catch (e) {}
}

let chartComparativaInstance = null;
async function cargarGraficaComparativa() {
    const ctx = document.getElementById('graficaComparativa'); if (!ctx) return; const grp = isGlobal ? 0 : session.grupo;
    try {
        if (chartComparativaInstance) chartComparativaInstance.destroy();
        const res = await fetch(`/api/dashboard/cursos-comparativa?grupo=${grp}&anio_servicio=${getAnio()}`); // AÑO AÑADIDO
        const data = await res.json();
        const ORDEN_AÑO = ['SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE', 'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO'];
        const datosPorMes = {}; ORDEN_AÑO.forEach(m => datosPorMes[m] = { con: 0, sin: 0, hasData: false });
        data.forEach(r => { const m = (r.mes || '').toUpperCase().trim(); if (datosPorMes[m]) { datosPorMes[m].hasData = true; datosPorMes[m].con = parseInt(r.con_cursos) || 0; datosPorMes[m].sin = parseInt(r.sin_cursos) || 0; } });
        const labelsMeses = []; const dataConCursos = []; const dataSinCursos = [];
        ORDEN_AÑO.forEach(m => { if (datosPorMes[m].hasData) { labelsMeses.push(m.substring(0, 3)); dataConCursos.push(datosPorMes[m].con); dataSinCursos.push(datosPorMes[m].sin); } });
        if (labelsMeses.length === 0) { labelsMeses.push("Sin Datos"); dataConCursos.push(0); dataSinCursos.push(0); }
        chartComparativaInstance = new Chart(ctx, { type: 'line', data: { labels: labelsMeses, datasets: [{ label: 'INFORMAN CURSOS', data: dataConCursos, borderColor: '#3b82f6', backgroundColor: '#3b82f6', tension: 0.3, pointRadius: 5, borderWidth: 3 }, { label: 'NO INFORMAN CURSOS', data: dataSinCursos, borderColor: '#f97316', backgroundColor: '#f97316', tension: 0.3, pointRadius: 5, borderWidth: 3 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: true, position: 'bottom' }, tooltip: { mode: 'index', intersect: false, callbacks: { label: function (context) { let v = context.raw; let t = 0; context.chart.data.datasets.forEach(d => { t += d.data[context.dataIndex]; }); let p = t > 0 ? Math.round((v / t) * 100) : 0; return ` ${context.dataset.label}: ${v} (${p}%)`; } } } }, scales: { y: { beginAtZero: true, grid: { borderDash: [5, 5], color: isDarkTheme() ? '#242424' : '#e2e8f0' } }, x: { grid: { display: false } } } } });
    } catch (e) {}
}

let chartAsistenciaInstance = null;
async function cargarGraficaAsistencia() {
    const ctx = document.getElementById('graficaAsistencia'); if (!ctx) return;
    try {
        if (chartAsistenciaInstance) chartAsistenciaInstance.destroy();
        const res = await fetch(`/api/dashboard/asistencia-comparativa?anio_servicio=${getAnio()}`); // AÑO AÑADIDO
        const data = await res.json();
        const ORDEN_AÑO = ['SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE', 'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO'];
        const labelsMeses = []; const dataPresencial = []; const dataZoom = [];
        ORDEN_AÑO.forEach(m => { let mesAbrev = m.substring(0, 3); if (mesAbrev === 'SEP') mesAbrev = 'SET'; labelsMeses.push([mesAbrev, 'ES']); labelsMeses.push([mesAbrev, 'FS']); });
        for(let i = 0; i < 24; i++) { dataPresencial.push(0); dataZoom.push(0); }
        data.forEach(r => {
            const m = (r.mes || '').toUpperCase().trim(); const mesIndex = ORDEN_AÑO.indexOf(m);
            if (mesIndex !== -1) {
                const finalIndex = (mesIndex * 2) + (r.tipo === 'ENTRE SEMANA' ? 0 : 1);
                if (r.modalidad === 'PRESENCIAL') dataPresencial[finalIndex] = r.promedio; else if (r.modalidad === 'ZOOM') dataZoom[finalIndex] = r.promedio;
            }
        });
        let lastDataIndex = 23; while(lastDataIndex >= 0 && dataPresencial[lastDataIndex] === 0 && dataZoom[lastDataIndex] === 0) { lastDataIndex--; }
        let finalLabels = labelsMeses.slice(0, lastDataIndex + 1); let finalPres = dataPresencial.slice(0, lastDataIndex + 1); let finalZoom = dataZoom.slice(0, lastDataIndex + 1);
        if (finalLabels.length === 0) { finalLabels = [['Sin', 'Datos']]; finalPres = [0]; finalZoom = [0]; }
        chartAsistenciaInstance = new Chart(ctx, { type: 'bar', data: { labels: finalLabels, datasets: [{ label: 'PRESENCIAL', data: finalPres, backgroundColor: '#4472c4' }, { label: 'ZOOM', data: finalZoom, backgroundColor: '#ed7d31' }] }, options: { responsive: true, maintainAspectRatio: false, scales: { x: { stacked: true, grid: { display: false }, ticks: { font: { size: 10, weight: 'bold' }, color: isDarkTheme() ? '#a1a1a1' : '#64748b' } }, y: { stacked: true, beginAtZero: true, grid: { color: isDarkTheme() ? '#242424' : '#e2e8f0' } } }, plugins: { legend: { display: true, position: 'bottom', labels: { usePointStyle: true, boxWidth: 10 } }, tooltip: { mode: 'index', intersect: false, callbacks: { footer: function(ti) { let t = 0; ti.forEach(function(i) { t += i.raw; }); return '\nTotal: ' + t; } } } } } });
    } catch (e) {}
}

// --- REPORTE ANUAL DE ASISTENCIA EN PDF (TODOS LOS REGISTROS) ---
async function descargarReporteAsistencia() {
    const anio = getAnio();
    Swal.fire({ title: 'Generando Reporte...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

    try {
        const res = await fetch(`/api/reuniones?anio_servicio=${anio}`);
        const reuniones = await res.json();

        if (reuniones.length === 0) {
            Swal.fire('Vacío', 'No hay datos de reuniones registrados para este año.', 'info');
            return;
        }

        // 1. Calcular las matemáticas para los promedios anuales
        let semanasEntre = 0; let semanasFin = 0;
        let totalEntrePres = 0; let totalEntreZoom = 0;
        let totalFinPres = 0; let totalFinZoom = 0;

        let mesesMap = {};
        reuniones.forEach(r => {
            const key = `${r.mes}-${r.tipo}`;
            if (!mesesMap[key]) mesesMap[key] = { semanas: 0 };
            
            const s1 = parseInt(r.sem1) || 0; const s2 = parseInt(r.sem2) || 0; 
            const s3 = parseInt(r.sem3) || 0; const s4 = parseInt(r.sem4) || 0; 
            const s5 = parseInt(r.sem5) || 0;
            const suma = s1 + s2 + s3 + s4 + s5;
            
            let weeks = 0;
            if (s1 > 0) weeks++; if (s2 > 0) weeks++; if (s3 > 0) weeks++; 
            if (s4 > 0) weeks++; if (s5 > 0) weeks++;
            
            if (weeks > mesesMap[key].semanas) mesesMap[key].semanas = weeks;

            if (r.tipo === 'ENTRE SEMANA') {
                if (r.modalidad === 'PRESENCIAL') totalEntrePres += suma;
                if (r.modalidad === 'ZOOM') totalEntreZoom += suma;
            } else {
                if (r.modalidad === 'PRESENCIAL') totalFinPres += suma;
                if (r.modalidad === 'ZOOM') totalFinZoom += suma;
            }
        });

        // Sumamos las semanas reales que tuvo el año por cada tipo de reunión
        Object.keys(mesesMap).forEach(key => {
            if (key.includes('ENTRE SEMANA')) semanasEntre += mesesMap[key].semanas;
            if (key.includes('FIN DE SEMANA')) semanasFin += mesesMap[key].semanas;
        });

        // Promedios Desglosados
        const promEntrePres = semanasEntre > 0 ? Math.round(totalEntrePres / semanasEntre) : 0;
        const promEntreZoom = semanasEntre > 0 ? Math.round(totalEntreZoom / semanasEntre) : 0;
        const promEntreTot = promEntrePres + promEntreZoom;

        const promFinPres = semanasFin > 0 ? Math.round(totalFinPres / semanasFin) : 0;
        const promFinZoom = semanasFin > 0 ? Math.round(totalFinZoom / semanasFin) : 0;
        const promFinTot = promFinPres + promFinZoom;

        // Promedio Global Anual (La media de ambas reuniones)
        const promGlobalPres = Math.round((promEntrePres + promFinPres) / 2);
        const promGlobalZoom = Math.round((promEntreZoom + promFinZoom) / 2);
        const promGlobalTot = promGlobalPres + promGlobalZoom;

        // 2. Construir la Tabla de Todos los Registros
        const tablaRegistros = [];
        const ORDEN_MESES = ['SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE', 'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO'];
        
        reuniones.sort((a, b) => {
            const mA = ORDEN_MESES.indexOf(a.mes.toUpperCase());
            const mB = ORDEN_MESES.indexOf(b.mes.toUpperCase());
            if (mA !== mB) return mA - mB;
            if (a.tipo !== b.tipo) return a.tipo.localeCompare(b.tipo);
            return a.modalidad.localeCompare(b.modalidad);
        });

        reuniones.forEach(r => {
            const s1 = parseInt(r.sem1) || 0; const s2 = parseInt(r.sem2) || 0; 
            const s3 = parseInt(r.sem3) || 0; const s4 = parseInt(r.sem4) || 0; 
            const s5 = parseInt(r.sem5) || 0;
            const suma = s1 + s2 + s3 + s4 + s5;
            
            let weeks = 0;
            if (s1 > 0) weeks++; if (s2 > 0) weeks++; if (s3 > 0) weeks++; 
            if (s4 > 0) weeks++; if (s5 > 0) weeks++;
            
            const prom = weeks > 0 ? Math.round(suma / weeks) : 0;
            
            tablaRegistros.push([
                r.mes, 
                r.tipo === 'ENTRE SEMANA' ? 'Entre Sem' : 'Fin Sem', 
                r.modalidad === 'PRESENCIAL' ? 'Pres' : 'Zoom', 
                s1 || '-', s2 || '-', s3 || '-', s4 || '-', s5 || '-', 
                prom
            ]);
        });

        // 3. Dibujar el PDF
        const { jsPDF } = window.jspdf; 
        const doc = new jsPDF();
        
        let y = 15;
        doc.setFontSize(14); doc.setFont("helvetica", "bold"); 
        doc.text("REGISTROS DE ASISTENCIA A LAS REUNIONES", 105, y, null, null, "center"); y += 6;
        
        doc.setFontSize(10); doc.setFont("helvetica", "normal"); 
        doc.text(`Año de Servicio: ${anio} | Generado: ${new Date().toLocaleDateString()}`, 105, y, null, null, "center"); y += 10;

        // --- SECCIÓN ARRIBA: PROMEDIO ANUAL GLOBAL ---
        doc.setFillColor(238, 242, 255); 
        doc.rect(14, y, 182, 20, 'F');
        
        doc.setFontSize(10); doc.setFont("helvetica", "bold"); doc.setTextColor(67, 56, 202);
        doc.text("PROMEDIO ANUAL GLOBAL", 105, y + 6, null, null, "center");
        
        doc.setFontSize(10); doc.setTextColor(30, 41, 59);
        doc.text(`Presencial: ${promGlobalPres}   |   Zoom: ${promGlobalZoom}   |   Total: ${promGlobalTot}`, 105, y + 14, null, null, "center");
        y += 24;

        // --- SECCIÓN ABAJO: DESGLOSE POR TIPO DE REUNIÓN ---
        doc.setFillColor(241, 245, 249); 
        doc.rect(14, y, 88, 22, 'F');
        doc.rect(108, y, 88, 22, 'F');
        
        doc.setFontSize(10); doc.setFont("helvetica", "bold"); doc.setTextColor(37, 99, 235);
        doc.text("ENTRE SEMANA", 58, y + 6, null, null, "center");
        doc.text("FIN DE SEMANA", 152, y + 6, null, null, "center");
        
        doc.setFontSize(9); doc.setTextColor(71, 85, 105); doc.setFont("helvetica", "normal");
        doc.text(`Presencial: ${promEntrePres}   |   Zoom: ${promEntreZoom}`, 58, y + 13, null, null, "center");
        doc.text(`Total: ${promEntreTot}`, 58, y + 18, null, null, "center");

        doc.text(`Presencial: ${promFinPres}   |   Zoom: ${promFinZoom}`, 152, y + 13, null, null, "center");
        doc.text(`Total: ${promFinTot}`, 152, y + 18, null, null, "center");
        
        y += 28;

        // --- TABLA DETALLADA: TODOS LOS REGISTROS ---
        doc.autoTable({ 
            startY: y, 
            head: [['Mes', 'Reunión', 'Modalidad', 'S1', 'S2', 'S3', 'S4', 'S5', 'Promedio']], 
            body: tablaRegistros, 
            theme: 'grid', 
            styles: { fontSize: 8, cellPadding: 2, halign: 'center', valign: 'middle' }, 
            headStyles: { fillColor: [71, 85, 105] },
            columnStyles: { 
                0: { halign: 'left', fontStyle: 'bold' },
                1: { halign: 'left' }
            }
        });

        doc.save(`Registros_Asistencia_${anio}.pdf`);
        Swal.close();

    } catch (error) {
        console.error(error);
        Swal.fire('Error', 'No se pudo generar el reporte.', 'error');
    }
}

document.addEventListener("DOMContentLoaded", () => {
    cargarGraficaCursos();
    cargarGraficaComparativa();
    cargarGraficaAsistencia();
});

