// Calendario y selector de rango de fechas
// (script clásico: comparte el ámbito global con el resto de archivos; el orden de carga está en dashboard.html)
/* ==========================================================================
   CALENDARIO MODERNO Y SELECTOR DE RANGO DE FECHAS (VCAL)
   ========================================================================== */
const VCAL_MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const VCAL_DIAS = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'];

const vcalState = {
    popover: null,
    activeInput: null,
    mode: 'single', // 'single' | 'range'
    viewYear: new Date().getFullYear(),
    viewMonth: new Date().getMonth(),
    from: '',
    to: '',
    activeSlot: 'from', // 'from' | 'to'
    hoverDate: ''
};

function vcalFormatYMD(dateObj) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function vcalTodayStr() {
    return vcalFormatYMD(new Date());
}

function asegurarVCalPopover() {
    if (vcalState.popover) return vcalState.popover;
    const pop = document.createElement('div');
    pop.id = 'vcalPopover';
    pop.className = 'vcal-popover';
    pop.style.display = 'none';
    pop.addEventListener('mousedown', (e) => e.stopPropagation());
    pop.addEventListener('click', (e) => e.stopPropagation());
    document.body.appendChild(pop);
    vcalState.popover = pop;
    return pop;
}

function abrirVCal(inputEl) {
    if (!inputEl || inputEl.disabled || inputEl.dataset.locked === '1') return;
    const pop = asegurarVCalPopover();
    const mode = inputEl.dataset.vcal === 'range' ? 'range' : 'single';
    vcalState.activeInput = inputEl;
    vcalState.mode = mode;
    vcalState.hoverDate = '';

    let refDateStr = '';
    if (mode === 'range') {
        vcalState.from = inputEl.dataset.from || '';
        vcalState.to = inputEl.dataset.to || '';
        vcalState.activeSlot = (vcalState.from && !vcalState.to) ? 'to' : 'from';
        refDateStr = vcalState.from || vcalState.to;
    } else {
        vcalState.from = (inputEl.value || '').trim();
        vcalState.to = '';
        refDateStr = vcalState.from;
    }

    if (refDateStr && /^\d{4}-\d{2}-\d{2}$/.test(refDateStr)) {
        const [y, m] = refDateStr.split('-').map(Number);
        vcalState.viewYear = y;
        vcalState.viewMonth = m - 1;
    } else {
        const now = new Date();
        vcalState.viewYear = now.getFullYear();
        vcalState.viewMonth = now.getMonth();
    }

    renderVCal();
    pop.style.display = 'block';
    posicionarVCal(inputEl);
}

function posicionarVCal(inputEl) {
    const pop = vcalState.popover;
    if (!pop || !inputEl) return;
    const rect = inputEl.getBoundingClientRect();
    const popW = pop.offsetWidth || 304;
    const popH = pop.offsetHeight || 340;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = rect.left;
    if (left + popW > vw - 12) left = Math.max(12, vw - popW - 12);
    if (left < 12) left = 12;

    let top = rect.bottom + 6;
    if (top + popH > vh - 12 && rect.top - popH - 6 >= 12) {
        top = rect.top - popH - 6;
    } else if (top + popH > vh - 12) {
        top = Math.max(12, vh - popH - 12);
    }

    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;
}

function cerrarVCal() {
    if (vcalState.popover) {
        vcalState.popover.style.display = 'none';
    }
    vcalState.activeInput = null;
    vcalState.hoverDate = '';
}

