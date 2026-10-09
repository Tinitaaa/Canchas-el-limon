/* ============================================================
   CanchaYa - Logica del flujo de reserva (cliente)
   ============================================================ */

const PASOS = ['Fecha', 'Cancha', 'Horario', 'Datos', 'Resumen', 'Listo'];
let estado = {
  fecha: null,
  canchaId: null,
  horario: null,
  datos: {}
};
let pasoActual = 1;

function renderStepper() {
  const el = document.getElementById('stepper');
  el.innerHTML = PASOS.map((p, i) => {
    const n = i + 1;
    const cls = n === pasoActual ? 'active' : (n < pasoActual ? 'done' : '');
    return `<div class="step-dot ${cls}">${n}. ${p}</div>`;
  }).join('');
}

function irAPaso(n) {
  pasoActual = n;
  for (let i = 1; i <= 6; i++) {
    document.getElementById('paso' + i).style.display = (i === n) ? 'block' : 'none';
  }
  renderStepper();
  if (n === 2) renderCanchas();
  if (n === 3) renderHorarios();
  if (n === 5) renderResumen();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---------- Paso 1: Fecha ---------- */
function renderFechaPicker() {
  const wrap = document.getElementById('fechaPicker');
  const hoy = Utils.hoyISO();
  let html = '';
  for (let i = 0; i < 7; i++) {
    const f = Utils.addDays(hoy, i);
    const d = new Date(f + 'T00:00:00');
    const dia = d.toLocaleDateString('es-AR', { weekday: 'short' });
    const num = d.getDate();
    html += `<button type="button" class="fecha-chip" data-fecha="${f}" onclick="elegirFecha('${f}')">${dia}<small>${num}</small></button>`;
  }
  wrap.innerHTML = html;
  document.getElementById('fechaManual').min = hoy;
  document.getElementById('fechaManual').addEventListener('change', e => {
    if (e.target.value) elegirFecha(e.target.value);
  });
}

function elegirFecha(f) {
  estado.fecha = f;
  document.querySelectorAll('.fecha-chip').forEach(c => c.classList.toggle('active', c.dataset.fecha === f));
  irAPaso(2);
}

/* ---------- Paso 2: Cancha ---------- */
function renderCanchas() {
  const wrap = document.getElementById('canchasGrid');
  if (!datosListos) {
    wrap.innerHTML = '<div class="empty-state">Cargando disponibilidad...</div>';
    return;
  }
  const canchas = Canchas.activas();
  if (!canchas.length) {
    wrap.innerHTML = '<div class="empty-state">No hay canchas activas en este momento.</div>';
    return;
  }
  wrap.innerHTML = canchas.map(c => {
    const libres = Horarios.activos().filter(h => Reservas.estaDisponible(estado.fecha, c.id, h.hora)).length;
    return `<button type="button" class="cancha-card ${c.id === estado.canchaId ? 'selected' : ''}" onclick="elegirCancha('${c.id}')">
      <h4>${c.nombre}</h4>
      <div class="meta">${c.tipo} - Hasta ${c.capacidad} jugadores</div>
      <div class="meta" style="margin-top:6px;">${libres} horario${libres === 1 ? '' : 's'} disponible${libres === 1 ? '' : 's'}</div>
    </button>`;
  }).join('');
}

function elegirCancha(id) {
  estado.canchaId = id;
  renderCanchas();
  irAPaso(3);
}

/* ---------- Paso 3: Horario ---------- */
function renderHorarios() {
  const wrap = document.getElementById('horariosGrid');
  if (!datosListos) {
    wrap.innerHTML = '<div class="empty-state">Cargando disponibilidad...</div>';
    return;
  }
  const horarios = Horarios.activos();
  if (!horarios.length) {
    wrap.innerHTML = '<div class="empty-state">No hay horarios configurados.</div>';
    return;
  }
  wrap.innerHTML = horarios.map(h => {
    const libre = Reservas.estaDisponible(estado.fecha, estado.canchaId, h.hora);
    const sel = h.hora === estado.horario;
    const cls = sel ? 'selected' : (libre ? 'disponible' : 'ocupado');
    return `<button type="button" class="horario-slot ${cls}" ${libre ? `onclick="elegirHorario('${h.hora}')"` : 'disabled'}>
      ${h.hora}<span class="tag">${libre ? 'Disponible' : 'Reservado'}</span>
    </button>`;
  }).join('');
}

function elegirHorario(h) {
  estado.horario = h;
  renderHorarios();
  setTimeout(() => irAPaso(4), 250);
}

/* ---------- Paso 4: Datos ---------- */
let datosListos = false;
window.addEventListener('cy:ready', () => { datosListos = true; });
window.addEventListener('cy:datachange', () => {
  datosListos = true;
  // Si el cliente esta mirando canchas u horarios, actualizar en vivo
  // (por ejemplo, si otra persona reserva el mismo horario justo ahora)
  if (pasoActual === 2) renderCanchas();
  if (pasoActual === 3) renderHorarios();
});

document.addEventListener('DOMContentLoaded', () => {
  renderFechaPicker();
  renderStepper();

  document.getElementById('formDatos').addEventListener('submit', e => {
    e.preventDefault();
    estado.datos = {
      nombre: document.getElementById('inNombre').value.trim(),
      telefono: document.getElementById('inTelefono').value.trim(),
      jugadores: document.getElementById('inJugadores').value || null,
      equiposCant: document.getElementById('inEquiposCant').value || null,
      equipo: document.getElementById('inEquipo').value.trim(),
      obs: document.getElementById('inObs').value.trim()
    };
    irAPaso(5);
  });

  document.getElementById('btnConfirmar').addEventListener('click', confirmarReserva);

  document.getElementById('navConsultar').addEventListener('click', e => {
    e.preventDefault();
    mostrarConsulta();
  });
});

/* ---------- Paso 5: Resumen ---------- */
function renderResumen() {
  const libre = Reservas.estaDisponible(estado.fecha, estado.canchaId, estado.horario);
  const cancha = Canchas.get(estado.canchaId);
  const box = document.getElementById('resumenBox');
  const btn = document.getElementById('btnConfirmar');

  if (!libre) {
    box.innerHTML = `<div class="empty-state">Justo se reservo ese horario. Elegi otro, por favor.</div>`;
    btn.disabled = true;
    return;
  }
  btn.disabled = false;
  box.innerHTML = `
    <div class="summary-row"><span>Fecha</span><strong style="text-transform:capitalize">${Utils.formatFechaLarga(estado.fecha)}</strong></div>
    <div class="summary-row"><span>Horario</span><strong>${estado.horario} hs</strong></div>
    <div class="summary-row"><span>Cancha</span><strong>${cancha ? cancha.nombre : '-'}</strong></div>
    <div class="summary-row"><span>Cliente</span><strong>${estado.datos.nombre}</strong></div>
    <div class="summary-row"><span>Telefono</span><strong>${estado.datos.telefono}</strong></div>
    <div class="summary-row"><span>Equipo</span><strong>${estado.datos.equipo || '-'}</strong></div>
    <div class="summary-row"><span>Cantidad de jugadores</span><strong>${estado.datos.jugadores || '-'}</strong></div>
  `;
}

async function confirmarReserva() {
  const btn = document.getElementById('btnConfirmar');
  btn.disabled = true;
  btn.textContent = 'Confirmando...';
  try {
    const reserva = await Reservas.crear({
      fecha: estado.fecha,
      canchaId: estado.canchaId,
      horario: estado.horario,
      clienteNombre: estado.datos.nombre,
      telefono: estado.datos.telefono,
      equipoNombre: estado.datos.equipo,
      jugadores: estado.datos.jugadores,
      equiposCantidad: estado.datos.equiposCant,
      observaciones: estado.datos.obs,
      estado: 'pendiente',
      origen: 'online'
    });
    mostrarCodigo(reserva);
  } catch (e) {
    if (e.message === 'DOBLE_RESERVA') {
      alert('Justo se reservo ese horario. Por favor elegi otro.');
      irAPaso(3);
    } else {
      alert('Ocurrio un error al confirmar la reserva. Revisa tu conexion e intenta de nuevo.');
      console.error(e);
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Confirmar reserva';
  }
}

/* ---------- Paso 6: Codigo ---------- */
function mostrarCodigo(reserva) {
  document.getElementById('codigoGenerado').textContent = reserva.codigo;
  const cancha = Canchas.get(reserva.canchaId);
  document.getElementById('resumenFinal').innerHTML = `
    <div class="summary-row"><span>Fecha</span><strong style="text-transform:capitalize">${Utils.formatFechaLarga(reserva.fecha)}</strong></div>
    <div class="summary-row"><span>Horario</span><strong>${reserva.horario} hs</strong></div>
    <div class="summary-row"><span>Cancha</span><strong>${cancha ? cancha.nombre : '-'}</strong></div>
    <div class="summary-row"><span>Estado</span><strong>Pendiente de confirmacion</strong></div>
  `;
  irAPaso(6);
}

/* ---------- Consulta de reserva ---------- */
function mostrarConsulta() {
  document.getElementById('flujoReserva').style.display = 'none';
  document.getElementById('consultaReserva').style.display = 'block';
}
function mostrarFlujo() {
  document.getElementById('consultaReserva').style.display = 'none';
  document.getElementById('flujoReserva').style.display = 'block';
}
function buscarReserva() {
  const codigo = document.getElementById('inCodigoConsulta').value.trim();
  const box = document.getElementById('resultadoConsulta');
  if (!codigo) { box.innerHTML = ''; return; }
  const r = Reservas.getByCodigo(codigo);
  if (!r) {
    box.innerHTML = `<div class="empty-state">No encontramos ninguna reserva con ese codigo.</div>`;
    return;
  }
  const cancha = Canchas.get(r.canchaId);
  box.innerHTML = `
    <div class="summary-row"><span>Codigo</span><strong>${r.codigo}</strong></div>
    <div class="summary-row"><span>Fecha</span><strong style="text-transform:capitalize">${Utils.formatFechaLarga(r.fecha)}</strong></div>
    <div class="summary-row"><span>Horario</span><strong>${r.horario} hs</strong></div>
    <div class="summary-row"><span>Cancha</span><strong>${cancha ? cancha.nombre : '-'}</strong></div>
    <div class="summary-row"><span>Cliente</span><strong>${r.clienteNombre}</strong></div>
    <div class="summary-row"><span>Equipo</span><strong>${r.equipoNombre || '-'}</strong></div>
    <div class="summary-row"><span>Estado</span><strong><span class="badge badge-${r.estado}">${r.estado}</span></strong></div>
  `;
}
