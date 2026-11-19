// Lee un chat exportado de WhatsApp y detecta avisos de avance de territorio.
// Todo ocurre en el navegador: el texto del chat no se envía al servidor.
// Es una lectura "aproximada": el resultado siempre se revisa a mano antes de guardar.

function waNormalizar(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Une las líneas sueltas al mensaje anterior y separa fecha, autor y texto.
function waLeerMensajes(texto) {
    const limpio = String(texto || '').replace(/[‎‏  ]/g, ' ').replace(/\r/g, '');
    const reCabecera = /^\[(\d{1,2})\/(\d{1,2})\/(\d{2,4}),\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp])?\.?\s*[Mm]?\.?\]\s*([^:]{1,80}?):\s?(.*)$/;
    const mensajes = [];
    for (const linea of limpio.split('\n')) {
        const m = reCabecera.exec(linea);
        if (m) {
            let anio = parseInt(m[3], 10);
            if (anio < 100) anio += 2000;
            let hora = parseInt(m[4], 10);
            const ampm = (m[7] || '').toUpperCase();
            if (ampm === 'P' && hora < 12) hora += 12;
            if (ampm === 'A' && hora === 12) hora = 0;
            const pad = (n) => String(n).padStart(2, '0');
            mensajes.push({
                fecha: `${anio}-${pad(m[2])}-${pad(m[1])}`,
                hora: `${pad(hora)}:${m[5]}:${m[6] || '00'}`,
                autor: m[8].trim(),
                texto: m[9]
            });
        } else if (mensajes.length > 0 && !/^\[\d{1,2}\/\d{1,2}\/\d{2,4},/.test(linea)) {
            mensajes[mensajes.length - 1].texto += '\n' + linea;
        }
    }
    return mensajes;
}

function waListaManzanas(s) {
    // "4-9" (sin espacios y aislado) es un rango; en cadenas como "1- 2-3 -4-5-9" cada número va suelto
    const t = waNormalizar(s).replace(/(^|[^\d-])(\d+)-(\d+)(?![\d-])/g, (_, pre, a, b) => {
        const x = +a, y = +b; const r = [];
        if (y >= x && y - x < 60) for (let i = x; i <= y; i++) r.push(i);
        return pre + r.join(',');
    }).replace(/\bdel?\s+(\d+)\s+(?:al?|hasta(?:\s+el)?)\s+(\d+)/g, (_, a, b) => {
        const x = +a, y = +b; const r = [];
        if (y >= x && y - x < 60) for (let i = x; i <= y; i++) r.push(i);
        return r.join(',');
    }).replace(/\b(\d+)\s*(?:al|hasta(?:\s+el)?)\s*(\d+)/g, (_, a, b) => {
        const x = +a, y = +b; const r = [];
        if (y >= x && y - x < 60) for (let i = x; i <= y; i++) r.push(i);
        return r.join(',');
    });
    return [...new Set((t.match(/\d+/g) || []).map(Number).filter(n => n >= 1 && n <= 99))].sort((a, b) => a - b);
}

