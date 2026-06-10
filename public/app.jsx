/* ============================================================
   App shell — frame, theme, routing, global state (context)
   ============================================================ */
const { useState, useEffect, useMemo, useRef, useCallback, createContext, useContext } = React;

const AppCtx = createContext(null);
const useApp = () => useContext(AppCtx);
window.AppCtx = AppCtx;
window.useApp = useApp;

/* ---------- Tweaks: accent palettes + bridge ---------- */
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "#1E3A5F",
  "cell": "diagonal",
  "font": "inter",
  "push": false,
  "dark": false
}/*EDITMODE-END*/;

const FONTS = {
  inter:   "'Inter', system-ui, sans-serif",
  sistema: "-apple-system, system-ui, 'Segoe UI', Roboto, sans-serif",
  nunito:  "'Nunito', system-ui, sans-serif",
};
function applyFont(key) {
  document.documentElement.style.setProperty('--font', FONTS[key] || FONTS.inter);
}
// Aplica la letra guardada por el usuario al arrancar (Perfil → Apariencia).
applyFont(localStorage.getItem('gd_font') || 'inter');

// Tamaño de letra de la app (escala global del texto, sin tocar el diseño).
const FONT_SIZES = { pequena: '92%', normal: '100%', grande: '112%', extra: '124%' };
function applyFontSize(key) {
  const v = FONT_SIZES[key] || '100%';
  document.documentElement.style.webkitTextSizeAdjust = v;
  document.documentElement.style.textSizeAdjust = v;
}
window.applyFontSize = applyFontSize;
applyFontSize(localStorage.getItem('gd_fs') || 'normal');

const ACCENTS = {
  '#1E3A5F': { l: '#1E3A5F', l7: '#16304F', d: '#6FA8DC', d7: '#8FBEE8', rl: '30,58,95', rd: '111,168,220' },
  '#0F766E': { l: '#0F766E', l7: '#0B5C55', d: '#5EC8BC', d7: '#7FD6CC', rl: '15,118,110', rd: '94,200,188' },
  '#2563A6': { l: '#2563A6', l7: '#1D4F86', d: '#7BB0E8', d7: '#9AC5F0', rl: '37,99,166', rd: '123,176,232' },
};
function applyAccent(hex) {
  const a = ACCENTS[hex] || ACCENTS['#1E3A5F'];
  let el = document.getElementById('tweak-accent');
  if (!el) { el = document.createElement('style'); el.id = 'tweak-accent'; document.head.appendChild(el); }
  el.textContent =
    `.app-root[data-theme="light"]{--accent:${a.l};--accent-700:${a.l7};--accent-soft:rgba(${a.rl},0.07);--accent-soft-2:rgba(${a.rl},0.12)}` +
    `.app-root[data-theme="dark"]{--accent:${a.d};--accent-700:${a.d7};--accent-soft:rgba(${a.rd},0.13);--accent-soft-2:rgba(${a.rd},0.22)}`;
}

/* deep-clone helpers for mutable mock state */
const clone = (o) => JSON.parse(JSON.stringify(o));

