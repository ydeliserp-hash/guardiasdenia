/* ============================================================
   Mock data — Guardias de Residentes (Hospital U. de Dénia)
   All data simulated. Attaches GD to window.
   ============================================================ */
(function () {
  const PASTELS = {
    rosa:      'var(--p-rosa)',
    melocoton: 'var(--p-melocoton)',
    amarillo:  'var(--p-amarillo)',
    menta:     'var(--p-menta)',
    salvia:    'var(--p-salvia)',
    cielo:     'var(--p-cielo)',
    bebe:      'var(--p-bebe)',
    lavanda:   'var(--p-lavanda)',
    lila:      'var(--p-lila)',
    coral:     'var(--p-coral)',
  };
  const PASTEL_ORDER = ['rosa','melocoton','amarillo','menta','salvia','cielo','bebe','lavanda','lila','coral'];
  const PASTEL_LABEL = {
    rosa:'Rosa', melocoton:'Melocotón', amarillo:'Amarillo', menta:'Menta', salvia:'Salvia',
    cielo:'Azul cielo', bebe:'Azul bebé', lavanda:'Lavanda', lila:'Lila', coral:'Coral',
  };

  // role: tutor | r4 | residente | externo
  const USERS = [
    { id:'carmen', nombre:'Carmen Bisbal',  trato:'Dra. Carmen Bisbal', ini:'CB', dni:'21456789X', role:'tutor',     anio:'Tutora',  color:'lavanda', guardias:false, limites:true  },
    { id:'marta',  nombre:'Marta Espí',     trato:'Marta Espí',         ini:'ME', dni:'48721903K', role:'r4',        anio:'R4',      color:'cielo',   guardias:true,  limites:true  },
    { id:'javier', nombre:'Javier Morand',  trato:'Javier Morand',      ini:'JM', dni:'20098451T', role:'r4',        anio:'R4',      color:'salvia',  guardias:true,  limites:true  },
    { id:'lucia',  nombre:'Lucía Sendra',   trato:'Lucía Sendra',       ini:'LS', dni:'53110874P', role:'residente', anio:'R3',      color:'rosa',    guardias:true,  limites:true  },
    { id:'hugo',   nombre:'Hugo Ferrer',    trato:'Hugo Ferrer',        ini:'HF', dni:'44903217M', role:'residente', anio:'R2',      color:'melocoton',guardias:true, limites:true  },
    { id:'aitana', nombre:'Aitana Roselló', trato:'Aitana Roselló',     ini:'AR', dni:'49872013D', role:'residente', anio:'R2',      color:'amarillo',guardias:true,  limites:true  },
    { id:'pablo',  nombre:'Pablo Mengual',  trato:'Pablo Mengual',      ini:'PM', dni:'26540918L', role:'residente', anio:'R1',      color:'menta',   guardias:true,  limites:true  },
    { id:'nerea',  nombre:'Nerea Vidal',    trato:'Nerea Vidal',        ini:'NV', dni:'51230496G', role:'residente', anio:'R1',      color:'bebe',    guardias:true,  limites:true  },
    { id:'tomas',  nombre:'Tomás Gilabert', trato:'Dr. Tomás Gilabert', ini:'TG', dni:'30019283F', role:'externo',   anio:'Externo', color:'coral',   guardias:true,  limites:false },
  ];

  const byId = Object.fromEntries(USERS.map(u => [u.id, u]));

  // ---- June 2026 schedule (1 = Mon ... 7 = Sun) ----
  // day number -> array of 1–2 user ids
  const SHIFTS_2026_06 = {
    1:['lucia'],            2:['hugo','pablo'],     3:['aitana'],          4:['nerea','tomas'],
    5:['marta','hugo'],     6:['javier'],           7:['pablo','aitana'],
    8:['lucia'],            9:['nerea'],            10:['hugo','javier'],  11:['aitana'],
    12:['pablo','nerea'],   13:['lucia','hugo'],    14:['tomas'],
    15:['marta'],           16:['aitana','pablo'],  17:['nerea'],          18:['hugo','lucia'],
    19:['javier'],          20:['aitana','marta'],  21:['pablo'],
    22:['nerea','tomas'],   23:['lucia'],           24:['hugo','aitana'],  25:['pablo'],
    26:['nerea','javier'],  27:['lucia','marta'],   28:['hugo'],
    29:['aitana','pablo'],  30:['nerea'],
  };

  // ---- Stats per year (vi/sa/do limit = 8) ----
  const STATS = {
    2026: {
      marta:  { mes:4, anio:28, vi:5, sa:6, do:4 },
      javier: { mes:3, anio:25, vi:4, sa:5, do:6 },
      lucia:  { mes:5, anio:31, vi:7, sa:7, do:6 },
      hugo:   { mes:5, anio:30, vi:6, sa:7, do:5 },
      aitana: { mes:5, anio:33, vi:7, sa:8, do:7 },  // ámbar: sábados 8/8
      pablo:  { mes:6, anio:29, vi:6, sa:6, do:5 },
      nerea:  { mes:5, anio:34, vi:9, sa:7, do:6 },  // rojo: viernes 9/8
      tomas:  { mes:3, anio:12, vi:2, sa:3, do:2 },  // externo (límites off)
    },
    2025: {
      marta:  { mes:0, anio:46, vi:7, sa:7, do:6 },
      javier: { mes:0, anio:44, vi:6, sa:7, do:7 },
      lucia:  { mes:0, anio:49, vi:8, sa:6, do:7 },  // ámbar viernes
      hugo:   { mes:0, anio:41, vi:5, sa:6, do:6 },
      aitana: { mes:0, anio:47, vi:7, sa:7, do:8 },  // ámbar domingos
      pablo:  { mes:0, anio:38, vi:5, sa:5, do:4 },
      nerea:  { mes:0, anio:40, vi:6, sa:5, do:5 },
      tomas:  { mes:0, anio:18, vi:3, sa:4, do:3 },
    },
  };

  // ---- Change requests ----
  // status: pend_companero | pend_tutor | aprobada | rechazada | cancelada
  const REQUESTS = [
    { id:'rq1', tipo:'intercambio', de:'hugo', a:'lucia',
      guardiaDe:{d:10, label:'Mié 10 jun'}, guardiaA:{d:8, label:'Lun 8 jun'},
      status:'pend_companero', flag:null, fecha:'hace 2 h',
      nota:'¿Te viene bien cambiar? Tengo una cita médica el día 10.' },

    { id:'rq2', tipo:'cesion', de:'lucia', a:'aitana',
      guardiaDe:{d:23, label:'Mar 23 jun'}, guardiaA:null,
      status:'pend_tutor', flag:null, fecha:'ayer',
      nota:'Te cedo la guardia del 23.' },

    { id:'rq3', tipo:'intercambio', de:'nerea', a:'javier',
      guardiaDe:{d:17, label:'Mié 17 jun'}, guardiaA:{d:19, label:'Vie 19 jun'},
      status:'aprobada', flag:null, fecha:'hace 3 días' },

    { id:'rq4', tipo:'cesion', de:'pablo', a:'aitana',
      guardiaDe:{d:27, label:'Sáb 27 jun'}, guardiaA:null,
      status:'pend_tutor', flag:{tipo:'sábados', actual:8, nuevo:9},
      fecha:'hace 5 h',
      nota:'¿Me cubres el sábado 27? Te lo devuelvo en julio.' },

    { id:'rq5', tipo:'intercambio', de:'tomas', a:'nerea',
      guardiaDe:{d:22, label:'Lun 22 jun'}, guardiaA:{d:9, label:'Mar 9 jun'},
      status:'rechazada', flag:null, fecha:'hace 4 días',
      motivo:'No puedo ese día, lo siento.' },

    { id:'rq6', tipo:'cesion', de:'marta', a:'pablo',
      guardiaDe:{d:15, label:'Lun 15 jun'}, guardiaA:null,
      status:'cancelada', flag:null, fecha:'hace 1 semana' },
  ];

  // ---- Notifications (for current resident) ----
  const NOTIS = [
    { id:'n1', tipo:'solicitud', icon:'swap',  titulo:'Hugo Ferrer te propone un intercambio',
      cuerpo:'Su guardia del 10 jun por la tuya del 8 jun.', fecha:'hace 2 h', leida:false, ref:'rq1' },
    { id:'n2', tipo:'plan',      icon:'cal',   titulo:'Plan de guardias de junio publicado',
      cuerpo:'La Dra. Bisbal ha publicado el calendario del mes.', fecha:'hace 6 h', leida:false },
    { id:'n3', tipo:'estado',    icon:'clock', titulo:'Tu cesión a Aitana está pendiente del tutor',
      cuerpo:'Aitana aceptó la guardia del 23 jun. Esperando aprobación.', fecha:'ayer', leida:true, ref:'rq2' },
    { id:'n4', tipo:'aprobada',  icon:'check', titulo:'Cambio aprobado por la tutora',
      cuerpo:'El intercambio entre Nerea y Javier ha sido aprobado.', fecha:'hace 3 días', leida:true, ref:'rq3' },
    { id:'n5', tipo:'recordatorio', icon:'bell', titulo:'Recordatorio de guardia',
      cuerpo:'Tienes guardia el sábado 13 de junio junto a Hugo.', fecha:'hace 3 días', leida:true },
  ];

  const STATUS_META = {
    pend_companero: { label:'Pendiente del compañero', cls:'pill-amber' },
    pend_tutor:     { label:'Pendiente del tutor',     cls:'pill-blue' },
    aprobada:       { label:'Aprobada',                cls:'pill-green' },
    rechazada:      { label:'Rechazada',               cls:'pill-red' },
    cancelada:      { label:'Cancelada',               cls:'pill-muted' },
  };

  const MONTHS = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const DOW = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];

  function initials(u){ return u ? u.ini : '·'; }
  function pastel(u){ return u ? PASTELS[u.color] : 'var(--surface-3)'; }

  window.GD = {
    PASTELS, PASTEL_ORDER, PASTEL_LABEL,
    USERS, byId,
    SHIFTS_2026_06, STATS, REQUESTS, NOTIS,
    STATUS_META, MONTHS, DOW,
    initials, pastel,
    // current logged-in user id (default resident)
    CURRENT: 'lucia',
    YEAR: 2026, MONTH: 5, // June (0-indexed)
    TODAY: 9,
  };
})();
