// Cierre y reapertura de meses
// (script clásico: comparte el ámbito global con el resto de archivos; el orden de carga está en dashboard.html)
// --- CIERRES ---
let mesesCerrados = [];   // meses cerrados del año seleccionado (lo llena verificarCierres)
async function verificarCierres() {
    try {
        const res = await fetch(`/api/cierres?anio_servicio=${getAnio()}`); // AÑO AÑADIDO
        mesesCerrados = await res.json();
        Array.from(formMesSelect.options).forEach(opt => {
            if (opt.value !== "") { opt.disabled = false; opt.textContent = opt.value; }
            if (mesesCerrados.includes(opt.value)) { opt.disabled = true; opt.textContent += " (Cerrado)"; }
        });
        if (!document.getElementById('informeId').value) aplicarBloqueoMesForm(formMesSelect);
    } catch (e) { console.error(e); }
}

async function cerrarMes() {
    const mes = document.getElementById('dashMesSelect').value;
    const confirm = await Swal.fire({ title: `¿Cerrar ${mes}?`, icon: 'warning', showCancelButton: true, confirmButtonText: 'Sí, Cerrar' });
    if (confirm.isConfirmed) {
        const res = await fetch('/api/cerrar-mes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mes, requester_group: session.grupo, anio_servicio: getAnio() }) });
        const json = await res.json();
        if (json.ok) { Swal.fire('Cerrado', `Mes ${mes} cerrado.`, 'success'); verificarCierres(); } else { Swal.fire('Error', json.msg, 'error'); }
    }
}

async function cargarTablaCierres() {
    try {
        // Asegúrate de usar la ruta con el año actual
        const res = await fetch(`/api/cierres?anio_servicio=${getAnio()}`); 
        let meses = await res.json();
        const contenedor = document.getElementById('listaCierresFlex');

        if (!contenedor) return;

        contenedor.innerHTML = '';

        if (meses.length === 0) {
            contenedor.innerHTML = '<div style="text-align:center; padding:30px; color:#94a3b8; font-size:0.95rem;">No hay meses cerrados en este año.</div>';
            return;
        }

        const ORDEN_AÑO = [
            'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE', 
            'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO'
        ];

        meses.sort((a, b) => {
            return ORDEN_AÑO.indexOf(b) - ORDEN_AÑO.indexOf(a);
        });

        meses.forEach(mes => {
            contenedor.innerHTML += `
            <div style="display: flex; justify-content: space-between; align-items: center; background: #f8fafc; padding: 12px 15px; border-radius: 8px; border: 1px solid #e2e8f0; margin-bottom: 10px;">
                <span style="font-weight: bold; color: #334155; font-size: 0.95rem;">${mes}</span>
                
                <!-- Le quitamos la clase btn-action y le dimos formato de botón rectangular -->
                <button type="button" onclick="reabrirMes('${mes}')" style="background:#f59e0b; color:white; padding:8px 16px; border-radius:6px; border:none; cursor:pointer; font-weight: 600; display: inline-flex; align-items: center; justify-content: center; gap: 8px; font-size: 0.85rem; box-shadow: 0 2px 4px rgba(245, 158, 11, 0.2); transition: all 0.2s ease;" title="Reabrir Mes" onmouseover="this.style.background='#d97706'" onmouseout="this.style.background='#f59e0b'">
                    <i class="fa-solid fa-unlock-keyhole"></i> Reabrir
                </button>
            </div>`;
        });
    } catch (error) {
        console.error("Error al cargar cierres:", error);
    }
}

async function reabrirMes(mes) {
    const confirm = await Swal.fire({ title: `¿Reabrir ${mes}?`, icon: 'warning', showCancelButton: true, confirmButtonColor: '#f59e0b', confirmButtonText: 'Sí, Reabrir' });
    if (confirm.isConfirmed) {
        try {
            const res = await fetch('/api/reabrir-mes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mes: mes, requester_group: session.grupo, anio_servicio: getAnio() }) });
            const json = await res.json();
            if (json.ok) { Swal.fire('Reabierto', `Listo.`, 'success'); cargarTablaCierres(); verificarCierres(); } else { Swal.fire('Error', json.msg, 'error'); }
        } catch (error) { console.error(error); }
    }
}

