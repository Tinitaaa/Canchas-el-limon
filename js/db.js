/* ============================================================
   CanchaYa – Capa de datos (Firebase Firestore)
   Todas las lecturas (Canchas.all(), Reservas.all(), etc.) son
   SINCRONICAS: leen de una cache local que se mantiene
   sincronizada en tiempo real con Firestore (onSnapshot).
   Todas las ESCRITURAS (save, crear, actualizar, remove...)
   son ASYNC: devuelven una Promise.
   ============================================================ */

/* ---------- 1) CONFIGURACION DE FIREBASE ----------
   Pega aca el objeto firebaseConfig que te da la consola de
   Firebase (Configuracion del proyecto -> Tus apps -> SDK). */
const firebaseConfig = {
  apiKey: "AIzaSyA2OWKk6xAHn11qtDK1YrT04WivMz4BPLo",
  authDomain: "canchas-c527f.firebaseapp.com",
  projectId: "canchas-c527f",
  storageBucket: "canchas-c527f.firebasestorage.app",
  messagingSenderId: "206532697789",
  appId: "1:206532697789:web:dbc944b27fa7de1f2e21d4"
};

firebase.initializeApp(firebaseConfig);
const fdb = firebase.firestore();
fdb.settings({ ignoreUndefinedProperties: true });

const ESTADOS_RESERVA = ['pendiente', 'confirmada', 'finalizada', 'cancelada'];
const ORIGENES = ['online', 'manual'];

/* ---------- 2) Cache local en memoria (tiempo real) ---------- */
let _canchas = [];
let _horarios = [];
let _equipos = [];
let _clientes = [];
let _reservas = [];
const _listo = { canchas: false, horarios: false, equipos: false, clientes: false, reservas: false };
let _yaAvisoListo = false;

function _avisarCambio() {
  window.dispatchEvent(new CustomEvent('cy:datachange'));
  if (!_yaAvisoListo && Object.values(_listo).every(Boolean)) {
    _yaAvisoListo = true;
    window.dispatchEvent(new CustomEvent('cy:ready'));
  }
}

function _suscribir(nombreColeccion, arrayDestino, key) {
  fdb.collection(nombreColeccion).onSnapshot(snap => {
    arrayDestino.length = 0;
    snap.forEach(doc => arrayDestino.push({ id: doc.id, ...doc.data() }));
    _listo[key] = true;
    _avisarCambio();
  }, err => console.error('Error escuchando ' + nombreColeccion, err));
}

async function seedIfEmpty() {
  const canchasSnap = await fdb.collection('canchas').limit(1).get();
  if (canchasSnap.empty) {
    const batch = fdb.batch();
    [
      { nombre: 'Cancha 1', numero: 1, capacidad: 10, tipo: 'Futbol 5', estado: 'activa' },
      { nombre: 'Cancha 2', numero: 2, capacidad: 10, tipo: 'Futbol 5', estado: 'activa' },
      { nombre: 'Cancha 3', numero: 3, capacidad: 14, tipo: 'Futbol 7', estado: 'activa' }
    ].forEach(c => batch.set(fdb.collection('canchas').doc(), c));
    await batch.commit();
  }
  const horariosSnap = await fdb.collection('horarios').limit(1).get();
  if (horariosSnap.empty) {
    const batch = fdb.batch();
    ['19:00', '20:00', '21:00', '22:00', '23:00'].forEach(hora => {
      batch.set(fdb.collection('horarios').doc(), { hora, activo: true });
    });
    await batch.commit();
  }
}

function iniciarSincronizacion() {
  _suscribir('canchas', _canchas, 'canchas');
  _suscribir('horarios', _horarios, 'horarios');
  _suscribir('equipos', _equipos, 'equipos');
  _suscribir('clientes', _clientes, 'clientes');
  _suscribir('reservas', _reservas, 'reservas');
  seedIfEmpty().catch(e => console.error('Error creando datos iniciales', e));
}

/* ---------- Codigo de reserva (contador atomico) ---------- */
async function nextReservaCodigo() {
  const ref = fdb.collection('config').doc('contador');
  const nuevo = await fdb.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const actual = snap.exists ? snap.data().valor : 100;
    const siguiente = actual + 1;
    tx.set(ref, { valor: siguiente });
    return siguiente;
  });
  return '#' + String(nuevo).padStart(6, '0');
}

