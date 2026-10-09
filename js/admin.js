/* ============================================================
   CanchaYa - Panel administrador (SPA con historial de navegacion)

   NAVEGACION
   - Cada pantalla es un "estado": { view, sub, params, idx, from }
       view   = seccion (dashboard, reservas, canchas...)
       sub    = subpantalla opcional (detalle, form, bloqueo)
       params = datos de la subpantalla (ej. { id })
       idx    = posicion en el historial de la app (0 = primera)
       from   = nombre de la pantalla anterior (para "Volver a ...")
   - navegar() hace history.pushState; el boton Atras del navegador
     y el boton "Volver" usan el mismo historial (popstate).
   - La URL usa hash (#reservas/detalle/ID) para funcionar con
     Live Server y con cualquier hosting estatico.
   ============================================================ */

let vistaActual = 'dashboard';   // seccion activa
let subVista = null;             // null | 'detalle' | 'form' | 'bloqueo'
let paramsVista = {};
let estadoActual = null;
let navIdx = 0;
let formDirty = false;           // hay cambios sin guardar en un formulario
let chartsActivos = [];
let datosListos = false;

/* Estado que se conserva al ir y volver entre pantallas */
let semanaOffset = 0;
let calDiaIdx = new Date().getDay();
let filtroReservas = { texto: '', estado: '', fecha: '' };
let filtroClientes = '';
const scrollGuardado = {};       // idx de historial -> scrollY

/* ---------- Helpers ---------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = id => document.getElementById(id);

const TITULOS = {
  dashboard: 'Dashboard', calendario: 'Calendario semanal', reservas: 'Reservas',
  clientes: 'Clientes', equipos: 'Equipos', canchas: 'Canchas', horarios: 'Horarios',
  estadisticas: 'Estadisticas'
};

/* ---------- Registro de pantallas ---------- */
const SECCIONES = {
  dashboard: () => renderDashboard(),
  calendario: () => renderCalendario(),
  reservas: () => renderReservas(),
  clientes: () => renderClientes(),
  equipos: () => renderEquipos(),
  canchas: () => renderCanchas(),
  horarios: () => renderHorarios(),
  estadisticas: () => renderEstadisticas()
};
const SUBVISTAS = {
  reservas: {
    detalle: p => renderDetalleReserva(p),
    form: p => renderFormReserva(p),
    bloqueo: () => renderFormBloqueo()
  },
  clientes: { detalle: p => renderDetalleCliente(p) },
  equipos: { form: p => renderFormEquipo(p) },
  canchas: { form: p => renderFormCancha(p) },
  horarios: { form: p => renderFormHorario(p) }
};

function etiquetaPantalla(view = vistaActual, sub = subVista, params = paramsVista) {
  if (!sub) return TITULOS[view];
  const nuevo = !(params && params.id);
  const mapa = {
    'reservas:detalle': 'Detalle de reserva',
    'reservas:form': nuevo ? 'Nuevo turno' : 'Editar reserva',
    'reservas:bloqueo': 'Bloquear horario',
    'clientes:detalle': 'Historial del cliente',
    'equipos:form': nuevo ? 'Nuevo equipo' : 'Editar equipo',
    'canchas:form': nuevo ? 'Nueva cancha' : 'Editar cancha',
    'horarios:form': nuevo ? 'Nuevo horario' : 'Editar horario'
  };
  return mapa[view + ':' + sub] || TITULOS[view];
}

/* ============================================================
   ROUTER / HISTORIAL
   ============================================================ */
function hashDe(st) {
  const partes = [st.view];
  if (st.sub) partes.push(st.sub);
  if (st.params && st.params.id) partes.push(st.params.id);
  return '#' + partes.join('/');
}

