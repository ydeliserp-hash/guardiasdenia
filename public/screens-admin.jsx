/* ============================================================
   Administración (tutor / R4) — usuarios + alta + modo edición
   ============================================================ */

const ROLES = [
  { id: 'tutor', label: 'Tutor' },
  { id: 'r4', label: 'R4' },
  { id: 'residente', label: 'Residente' },
  { id: 'externo', label: 'Externo' },
];
const ROLE_LABEL = { tutor: 'Tutora', r4: 'R4 · Admin', residente: 'Residente', externo: 'Externo' };

function AdminScreen() {
  const { users, syncUsers, setScreen, setEditMode, showToast } = useApp();
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState(null); // usuario recién creado (con código de activación)
  const [f, setF] = useState({ nombre: '', dni: '', role: 'residente', anio: 'R1', color: null, limites: true });

  const usedColors = new Set(users.map(u => u.color));

  function reset() { setF({ nombre: '', dni: '', role: 'residente', anio: 'R1', color: null, limites: true }); }
  async function save() {
    if (!f.nombre.trim() || !f.dni.trim() || !f.color) { showToast('Completa nombre, DNI y color', 'warn'); return; }
    setSaving(true);
    try {
      const nuevo = await API.altaUsuario({
        nombre: f.nombre.trim(),
        dni: f.dni.trim().toUpperCase(),
        role: f.role,
        anio: f.role === 'externo' ? 'Externo' : f.role === 'tutor' ? 'Tutora' : f.anio,
        color: f.color,
        aplica_limites: f.role === 'externo' ? f.limites : true,
      });
      await syncUsers();
      setAdding(false); reset();
      setCreated(nuevo); // muestra el código de activación
    } catch (e) {
      showToast(e.message, 'err');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-pad">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <h2 className="page-title" style={{ flex: 1 }}>Administración</h2>
        <button className="btn btn-primary btn-sm" onClick={() => { reset(); setAdding(true); }}><Icon name="plus" size={16} /> Alta</button>
      </div>
      <p className="page-sub">Gestión de usuarios y plan de guardias.</p>

      <button className="card admin-cta" onClick={() => { setScreen('calendar'); setEditMode(true); }}>
        <div className="admin-cta-icn"><Icon name="edit" size={20} /></div>
        <div style={{ flex: 1 }}>
          <div className="row-title">Editar plan de guardias</div>
          <div className="row-meta">Asignar residentes y publicar el mes</div>
        </div>
        <Icon name="chevR" size={18} style={{ color: 'var(--text-faint)' }} />
      </button>

      <div className="section-label">Usuarios ({users.length})</div>
      <div className="card" style={{ padding: '4px 16px' }}>
        {users.map(u => (
          <div key={u.id} className="row">
            <ColorDot color={u.color} />
            <div className="row-main">
              <div className="row-title">{u.nombre}</div>
              <div className="row-meta">DNI {u.dni}{u.pendiente_activacion && u.activation_code ? ` · código ${u.activation_code}` : ''}</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
              <span className={'pill ' + (u.role === 'tutor' ? 'pill-blue' : u.role === 'externo' ? 'pill-muted' : 'pill-green')}>{ROLE_LABEL[u.role]}</span>
              {u.role === 'externo' && !u.limites && <span className="mini-note">sin control Vi/Sa/Do</span>}
            </div>
          </div>
        ))}
      </div>

      {/* Alta de usuario */}
      <Sheet open={adding} onClose={() => setAdding(false)} title="Alta de usuario" sub="Da de alta a un nuevo residente o tutor.">
        <div className="field">
          <label className="field-label">Nombre completo</label>
          <input className="input" value={f.nombre} onChange={e => setF({ ...f, nombre: e.target.value })} placeholder="Nombre y apellidos" />
        </div>
        <div className="field">
          <label className="field-label">DNI</label>
          <input className="input" value={f.dni} onChange={e => setF({ ...f, dni: e.target.value })} placeholder="00000000A" autoCapitalize="characters" />
        </div>
        <div className="field">
          <label className="field-label">Rol</label>
          <div className="seg">
            {ROLES.map(r => <button key={r.id} className={f.role === r.id ? 'on' : ''} onClick={() => setF({ ...f, role: r.id })}>{r.label}</button>)}
          </div>
        </div>
        {(f.role === 'residente' || f.role === 'r4') && (
          <div className="field">
            <label className="field-label">Año de residencia</label>
            <div className="seg">
              {['R1', 'R2', 'R3', 'R4'].map(a => <button key={a} className={f.anio === a ? 'on' : ''} onClick={() => setF({ ...f, anio: a })}>{a}</button>)}
            </div>
          </div>
        )}
        {f.role === 'externo' && (
          <button className="set-row plain" onClick={() => setF({ ...f, limites: !f.limites })}>
            <span>Aplicar control de límites Vi/Sa/Do</span>
            <div className="set-toggle" data-on={f.limites}><span /></div>
          </button>
        )}
        <div className="field" style={{ marginTop: 6 }}>
          <label className="field-label">Color asignado</label>
          <div className="color-grid">
            {GD.PASTEL_ORDER.map(c => {
              const used = usedColors.has(c);
              return (
                <button key={c} className={'swatch' + (f.color === c ? ' on' : '') + (used ? ' used' : '')}
                  disabled={used} title={used ? 'En uso' : GD.PASTEL_LABEL[c]}
                  style={{ background: GD.PASTELS[c] }}
                  onClick={() => setF({ ...f, color: c })}>
                  {f.color === c && <Icon name="check" size={16} style={{ color: '#1F2937' }} />}
                  {used && <Icon name="close" size={14} style={{ color: '#1F2937', opacity: .4 }} />}
                </button>
              );
            })}
          </div>
          <div className="mini-note" style={{ marginTop: 8 }}>Los colores en uso aparecen deshabilitados.</div>
        </div>
        {/* Botón final siempre visible (fijo al pie de la hoja), activo al completar los datos */}
        <div style={{
          position: 'sticky', bottom: 0, margin: '14px -18px 0', padding: '12px 18px 4px',
          background: 'var(--surface)', boxShadow: '0 -10px 14px -12px rgba(0,0,0,0.25)',
        }}>
          <button className="btn btn-primary" style={{ width: '100%' }}
            disabled={saving || !(f.nombre.trim() && f.dni.trim() && f.color)} onClick={save}>
            <Icon name="check" size={17} /> {saving ? 'Creando…' : 'Aceptar'}
          </button>
          {!(f.nombre.trim() && f.dni.trim() && f.color) && (
            <div className="mini-note" style={{ textAlign: 'center', marginTop: 6 }}>
              Completa nombre, DNI y color para continuar.
            </div>
          )}
        </div>
      </Sheet>

      {/* Código de activación del usuario recién creado */}
      <Dialog open={!!created} onClose={() => setCreated(null)}>
        {created && (<>
          <h3 className="dlg-title">Usuario creado</h3>
          <p className="dlg-text"><b>{created.nombre}</b> ya está dado de alta. Su código de activación es:</p>
          <p className="dlg-text" style={{ fontSize: 24, fontWeight: 800, letterSpacing: 3, textAlign: 'center', margin: '10px 0' }}>
            {created.activation_code}
          </p>
          <p className="dlg-text">Entrégaselo para su primer acceso (DNI + código). No caduca y solo puede usarse una vez. También podrás verlo en la lista de usuarios mientras no lo use.</p>
          <button className="btn btn-primary" onClick={() => setCreated(null)}>Entendido</button>
        </>)}
      </Dialog>
    </div>
  );
}
window.AdminScreen = AdminScreen;