/* ---------- Canchas ---------- */
const Canchas = {
  all: () => _canchas,
  activas: () => _canchas.filter(c => c.estado === 'activa'),
  get: id => _canchas.find(c => c.id === id),
  async save(cancha) {
    if (cancha.id) {
      const { id, ...datos } = cancha;
      await fdb.collection('canchas').doc(id).set(datos, { merge: true });
    } else {
      const datos = { ...cancha, estado: cancha.estado || 'activa' };
      delete datos.id;
      await fdb.collection('canchas').add(datos);
    }
  },
  async remove(id) { await fdb.collection('canchas').doc(id).delete(); },
  async toggle(id) {
    const c = Canchas.get(id);
    if (!c) return;
    await fdb.collection('canchas').doc(id).update({ estado: c.estado === 'activa' ? 'inactiva' : 'activa' });
  }
};

/* ---------- Horarios ---------- */
const Horarios = {
  all: () => [..._horarios].sort((a, b) => a.hora.localeCompare(b.hora)),
  activos: () => Horarios.all().filter(h => h.activo),
  async save(h) {
    if (h.id) {
      const { id, ...datos } = h;
      await fdb.collection('horarios').doc(id).set(datos, { merge: true });
    } else {
      const datos = { ...h, activo: h.activo !== false };
      delete datos.id;
      await fdb.collection('horarios').add(datos);
    }
  },
  async remove(id) { await fdb.collection('horarios').doc(id).delete(); },
  async toggle(id) {
    const h = _horarios.find(x => x.id === id);
    if (!h) return;
    await fdb.collection('horarios').doc(id).update({ activo: !h.activo });
  }
};

/* ---------- Equipos ---------- */
const Equipos = {
  all: () => _equipos,
  get: id => _equipos.find(e => e.id === id),
  async save(eq) {
    if (eq.id) {
      const { id, ...datos } = eq;
      await fdb.collection('equipos').doc(id).set(datos, { merge: true });
    } else {
      const datos = { ...eq };
      delete datos.id;
      await fdb.collection('equipos').add(datos);
    }
  },
  async remove(id) { await fdb.collection('equipos').doc(id).delete(); }
};

/* ---------- Clientes ---------- */
const Clientes = {
  all: () => _clientes,
  get: id => _clientes.find(c => c.id === id),
  findByTelefono: tel => _clientes.find(c => c.telefono === tel),
  async upsertFromReserva(r) {
    const existente = _clientes.find(c => c.telefono === r.telefono);
    if (!existente) {
      await fdb.collection('clientes').add({
        nombre: r.clienteNombre, telefono: r.telefono, equipoHabitual: r.equipoNombre || ''
      });
    } else {
      await fdb.collection('clientes').doc(existente.id).set({
        nombre: r.clienteNombre || existente.nombre,
        equipoHabitual: r.equipoNombre || existente.equipoHabitual
      }, { merge: true });
    }
  },
  async remove(id) { await fdb.collection('clientes').doc(id).delete(); },
  statsFor(telefono) {
    const reservas = _reservas.filter(r => r.telefono === telefono);
    const ordenadas = reservas.slice().sort((a, b) => (a.fecha + a.horario).localeCompare(b.fecha + b.horario));
    return {
      cantidad: reservas.length,
      ultima: ordenadas.length ? ordenadas[ordenadas.length - 1] : null,
      reservas: ordenadas
    };
  }
};

/* ---------- Reservas ---------- */
function _slotId(fecha, canchaId, horario) { return `${fecha}_${canchaId}_${horario}`; }