function estadoDesdeHash() {
  const [view, sub, id] = decodeURIComponent(location.hash.replace(/^#/, '')).split('/');
  if (!TITULOS[view]) return { app: 'cy', view: 'dashboard', sub: null, params: {}, idx: 0, from: '' };
  if (sub && !(SUBVISTAS[view] && SUBVISTAS[view][sub])) return { app: 'cy', view, sub: null, params: {}, idx: 0, from: '' };
  return { app: 'cy', view, sub: sub || null, params: id ? { id } : {}, idx: 0, from: '' };
}

function panelVisible() { return $('panel').style.display !== 'none'; }

function confirmarSalida() {
  if (!formDirty) return true;
  const ok = window.confirm('Tenes cambios sin guardar. ¿Queres salir igual?');
  if (ok) formDirty = false;
  return ok;
}

function guardarScroll() { scrollGuardado[navIdx] = window.scrollY || 0; }

/** Navega a una seccion o subpantalla agregando una entrada al historial. */
function navegar(view, sub = null, params = {}, { replace = false } = {}) {
  if (!confirmarSalida()) return false;
  const mismo = view === vistaActual && sub === subVista && ((params && params.id) || '') === ((paramsVista && paramsVista.id) || '');
  if (mismo && !sub) replace = true;   // clic en la seccion ya abierta: no ensuciar el historial
  guardarScroll();
  const st = {
    app: 'cy', view, sub, params,
    idx: replace ? navIdx : navIdx + 1,
    from: replace ? ((estadoActual && estadoActual.from) || '') : etiquetaPantalla()
  };
  if (replace) history.replaceState(st, '', hashDe(st));
  else history.pushState(st, '', hashDe(st));
  aplicarEstado(st);
  return true;
}

/** Boton "Volver": vuelve exactamente a la pantalla anterior. */
function volver() {
  if (navIdx > 0) { history.back(); return; }
  // Entrada directa por URL: no hay pantalla anterior en la app -> ir a la seccion padre
  if (subVista) navegar(vistaActual, null, {}, { replace: true });
  else navegar('dashboard', null, {}, { replace: true });
}

function barraVolver() {
  const destino = (navIdx > 0 && estadoActual && estadoActual.from) ? estadoActual.from : TITULOS[vistaActual];
  return `<div class="back-bar"><button type="button" class="btn btn-ghost btn-back" onclick="volver()">&larr; Volver a ${esc(destino)}</button></div>`;
}

function marcarNavActivo() {
  document.querySelectorAll('#adminNav button').forEach(b => b.classList.toggle('active', b.dataset.view === vistaActual));
}

function aplicarEstado(st, { restaurarScroll = false } = {}) {
  destruirCharts();
  estadoActual = st;
  vistaActual = st.view;
  subVista = st.sub || null;
  paramsVista = st.params || {};
  navIdx = st.idx || 0;
  formDirty = false;
  $('sidebar').classList.remove('open');
  marcarNavActivo();
  renderActual();
  window.scrollTo(0, restaurarScroll ? (scrollGuardado[navIdx] || 0) : 0);
}

function renderActual({ animar = true } = {}) {
  const cont = $('viewContent');
  $('viewTitle').textContent = etiquetaPantalla();
  document.title = etiquetaPantalla() + ' - CanchaYa Admin';
  try {
    if (subVista) SUBVISTAS[vistaActual][subVista](paramsVista);
    else SECCIONES[vistaActual]();
  } catch (e) {
    console.error('Error al mostrar la pantalla', e);
    cont.innerHTML = '<div class="empty-state">No se pudo mostrar esta pantalla. Proba volver al inicio.</div>';
  }
  if (animar) {
    cont.classList.remove('view-enter');
    void cont.offsetWidth;
    cont.classList.add('view-enter');
  }
}

window.addEventListener('popstate', e => {
  if (!panelVisible()) return;
  const st = (e.state && e.state.app === 'cy') ? e.state : estadoDesdeHash();
  if (formDirty && !window.confirm('Tenes cambios sin guardar. ¿Queres salir igual?')) {
    // Se queda en el formulario: se repone la entrada que el navegador acaba de sacar
    history.pushState(estadoActual, '', hashDe(estadoActual));
    return;
  }
  guardarScroll();
  aplicarEstado(st, { restaurarScroll: true });
});

window.addEventListener('beforeunload', e => {
  if (formDirty) { e.preventDefault(); e.returnValue = ''; }
});

/* Atajos que usan los botones del HTML (misma firma que antes) */
function irAVista(v) { navegar(v); }
function verDetalleReserva(id) { navegar('reservas', 'detalle', { id }); }
function abrirFormReserva(id, prellenado) { navegar('reservas', 'form', { id: id || null, prefill: prellenado || null }); }
function nuevaReservaDesdeGrilla(fecha, canchaId, horario) { abrirFormReserva(null, { fecha, canchaId, horario }); }
function abrirFormBloqueo() { navegar('reservas', 'bloqueo'); }
function verHistorialCliente(id) { navegar('clientes', 'detalle', { id }); }
function abrirFormEquipo(id) { navegar('equipos', 'form', { id: id || null }); }
function abrirFormCancha(id) { navegar('canchas', 'form', { id: id || null }); }
function abrirFormHorario(id) { navegar('horarios', 'form', { id: id || null }); }

/** Despues de guardar: se vuelve a la pantalla de la que se vino. */
function terminarFormulario() { formDirty = false; volver(); }
function vigilarCambios(formEl) {
  formEl.addEventListener('input', () => { formDirty = true; });
  formEl.addEventListener('change', () => { formDirty = true; });
}

/* ============================================================
   ARRANQUE / AUTH
   ============================================================ */
window.addEventListener('cy:ready', () => { datosListos = true; });

document.addEventListener('DOMContentLoaded', () => {
  if (Auth.estaLogueado()) entrarAlPanel(); else mostrarLogin();

  $('formLogin').addEventListener('submit', e => {
    e.preventDefault();
    const u = $('loginUser').value.trim();
    const p = $('loginPass').value;
    if (Auth.login(u, p)) entrarAlPanel();
    else alert('Usuario o contrasena incorrectos.');
  });

  $('btnLogout').addEventListener('click', () => {
    if (!confirmarSalida()) return;
    Auth.logout();
    history.replaceState(null, '', location.pathname + location.search);
    navIdx = 0; estadoActual = null; subVista = null;
    mostrarLogin();
  });

  $('adminNav').addEventListener('click', e => {
    const btn = e.target.closest('button[data-view]');
    if (!btn) return;
    navegar(btn.dataset.view);
  });

  $('menuToggle').addEventListener('click', () => $('sidebar').classList.toggle('open'));
});

function entrarAlPanel() {
  if (datosListos) { mostrarPanel(); return; }
  mostrarCargando();
  window.addEventListener('cy:ready', mostrarPanel, { once: true });
}
function mostrarLogin() {
  $('cargandoWrap').style.display = 'none';
  $('loginWrap').style.display = 'flex';
  $('panel').style.display = 'none';
}
function mostrarCargando() {
  $('loginWrap').style.display = 'none';
  $('cargandoWrap').style.display = 'flex';
  $('panel').style.display = 'none';
}
function mostrarPanel() {
  $('loginWrap').style.display = 'none';
  $('cargandoWrap').style.display = 'none';
  $('panel').style.display = 'flex';
  // Si se recarga la pagina se conserva la pantalla (y su posicion en el historial)
  const st = (history.state && history.state.app === 'cy') ? history.state : estadoDesdeHash();
  history.replaceState(st, '', hashDe(st));
  aplicarEstado(st, { restaurarScroll: true });
}

/* Refresco en vivo cuando cambian los datos en Firestore.
   - En listas/secciones se actualiza solo el contenido (no se pierden filtros).
   - En formularios NO se redibuja nada (para no borrar lo que se esta escribiendo). */
window.addEventListener('cy:datachange', () => {
  if (!Auth.estaLogueado() || !panelVisible() || !estadoActual) return;
  if (subVista) {
    if (subVista === 'detalle') renderActual({ animar: false });
    return;
  }
  const refrescos = {
    dashboard: renderDashboard,
    calendario: () => { const sel = $('selDiaCal'); if (sel) renderGridDia(sel.value); },
    reservas: () => { if ($('tbodyReservas')) pintarTablaReservas(); },
    clientes: () => { if ($('tbodyClientes')) pintarClientes(); },
    equipos: renderEquipos,
    canchas: renderCanchas,
    horarios: renderHorarios,
    estadisticas: renderEstadisticas
  };
  if (refrescos[vistaActual]) refrescos[vistaActual]();
});

/* ---------- Helpers UI ---------- */
function nombreCancha(id) { const c = Canchas.get(id); return c ? c.nombre : '(cancha eliminada)'; }
function badgeEstado(estado) { return `<span class="badge badge-${esc(estado)}">${esc(estado)}</span>`; }
function badgeOrigen(o) { return `<span class="badge badge-${esc(o)}">${o === 'online' ? 'online' : 'manual'}</span>`; }

/* Modal: se conserva por compatibilidad (ya no lo usan los formularios) */
function abrirModal(titulo, bodyHtml, { wide } = {}) {
  const root = $('modalRoot');
  root.innerHTML = `
    <div class="modal-overlay" id="modalOverlay">
      <div class="modal-box ${wide ? 'wide' : ''}">
        <h3>${titulo}</h3>
        <div id="modalBody">${bodyHtml}</div>
      </div>
    </div>`;
  $('modalOverlay').addEventListener('click', e => { if (e.target.id === 'modalOverlay') cerrarModal(); });
}
function cerrarModal() { $('modalRoot').innerHTML = ''; }
function confirmar(msg) { return window.confirm(msg); }
function destruirCharts() { chartsActivos.forEach(c => c.destroy()); chartsActivos = []; }

/* ============================================================
   DASHBOARD
   ============================================================ */
function renderDashboard() {
  const hoy = Utils.hoyISO();
  const reservasHoy = Reservas.all().filter(r => r.fecha === hoy && r.estado !== 'cancelada' && r.estado !== 'bloqueado');
  const horariosActivos = Horarios.activos();
  const canchas = Canchas.activas();
  const slotsHoy = horariosActivos.length * canchas.length;
  const ocupadosHoy = reservasHoy.length;
  const proximaHora = horariosActivos.map(h => h.hora).sort().find(h => h > new Date().toTimeString().slice(0, 5));
  const canceladasHoy = Reservas.all().filter(r => r.fecha === hoy && r.estado === 'cancelada').length;

  const inicioSemana = Utils.addDays(hoy, -new Date(hoy + 'T00:00:00').getDay());
  const finSemana = Utils.addDays(inicioSemana, 6);
  const reservasSemana = Reservas.all().filter(r => r.fecha >= inicioSemana && r.fecha <= finSemana && r.estado !== 'cancelada' && r.estado !== 'bloqueado');
  const totalJugadores = reservasSemana.reduce((s, r) => s + (parseInt(r.jugadores) || 0), 0);
  const conteoCanchas = {}, conteoHorarios = {};
  reservasSemana.forEach(r => {
    conteoCanchas[r.canchaId] = (conteoCanchas[r.canchaId] || 0) + 1;
    conteoHorarios[r.horario] = (conteoHorarios[r.horario] || 0) + 1;
  });
  const canchaTop = Object.entries(conteoCanchas).sort((a, b) => b[1] - a[1])[0];
  const horarioTop = Object.entries(conteoHorarios).sort((a, b) => b[1] - a[1])[0];
  const online = reservasSemana.filter(r => r.origen === 'online').length;
  const manual = reservasSemana.filter(r => r.origen === 'manual').length;

  $('viewContent').innerHTML = `
    <h3 style="margin-top:4px;">Resumen del dia</h3>
    <div class="kpi-grid">
      <div class="kpi-card"><div class="num">${ocupadosHoy}</div><div class="lbl">Turnos de hoy</div></div>
      <div class="kpi-card"><div class="num">${proximaHora || '-'}</div><div class="lbl">Proximo turno</div></div>
      <div class="kpi-card"><div class="num">${Math.max(slotsHoy - ocupadosHoy, 0)}</div><div class="lbl">Horarios disponibles</div></div>
      <div class="kpi-card"><div class="num">${ocupadosHoy}</div><div class="lbl">Horarios ocupados</div></div>
      <div class="kpi-card"><div class="num">${canceladasHoy}</div><div class="lbl">Canceladas hoy</div></div>
    </div>

    <h3>Resumen semanal</h3>
    <div class="kpi-grid">
      <div class="kpi-card"><div class="num">${reservasSemana.length}</div><div class="lbl">Total de reservas</div></div>
      <div class="kpi-card"><div class="num">${totalJugadores}</div><div class="lbl">Total de jugadores</div></div>
      <div class="kpi-card"><div class="num">${canchaTop ? esc(nombreCancha(canchaTop[0])) : '-'}</div><div class="lbl">Cancha mas usada</div></div>
      <div class="kpi-card"><div class="num">${horarioTop ? esc(horarioTop[0]) : '-'}</div><div class="lbl">Horario mas usado</div></div>
      <div class="kpi-card"><div class="num">${online} / ${manual}</div><div class="lbl">Online / Manual</div></div>
    </div>

    <h3>Proximos turnos de hoy</h3>
    <div class="table-scroll">
      <table>
        <thead><tr><th>Hora</th><th>Cancha</th><th>Cliente</th><th>Equipo</th><th>Estado</th><th>Origen</th></tr></thead>
        <tbody>
          ${reservasHoy.sort((a,b)=>a.horario.localeCompare(b.horario)).map(r => `
            <tr class="row-link" onclick="verDetalleReserva('${esc(r.id)}')">
              <td><strong>${esc(r.horario)}</strong></td>
              <td>${esc(nombreCancha(r.canchaId))}</td>
              <td>${esc(r.clienteNombre)}</td>
              <td>${esc(r.equipoNombre) || '-'}</td>
              <td>${badgeEstado(r.estado)}</td>
              <td>${badgeOrigen(r.origen)}</td>
            </tr>`).join('') || '<tr><td colspan="6" class="empty-state">No hay turnos para hoy.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

/* ============================================================
   CALENDARIO SEMANAL
   ============================================================ */
function diasDeLaSemana() {
  const hoy = Utils.hoyISO();
  const inicioBase = Utils.addDays(hoy, -new Date(hoy + 'T00:00:00').getDay());
  const inicio = Utils.addDays(inicioBase, semanaOffset * 7);
  return Array.from({ length: 7 }, (_, i) => Utils.addDays(inicio, i));
}

function renderCalendario() {
  const dias = diasDeLaSemana();
  const nombresDia = dias.map(d => new Date(d + 'T00:00:00').toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric' }));

  $('viewContent').innerHTML = `
    <div class="week-nav">
      <button class="btn btn-ghost btn-sm" onclick="cambiarSemana(-1)">&larr; Semana anterior</button>
      <strong style="text-transform:capitalize;">${Utils.formatFechaLarga(dias[0])} - ${Utils.formatFechaLarga(dias[6])}</strong>
      <button class="btn btn-ghost btn-sm" onclick="cambiarSemana(1)">Semana siguiente &rarr;</button>
      <button class="btn btn-ghost btn-sm" onclick="irAHoyCalendario()">Hoy</button>
    </div>
    <div class="toolbar">
      <label style="margin:0;">Dia:</label>
      <select id="selDiaCal">${dias.map((d,i) => `<option value="${d}">${nombresDia[i]}</option>`).join('')}</select>
    </div>
    <div class="scroll-x-hint">Desliza para ver todas las canchas &rarr;</div>
    <div id="gridDia"></div>
  `;
  const sel = $('selDiaCal');
  sel.value = dias[calDiaIdx] || dias[0];
  sel.addEventListener('change', () => { calDiaIdx = dias.indexOf(sel.value); renderGridDia(sel.value); });
  renderGridDia(sel.value);
}
function cambiarSemana(delta) { semanaOffset += delta; renderCalendario(); }
function irAHoyCalendario() { semanaOffset = 0; calDiaIdx = new Date().getDay(); renderCalendario(); }

function renderGridDia(fecha) {
  const canchas = Canchas.activas();
  const horarios = Horarios.activos();
  const cols = canchas.length || 1;
  let html = `<div class="calendar-grid-wrap"><div class="calendar-grid" style="grid-template-columns: 90px repeat(${cols}, 1fr);">`;
  html += `<div class="cg-head">Hora</div>`;
  canchas.forEach(c => html += `<div class="cg-head">${esc(c.nombre)}</div>`);
  if (!canchas.length) html += `<div class="cg-head">Sin canchas activas</div>`;

  horarios.forEach(h => {
    html += `<div class="cg-hora">${esc(h.hora)}</div>`;
    canchas.forEach(c => {
      const r = Reservas.all().find(x => x.fecha === fecha && x.canchaId === c.id && x.horario === h.hora && x.estado !== 'cancelada');
      if (r) {
        html += `<div class="cg-cell ${esc(r.estado)}" onclick="verDetalleReserva('${esc(r.id)}')">
          <div class="mini-name">${esc(r.clienteNombre)}</div>
          <div class="mini-team">${esc(r.equipoNombre)}</div>
          ${badgeEstado(r.estado)}
        </div>`;
      } else {
        html += `<div class="cg-cell disponible" onclick="nuevaReservaDesdeGrilla('${fecha}','${esc(c.id)}','${esc(h.hora)}')">
          <div class="mini-team">Disponible</div>
        </div>`;
      }
    });
  });
  html += `</div></div>`;
  const grid = $('gridDia');
  if (grid) grid.innerHTML = html;
}

/* ============================================================
   RESERVAS: listado
   ============================================================ */
function renderReservas() {
  $('viewContent').innerHTML = `
    <div class="toolbar">
      <input class="input grow" id="fReservaTexto" placeholder="Buscar por cliente, telefono, equipo, codigo o cancha...">
      <select id="fReservaEstado">
        <option value="">Todos los estados</option>
        ${ESTADOS_RESERVA.map(e => `<option value="${e}">${e}</option>`).join('')}
        <option value="bloqueado">bloqueado</option>
      </select>
      <input type="date" id="fReservaFecha">
      <button class="btn btn-accent" onclick="abrirFormReserva()">+ Nuevo turno</button>
      <button class="btn btn-ghost" onclick="abrirFormBloqueo()">Bloquear horario</button>
    </div>
    <div class="table-scroll">
      <table>
        <thead><tr><th>Codigo</th><th>Fecha</th><th>Hora</th><th>Cancha</th><th>Cliente</th><th>Equipo</th><th>Estado</th><th>Origen</th><th></th></tr></thead>
        <tbody id="tbodyReservas"></tbody>
      </table>
    </div>
  `;
  // Se restauran los filtros que el usuario tenia antes de salir de esta pantalla
  $('fReservaTexto').value = filtroReservas.texto;
  $('fReservaEstado').value = filtroReservas.estado;
  $('fReservaFecha').value = filtroReservas.fecha;
  ['fReservaTexto', 'fReservaEstado', 'fReservaFecha'].forEach(id => {
    $(id).addEventListener('input', () => {
      filtroReservas = {
        texto: $('fReservaTexto').value,
        estado: $('fReservaEstado').value,
        fecha: $('fReservaFecha').value
      };
      pintarTablaReservas();
    });
  });
  pintarTablaReservas();
}

function pintarTablaReservas() {
  const tbody = $('tbodyReservas');
  if (!tbody) return;
  let lista = Reservas.all().sort((a, b) => (b.fecha + b.horario).localeCompare(a.fecha + a.horario));
  const texto = filtroReservas.texto.toLowerCase();
  if (texto) {
    lista = lista.filter(r => [r.clienteNombre, r.telefono, r.equipoNombre, r.codigo, nombreCancha(r.canchaId)]
      .join(' ').toLowerCase().includes(texto));
  }
  if (filtroReservas.estado) lista = lista.filter(r => r.estado === filtroReservas.estado);
  if (filtroReservas.fecha) lista = lista.filter(r => r.fecha === filtroReservas.fecha);

  tbody.innerHTML = lista.map(r => `
    <tr>
      <td>${esc(r.codigo)}</td>
      <td>${esc(r.fecha)}</td>
      <td>${esc(r.horario)}</td>
      <td>${esc(nombreCancha(r.canchaId))}</td>
      <td>${esc(r.clienteNombre)}</td>
      <td>${esc(r.equipoNombre) || '-'}</td>
      <td>${badgeEstado(r.estado)}</td>
      <td>${badgeOrigen(r.origen)}</td>
      <td style="white-space:nowrap;">
        <button class="btn btn-ghost btn-sm" onclick="verDetalleReserva('${esc(r.id)}')">Ver</button>
        <button class="btn btn-ghost btn-sm" onclick="abrirFormReserva('${esc(r.id)}')">Editar</button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="9" class="empty-state">No se encontraron reservas.</td></tr>';
}

/* ============================================================
   RESERVAS: detalle
   ============================================================ */
function renderDetalleReserva({ id } = {}) {
  const r = Reservas.get(id);
  if (!r) {   // se elimino (o no existe): volver a la lista
    navegar('reservas', null, {}, { replace: true });
    return;
  }
  $('viewContent').innerHTML = `
    ${barraVolver()}
    <div class="card">
      <h3>Reserva ${esc(r.codigo)} ${badgeEstado(r.estado)}</h3>
      <div class="summary-row"><span>Fecha</span><strong>${esc(r.fecha)}</strong></div>
      <div class="summary-row"><span>Horario</span><strong>${esc(r.horario)}</strong></div>
      <div class="summary-row"><span>Cancha</span><strong>${esc(nombreCancha(r.canchaId))}</strong></div>
      <div class="summary-row"><span>Cliente</span><strong>${esc(r.clienteNombre)}</strong></div>
      <div class="summary-row"><span>Telefono</span><strong>${esc(r.telefono) || '-'}</strong></div>
      <div class="summary-row"><span>Equipo</span><strong>${esc(r.equipoNombre) || '-'}</strong></div>
      <div class="summary-row"><span>Jugadores</span><strong>${esc(r.jugadores) || '-'}</strong></div>
      <div class="summary-row"><span>Observaciones</span><strong>${esc(r.observaciones) || '-'}</strong></div>
      <div class="summary-row"><span>Estado</span><strong>${badgeEstado(r.estado)}</strong></div>
      <div class="summary-row"><span>Origen</span><strong>${badgeOrigen(r.origen)}</strong></div>
      <div class="form-actions">
        ${r.telefono ? `<a class="btn btn-ghost" target="_blank" rel="noopener" href="${esc(Utils.whatsappLink(r.telefono, `Hola ${r.clienteNombre}! Te escribimos por tu reserva ${r.codigo}.`))}">Contactar por WhatsApp</a>` : ''}
        <button class="btn btn-ghost" onclick="abrirFormReserva('${esc(r.id)}')">Editar</button>
        ${r.estado !== 'cancelada' ? `<button class="btn btn-danger" onclick="cancelarReserva('${esc(r.id)}')">Cancelar reserva</button>` : ''}
      </div>
    </div>
  `;
}

async function cancelarReserva(id) {
  if (!confirmar('¿Estas seguro de que queres cancelar esta reserva?')) return;
  try { await Reservas.cancelar(id); }   // el detalle se actualiza solo (tiempo real)
  catch (err) { console.error(err); alert('No se pudo cancelar la reserva.'); }
}
async function eliminarReserva(id) {
  if (!confirmar('Esto borra la reserva definitivamente. ¿Continuar?')) return;
  try {
    await Reservas.remove(id);
    formDirty = false;
    navegar('reservas', null, {}, { replace: true });
  } catch (err) { console.error(err); alert('No se pudo eliminar la reserva.'); }
}

/* ============================================================
   RESERVAS: formulario (nuevo turno / editar)
   ============================================================ */
function opcionesCanchas(seleccion) {
  const lista = Canchas.activas().slice();
  const actual = seleccion && Canchas.get(seleccion);
  if (actual && !lista.some(c => c.id === actual.id)) lista.push(actual);   // no perder la cancha si esta inactiva
  return lista.map(c => `<option value="${esc(c.id)}" ${c.id === seleccion ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('');
}
function opcionesHorarios(seleccion) {
  const lista = Horarios.activos().map(h => h.hora);
  if (seleccion && !lista.includes(seleccion)) lista.push(seleccion);
  return lista.sort().map(h => `<option value="${esc(h)}" ${h === seleccion ? 'selected' : ''}>${esc(h)}</option>`).join('');
}

function renderFormReserva({ id, prefill } = {}) {
  const r = id ? Reservas.get(id) : null;
  if (id && !r) { navegar('reservas', null, {}, { replace: true }); return; }
  const f = r || prefill || {};
  $('viewContent').innerHTML = `
    ${barraVolver()}
    <div class="card">
      <h3>${r ? `Editar reserva ${esc(r.codigo)}` : 'Nuevo turno manual'}</h3>
      <form id="formReserva">
        <div class="field-row">
          <div><label>Fecha</label><input type="date" id="rFecha" value="${esc(f.fecha || Utils.hoyISO())}" required></div>
          <div><label>Horario</label><select id="rHorario">${opcionesHorarios(f.horario)}</select></div>
        </div>
        <label>Cancha</label>
        <select id="rCancha">${opcionesCanchas(f.canchaId)}</select>
        <div class="field-row">
          <div><label>Nombre del cliente</label><input type="text" id="rCliente" value="${esc(f.clienteNombre)}" required></div>
          <div><label>Telefono</label><input type="tel" id="rTelefono" value="${esc(f.telefono)}"></div>
        </div>
        <div class="field-row">
          <div><label>Equipo</label><input type="text" id="rEquipo" value="${esc(f.equipoNombre)}"></div>
          <div><label>Cantidad de jugadores</label><input type="number" id="rJugadores" value="${esc(f.jugadores)}"></div>
        </div>
        <label>Observaciones</label>
        <textarea id="rObs">${esc(f.observaciones)}</textarea>
        <label>Estado</label>
        <select id="rEstado">${ESTADOS_RESERVA.map(e => `<option value="${e}" ${e === (f.estado || 'confirmada') ? 'selected' : ''}>${e}</option>`).join('')}</select>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" onclick="volver()">Cancelar</button>
          ${r ? `<button type="button" class="btn btn-danger" id="btnEliminarReserva">Eliminar</button>` : ''}
          <button type="submit" class="btn btn-primary" id="btnGuardarReserva">Guardar</button>
        </div>
      </form>
    </div>
  `;
  const form = $('formReserva');
  vigilarCambios(form);
  if (r) $('btnEliminarReserva').addEventListener('click', () => eliminarReserva(r.id));

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('btnGuardarReserva');
    const datos = {
      fecha: $('rFecha').value,
      horario: $('rHorario').value,
      canchaId: $('rCancha').value,
      clienteNombre: $('rCliente').value.trim(),
      telefono: $('rTelefono').value.trim(),
      equipoNombre: $('rEquipo').value.trim(),
      jugadores: $('rJugadores').value,
      observaciones: $('rObs').value.trim(),
      estado: $('rEstado').value
    };
    btn.disabled = true;
    btn.textContent = 'Guardando...';
    try {
      if (r) await Reservas.actualizar(r.id, datos);
      else await Reservas.crear({ ...datos, origen: 'manual' });
      terminarFormulario();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Guardar';
      if (err.message === 'DOBLE_RESERVA') alert('Ese horario y cancha ya estan ocupados.');
      else { alert('Error al guardar la reserva.'); console.error(err); }
    }
  });
}

/* ============================================================
   RESERVAS: bloquear horario
   ============================================================ */
function renderFormBloqueo() {
  $('viewContent').innerHTML = `
    ${barraVolver()}
    <div class="card">
      <h3>Bloquear horario</h3>
      <form id="formBloqueo">
        <div class="field-row">
          <div><label>Fecha</label><input type="date" id="bFecha" value="${Utils.hoyISO()}" required></div>
          <div><label>Horario</label><select id="bHorario">${opcionesHorarios()}</select></div>
        </div>
        <label>Cancha</label>
        <select id="bCancha">${opcionesCanchas()}</select>
        <label>Motivo</label>
        <select id="bMotivo">
          <option>Mantenimiento</option><option>Evento privado</option><option>Reparacion</option><option>Otro</option>
        </select>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" onclick="volver()">Cancelar</button>
          <button type="submit" class="btn btn-primary">Bloquear</button>
        </div>
      </form>
    </div>
  `;
  const form = $('formBloqueo');
  vigilarCambios(form);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await Reservas.bloquear($('bFecha').value, $('bCancha').value, $('bHorario').value, $('bMotivo').value);
      terminarFormulario();
    } catch (err) {
      if (err.message === 'DOBLE_RESERVA') alert('Ese horario ya esta ocupado o bloqueado.');
      else { console.error(err); alert('No se pudo bloquear el horario.'); }
    }
  });
}

/* ============================================================
   CLIENTES
   ============================================================ */
function renderClientes() {
  $('viewContent').innerHTML = `
    <div class="toolbar">
      <input class="input grow" id="fClienteTexto" placeholder="Buscar por nombre, telefono o equipo...">
    </div>
    <div class="table-scroll">
      <table>
        <thead><tr><th>Nombre</th><th>Telefono</th><th>Equipo habitual</th><th>Cant. reservas</th><th>Ultima reserva</th><th></th></tr></thead>
        <tbody id="tbodyClientes"></tbody>
      </table>
    </div>
  `;
  $('fClienteTexto').value = filtroClientes;
  $('fClienteTexto').addEventListener('input', () => { filtroClientes = $('fClienteTexto').value; pintarClientes(); });
  pintarClientes();
}
function pintarClientes() {
  const tbody = $('tbodyClientes');
  if (!tbody) return;
  const texto = filtroClientes.toLowerCase();
  let lista = Clientes.all();
  if (texto) lista = lista.filter(c => [c.nombre, c.telefono, c.equipoHabitual].join(' ').toLowerCase().includes(texto));
  tbody.innerHTML = lista.map(c => {
    const stats = Clientes.statsFor(c.telefono);
    return `<tr>
      <td>${esc(c.nombre)}</td><td>${esc(c.telefono)}</td><td>${esc(c.equipoHabitual) || '-'}</td>
      <td>${stats.cantidad}</td>
      <td>${stats.ultima ? esc(stats.ultima.fecha) : '-'}</td>
      <td><button class="btn btn-ghost btn-sm" onclick="verHistorialCliente('${esc(c.id)}')">Historial</button></td>
    </tr>`;
  }).join('') || '<tr><td colspan="6" class="empty-state">Todavia no hay clientes registrados.</td></tr>';
}
function renderDetalleCliente({ id } = {}) {
  const c = Clientes.get(id);
  if (!c) { navegar('clientes', null, {}, { replace: true }); return; }
  const stats = Clientes.statsFor(c.telefono);
  $('viewContent').innerHTML = `
    ${barraVolver()}
    <div class="card">
      <h3>${esc(c.nombre)}</h3>
      <p style="color:var(--ink-soft); font-size:14px;">${esc(c.telefono)} - ${stats.cantidad} reserva${stats.cantidad === 1 ? '' : 's'} en total${c.equipoHabitual ? ' - Equipo: ' + esc(c.equipoHabitual) : ''}</p>
      <div class="table-scroll">
        <table>
          <thead><tr><th>Fecha</th><th>Hora</th><th>Cancha</th><th>Equipo</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            ${stats.reservas.map(r => `<tr><td>${esc(r.fecha)}</td><td>${esc(r.horario)}</td><td>${esc(nombreCancha(r.canchaId))}</td><td>${esc(r.equipoNombre) || '-'}</td><td>${badgeEstado(r.estado)}</td>
              <td><button class="btn btn-ghost btn-sm" onclick="verDetalleReserva('${esc(r.id)}')">Ver</button></td></tr>`).join('') || `<tr><td colspan="6" class="empty-state">Sin reservas.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

/* ============================================================
   EQUIPOS
   ============================================================ */
function renderEquipos() {
  $('viewContent').innerHTML = `
    <div class="toolbar"><button class="btn btn-accent" onclick="abrirFormEquipo()">+ Nuevo equipo</button></div>
    <div class="table-scroll">
      <table>
        <thead><tr><th>Nombre</th><th>Responsable</th><th>Telefono</th><th>Jugadores habituales</th><th></th></tr></thead>
        <tbody>
          ${Equipos.all().map(e => `<tr>
            <td>${esc(e.nombre)}</td><td>${esc(e.responsable) || '-'}</td><td>${esc(e.telefono) || '-'}</td><td>${esc(e.jugadoresHabitual) || '-'}</td>
            <td style="white-space:nowrap;"><button class="btn btn-ghost btn-sm" onclick="abrirFormEquipo('${esc(e.id)}')">Editar</button>
                <button class="btn btn-danger btn-sm" onclick="eliminarEquipo('${esc(e.id)}')">Eliminar</button></td>
          </tr>`).join('') || '<tr><td colspan="5" class="empty-state">No hay equipos cargados.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}
function renderFormEquipo({ id } = {}) {
  const e = id ? Equipos.get(id) : {};
  if (id && !e) { navegar('equipos', null, {}, { replace: true }); return; }
  $('viewContent').innerHTML = `
    ${barraVolver()}
    <div class="card">
      <h3>${id ? 'Editar equipo' : 'Nuevo equipo'}</h3>
      <form id="formEquipo">
        <label>Nombre</label><input type="text" id="eqNombre" value="${esc(e.nombre)}" required>
        <label>Responsable</label><input type="text" id="eqResp" value="${esc(e.responsable)}">
        <label>Telefono</label><input type="tel" id="eqTel" value="${esc(e.telefono)}">
        <label>Cantidad habitual de jugadores</label><input type="number" id="eqJug" value="${esc(e.jugadoresHabitual)}">
        <label>Observaciones</label><textarea id="eqObs">${esc(e.observaciones)}</textarea>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" onclick="volver()">Cancelar</button>
          <button type="submit" class="btn btn-primary">Guardar</button>
        </div>
      </form>
    </div>
  `;
  const form = $('formEquipo');
  vigilarCambios(form);
  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    try {
      await Equipos.save({
        id: id || undefined,
        nombre: $('eqNombre').value.trim(),
        responsable: $('eqResp').value.trim(),
        telefono: $('eqTel').value.trim(),
        jugadoresHabitual: $('eqJug').value,
        observaciones: $('eqObs').value.trim()
      });
      terminarFormulario();
    } catch (err) { console.error(err); alert('No se pudo guardar el equipo.'); }
  });
}
async function eliminarEquipo(id) {
  if (!confirmar('¿Eliminar este equipo?')) return;
  try { await Equipos.remove(id); } catch (err) { console.error(err); alert('No se pudo eliminar.'); }
}

/* ============================================================
   CANCHAS
   ============================================================ */
function renderCanchas() {
  $('viewContent').innerHTML = `
    <div class="toolbar"><button class="btn btn-accent" onclick="abrirFormCancha()">+ Nueva cancha</button></div>
    <div class="table-scroll">
      <table>
        <thead><tr><th>Nombre</th><th>N°</th><th>Capacidad</th><th>Tipo</th><th>Estado</th><th></th></tr></thead>
        <tbody>
          ${Canchas.all().map(c => `<tr>
            <td>${esc(c.nombre)}</td><td>${esc(c.numero)}</td><td>${esc(c.capacidad)}</td><td>${esc(c.tipo)}</td>
            <td><span class="badge ${c.estado === 'activa' ? 'badge-disponible' : 'badge-cancelada'}">${esc(c.estado)}</span></td>
            <td style="white-space:nowrap;">
              <button class="btn btn-ghost btn-sm" onclick="abrirFormCancha('${esc(c.id)}')">Editar</button>
              <button class="btn btn-ghost btn-sm" onclick="Canchas.toggle('${esc(c.id)}').catch(console.error)">${c.estado === 'activa' ? 'Desactivar' : 'Activar'}</button>
              <button class="btn btn-danger btn-sm" onclick="eliminarCancha('${esc(c.id)}')">Eliminar</button>
            </td>
          </tr>`).join('') || '<tr><td colspan="6" class="empty-state">No hay canchas cargadas.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}
function renderFormCancha({ id } = {}) {
  const c = id ? Canchas.get(id) : {};
  if (id && !c) { navegar('canchas', null, {}, { replace: true }); return; }
  $('viewContent').innerHTML = `
    ${barraVolver()}
    <div class="card">
      <h3>${id ? 'Editar cancha' : 'Nueva cancha'}</h3>
      <form id="formCancha">
        <label>Nombre</label><input type="text" id="cNombre" value="${esc(c.nombre)}" required>
        <div class="field-row">
          <div><label>Numero</label><input type="number" id="cNumero" value="${esc(c.numero)}"></div>
          <div><label>Capacidad maxima</label><input type="number" id="cCapacidad" value="${esc(c.capacidad || 10)}"></div>
        </div>
        <label>Tipo de cancha</label>
        <select id="cTipo">
          ${['Futbol 5', 'Futbol 7', 'Futbol 8', 'Futbol 11'].map(t => `<option ${c.tipo === t ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" onclick="volver()">Cancelar</button>
          <button type="submit" class="btn btn-primary">Guardar</button>
        </div>
      </form>
    </div>
  `;
  const form = $('formCancha');
  vigilarCambios(form);
  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    try {
      await Canchas.save({
        id: id || undefined,
        nombre: $('cNombre').value.trim(),
        numero: $('cNumero').value,
        capacidad: $('cCapacidad').value,
        tipo: $('cTipo').value,
        estado: c.estado || 'activa'
      });
      terminarFormulario();
    } catch (err) { console.error(err); alert('No se pudo guardar la cancha.'); }
  });
}
async function eliminarCancha(id) {
  if (!confirmar('¿Eliminar esta cancha? Las reservas asociadas no se borraran.')) return;
  try { await Canchas.remove(id); } catch (err) { console.error(err); alert('No se pudo eliminar.'); }
}

/* ============================================================
   HORARIOS
   ============================================================ */
function renderHorarios() {
  $('viewContent').innerHTML = `
    <div class="toolbar"><button class="btn btn-accent" onclick="abrirFormHorario()">+ Nuevo horario</button></div>
    <div class="table-scroll">
      <table>
        <thead><tr><th>Hora</th><th>Estado</th><th></th></tr></thead>
        <tbody>
          ${Horarios.all().map(h => `<tr>
            <td><strong>${esc(h.hora)}</strong></td>
            <td><span class="badge ${h.activo ? 'badge-disponible' : 'badge-cancelada'}">${h.activo ? 'activo' : 'inactivo'}</span></td>
            <td style="white-space:nowrap;">
              <button class="btn btn-ghost btn-sm" onclick="abrirFormHorario('${esc(h.id)}')">Editar</button>
              <button class="btn btn-ghost btn-sm" onclick="Horarios.toggle('${esc(h.id)}').catch(console.error)">${h.activo ? 'Desactivar' : 'Activar'}</button>
              <button class="btn btn-danger btn-sm" onclick="eliminarHorario('${esc(h.id)}')">Eliminar</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
}
function renderFormHorario({ id } = {}) {
  const h = id ? Horarios.all().find(x => x.id === id) : {};
  if (id && !h) { navegar('horarios', null, {}, { replace: true }); return; }
  $('viewContent').innerHTML = `
    ${barraVolver()}
    <div class="card">
      <h3>${id ? 'Editar horario' : 'Nuevo horario'}</h3>
      <form id="formHorario">
        <label>Hora (HH:MM)</label><input type="time" id="hHora" value="${esc(h.hora || '19:00')}" required>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" onclick="volver()">Cancelar</button>
          <button type="submit" class="btn btn-primary">Guardar</button>
        </div>
      </form>
    </div>
  `;
  const form = $('formHorario');
  vigilarCambios(form);
  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    try {
      await Horarios.save({ id: id || undefined, hora: $('hHora').value, activo: h.activo !== false });
      terminarFormulario();
    } catch (err) { console.error(err); alert('No se pudo guardar el horario.'); }
  });
}
async function eliminarHorario(id) {
  if (!confirmar('¿Eliminar este horario?')) return;
  try { await Horarios.remove(id); } catch (err) { console.error(err); alert('No se pudo eliminar.'); }
}

/* ============================================================
   ESTADISTICAS
   ============================================================ */
function renderEstadisticas() {
  destruirCharts();   // evita acumular graficos viejos cuando se refresca en vivo
  $('viewContent').innerHTML = `
    <div class="kpi-grid" id="statKpis"></div>
    <div class="card"><h3>Reservas por dia (ultimos 14 dias)</h3><canvas id="chartDias" height="90"></canvas></div>
    <div class="card"><h3>Horarios mas utilizados</h3><canvas id="chartHorarios" height="90"></canvas></div>
    <div class="card"><h3>Canchas mas utilizadas</h3><canvas id="chartCanchas" height="90"></canvas></div>
    <div class="card"><h3>Reservas online vs. manuales</h3><canvas id="chartOrigen" height="90"></canvas></div>
  `;
  const reservas = Reservas.all().filter(r => r.estado !== 'bloqueado');
  const hoy = Utils.hoyISO();

  const clientesFrecuentes = Clientes.all()
    .map(c => ({ c, n: Clientes.statsFor(c.telefono).cantidad }))
    .sort((a, b) => b.n - a.n)[0];
  $('statKpis').innerHTML = `
    <div class="kpi-card"><div class="num">${reservas.length}</div><div class="lbl">Reservas totales</div></div>
    <div class="kpi-card"><div class="num">${Clientes.all().length}</div><div class="lbl">Clientes registrados</div></div>
    <div class="kpi-card"><div class="num">${clientesFrecuentes ? esc(clientesFrecuentes.c.nombre) : '-'}</div><div class="lbl">Cliente mas frecuente</div></div>
    <div class="kpi-card"><div class="num">${reservas.reduce((s, r) => s + (parseInt(r.jugadores) || 0), 0)}</div><div class="lbl">Jugadores totales</div></div>
  `;
  if (typeof Chart === 'undefined') return;   // sin conexion al CDN de Chart.js: se muestran solo los numeros

  const dias = Array.from({ length: 14 }, (_, i) => Utils.addDays(hoy, i - 13));
  const porDia = dias.map(d => reservas.filter(r => r.fecha === d).length);

  const porHorario = {};
  reservas.forEach(r => porHorario[r.horario] = (porHorario[r.horario] || 0) + 1);
  const horariosOrden = Object.keys(porHorario).sort();

  const porCancha = {};
  reservas.forEach(r => porCancha[r.canchaId] = (porCancha[r.canchaId] || 0) + 1);
  const canchaIds = Object.keys(porCancha);

  const online = reservas.filter(r => r.origen === 'online').length;
  const manual = reservas.filter(r => r.origen === 'manual').length;

  chartsActivos.push(new Chart($('chartDias'), {
    type: 'line',
    data: { labels: dias.map(d => d.slice(5)), datasets: [{ label: 'Reservas', data: porDia, borderColor: '#1B4332', backgroundColor: 'rgba(27,67,50,.12)', fill: true, tension: .3 }] },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
  }));
  chartsActivos.push(new Chart($('chartHorarios'), {
    type: 'bar',
    data: { labels: horariosOrden, datasets: [{ label: 'Reservas', data: horariosOrden.map(h => porHorario[h]), backgroundColor: '#40916C' }] },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
  }));
  chartsActivos.push(new Chart($('chartCanchas'), {
    type: 'bar',
    data: { labels: canchaIds.map(nombreCancha), datasets: [{ label: 'Reservas', data: canchaIds.map(id => porCancha[id]), backgroundColor: '#FFB627' }] },
    options: { plugins: { legend: { display: false } }, indexAxis: 'y', scales: { x: { beginAtZero: true, ticks: { precision: 0 } } } }
  }));
  chartsActivos.push(new Chart($('chartOrigen'), {
    type: 'doughnut',
    data: { labels: ['Online', 'Manual'], datasets: [{ data: [online, manual], backgroundColor: ['#40916C', '#3A7CA5'] }] },
    options: { plugins: { legend: { position: 'bottom' } } }
  }));
}
