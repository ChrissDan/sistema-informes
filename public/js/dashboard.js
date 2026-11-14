// Dashboard: estadísticas y progreso por grupo
// (script clásico: comparte el ámbito global con el resto de archivos; el orden de carga está en dashboard.html)
// --- DASHBOARD ---
async function cargarDashboard() {
    const mes = document.getElementById('dashMesSelect').value; const grp = isGlobal ? 0 : session.grupo;
    try {
        const res = await fetch(`/api/dashboard?mes=${mes}&grupo=${grp}&anio_servicio=${getAnio()}`); // AÑO AÑADIDO
        const data = await res.json();
        document.getElementById('stat-pub-count').textContent = data.stats.pub.count; document.getElementById('stat-pub-cursos').textContent = data.stats.pub.cursos || 0;
        document.getElementById('stat-aux-count').textContent = data.stats.aux.count; document.getElementById('stat-aux-horas').textContent = data.stats.aux.horas || 0; document.getElementById('stat-aux-cursos').textContent = data.stats.aux.cursos || 0;
        document.getElementById('stat-reg-count').textContent = data.stats.reg.count; document.getElementById('stat-reg-horas').textContent = data.stats.reg.horas || 0; document.getElementById('stat-reg-cursos').textContent = data.stats.reg.cursos || 0;
        const container = document.getElementById('groups-progress-container'); container.innerHTML = '';
        const gruposInfo = {}; data.groups.totals.forEach(g => gruposInfo[g.grupo] = { total: g.total, reported: 0 });
        data.groups.reports.forEach(g => { if (gruposInfo[g.grupo]) gruposInfo[g.grupo].reported = g.count; });
        Object.keys(gruposInfo).forEach(grpNum => { if (grpNum == 0) return; const g = gruposInfo[grpNum]; const percent = Math.round((g.reported / g.total) * 100) || 0; let color = 'var(--primary)'; if (percent === 100) color = 'var(--success)'; if (percent < 50) color = 'var(--danger)'; container.innerHTML += `<div class="group-item"><div class="group-info"><div class="group-name">Grupo ${grpNum} <span>(${g.reported}/${g.total})</span></div><div class="progress-bar-bg"><div class="progress-bar-fill" style="width:${percent}%; background:${color}"></div></div></div><div class="group-perc" style="color:${color}">${percent}%</div></div>`; });
    } catch (error) { console.error(error); }
}