function AppProvider({ children }) {
  // Tema: el guardado por el usuario o, si no, el del sistema (oscuro automático).
  const [theme, setTheme] = useState(() =>
    localStorage.getItem('gd_theme')
    || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  const [authed, setAuthed] = useState(false);
  const [booting, setBooting] = useState(true);
  const [current, setCurrent] = useState(null);
  const [screen, setScreen] = useState('calendar');
  const [prevScreen, setPrevScreen] = useState('calendar');
  const [calTreatment, setCalTreatment] = useState('diagonal');
  const [editMode, setEditMode] = useState(false);

  // estado real, cargado desde la API tras el login
  const hoy = useMemo(() => new Date(), []);
  const [requests, setRequests] = useState([]);
  const [notis, setNotis] = useState([]);
  const [users, setUsers] = useState([]);
  const [schedule, setSchedule] = useState({});
  const [published, setPublished] = useState(false);
  const [calY, setCalY] = useState(hoy.getFullYear());
  const [calM, setCalM] = useState(hoy.getMonth()); // 0-indexado

  const [reqSeed, setReqSeed] = useState(null); // {fromDay, mode} to preload Cambios flow
  const [isDesktop, setIsDesktop] = useState(() => window.innerWidth >= 900);
  useEffect(() => {
    const on = () => setIsDesktop(window.innerWidth >= 900);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const showToast = useCallback((msg, kind = 'ok') => {
    setToast({ msg, kind, id: Date.now() });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  /* ---- sincronización con la API ---- */
  const syncUsers = useCallback(async () => {
    const us = await API.usuarios();
    GD.USERS = us;
    GD.byId = Object.fromEntries(us.map(u => [u.id, u]));
    setUsers(us.filter(u => u.activo !== false));
  }, []);

  const syncSolicitudes = useCallback(async () => {
    setRequests(await API.solicitudes());
  }, []);

  const syncNotis = useCallback(async () => {
    const d = await API.notificaciones();
    setNotis(d.notificaciones || []);
  }, []);

  const syncStats = useCallback(async () => {
    const y = hoy.getFullYear();
    const [a, b] = await Promise.all([
      API.estadisticas(y, hoy.getMonth() + 1),
      API.estadisticas(y - 1),
    ]);
    GD.STATS = { [y]: a.stats, [y - 1]: b.stats };
  }, [hoy]);

  // Memoria de meses ya visitados: volver a un mes es instantáneo
  // (se enseña lo recordado y se refresca por detrás).
  const mesCacheRef = useRef({});
  const loadMonth = useCallback(async (y, m0) => {
    setCalY(y); setCalM(m0);
    const clave = y + '-' + m0;
    const recordado = mesCacheRef.current[clave];
    if (recordado) {
      setSchedule(recordado.guardias);
      setPublished(recordado.publicado);
    } else {
      setSchedule({}); // mes nuevo: cuadrícula limpia mientras llega
    }
    try {
      const plan = await API.plan(y, m0 + 1);
      const datos = { guardias: plan.guardias || {}, publicado: plan.estado === 'publicado' };
      mesCacheRef.current[clave] = datos;
      setSchedule(datos.guardias);
      setPublished(datos.publicado);
    } catch (e) {
      if (!recordado) { setSchedule({}); setPublished(false); }
    }
  }, []);

  const calYRef = useRef({ y: hoy.getFullYear(), m: hoy.getMonth() });
  useEffect(() => { calYRef.current = { y: calY, m: calM }; }, [calY, calM]);

  const refrescar = useCallback(async () => {
    await Promise.all([
      syncSolicitudes(), syncNotis(), syncStats(),
      loadMonth(calYRef.current.y, calYRef.current.m),
    ]);
  }, [syncSolicitudes, syncNotis, syncStats, loadMonth]);

  /* ---- sesión ---- */
  const loginOk = useCallback(async (user) => {
    GD.YEAR = hoy.getFullYear(); GD.MONTH = hoy.getMonth(); GD.TODAY = hoy.getDate();
    await syncUsers(); // primero: el resto de pantallas dependen de GD.byId
    await Promise.all([
      syncSolicitudes(), syncNotis(), syncStats(),
      loadMonth(GD.YEAR, GD.MONTH),
    ]);
    setCurrent(user);
    setAuthed(true);
  }, [hoy, syncUsers, syncSolicitudes, syncNotis, syncStats, loadMonth]);

  const logout = useCallback(() => {
    API.setToken(null);
    setAuthed(false); setCurrent(null);
    setScreen('calendar'); setEditMode(false);
    setRequests([]); setNotis([]); setSchedule({});
  }, []);

  // restaurar sesión guardada al abrir la app
  useEffect(() => {
    (async () => {
      if (API.token) {
        try {
          const { user } = await API.me();
          await loginOk(user);
        } catch (e) {
          API.setToken(null);
        }
      }
      setBooting(false);
    })();
  }, []); // eslint-disable-line

  // refresco ligero periódico (notis + solicitudes)
  useEffect(() => {
    if (!authed) return;
    const t = setInterval(() => {
      syncNotis().catch(() => {});
      syncSolicitudes().catch(() => {});
    }, 60000);
    return () => clearInterval(t);
  }, [authed, syncNotis, syncSolicitudes]);

  const isStaff = current && (current.role === 'tutor' || current.role === 'r4');
  const isTutor = current && current.role === 'tutor';

  const go = useCallback((s) => { setScreen(prev => { setPrevScreen(prev); return s; }); }, []);
  const back = useCallback(() => setScreen(prevScreen || 'calendar'), [prevScreen]);

  const toggleTheme = useCallback(() => setTheme(t => {
    const nuevo = t === 'light' ? 'dark' : 'light';
    localStorage.setItem('gd_theme', nuevo); // la elección manual manda sobre el sistema
    return nuevo;
  }), []);

  const unread = notis.filter(n => !n.leida).length;
  const markAllRead = useCallback(() => {
    setNotis(ns => ns.map(n => ({ ...n, leida: true })));
    API.leerTodasNotis().catch(() => {});
  }, []);
  const markRead = useCallback((id) => {
    setNotis(ns => ns.map(n => n.id === id ? { ...n, leida: true } : n));
    API.leerNoti(id).catch(() => {});
  }, []);

  /* ---- acciones reales sobre solicitudes ---- */
  const accion = useCallback(async (fn, okMsg, kind = 'ok') => {
    try {
      await fn();
      if (okMsg) showToast(okMsg, kind);
      // La sincronización va en segundo plano: la interfaz responde ya.
      refrescar().catch(() => {});
      return true;
    } catch (e) {
      showToast(e.message, 'err');
      return false;
    }
  }, [refrescar, showToast]);

  const aceptarReq = useCallback((id) =>
    accion(() => API.aceptarSolicitud(id), 'Aceptada · pendiente del tutor'), [accion]);
  const rechazarReq = useCallback((id, motivo) =>
    accion(() => API.rechazarSolicitud(id, motivo), 'Solicitud rechazada', 'warn'), [accion]);
  const aprobarReq = useCallback((id, confirmar) =>
    accion(() => API.aprobarSolicitud(id, confirmar), confirmar ? 'Aprobado pese al exceso' : 'Cambio aprobado'), [accion]);
  const cancelarReq = useCallback((id) =>
    accion(() => API.cancelarSolicitud(id), 'Solicitud cancelada'), [accion]);
  const crearReq = useCallback((body, okMsg) =>
    accion(() => API.crearSolicitud(body), okMsg), [accion]);

  const value = {
    theme, setTheme, toggleTheme,
    authed, booting, loginOk, logout,
    users, current, isStaff, isTutor,
    screen, go, back, prevScreen, setScreen,
    calTreatment, setCalTreatment,
    editMode, setEditMode,
    requests, aceptarReq, rechazarReq, aprobarReq, cancelarReq, crearReq,
    notis, unread, markAllRead, markRead,
    schedule, setSchedule, published, setPublished,
    calY, calM, loadMonth, refrescar, syncUsers,
    reqSeed, setReqSeed,
    isDesktop,
    toast, showToast,
  };
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

/* ---------- Header (appbar) ---------- */
function AppBar() {
  const { current, theme, toggleTheme, unread, go } = useApp();
  return (
    <header className="appbar">
      <img className="appbar-logo" src="assets/logo-denia.png" alt="Hospital U. de Dénia" />
      <div style={{ minWidth: 0 }}>
        <h1 className="appbar-title">Guardias</h1>
      </div>
      <div className="appbar-spacer" />
      <button className="iconbtn" onClick={toggleTheme} aria-label="Tema">
        <Icon name={theme === 'light' ? 'moon' : 'sun'} size={21} />
      </button>
      <button className="iconbtn" onClick={() => go('notis')} aria-label="Notificaciones">
        <Icon name="bell" size={22} />
        {unread > 0 && <span className="badge">{unread}</span>}
      </button>
    </header>
  );
}

/* ---------- Bottom nav ---------- */
function BottomNav() {
  const { screen, setScreen, isStaff } = useApp();
  const items = [
    { id: 'calendar', label: 'Calendario', icon: 'calendar' },
    { id: 'stats', label: 'Estadísticas', icon: 'stats' },
    { id: 'changes', label: 'Cambios', icon: 'swap' },
    { id: 'profile', label: 'Perfil', icon: 'user' },
  ];
  if (isStaff) items.push({ id: 'admin', label: 'Admin', icon: 'shield' });
  const active = ['notis'].includes(screen) ? null : screen;
  return (
    <nav className="botnav">
      {items.map(it => (
        <button key={it.id}
          className={'botnav-item' + (active === it.id ? ' active' : '') + (it.id === 'admin' ? ' admin' : '')}
          onClick={() => setScreen(it.id)}>
          <Icon name={it.icon} size={23} stroke={active === it.id ? 2.3 : 2} />
          <span>{it.label}</span>
        </button>
      ))}
    </nav>
  );
}

/* ---------- Toast ---------- */
function Toast() {
  const { toast } = useApp();
  if (!toast) return null;
  const icon = toast.kind === 'warn' ? 'warn' : toast.kind === 'err' ? 'x-circle' : 'check-circle';
  return (
    <div className="toast-wrap">
      <div className={'toast ' + toast.kind}>
        <Icon name={icon} size={18} />
        <span>{toast.msg}</span>
      </div>
    </div>
  );
}

/* ---------- Red de seguridad: un error de pantalla nunca deja la app en blanco ---------- */
class Guardian extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('Error de pantalla:', error, info); }
  render() {
    if (this.state.error) {
      const e = this.state.error;
      const detalle = (e && (e.message || String(e))) + '\n' + ((e && e.stack) || '').split('\n').slice(1, 4).join('\n');
      return (
        <div className="page-pad" style={{ paddingTop: 48, textAlign: 'center' }}>
          <h2 className="page-title">Vaya, algo ha fallado</h2>
          <p className="page-sub">Se ha producido un error en esta pantalla. Tus datos están a salvo.</p>
          <button className="btn btn-primary" style={{ marginTop: 10 }}
            onClick={() => { this.setState({ error: null }); this.props.onReset && this.props.onReset(); }}>
            Volver al calendario
          </button>
          {/* detalle técnico: haz captura de esto si vuelve a pasar */}
          <div className="mini-note" style={{
            marginTop: 18, textAlign: 'left', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            background: 'var(--surface)', borderRadius: 12, padding: '10px 12px', fontSize: 11,
          }}>
            {detalle}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

/* ---------- Routed screen body ---------- */
function ScreenBody() {
  const { screen } = useApp();
  switch (screen) {
    case 'calendar': return <CalendarScreen />;
    case 'stats': return <StatsScreen />;
    case 'changes': return <ChangesScreen />;
    case 'profile': return <ProfileScreen />;
    case 'admin': return <AdminScreen />;
    case 'notis': return <NotificationsScreen />;
    case 'historial': return <HistorialScreen />;
    default: return <CalendarScreen />;
  }
}

/* ---------- Authenticated app frame ---------- */
function AppMain() {
  const { screen, setScreen } = useApp();
  const noChrome = screen === 'notis'; // notis renders its own header
  return (
    <div className="scr">
      {!noChrome && <AppBar />}
      <div className="scr-body">
        <Guardian onReset={() => setScreen('calendar')}>
          <ScreenBody />
        </Guardian>
      </div>
      {!noChrome && <BottomNav />}
      <Toast />
    </div>
  );
}

/* ---------- Phone frame + scaler ---------- */
function Cargando() {
  return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
      Cargando…
    </div>
  );
}

function Phone() {
  // Móvil real: la app ocupa toda la pantalla, sin el marco de iPhone del
  // prototipo (el sistema ya pone su propia barra de estado).
  const { theme, authed, booting } = useApp();
  useEffect(() => { document.body.setAttribute('data-stage', theme); }, [theme]);
  return (
    <div className="app-root mobile-full" data-theme={theme}>
      <div className="frame-body">
        {booting ? <Cargando /> : authed ? <AppMain /> : <AuthScreen />}
      </div>
      <div id="overlay-root" />
    </div>
  );
}

function App() {
  return (
    <AppProvider>
      <Shell />
      <TweaksBridge />
    </AppProvider>
  );
}

function Shell() {
  const { isDesktop } = useApp();
  return isDesktop ? <Desktop /> : <Phone />;
}

/* ---------- Desktop layout: sidebar rail + wide content ---------- */
function DeskRail() {
  const { current, theme, toggleTheme, unread, screen, setScreen, isStaff } = useApp();
  const items = [
    { id: 'calendar', label: 'Calendario', icon: 'calendar' },
    { id: 'stats', label: 'Estadísticas', icon: 'stats' },
    { id: 'changes', label: 'Cambios', icon: 'swap' },
    { id: 'profile', label: 'Perfil', icon: 'user' },
  ];
  if (isStaff) items.push({ id: 'admin', label: 'Administración', icon: 'shield' });
  return (
    <aside className="dk-rail">
      <div className="dk-brand">
        <img className="dk-logo" src="assets/logo-denia.png" alt="Dénia" />
        <div>
          <div className="dk-brand-t">Guardias</div>
          <div className="dk-brand-s">H. U. de Dénia</div>
        </div>
      </div>

      <nav className="dk-nav">
        {items.map(it => (
          <button key={it.id} className={'dk-navitem' + (screen === it.id ? ' active' : '')}
            onClick={() => setScreen(it.id)}>
            <Icon name={it.icon} size={20} stroke={screen === it.id ? 2.3 : 2} />
            <span>{it.label}</span>
          </button>
        ))}
      </nav>

      <div className="dk-rail-foot">
        <button className={'dk-navitem' + (screen === 'notis' ? ' active' : '')} onClick={() => setScreen('notis')}>
          <span style={{ position: 'relative', display: 'flex' }}>
            <Icon name="bell" size={20} />
            {unread > 0 && <span className="dk-badge">{unread}</span>}
          </span>
          <span>Notificaciones</span>
        </button>
        <button className="dk-navitem" onClick={toggleTheme}>
          <Icon name={theme === 'light' ? 'moon' : 'sun'} size={20} />
          <span>Tema {theme === 'light' ? 'oscuro' : 'claro'}</span>
        </button>
        <button className="dk-user" onClick={() => setScreen('profile')}>
          <Avatar user={current} size={36} />
          <div style={{ minWidth: 0, textAlign: 'left' }}>
            <div className="dk-user-n">{current.nombre}</div>
            <div className="dk-user-r">{current.role === 'tutor' ? 'Tutor' : current.role === 'r4' ? 'R4 · Admin' : current.role === 'externo' ? 'Externo' : current.anio}</div>
          </div>
        </button>
      </div>
    </aside>
  );
}

function Desktop() {
  const { theme, authed, booting } = useApp();
  useEffect(() => { document.body.setAttribute('data-stage', theme); }, [theme]);
  if (booting) {
    return (
      <div className="dk-root" data-theme={theme}>
        <div className="dk-authwrap"><Cargando /></div>
      </div>
    );
  }
  if (!authed) {
    return (
      <div className="dk-root" data-theme={theme}>
        <div className="dk-authwrap"><AuthScreen /></div>
      </div>
    );
  }
  return (
    <div className="dk-root" data-theme={theme}>
      <DeskRail />
      <main className="dk-main">
        <div className="dk-scroll">
          <div className="dk-content">
            <Guardian onReset={() => { /* vuelve al calendario */ window.location.hash = ''; }}>
              <ScreenBody />
            </Guardian>
          </div>
        </div>
      </main>
      <Toast />
      <div id="overlay-root" />
    </div>
  );
}

function TweaksBridge() {
  const { theme, setTheme, calTreatment, setCalTreatment, showToast } = useApp();
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  useEffect(() => { applyAccent(t.accent); }, [t.accent]);
  useEffect(() => { applyFont(t.font); }, [t.font]);
  useEffect(() => { if (t.cell && t.cell !== calTreatment) setCalTreatment(t.cell); }, []); // eslint-disable-line
  const cellOpts = [
    { value: 'diagonal', label: 'Diagonal' },
    { value: 'fichas', label: 'Fichas' },
    { value: 'split', label: 'Cuadros' },
  ];
  const fontOpts = [
    { value: 'inter', label: 'Inter' },
    { value: 'sistema', label: 'Sistema' },
    { value: 'nunito', label: 'Nunito' },
  ];
  return (
    <TweaksPanel title="Tweaks">
      <TweakSection label="Marca" />
      <TweakColor label="Color de acento" value={t.accent}
        options={['#1E3A5F', '#0F766E', '#2563A6']}
        onChange={v => setTweak('accent', v)} />
      <TweakSection label="Calendario" />
      <TweakRadio label="Vista de calendario" value={calTreatment}
        options={cellOpts}
        onChange={v => { setCalTreatment(v); setTweak('cell', v); }} />
      <TweakSection label="Tipografía" />
      <TweakRadio label="Formato de letra" value={t.font}
        options={fontOpts}
        onChange={v => setTweak('font', v)} />
      <TweakSection label="Notificaciones" />
      <TweakToggle label="Notificaciones push" value={t.push}
        onChange={v => { setTweak('push', v); showToast(v ? 'Notificaciones push activadas' : 'Notificaciones push desactivadas', v ? 'ok' : 'warn'); }} />
      <TweakSection label="Apariencia" />
      <TweakToggle label="Tema oscuro" value={theme === 'dark'}
        onChange={v => setTheme(v ? 'dark' : 'light')} />
    </TweaksPanel>
  );
}

/* ---------- mount + responsive scale ---------- */
const scaler = document.getElementById('scaler');
scaler.innerHTML = '';
ReactDOM.createRoot(scaler).render(<App />);

// Sin marco de dispositivo ya no se escala nada: la app ocupa la pantalla.
// 'none' (y no 'scale(1)') porque cualquier transform en un ancestro rompería
// el position:fixed del contenedor móvil.
function fit() {
  document.getElementById('scaler').style.transform = 'none';
}
window.addEventListener('resize', fit);
setTimeout(fit, 30); fit();
