/* ============================================================
   Notificaciones + Perfil
   ============================================================ */

const NOTI_ICON = { swap: 'swap', cal: 'calendar', clock: 'clock', check: 'check-circle', bell: 'bell' };
const NOTI_TINT = { swap: 'var(--blue-bg)', cal: 'var(--accent-soft-2)', clock: 'var(--amber-bg)', check: 'var(--green-bg)', bell: 'var(--surface-3)' };
const NOTI_FG = { swap: 'var(--blue-text)', cal: 'var(--accent)', clock: 'var(--amber-text)', check: 'var(--green-text)', bell: 'var(--text-muted)' };

function NotificationsList() {
  const { notis, markRead, go } = useApp();
  return (
    <div className="noti-list">
      {notis.map(n => (
        <button key={n.id} className={'noti' + (n.leida ? '' : ' unread')}
          onClick={() => { markRead(n.id); if (n.ref) go('changes'); }}>
          <div className="noti-icn" style={{ background: NOTI_TINT[n.icon], color: NOTI_FG[n.icon] }}>
            <Icon name={NOTI_ICON[n.icon]} size={19} />
          </div>
          <div className="noti-main">
            <div className="noti-title">{n.titulo}</div>
            <div className="noti-body">{n.cuerpo}</div>
            <div className="noti-time">{n.fecha}</div>
          </div>
          {!n.leida && <span className="noti-dot" />}
        </button>
      ))}
    </div>
  );
}
window.NotificationsList = NotificationsList;

function NotificationsScreen() {
  const { markAllRead, back, unread, isDesktop } = useApp();
  if (isDesktop) {
    return (
      <div className="page-pad">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <h2 className="page-title">Notificaciones</h2>
            <p className="page-sub" style={{ margin: 0 }}>{unread > 0 ? `${unread} sin leer` : 'Todo al día'}</p>
          </div>
          {unread > 0 && <button className="btn btn-secondary btn-sm" onClick={markAllRead}>Marcar leídas</button>}
        </div>
        <NotificationsList />
      </div>
    );
  }
  return (
    <div className="scr">
      <header className="appbar">
        <button className="iconbtn" onClick={back} style={{ marginLeft: -8 }}><Icon name="arrow-left" size={22} /></button>
        <div style={{ minWidth: 0 }}>
          <h1 className="appbar-title">Notificaciones</h1>
          <p className="appbar-sub">{unread > 0 ? `${unread} sin leer` : 'Todo al día'}</p>
        </div>
        <div className="appbar-spacer" />
        {unread > 0 && <button className="btn btn-ghost btn-sm" onClick={markAllRead}>Marcar leídas</button>}
      </header>
      <div className="scr-body page-pad">
        <NotificationsList />
      </div>
    </div>
  );
}
window.NotificationsScreen = NotificationsScreen;

/* ---------- Notificaciones push (toggle del Perfil) ---------- */
function PushToggle() {
  const { showToast } = useApp();
  const soportado = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const [estado, setEstado] = useState('cargando'); // cargando | on | off | no-soportado

  useEffect(() => {
    let vivo = true;
    (async () => {
      if (!soportado) { setEstado('no-soportado'); return; }
      try {
        // con tope de tiempo: si iOS tarda en registrar el SW, el botón
        // queda usable igualmente (activar() lo reintenta)
        const sub = await Promise.race([
          (async () => {
            const reg = await navigator.serviceWorker.register('sw.js');
            return reg.pushManager.getSubscription();
          })(),
          new Promise((res) => setTimeout(() => res(null), 2500)),
        ]);
        if (vivo) setEstado(sub ? 'on' : 'off');
      } catch (e) {
        if (vivo) setEstado('off');
      }
    })();
    return () => { vivo = false; };
  }, []); // eslint-disable-line

  function b64ToU8(base64) {
    const pad = '='.repeat((4 - (base64.length % 4)) % 4);
    const b64 = (base64 + pad).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(b64);
    return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
  }

  async function activar() {
    try {
      const permiso = await Notification.requestPermission();
      if (permiso !== 'granted') { showToast('Permiso de notificaciones denegado', 'warn'); return; }
      const reg = await navigator.serviceWorker.register('sw.js');
      const { publicKey } = await API.pushClave();
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(publicKey) });
      await API.pushSuscribir(sub.toJSON());
      setEstado('on');
      showToast('Notificaciones push activadas en este dispositivo');
    } catch (e) {
      showToast('No se pudo activar: ' + e.message, 'err');
    }
  }

  async function desactivar() {
    try {
      const reg = await navigator.serviceWorker.register('sw.js');
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await API.pushBaja(sub.endpoint).catch(() => {});
        await sub.unsubscribe();
      }
      setEstado('off');
      showToast('Notificaciones push desactivadas', 'warn');
    } catch (e) {
      showToast(e.message, 'err');
    }
  }

  if (estado === 'no-soportado') {
    return (
      <div className="set-block" style={{ padding: '12px 14px' }}>
        <div className="set-label">Notificaciones push</div>
        <div className="mini-note" style={{ marginTop: 4 }}>
          En iPhone: añade primero la app a la pantalla de inicio (botón Compartir → "Añadir a pantalla de inicio") y activa las notificaciones desde la app instalada.
        </div>
      </div>
    );
  }

  return (
    <button className="set-row"
      onClick={() => (estado === 'on' ? desactivar() : activar())}>
      <Icon name="bell" size={20} />
      <span>Notificaciones push{estado === 'cargando' ? ' · comprobando…' : ''}</span>
      <div className="set-toggle" data-on={estado === 'on'}><span /></div>
    </button>
  );
}
window.PushToggle = PushToggle;

