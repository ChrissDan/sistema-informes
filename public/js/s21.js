// Tarjetas S-21 (individual, ZIP masivo y totales de congregación)
// (script clásico: comparte el ámbito global con el resto de archivos; el orden de carga está en dashboard.html)
// --- PLANTILLA S-21 EN BLANCO (incluida en el proyecto: public/plantillas/S-21.pdf) ---
// Ya no hay que elegir el archivo cada vez. Para actualizar el formato, reemplaza ese PDF conservando los nombres de campos.
async function obtenerPlantillaS21() {
    const r = await fetch('/plantillas/S-21.pdf', { cache: 'no-cache' });
    if (!r.ok) throw new Error('No se pudo cargar la plantilla S-21 (' + r.status + ')');
    return await r.arrayBuffer();
}

// --- GENERACIÓN MASIVA DE TARJETAS S-21 EN ZIP ---
async function generarTarjetasMasivasZIP() {
    try {
        const plantillaBuffer = await obtenerPlantillaS21();

        Swal.fire({ 
            title: 'Generando Tarjetas...', 
            html: 'Procesando historial y organizando en carpetas.<br><b>No cierres esta ventana.</b>', 
            allowOutsideClick: false, 
            didOpen: () => Swal.showLoading() 
        });

        const zip = new JSZip(); 
        const anio = getAnio();

        // Una sola petición trae a todos los publicadores con sus informes del año (antes eran N peticiones, una por publicador)
        const resTarjetas = await fetch(`/api/tarjetas?anio_servicio=${anio}`);
        if (!resTarjetas.ok) throw new Error('No se pudieron obtener los datos de las tarjetas');
        const tarjetas = await resTarjetas.json();
        const nombresUsados = new Set();

        for (const item of tarjetas) {
            const pub = item.publicador; const dataHist = item;
            // activos e inactivos: los inactivos solo se incluyen si tienen informes en el año
            if (!pub.activo && item.informes.length === 0) continue;

            const pdfBytes = await rellenarPlantillaPersonalizada(plantillaBuffer, dataHist, pub);
            
            let nombreSeguro = (pub.nombre || 'SinNombre').replace(/[^a-zA-Z0-9]/g, '_');
            const nombreCarpeta = `Grupo ${pub.grupo}`; // subcarpeta por grupo
            if (nombresUsados.has(nombreCarpeta + '/' + nombreSeguro)) nombreSeguro += '_' + pub.id; // evita que dos publicadores con el mismo nombre se sobrescriban
            nombresUsados.add(nombreCarpeta + '/' + nombreSeguro);
            zip.folder(nombreCarpeta).file(`S21_${nombreSeguro}.pdf`, pdfBytes);
        }

        const contenidoZip = await zip.generateAsync({ type: 'blob' });
        Swal.close();
        const nombreZip = `Tarjetas_S21_${anio}.zip`;
        if (esMovil()) await entregarArchivo(contenidoZip, nombreZip, 'Tarjetas S-21 listas');
        else { descargarBlob(contenidoZip, nombreZip); Swal.fire('¡Éxito!', 'Las tarjetas han sido organizadas por grupos y descargadas.', 'success'); }

    } catch (error) {
        console.error(error);
        if (error.name !== 'AbortError') Swal.fire('Error', 'Hubo un problema en la generación masiva.', 'error');
    }
}