const Reservas = {
  all: () => _reservas,
  get: id => _reservas.find(r => r.id === id),
  getByCodigo: codigo => _reservas.find(r => r.codigo.toLowerCase() === String(codigo).toLowerCase().trim()),

  porFechaCancha(fecha, canchaId) {
    return _reservas.filter(r => r.fecha === fecha && r.canchaId === canchaId && r.estado !== 'cancelada');
  },

  estaDisponible(fecha, canchaId, horario, ignorarId) {
    return !_reservas.some(r =>
      r.id !== ignorarId && r.fecha === fecha && r.canchaId === canchaId &&
      r.horario === horario && r.estado !== 'cancelada'
    );
  },

  async crear(data) {
    const slotRef = fdb.collection('slots').doc(_slotId(data.fecha, data.canchaId, data.horario));
    const reservaRef = fdb.collection('reservas').doc();
    const codigo = await nextReservaCodigo();

    const reserva = {
      codigo,
      fecha: data.fecha, horario: data.horario, canchaId: data.canchaId,
      clienteNombre: data.clienteNombre, telefono: data.telefono || '',
      equipoNombre: data.equipoNombre || '', jugadores: data.jugadores || null,
      equiposCantidad: data.equiposCantidad || null, observaciones: data.observaciones || '',
      estado: data.estado || 'pendiente', origen: data.origen || 'online',
      pago: data.pago || { precio: null, sena: 0, saldo: null, totalPagado: 0, metodo: '', estadoPago: 'pendiente' },
      createdAt: new Date().toISOString()
    };

    await fdb.runTransaction(async tx => {
      const slotSnap = await tx.get(slotRef);
      if (slotSnap.exists) throw new Error('DOBLE_RESERVA');
      tx.set(slotRef, { reservaId: reservaRef.id });
      tx.set(reservaRef, reserva);
    });

    await Clientes.upsertFromReserva(reserva);
    return { id: reservaRef.id, ...reserva };
  },

  async actualizar(id, cambios) {
    const actual = Reservas.get(id);
    if (!actual) return null;
    const fecha = cambios.fecha ?? actual.fecha;
    const canchaId = cambios.canchaId ?? actual.canchaId;
    const horario = cambios.horario ?? actual.horario;
    const cambiaSlot = fecha !== actual.fecha || canchaId !== actual.canchaId || horario !== actual.horario;

    if (cambiaSlot) {
      const nuevoSlotRef = fdb.collection('slots').doc(_slotId(fecha, canchaId, horario));
      const viejoSlotRef = fdb.collection('slots').doc(_slotId(actual.fecha, actual.canchaId, actual.horario));
      await fdb.runTransaction(async tx => {
        const nuevoSnap = await tx.get(nuevoSlotRef);
        if (nuevoSnap.exists) throw new Error('DOBLE_RESERVA');
        tx.delete(viejoSlotRef);
        tx.set(nuevoSlotRef, { reservaId: id });
        tx.update(fdb.collection('reservas').doc(id), cambios);
      });
    } else {
      await fdb.collection('reservas').doc(id).set(cambios, { merge: true });
    }
    return { ...actual, ...cambios };
  },

  async cancelar(id) {
    const r = Reservas.get(id);
    if (!r) return;
    const slotRef = fdb.collection('slots').doc(_slotId(r.fecha, r.canchaId, r.horario));
    await fdb.runTransaction(async tx => {
      tx.delete(slotRef);
      tx.update(fdb.collection('reservas').doc(id), { estado: 'cancelada' });
    });
  },

  async remove(id) {
    const r = Reservas.get(id);
    if (r) {
      await fdb.collection('slots').doc(_slotId(r.fecha, r.canchaId, r.horario)).delete().catch(() => {});
    }
    await fdb.collection('reservas').doc(id).delete();
  },

  async bloquear(fecha, canchaId, horario, motivo) {
    return Reservas.crear({
      fecha, canchaId, horario, clienteNombre: 'BLOQUEADO', telefono: '',
      observaciones: motivo || 'Bloqueado', estado: 'bloqueado', origen: 'manual'
    });
  }
};

/* ---------- Auth admin (demo simple, queda local del navegador) ---------- */
const Auth = {
  CREDENCIALES: { usuario: 'admin', clave: 'admin123' },
  login(usuario, clave) {
    if (usuario === Auth.CREDENCIALES.usuario && clave === Auth.CREDENCIALES.clave) {
      sessionStorage.setItem('cy_admin_session', '1');
      return true;
    }
    return false;
  },
  logout() { sessionStorage.removeItem('cy_admin_session'); },
  estaLogueado() { return sessionStorage.getItem('cy_admin_session') === '1'; }
};

/* ---------- Utilidades ---------- */
const Utils = {
  hoyISO() { return new Date().toISOString().slice(0, 10); },
  formatFechaLarga(iso) {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
  },
  diaSemana(iso) {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('es-AR', { weekday: 'long' });
  },
  whatsappLink(telefono, mensaje) {
    const tel = (telefono || '').replace(/\D/g, '');
    return `https://wa.me/${tel}?text=${encodeURIComponent(mensaje || '')}`;
  },
  addDays(iso, n) {
    const d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  }
};

iniciarSincronizacion();