/* ---------- Perfil ---------- */
function ProfileScreen() {
  const { current, theme, toggleTheme, calTreatment, setCalTreatment, logout } = useApp();
  const s = (GD.STATS[GD.YEAR] || {})[current.id];

  const treatments = [
    { id: 'diagonal', label: 'Diagonal', a: 'lucia', b: 'hugo' },
    { id: 'corners', label: 'Esquinas', a: 'lucia', b: 'hugo' },
    { id: 'split', label: 'Cuadros', a: 'lucia', b: 'hugo' },
  ];

  // tipo de letra de la app (persistente)
  const [fuente, setFuente] = useState(() => localStorage.getItem('gd_font') || 'inter');
  const FUENTES = [
    { id: 'inter', label: 'Inter' },
    { id: 'sistema', label: 'Sistema' },
    { id: 'nunito', label: 'Nunito' },
  ];
  function cambiarFuente(id) {
    setFuente(id);
    localStorage.setItem('gd_font', id);
    applyFont(id);
  }

  // tamaño de letra (escala global, persistente)
  const [tam, setTam] = useState(() => localStorage.getItem('gd_fs') || 'normal');
  const TAMANOS = [
    { id: 'pequena', label: 'A', px: 12, nombre: 'Pequeña' },
    { id: 'normal', label: 'A', px: 14, nombre: 'Normal' },
    { id: 'grande', label: 'A', px: 17, nombre: 'Grande' },
    { id: 'extra', label: 'A', px: 20, nombre: 'Extra' },
  ];
  function cambiarTam(id) {
    setTam(id);
    localStorage.setItem('gd_fs', id);
    applyFontSize(id);
  }

  return (
    <div className="page-pad">
      <h2 className="page-title">Perfil</h2>

      <div className="card prof-card">
        <div className="prof-avatar"><Avatar user={current} size={64} /></div>
        <div className="prof-name">{current.trato}</div>
        <div className="prof-role">
          <span className="pill pill-blue">{current.role === 'tutor' ? 'Tutora' : current.role === 'r4' ? 'R4 · Admin' : current.role === 'externo' ? 'Externo' : 'Residente'}</span>
          {/* el año solo aporta información a los residentes (R1–R3) */}
          {current.role === 'residente' && <span className="pill pill-muted">{current.anio}</span>}
        </div>
        <div className="prof-dni">DNI {current.dni}</div>
      </div>

      {s && current.guardias && (
        <div className="card" style={{ padding: 16, marginTop: 12 }}>
          <div className="section-label" style={{ margin: '0 0 12px' }}>Tus guardias en {GD.YEAR}</div>
          <div className="prof-stats">
            <div><b>{s.mes}</b><span>este mes</span></div>
            <div><b>{s.anio}</b><span>en el año</span></div>
            <div><b>{s.vi}</b><span>viernes</span></div>
            <div><b>{s.sa}</b><span>sábados</span></div>
            <div><b>{s.do}</b><span>domingos</span></div>
          </div>
        </div>
      )}

      <div className="section-label">Apariencia</div>
      <div className="card" style={{ padding: 4 }}>
        <button className="set-row" onClick={toggleTheme}>
          <Icon name={theme === 'light' ? 'sun' : 'moon'} size={20} />
          <span>Tema {theme === 'light' ? 'claro' : 'oscuro'}</span>
          <div className="set-toggle" data-on={theme === 'dark'}><span /></div>
        </button>
        <div className="set-divider" />
        <div className="set-block">
          <div className="set-label">Vista de calendario</div>
          <div className="treat-row">
            {treatments.map(t => (
              <button key={t.id} className={'treat' + (calTreatment === t.id ? ' on' : '')} onClick={() => setCalTreatment(t.id)}>
                {t.id === 'split'
                  ? <span className="treat-split-ico"><i style={{ background: GD.pastel(GD.byId[t.a]) }} /><i style={{ background: GD.pastel(GD.byId[t.b]) }} /></span>
                  : <MiniCell a={t.a} b={t.b} mode={t.id} size={42} />}
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="set-divider" />
        <div className="set-block">
          <div className="set-label">Tipo de letra</div>
          <div className="seg">
            {FUENTES.map(fu => (
              <button key={fu.id} className={fuente === fu.id ? 'on' : ''}
                style={{ fontFamily: ({ inter: "'Inter', sans-serif", sistema: 'system-ui, sans-serif', nunito: "'Nunito', sans-serif" })[fu.id] }}
                onClick={() => cambiarFuente(fu.id)}>{fu.label}</button>
            ))}
          </div>
        </div>
        <div className="set-divider" />
        <div className="set-block">
          <div className="set-label">Tamaño de letra</div>
          <div className="seg">
            {TAMANOS.map(t => (
              <button key={t.id} className={tam === t.id ? 'on' : ''} title={t.nombre}
                style={{ fontSize: t.px, fontWeight: 700, lineHeight: 1 }}
                onClick={() => cambiarTam(t.id)}>{t.label}</button>
            ))}
          </div>
          <div className="mini-note" style={{ marginTop: 6 }}>
            {TAMANOS.find(t => t.id === tam).nombre}
          </div>
        </div>
      </div>

      <div className="section-label">Notificaciones</div>
      <div className="card" style={{ padding: 4 }}>
        <PushToggle />
      </div>

      <div className="section-label">Cuenta</div>
      <div className="card" style={{ padding: 4 }}>
        <button className="set-row danger" onClick={logout}>
          <Icon name="logout" size={20} />
          <span>Cerrar sesión</span>
        </button>
      </div>
    </div>
  );
}
window.ProfileScreen = ProfileScreen;
