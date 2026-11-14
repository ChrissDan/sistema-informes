// Buscador de publicador (autocompletar): el MISMO comportamiento en Informes, Publicadores y Reportes.
// - No distingue mayúsculas/minúsculas ni tildes ("jose" encuentra "José"); las palabras pueden ir en cualquier orden.
// - Al escribir muestra debajo los publicadores que coinciden; la búsqueda real se hace al ELEGIR uno de la lista.
// - Si se pulsa "Buscar" con texto sin elegir, se busca a todos los que coinciden con lo escrito.
// (script clásico: comparte el ámbito global; se carga después de core.js, ver dashboard.html)

// Minúsculas, sin tildes y sin espacios sobrantes
function normalizarTexto(s) {
    return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Lista de publicadores compartida (una sola descarga, se renueva cada 2 min o al crear/editar/eliminar)
const _buscadorDatos = { lista: null, t: 0, promesa: null };
function obtenerPublicadoresBuscador() {
    if (_buscadorDatos.lista && Date.now() - _buscadorDatos.t < 120000) return Promise.resolve(_buscadorDatos.lista);
    if (!_buscadorDatos.promesa) {
        _buscadorDatos.promesa = fetch('/api/publicadores?grupo=0')
            .then(r => r.ok ? r.json() : [])
            .then(l => { _buscadorDatos.lista = Array.isArray(l) ? l : []; _buscadorDatos.t = Date.now(); return _buscadorDatos.lista; })
            .catch(() => [])
            .finally(() => { _buscadorDatos.promesa = null; });
    }
    return _buscadorDatos.promesa;
}
function invalidarBuscadorPublicadores() { _buscadorDatos.lista = null; }

function filtrarPublicadoresPorTexto(lista, texto, grupo) {
    const palabras = normalizarTexto(texto).split(' ').filter(Boolean);
    if (!palabras.length) return [];
    return lista.filter(p => {
        if (grupo && String(p.grupo) !== String(grupo)) return false;
        p._n = p._n || normalizarTexto(p.nombre);
        return palabras.every(w => p._n.includes(w));
    });
}

function crearBuscadorPublicador(input, opciones = {}) {
    const { onSeleccion = () => {}, onLimpiar = () => {}, onInvalidar = () => {}, grupo = () => '' } = opciones;
    const contenedor = input.parentElement;
    contenedor.classList.add('buscador-pub');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('placeholder', 'Escribe el nombre del publicador...');
    const lista = document.createElement('div'); lista.className = 'buscador-lista'; lista.hidden = true; lista.setAttribute('role', 'listbox');
    const btnX = document.createElement('button'); btnX.type = 'button'; btnX.className = 'buscador-x'; btnX.hidden = true;
    btnX.title = 'Quitar selección'; btnX.setAttribute('aria-label', 'Quitar selección'); btnX.innerHTML = '&times;';
    contenedor.appendChild(lista); contenedor.appendChild(btnX);

    let seleccionado = null, resultados = [], indice = -1;
    const MAX = 15;

    function cerrar() { lista.hidden = true; indice = -1; }
    function marcarIndice(i) {
        indice = i;
        lista.querySelectorAll('.buscador-item').forEach((el, k) => el.classList.toggle('activo', k === i));
        const el = lista.querySelector('.buscador-item.activo'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
    }
    function dibujar() {
        if (resultados.length === 0) { lista.innerHTML = '<div class="buscador-vacio">Sin coincidencias</div>'; lista.hidden = false; return; }
        const visibles = resultados.slice(0, MAX);
        lista.innerHTML = visibles.map((p, i) =>
            `<div class="buscador-item" role="option" data-i="${i}"><span class="buscador-nombre">${esc(p.nombre)}</span>` +
            `<span class="buscador-meta">G${esc(p.grupo)} · ${esc(p.priv3 || '-')}${p.activo ? '' : ' · inactivo'}</span></div>`).join('') +
            (resultados.length > MAX ? `<div class="buscador-vacio">Hay ${resultados.length - MAX} más: escribe más letras para acotar</div>` : '');
        lista.hidden = false; indice = -1;
    }
    async function mostrar() {
        const texto = input.value;
        if (!normalizarTexto(texto)) { cerrar(); return; }
        const datos = await obtenerPublicadoresBuscador();
        if (input.value !== texto) return; // el usuario siguió escribiendo
        resultados = filtrarPublicadoresPorTexto(datos, texto, grupo());
        dibujar();
    }
    function elegir(p) {
        seleccionado = p; input.value = p.nombre; btnX.hidden = false; input.classList.add('buscador-sel');
        cerrar(); onSeleccion(p);
    }
    function limpiar(notificar = false) {
        seleccionado = null; input.value = ''; btnX.hidden = true; input.classList.remove('buscador-sel'); cerrar();
        if (notificar) onLimpiar();
    }

    input.addEventListener('input', () => {
        if (seleccionado && input.value !== seleccionado.nombre) { seleccionado = null; btnX.hidden = true; input.classList.remove('buscador-sel'); onInvalidar(); }
        mostrar();
    });
    input.addEventListener('focus', () => { obtenerPublicadoresBuscador(); if (input.value && !seleccionado) mostrar(); });
    input.addEventListener('keydown', (e) => {
        const abierta = !lista.hidden && resultados.length > 0;
        const n = Math.min(resultados.length, MAX);
        if (e.key === 'ArrowDown' && abierta) { e.preventDefault(); marcarIndice((indice + 1) % n); }
        else if (e.key === 'ArrowUp' && abierta) { e.preventDefault(); marcarIndice((indice - 1 + n) % n); }
        else if (e.key === 'Enter') {
            e.preventDefault();
            if (abierta) { const i = indice >= 0 ? indice : (resultados.length === 1 ? 0 : -1); if (i >= 0) elegir(resultados[i]); }
        } else if (e.key === 'Escape') cerrar();
    });
    lista.addEventListener('click', (e) => {
        const it = e.target.closest('.buscador-item'); if (!it) return;
        const p = resultados[parseInt(it.dataset.i, 10)]; if (p) elegir(p);
    });
    btnX.addEventListener('click', () => { limpiar(true); input.focus(); });
    document.addEventListener('click', (e) => { if (!contenedor.contains(e.target)) cerrar(); });

    return {
        limpiar: () => limpiar(false),
        // Deja elegido un publicador sin disparar búsquedas (al abrir un formulario de edición)
        fijar: (p) => { if (!p) { limpiar(false); return; } seleccionado = p; input.value = p.nombre; btnX.hidden = false; input.classList.add('buscador-sel'); cerrar(); },
        obtenerSeleccion: () => seleccionado,
        // IDs para filtrar: null = sin filtro de nombre; [] = escribió algo pero nadie coincide
        async idsParaBuscar() {
            if (seleccionado) return [seleccionado.id];
            if (!normalizarTexto(input.value)) return null;
            return filtrarPublicadoresPorTexto(await obtenerPublicadoresBuscador(), input.value, grupo()).map(p => p.id);
        }
    };
}

// --- Los tres buscadores (Informes, Publicadores, Reportes) ---
const _valorGrupo = (sel) => () => { const el = typeof sel === 'function' ? sel() : document.getElementById(sel); return el ? el.value : ''; };
const buscadorInformes = crearBuscadorPublicador(document.getElementById('infFiltroNombre'), {
    grupo: _valorGrupo('infFiltroGrupo'), onSeleccion: () => cargarTablaInformes(), onLimpiar: () => cargarTablaInformes()
});
const buscadorPublicadores = crearBuscadorPublicador(document.getElementById('pubFiltroNombre'), {
    grupo: _valorGrupo('pubFiltroGrupo'), onSeleccion: () => cargarTablaPublicadores(), onLimpiar: () => cargarTablaPublicadores()
});
const buscadorReportes = crearBuscadorPublicador(document.getElementById('repFiltroNombre'), {
    grupo: _valorGrupo(() => document.getElementById('formReporte').grupo), onSeleccion: () => generarReporte()
});