function sincronizarInputRangoVCal() {
    const inp = vcalState.activeInput;
    if (!inp || vcalState.mode !== 'range') return;
    inp.dataset.from = vcalState.from || '';
    inp.dataset.to = vcalState.to || '';

    if (vcalState.from && vcalState.to) {
        inp.value = vcalState.from === vcalState.to
            ? vcalState.from
            : `${vcalState.from} → ${vcalState.to}`;
        inp.classList.add('has-range');
    } else if (vcalState.from) {
        inp.value = `Desde ${vcalState.from}`;
        inp.classList.add('has-range');
    } else if (vcalState.to) {
        inp.value = `Hasta ${vcalState.to}`;
        inp.classList.add('has-range');
    } else {
        inp.value = '';
        inp.classList.remove('has-range');
    }

    const clearBtn = document.getElementById(inp.id + 'Clear');
    if (clearBtn) {
        clearBtn.style.display = (vcalState.from || vcalState.to) ? 'inline-flex' : 'none';
    }
    renderTablaBitacoraFiltrada();
}

function aplicarPresetRangoVCal(tipo) {
    const hoy = new Date();
    let dIni = new Date(hoy);
    let dFin = new Date(hoy);

    if (tipo === 'hoy') {
        // Hoy exacto
    } else if (tipo === '7d') {
        dIni.setDate(hoy.getDate() - 6);
    } else if (tipo === 'mes') {
        dIni = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
        dFin = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0);
    } else if (tipo === 'mes_ant') {
        dIni = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
        dFin = new Date(hoy.getFullYear(), hoy.getMonth(), 0);
    } else if (tipo === 'anio') {
        dIni = new Date(hoy.getFullYear(), 0, 1);
        dFin = new Date(hoy.getFullYear(), 11, 31);
    }

    vcalState.from = vcalFormatYMD(dIni);
    vcalState.to = vcalFormatYMD(dFin);
    vcalState.viewYear = dFin.getFullYear();
    vcalState.viewMonth = dFin.getMonth();
    vcalState.activeSlot = 'from';
    sincronizarInputRangoVCal();
    renderVCal();
}

function seleccionarDiaVCal(ymd) {
    const inp = vcalState.activeInput;
    if (!inp) return;

    if (vcalState.mode === 'single') {
        inp.value = ymd;
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        cerrarVCal();
        return;
    }

    // Modo rango
    if (vcalState.activeSlot === 'from' || (!vcalState.from && !vcalState.to)) {
        vcalState.from = ymd;
        if (vcalState.to && vcalState.to < vcalState.from) {
            vcalState.to = '';
        }
        vcalState.activeSlot = 'to';
    } else {
        if (vcalState.from && ymd < vcalState.from) {
            vcalState.to = vcalState.from;
            vcalState.from = ymd;
        } else {
            vcalState.to = ymd;
        }
        vcalState.activeSlot = 'from';
    }
    vcalState.hoverDate = '';
    sincronizarInputRangoVCal();
    renderVCal();
}

function actualizarHoverDiasVCal() {
    const pop = vcalState.popover;
    if (!pop || vcalState.mode !== 'range') return;
    let rStart = vcalState.from;
    let rEnd = vcalState.to;
    if (vcalState.activeSlot === 'to' && vcalState.from && !vcalState.to && vcalState.hoverDate) {
        if (vcalState.hoverDate < vcalState.from) {
            rStart = vcalState.hoverDate;
            rEnd = vcalState.from;
        } else {
            rStart = vcalState.from;
            rEnd = vcalState.hoverDate;
        }
    }

    pop.querySelectorAll('.vcal-day[data-ymd]').forEach(btn => {
        const d = btn.dataset.ymd;
        btn.classList.remove('is-start', 'is-end', 'is-in-range');
        if (rStart && d === rStart) btn.classList.add('is-start');
        if (rEnd && d === rEnd) btn.classList.add('is-end');
        if (rStart && rEnd && d > rStart && d < rEnd) btn.classList.add('is-in-range');
    });
}

