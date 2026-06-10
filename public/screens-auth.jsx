/* ============================================================
   Auth — Login + Primer acceso + Crear contraseña (API real)
   ============================================================ */

/* Campo de contraseña con botón para mostrar/ocultar (ojito) */
function EyeIcon({ off }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      {off && <line x1="4" y1="20" x2="20" y2="4" />}
    </svg>
  );
}

function PassInput({ value, onChange, error, autoComplete, onEnter }) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <input className={'input' + (error ? ' err' : '')} type={show ? 'text' : 'password'}
        value={value} onChange={onChange} placeholder="••••••••"
        autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete={autoComplete}
        style={{ paddingRight: 48, boxSizing: 'border-box' }}
        onKeyDown={e => { if (onEnter && e.key === 'Enter') onEnter(); }} />
      <button type="button" onClick={() => setShow(s => !s)}
        aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}
        style={{
          position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)',
          background: 'none', border: 'none', padding: 10, cursor: 'pointer',
          color: 'var(--text-muted)', display: 'flex', alignItems: 'center',
        }}>
        <EyeIcon off={show} />
      </button>
    </div>
  );
}

function AuthScreen() {
  const { loginOk, showToast } = useApp();
  const [mode, setMode] = useState('login'); // login | activar | crear
  const [dni, setDni] = useState('');
  const [pass, setPass] = useState('');
  const [code, setCode] = useState('');
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [err, setErr] = useState({});
  const [busy, setBusy] = useState(false);
  const [tempToken, setTempToken] = useState(null);

  async function doLogin() {
    const e = {};
    if (!dni.trim()) e.dni = 'Introduce tu DNI';
    if (pass.length < 6) e.pass = 'Mínimo 6 caracteres';
    setErr(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const { token, user } = await API.login(dni.trim().toUpperCase(), pass);
      API.setToken(token);
      await loginOk(user);
    } catch (ex) {
      setErr({ pass: ex.message });
    } finally {
      setBusy(false);
    }
  }

  async function doActivar() {
    const e = {};
    if (!dni.trim()) e.dni = 'Introduce tu DNI';
    if (code.replace(/\s/g, '').length < 6) e.code = 'Introduce el código completo';
    setErr(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const r = await API.primerAcceso(dni.trim().toUpperCase(), code.replace(/\s/g, '').toUpperCase());
      setTempToken(r.tempToken);
      setMode('crear');
    } catch (ex) {
      setErr({ code: ex.message });
    } finally {
      setBusy(false);
    }
  }

  async function doCrear() {
    const e = {};
    if (p1.length < 6) e.p1 = 'Mínimo 6 caracteres';
    if (p1 !== p2) e.p2 = 'Las contraseñas no coinciden';
    setErr(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const { token, user } = await API.crearPassword(tempToken, p1);
      API.setToken(token);
      showToast('Contraseña creada. ¡Bienvenida!');
      await loginOk(user);
    } catch (ex) {
      setErr({ p2: ex.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <div className="auth-top">
        <img className="auth-logo" src="assets/logo-denia.png" alt="Hospital de Dénia" />
        <h1 className="auth-h1">Guardias de Residentes</h1>
        <p className="auth-sub">Hospital Universitario de Dénia</p>
      </div>

      <div className="auth-card card">
        {mode === 'login' && (<>
          <div className="field">
            <label className="field-label">DNI</label>
            <input className={'input' + (err.dni ? ' err' : '')} value={dni}
              onChange={e => setDni(e.target.value)} placeholder="00000000A" inputMode="text" autoCapitalize="characters" />
            {err.dni && <div className="field-err">{err.dni}</div>}
          </div>
          <div className="field">
            <label className="field-label">Contraseña</label>
            <PassInput value={pass} onChange={e => setPass(e.target.value)}
              error={err.pass} autoComplete="current-password" onEnter={doLogin} />
            {err.pass && <div className="field-err">{err.pass}</div>}
          </div>
          <button className="btn btn-primary" disabled={busy} onClick={doLogin}>{busy ? 'Entrando…' : 'Entrar'}</button>
          <button className="auth-link" onClick={() => { setErr({}); setMode('activar'); }}>
            Primer acceso · activar cuenta
          </button>
        </>)}

        {mode === 'activar' && (<>
          <div className="auth-back" onClick={() => { setErr({}); setMode('login'); }}>
            <Icon name="arrow-left" size={18} /> Volver
          </div>
          <h2 className="sheet-title" style={{ marginTop: 4 }}>Primer acceso</h2>
          <p className="sheet-sub">Introduce tu DNI y el código de activación que te ha facilitado tu tutor.</p>
          <div className="field">
            <label className="field-label">DNI</label>
            <input className={'input' + (err.dni ? ' err' : '')} value={dni}
              onChange={e => setDni(e.target.value)} placeholder="00000000A" autoCapitalize="characters" />
            {err.dni && <div className="field-err">{err.dni}</div>}
          </div>
          <div className="field">
            <label className="field-label">Código de activación</label>
            <input className={'input' + (err.code ? ' err' : '')} value={code}
              onChange={e => setCode(e.target.value)} placeholder="Código facilitado por tu tutor" autoCapitalize="characters" />
            {err.code && <div className="field-err">{err.code}</div>}
          </div>
          <button className="btn btn-primary" disabled={busy} onClick={doActivar}>{busy ? 'Comprobando…' : 'Continuar'}</button>
        </>)}

        {mode === 'crear' && (<>
          <div className="auth-back" onClick={() => { setErr({}); setMode('activar'); }}>
            <Icon name="arrow-left" size={18} /> Volver
          </div>
          <h2 className="sheet-title" style={{ marginTop: 4 }}>Crea tu contraseña</h2>
          <p className="sheet-sub">Al menos 6 caracteres: letras, números o una combinación. Se distingue entre mayúsculas y minúsculas. La usarás para entrar a partir de ahora.</p>
          <div className="field">
            <label className="field-label">Nueva contraseña</label>
            <PassInput value={p1} onChange={e => setP1(e.target.value)}
              error={err.p1} autoComplete="new-password" />
            {err.p1 && <div className="field-err">{err.p1}</div>}
          </div>
          <div className="field">
            <label className="field-label">Repite la contraseña</label>
            <PassInput value={p2} onChange={e => setP2(e.target.value)}
              error={err.p2} autoComplete="new-password" onEnter={doCrear} />
            {err.p2 && <div className="field-err">{err.p2}</div>}
          </div>
          <button className="btn btn-primary" disabled={busy} onClick={doCrear}>{busy ? 'Creando…' : 'Crear contraseña y entrar'}</button>
        </>)}
      </div>

      <p className="auth-foot"><Icon name="lock" size={13} /> Acceso restringido · Hospital U. de Dénia</p>
    </div>
  );
}
window.AuthScreen = AuthScreen;