async function rellenarPlantillaPersonalizada(plantillaBuffer, dataHistorial, pub) {
    const { PDFDocument } = PDFLib; 
    const pdfDoc = await PDFDocument.load(plantillaBuffer); 
    const form = pdfDoc.getForm();

    const safeSetText = (field, text) => { try { const f = form.getTextField(field); if (f) f.setText(text ? text.toString() : ''); } catch (e) {} };
    const safeCheck = (field, condition) => { try { const f = form.getCheckBox(field); if (f && condition) f.check(); } catch (e) {} };

    // >>> NUEVO: Función auxiliar para invertir la fecha (De YYYY-MM-DD a DD-MM-YYYY) <<<
    const formatearFecha = (fechaIso) => {
        if (!fechaIso) return '';
        const soloFecha = fechaIso.split('T')[0]; // Toma la fecha limpia
        const partes = soloFecha.split('-'); // Corta en [YYYY, MM, DD]
        if (partes.length !== 3) return soloFecha;
        return `${partes[2]}-${partes[1]}-${partes[0]}`; // Lo arma al revés
    };

    // --- DATOS PERSONALES ---
    const nombreFinal = pub.nombre_completo || pub.nombre || '';
    safeSetText('900_1_Text_SanSerif', nombreFinal);
    
    // >>> ACTUALIZADO: Usamos la nueva función formatearFecha <<<
    safeSetText('900_2_Text_SanSerif', formatearFecha(pub.fecha_nacimiento));
    safeSetText('900_5_Text_SanSerif', formatearFecha(pub.fecha_bautismo));

    // Sexo y Esperanza
    if (pub.sexo === 'Hombre') safeCheck('900_3_CheckBox', true);
    if (pub.sexo === 'Mujer') safeCheck('900_4_CheckBox', true);
    if (pub.esperanza === 'Otras ovejas') safeCheck('900_6_CheckBox', true);
    if (pub.esperanza === 'Ungido') safeCheck('900_7_CheckBox', true);

    // Privilegios (Múltiples)
    const privsS21 = pub.privilegio_s21 || '';
    if (privsS21.includes('Anciano')) safeCheck('900_8_CheckBox', true);
    if (privsS21.includes('Siervo ministerial')) safeCheck('900_9_CheckBox', true);
    if (privsS21.includes('Precursor regular')) safeCheck('900_10_CheckBox', true);
    if (privsS21.includes('Precursor especial')) safeCheck('900_11_CheckBox', true);
    if (privsS21.includes('Misionero que sirve en el campo')) safeCheck('900_12_CheckBox', true);

    // Año de servicio
    safeSetText('900_13_Text_C_SanSerif', getAnio().toString());

    // --- INFORMES MENSUALES ---
    const mapaMeses = { 'septiembre': 20, 'octubre': 21, 'noviembre': 22, 'diciembre': 23, 'enero': 24, 'febrero': 25, 'marzo': 26, 'abril': 27, 'mayo': 28, 'junio': 29, 'julio': 30, 'agosto': 31 };
    let totalHoras = 0;

    if (dataHistorial && dataHistorial.informes) {
        dataHistorial.informes.forEach(inf => {
            const mesNombre = (inf.mes || '').toLowerCase().trim();
            const index = mapaMeses[mesNombre];
            if (index) {
                safeCheck(`901_${index}_CheckBox`, (inf.horas > 0 || inf.cursos > 0 || inf.predico === 'SI' || inf.predico === 1));
                if (inf.cursos > 0) safeSetText(`902_${index}_Text_C_SanSerif`, inf.cursos.toString());
                safeCheck(`903_${index}_CheckBox`, (inf.priv3 || '').toUpperCase().includes('AUX'));
                
                const cred = parseFloat(inf.credito_hrs) || 0;
                const hrs = parseFloat(inf.horas) || 0; // el crédito NO se suma: solo se anota en la columna de notas
                if (hrs > 0) { 
                    safeSetText(`904_${index}_S21_Value`, hrs.toString()); 
                    totalHoras += hrs; 
                }
                const nota = [inf.comentarios, cred > 0 ? `Incluye ${cred} h de crédito` : ''].filter(Boolean).join('. ');
                if (nota) safeSetText(`905_${index}_Text_SanSerif`, nota);
            }
        });
    }
    
    if (totalHoras > 0) safeSetText('904_32_S21_Value', totalHoras.toString());
    
    form.flatten(); 
    return await pdfDoc.save();
}