function renderVCal() {
    const pop = asegurarVCalPopover();
    const year = vcalState.viewYear;
    const month = vcalState.viewMonth;
    const todayStr = vcalTodayStr();

    // Opciones de año (1950 a año actual + 5)
    const maxYear = new Date().getFullYear() + 5;
    let yearOpts = '';
    for (let y = maxYear; y >= 1950; y--) {
        yearOpts += `<option value="${y}" ${y === year ? 'selected' : ''}>${y}</option>`;
    }
    const monthOpts = VCAL_MESES.map((m, idx) => `<option value="${idx}" ${idx === month ? 'selected' : ''}>${m}</option>`).join('');

    // Calcular cuadrícula de 42 días (Lunes = 0 ... Domingo = 6)
    const firstDay = new Date(year, month, 1);
    const startOffset = (firstDay.getDay() + 6) % 7;
    const gridStartDate = new Date(year, month, 1 - startOffset);

    let daysHtml = '';
    for (let i = 0; i < 42; i++) {
        const cellDate = new Date(gridStartDate.getFullYear(), gridStartDate.getMonth(), gridStartDate.getDate() + i);
        const ymd = vcalFormatYMD(cellDate);
        const isOutside = cellDate.getMonth() !== month;
        const isToday = ymd === todayStr;

        const classes = ['vcal-day'];
        if (isOutside) classes.push('is-outside');
        if (isToday) classes.push('is-today');

        if (vcalState.mode === 'single') {
            if (vcalState.from && ymd === vcalState.from) classes.push('is-selected');
        } else {
            if (vcalState.from && ymd === vcalState.from) classes.push('is-start');
            if (vcalState.to && ymd === vcalState.to) classes.push('is-end');
            if (vcalState.from && vcalState.to && ymd > vcalState.from && ymd < vcalState.to) {
                classes.push('is-in-range');
            }
        }

        daysHtml += `<button type="button" class="${classes.join(' ')}" data-ymd="${ymd}">${cellDate.getDate()}</button>`;
    }

    const rangeTopHtml = vcalState.mode === 'range' ? `
        <div class="vcal-range-bar">
            <div class="vcal-range-slot ${vcalState.activeSlot === 'from' ? 'active' : ''}" data-slot="from">
                <span class="vcal-range-slot-label">Desde</span>
                <span class="vcal-range-slot-val ${vcalState.from ? '' : 'is-empty'}">${vcalState.from || 'Elegir fecha'}</span>
            </div>
            <div class="vcal-range-slot ${vcalState.activeSlot === 'to' ? 'active' : ''}" data-slot="to">
                <span class="vcal-range-slot-label">Hasta</span>
                <span class="vcal-range-slot-val ${vcalState.to ? '' : 'is-empty'}">${vcalState.to || 'Elegir fecha'}</span>
            </div>
        </div>
        <div class="vcal-presets">
            <button type="button" class="vcal-preset-btn" data-preset="hoy">Hoy</button>
            <button type="button" class="vcal-preset-btn" data-preset="7d">7 días</button>
            <button type="button" class="vcal-preset-btn" data-preset="mes">Este mes</button>
            <button type="button" class="vcal-preset-btn" data-preset="mes_ant">Mes ant.</button>
            <button type="button" class="vcal-preset-btn" data-preset="anio">Este año</button>
        </div>
    ` : '';

    const footerHtml = vcalState.mode === 'range' ? `
        <div class="vcal-footer">
            <button type="button" class="vcal-footer-btn" data-action="clear">Limpiar</button>
            <button type="button" class="vcal-footer-btn primary" data-action="close">Listo</button>
        </div>
    ` : `
        <div class="vcal-footer">
            <button type="button" class="vcal-footer-btn" data-action="clear-single">Borrar</button>
            <button type="button" class="vcal-footer-btn primary" data-action="today-single">Hoy</button>
        </div>
    `;

    pop.innerHTML = `
        ${rangeTopHtml}
        <div class="vcal-header">
            <button type="button" class="vcal-nav-btn" data-nav="-1" title="Mes anterior"><i class="fa-solid fa-chevron-left"></i></button>
            <div class="vcal-title-selects">
                <select class="vcal-select" id="vcalMonthSelect">${monthOpts}</select>
                <select class="vcal-select" id="vcalYearSelect">${yearOpts}</select>
            </div>
            <button type="button" class="vcal-nav-btn" data-nav="1" title="Mes siguiente"><i class="fa-solid fa-chevron-right"></i></button>
        </div>
        <div class="vcal-weekdays">
            ${VCAL_DIAS.map(d => `<div class="vcal-weekday">${d}</div>`).join('')}
        </div>
        <div class="vcal-days">
            ${daysHtml}
        </div>
        ${footerHtml}
    `;

    // Eventos internos del popover
    pop.querySelectorAll('.vcal-nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const delta = parseInt(btn.dataset.nav, 10);
            const d = new Date(vcalState.viewYear, vcalState.viewMonth + delta, 1);
            vcalState.viewYear = d.getFullYear();
            vcalState.viewMonth = d.getMonth();
            renderVCal();
        });
    });

    pop.querySelector('#vcalMonthSelect')?.addEventListener('change', (e) => {
        vcalState.viewMonth = parseInt(e.target.value, 10);
        renderVCal();
    });

    pop.querySelector('#vcalYearSelect')?.addEventListener('change', (e) => {
        vcalState.viewYear = parseInt(e.target.value, 10);
        renderVCal();
    });

    pop.querySelectorAll('.vcal-range-slot').forEach(slot => {
        slot.addEventListener('click', () => {
            vcalState.activeSlot = slot.dataset.slot;
            renderVCal();
        });
    });

    pop.querySelectorAll('.vcal-preset-btn').forEach(btn => {
        btn.addEventListener('click', () => aplicarPresetRangoVCal(btn.dataset.preset));
    });

    pop.querySelectorAll('.vcal-day').forEach(dayBtn => {
        dayBtn.addEventListener('click', () => seleccionarDiaVCal(dayBtn.dataset.ymd));
        if (vcalState.mode === 'range') {
            dayBtn.addEventListener('mouseenter', () => {
                if (vcalState.activeSlot === 'to' && vcalState.from && !vcalState.to) {
                    vcalState.hoverDate = dayBtn.dataset.ymd;
                    actualizarHoverDiasVCal();
                }
            });
        }
    });

    pop.querySelector('.vcal-days')?.addEventListener('mouseleave', () => {
        if (vcalState.mode === 'range' && vcalState.hoverDate) {
            vcalState.hoverDate = '';
            actualizarHoverDiasVCal();
        }
    });

    pop.querySelector('[data-action="clear"]')?.addEventListener('click', () => {
        vcalState.from = '';
        vcalState.to = '';
        vcalState.activeSlot = 'from';
        sincronizarInputRangoVCal();
        renderVCal();
    });

    pop.querySelector('[data-action="close"]')?.addEventListener('click', () => cerrarVCal());

    pop.querySelector('[data-action="clear-single"]')?.addEventListener('click', () => {
        if (vcalState.activeInput) {
            vcalState.activeInput.value = '';
            vcalState.activeInput.dispatchEvent(new Event('input', { bubbles: true }));
            vcalState.activeInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
        cerrarVCal();
    });

    pop.querySelector('[data-action="today-single"]')?.addEventListener('click', () => {
        seleccionarDiaVCal(vcalTodayStr());
    });
}

// Delegación global para abrir y cerrar el calendario moderno
document.addEventListener('click', (e) => {
    const targetInput = e.target.closest('input[data-vcal]');
    if (targetInput) {
        abrirVCal(targetInput);
        return;
    }
    if (vcalState.popover && vcalState.popover.style.display === 'block') {
        if (!vcalState.popover.contains(e.target)) {
            cerrarVCal();
        }
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && vcalState.popover && vcalState.popover.style.display === 'block') {
        cerrarVCal();
    }
    if (e.target && e.target.matches && e.target.matches('input[data-vcal]')) {
        if (e.key !== 'Tab') e.preventDefault();
    }
});

window.addEventListener('resize', () => {
    if (vcalState.activeInput && vcalState.popover?.style.display === 'block') {
        posicionarVCal(vcalState.activeInput);
    }
});

showView('dashboard');