const WA_DIAS = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6 };
const WA_VERBO_PASADO = /\b(avanzo|avanzamos|avanzaron|termino|terminamos|terminaron|empezo|empezamos|empezaron|inicio|iniciamos|comenzo|comenzamos|predico|predicamos|predicaron|trabajo|trabajamos|completo|completamos|concluyo|concluimos|cerro|cerramos|finalizo|finalizamos|acabo|acabamos|acabaron|continuo|continuamos|seguimos|hizo|hicimos|hicieron)\b/;
const WA_CIERRE = /\b(termino|terminamos|terminaron|concluyo|concluimos|completo|completamos|cerro|cerramos|finalizo|finalizamos|acabo|acabamos|acabaron|tod[oa]s?)\b/;
const WA_MES = String.raw`(?:de|del|\/)\s*(?:ene|feb|mar|abr|may|jun|jul|ago|set|sep|oct|nov|dic|\d)`;
const WA_LISTA_MZ = String.raw`((?:del?\s+)?\d+(?:(?:\s*(?:,|y|e|-|\.|al|a|hasta(?:\s+el)?)\s*)+\d+)*)`;
const WA_RE_MZ = new RegExp(String.raw`(?:manzanas?|manzs?\.?|mzas?\.?|mzs?\.?|mz\.?)[:.,;\s]*(?:n[o.]?\s*)?` + WA_LISTA_MZ, 'g');
const WA_RE_MZ_ANTES = new RegExp(String.raw`(?:manzanas?|manzs?\.?|mzas?\.?|mzs?\.?|mz\.?)[:.,\s]*` + WA_LISTA_MZ + String.raw`\s*(?:de\s+el|del?|en\s+el)\s*$`);
const WA_RE_MENCION = new RegExp(
    String.raw`(?:territorios?|terr\.?|ter\.?|\bt)\s*[:#.]?\s*(?:n[o.]?\s*)?#?\s*(\d{1,3})(?:(?:\s*(?:,|y|e)\s*|\s+)(?=\d)(\d{1,3}))*(?:\s*(?:al|a|hasta)\s*(\d{1,3}))?(?!\d)` +
    String.raw`|\b(?:se\s+)?(?:empez\w*|inici\w*|avanz\w*|termin\w*|complet\w*|predic\w*|contin\w*|comenz\w*|segu\w*|hizo|hicimos)\s+(?:con\s+|de\s+)?(?:el|los)\s+(\d{1,3})\b(?!\s*` + WA_MES + String.raw`)` +
    String.raw`|\b(?:y|e|tambien|ademas)\s+(?:tambien\s+)?(?:el|los)\s+(\d{1,3})\b(?!\s*` + WA_MES + ')', 'g');

function waFechaReal(fechaMsg, textoNorm) {
    // "el domingo se terminó..." escrito un lunes: la fecha real es el domingo anterior
    const d = new Date(fechaMsg + 'T12:00:00Z');
    if (/\bhoy\b/.test(textoNorm)) return fechaMsg;
    if (/\bayer\b/.test(textoNorm)) { d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); }
    for (const [nombre, num] of Object.entries(WA_DIAS)) {
        if (new RegExp('\\b' + nombre + 's?\\b').test(textoNorm)) {
            const atras = (d.getUTCDay() - num + 7) % 7;
            d.setUTCDate(d.getUTCDate() - atras);
            return d.toISOString().slice(0, 10);
        }
    }
    return fechaMsg;
}

function waHash(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return h.toString(36);
}