// --- GENERACIÓN DE REPORTES TOTALES DE CONGREGACIÓN (S-21) ---
async function descargarTotalesS21() {
    try {
        const plantillaBuffer = await obtenerPlantillaS21();

        Swal.fire({ title: 'Generando Totales...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

        const anio = getAnio();
        const res = await fetch(`/api/reportes/totales-s21?anio_servicio=${anio}`);
        const rawData = await res.json();

        // Estructura en blanco para los 12 meses
        const mesesEstructura = () => ({ SEPTIEMBRE: null, OCTUBRE: null, NOVIEMBRE: null, DICIEMBRE: null, ENERO: null, FEBRERO: null, MARZO: null, ABRIL: null, MAYO: null, JUNIO: null, JULIO: null, AGOSTO: null });
        
        let dataCong = mesesEstructura();
        let dataReg = mesesEstructura();
        let dataAux = mesesEstructura();
        let dataPub = mesesEstructura();

        // Agrupar los datos de la base de datos
        rawData.forEach(r => {
            const m = r.mes.toUpperCase().trim();
            if (!dataCong[m]) dataCong[m] = { cantidad: 0, horas: 0, cursos: 0 };
            
            // Sumar al total general de la congregación
            dataCong[m].cantidad += r.cantidad;
            dataCong[m].horas += parseFloat(r.total_horas) || 0;
            dataCong[m].cursos += parseInt(r.total_cursos) || 0;

            // Asignar al grupo específico
            if (r.categoria === 'REG') dataReg[m] = { cantidad: r.cantidad, horas: r.total_horas, cursos: r.total_cursos };
            if (r.categoria === 'AUX') dataAux[m] = { cantidad: r.cantidad, horas: r.total_horas, cursos: r.total_cursos };
            if (r.categoria === 'PUB') dataPub[m] = { cantidad: r.cantidad, horas: r.total_horas, cursos: r.total_cursos };
        });

        const zip = new JSZip();

        // 1. Tarjeta Congregación (Muestra Horas)
        zip.file(`S21_Totales_Congregacion_${anio}.pdf`, await rellenarTarjetaTotales(plantillaBuffer, dataCong, `Totales congregación Umachiri (${anio})`, 'Publicadores', true));
        
        // 2. Tarjeta Precursores Regulares (Muestra Horas)
        zip.file(`S21_Totales_Regulares_${anio}.pdf`, await rellenarTarjetaTotales(plantillaBuffer, dataReg, `Totales precursores regulares (${anio})`, 'precursores regulares', true));
        
        // 3. Tarjeta Precursores Auxiliares (Muestra Horas)
        zip.file(`S21_Totales_Auxiliares_${anio}.pdf`, await rellenarTarjetaTotales(plantillaBuffer, dataAux, `Totales precursores auxiliares (${anio})`, 'precursores auxiliares', true));
        
        // 4. Tarjeta Publicadores (NO Muestra Horas)
        zip.file(`S21_Totales_Publicadores_${anio}.pdf`, await rellenarTarjetaTotales(plantillaBuffer, dataPub, `Totales publicadores (${anio})`, 'publicadores', false));

        // Descargar el ZIP
        const contenidoZip = await zip.generateAsync({ type: 'blob' });
        Swal.close();
        const nombreZip = `Totales_S21_Congregacion_${anio}.zip`;
        if (esMovil()) await entregarArchivo(contenidoZip, nombreZip, 'Totales S-21 listos');
        else { descargarBlob(contenidoZip, nombreZip); Swal.fire('¡Éxito!', 'Los 4 reportes consolidados han sido descargados en un archivo ZIP.', 'success'); }

    } catch (error) {
        console.error(error);
        if (error.name !== 'AbortError') Swal.fire('Error', 'No se pudieron generar los reportes.', 'error');
    }
}

// MOTOR ESPECIAL PARA TARJETAS CONSOLIDADAS
// MOTOR ESPECIAL PARA TARJETAS CONSOLIDADAS
async function rellenarTarjetaTotales(plantillaBuffer, datosMeses, titulo, etiquetaNotas, mostrarHoras) {
    const { PDFDocument } = PDFLib; 
    const pdfDoc = await PDFDocument.load(plantillaBuffer); 
    const form = pdfDoc.getForm();
    
    const safeSetText = (f, t) => { try { const field = form.getTextField(f); if (field) field.setText(t ? t.toString() : ''); } catch (e) {} };
    const safeCheck = (f, c) => { try { const field = form.getCheckBox(f); if (field && c) field.check(); } catch (e) {} };

    // Establecer Título y Año
    safeSetText('900_1_Text_SanSerif', titulo);
    safeSetText('900_13_Text_C_SanSerif', getAnio().toString());

    const mapaMeses = { 'SEPTIEMBRE': 20, 'OCTUBRE': 21, 'NOVIEMBRE': 22, 'DICIEMBRE': 23, 'ENERO': 24, 'FEBRERO': 25, 'MARZO': 26, 'ABRIL': 27, 'MAYO': 28, 'JUNIO': 29, 'JULIO': 30, 'AGOSTO': 31 };
    
    let sumaTotalHoras = 0;

    Object.keys(datosMeses).forEach(mes => {
        const data = datosMeses[mes];
        const idx = mapaMeses[mes];
        
        if (data && idx) {
            // Checkbox de participación
            safeCheck(`901_${idx}_CheckBox`, true);
            
            // Cursos Bíblicos
            if (data.cursos > 0) safeSetText(`902_${idx}_Text_C_SanSerif`, data.cursos.toString());
            
            // CONVERSIÓN SEGURA A NÚMERO
            const horasNum = parseFloat(data.horas) || 0;
            
            // Horas (Si la tarjeta lo permite)
            if (mostrarHoras && horasNum > 0) {
                // Formatear a entero si no tiene decimales
                const hrsLimpias = horasNum % 1 === 0 ? horasNum.toString() : horasNum.toFixed(1);
                safeSetText(`904_${idx}_S21_Value`, hrsLimpias);
                sumaTotalHoras += horasNum;
            }
            
            // Columna de Notas (Cantidad de publicadores)
            safeSetText(`905_${idx}_Text_SanSerif`, `${data.cantidad} ${etiquetaNotas}`);
        }
    });

    // Suma final anual de horas
    if (mostrarHoras && sumaTotalHoras > 0) {
        const hrsTotalesLimpias = sumaTotalHoras % 1 === 0 ? sumaTotalHoras.toString() : sumaTotalHoras.toFixed(1);
        safeSetText('904_32_S21_Value', hrsTotalesLimpias);
    }

    form.flatten();
    return await pdfDoc.save();
}