// Devuelve los avances que parece contar un mensaje (puede haber más de uno por mensaje).
function waExtraerAvances(msg) {
    // se quitan marcas de formato de WhatsApp (*negrita*, _cursiva_) y variantes mal escritas
    const norm = waNormalizar(msg.texto).replace(/[*_~]/g, '').replace(/\bterretorio/g, 'territorio');
    if (!WA_VERBO_PASADO.test(norm)) return [];
    const menciones = [];
    const re = new RegExp(WA_RE_MENCION.source, 'g');
    let m;
    while ((m = re.exec(norm)) !== null) {
        const texto = m[0];
        // un número seguido de "de <mes>" es una fecha, no un territorio
        if (new RegExp('^\\s*' + WA_MES).test(norm.slice(m.index + texto.length, m.index + texto.length + 12))) continue;
        const nums = (texto.match(/\d+/g) || []).map(Number);
        let lista = nums;
        if (/\b(?:al|a|hasta)\s*\d+\s*$/.test(texto) && nums.length >= 2) {
            const a = nums[nums.length - 2], b = nums[nums.length - 1];
            lista = nums.slice(0, -2);
            if (b >= a && b - a < 80) for (let k = a; k <= b; k++) lista.push(k);
        }
        menciones.push({ nums: [...new Set(lista)], ini: m.index, fin: m.index + texto.length, propio: texto });
    }
    if (menciones.length === 0) return [];
    const fecha = waFechaReal(msg.fecha, norm);
    const res = [];
    // 1.ª pasada: lo que va ANTES de cada territorio ("las manzanas 5, 6 y 7 del Territorio 23")
    const info = menciones.map((mn, i) => {
        const prevFin = i === 0 ? Math.max(0, mn.ini - 60) : menciones[i - 1].fin;
        const antesRaw = norm.slice(prevFin, mn.ini);
        const ma = WA_RE_MZ_ANTES.exec(antesRaw);
        return { prevFin, antesRaw, ma };
    });
    const vistos = new Map();
    let previoAceptado = false;
    menciones.forEach((mn, i) => {
        const { antesRaw, ma } = info[i];
        let hechas = null, faltan = null;
        let antes = antesRaw;
        if (ma) { hechas = waListaManzanas(ma[1]); antes = antesRaw.slice(0, ma.index); }
        antes = antes + ' ' + mn.propio;
        // lo que va después llega hasta el siguiente territorio (o hasta sus manzanas "de adelanto")
        let fin = norm.length;
        if (i + 1 < menciones.length) fin = info[i + 1].ma ? mn.fin + info[i + 1].ma.index : menciones[i + 1].ini;
        const despues = norm.slice(mn.fin, fin);
        const reMz = new RegExp(WA_RE_MZ.source, 'g');
        let mz;
        while ((mz = reMz.exec(despues)) !== null) {
            const lista = waListaManzanas(mz[1]);
            if (lista.length === 0) continue;
            const previo = despues.slice(Math.max(0, mz.index - 35), mz.index);
            if (/\b(falt\w*|quedan\w*|resta\w*|pendiente\w*|demas)\b/.test(previo)) faltan = (faltan || []).concat(lista);
            else hechas = (hechas || []).concat(lista);
        }
        if (!faltan) {
            const rf = /\b(?:falt\w*|quedan\w*|restan?)\s*(?:solo\s*)?(?:las?\s+)?(?:(?:manzanas?|mzas?|mzs?)\.?\s*)?(?:demas,?\s*(?:o\s*sea|osea)?\s*(?:las?\s+)?)?((?:\d+\s*(?:,|y|e|-)?\s*)+)/.exec(despues);
            if (rf) faltan = waListaManzanas(rf[1]);
        }
        const conVerbo = WA_VERBO_PASADO.test(antes) || WA_VERBO_PASADO.test(despues.slice(0, 40));
        // "Territorio 36 la manzana 4 / Territorio 37 la manzana 1": sin verbo propio pero con manzanas, hereda el del anterior
        if (!conVerbo && !(previoAceptado && (hechas || faltan))) { previoAceptado = false; return; }
        previoAceptado = true;
        const cierre = WA_CIERRE.test(antes) || WA_CIERRE.test(despues.slice(0, 25));
        if (hechas) hechas = [...new Set(hechas)].sort((a, b) => a - b);
        if (faltan) faltan = [...new Set(faltan)].sort((a, b) => a - b);
        const varios = mn.nums.length > 1;
        for (const num of mn.nums) {
            const origen = 'wa:' + waHash(msg.fecha + msg.hora + msg.autor) + ':' + num;
            const h = varios ? null : hechas, f = varios ? null : faltan, c = varios ? (cierre || !hechas) : cierre;
            // el mismo territorio mencionado dos veces en un mensaje se junta en un solo aviso
            const ya = vistos.get(origen);
            if (ya) {
                if (h) ya.hechas = [...new Set((ya.hechas || []).concat(h))].sort((x, y) => x - y);
                if (f) ya.faltan = [...new Set((ya.faltan || []).concat(f))].sort((x, y) => x - y);
                ya.cierre = ya.cierre || c;
                continue;
            }
            const aviso = {
                origen, fecha, autor: msg.autor, territorio: String(num), hechas: h, faltan: f, cierre: c,
                texto: msg.texto.replace(/\s+/g, ' ').slice(0, 220)
            };
            vistos.set(origen, aviso);
            res.push(aviso);
        }
    });
    return res;
}

function waAnalizarChat(texto, desdeFecha) {
    const out = [];
    for (const msg of waLeerMensajes(texto)) {
        if (desdeFecha && msg.fecha < desdeFecha) continue;
        out.push(...waExtraerAvances(msg));
    }
    return out;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { waLeerMensajes, waExtraerAvances, waAnalizarChat, waListaManzanas, waNormalizar };
}
