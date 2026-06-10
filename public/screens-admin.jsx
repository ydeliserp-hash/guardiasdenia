/* ============================================================
   Administración (tutor / R4) — usuarios + alta + modo edición
   ============================================================ */

const ROLES = [
  { id: 'tutor', label: 'Tutor' },
  { id: 'r4', label: 'R4' },
  { id: 'residente', label: 'Residente' },
  { id: 'externo', label: 'Externo' },
];
const ROLE_LABEL = { tutor: 'Tutor', r4: 'R4 · Admin', residente: 'Residente', externo: 'Externo' };

function AdminScreen() {
  const { users, syncUsers, setScreen, setEditMode, showToast, current } = useApp();
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState(null); // usuario recién creado (con código de activación)
  const [f, setF] = useState({ nombre: '', dni: '', role: 'residente', anio: 'R1', color: null, limites: true });

  // edición de un usuario existente
  const [editing, setEditing] = useState(null); // usuario seleccionado
  const [fe, setFe] = useState(null);           // formulario de edición
  const [savingEdit, setSavingEdit] = useState(false);
  const [confirmBaja, setConfirmBaja] = useState(false);

  const usedColors = new Set(users.map(u => u.color));

  function reset() { setF({ nombre: '', dni: '', role: 'residente', anio: 'R1', color: null, limites: true }); }

  // Elegir una opción cierra antes el teclado del móvil: si queda abierto,
  // en iOS la hoja fija se descoloca y deja de responder al scroll.
  function cerrarTeclado() {
    const el = document.activeElement;
    if (el && typeof el.blur === 'function') el.blur();
  }
  function elegir(patch) { cerrarTeclado(); setF(prev => ({ ...prev, ...patch })); }
  function elegirE(patch) { cerrarTeclado(); setFe(prev => ({ ...prev, ...patch })); }

  function abrirEdicion(u) {
    setFe({
      nombre: u.nombre, dni: u.dni || '', role: u.role,
      anio: ['R1', 'R2', 'R3', 'R4'].includes(u.anio) ? u.anio : 'R1',
      color: u.color || null, limites: u.limites,
    });
    setConfirmBaja(false);
    setEditing(u);
  }

  const editColorOk = fe && (fe.role === 'tutor' || fe.color);
  const completoE = !!(fe && fe.nombre.trim() && fe.dni.trim() && editColorOk);

  async function guardarEdicion() {
    if (!completoE) { showToast('Completa los datos obligatorios', 'warn'); return; }
    setSavingEdit(true);
    try {
      await API.editarUsuario(editing.id, {
        nombre: fe.nombre.trim(),
        dni: fe.dni.trim().toUpperCase(),
        role: fe.role,
        anio: fe.role === 'externo' ? 'Externo' : fe.role === 'tutor' ? 'Tutor' : fe.anio,
        color: fe.role === 'tutor' ? null : fe.color,
        aplica_limites: fe.role === 'externo' ? fe.limites : true,
        hace_guardias: fe.role !== 'tutor',
      });
      await syncUsers();
      setEditing(null);
      showToast('Usuario actualizado');
    } catch (e) {
      showToast(e.message, 'err');
    } finally {
      setSavingEdit(false);
    }
  }

  async function darDeBaja() {
    setSavingEdit(true);
    try {
      await API.bajaUsuario(editing.id);
      await syncUsers();
      setEditing(null);
      showToast('Usuario dado de baja (su color queda libre)', 'warn');
    } catch (e) {
      showToast(e.message, 'err');
    } finally {
      setSavingEdit(false);
      setConfirmBaja(false);
    }
  }
  // El tutor no necesita color: no aparece en el calendario.
  const necesitaColor = f.role !== 'tutor';
  const completo = !!(f.nombre.trim() && f.dni.trim() && (!necesitaColor || f.color));

  async function save() {
    if (!completo) { showToast(necesitaColor ? 'Completa nombre, DNI y color' : 'Completa nombre y DNI', 'warn'); return; }
    setSaving(true);
    try {
      const nuevo = await API.altaUsuario({
        nombre: f.nombre.trim(),
        dni: f.dni.trim().toUpperCase(),
        role: f.role,
        anio: f.role === 'externo' ? 'Externo' : f.role === 'tutor' ? 'Tutor' : f.anio,
        color: necesitaColor ? f.color : undefined,
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
          <div key={u.id} className="row" onClick={() => abrirEdicion(u)} style={{ cursor: 'pointer' }}>
            <ColorDot color={u.color} />
            <div className="row-main">
              <div className="row-title">{u.nombre}</div>
              {/* sin DNI en el listado (protección de datos); se ve al abrir la ficha */}
              {u.pendiente_activacion && u.activation_code
                ? <div className="row-meta">Código de activación: {u.activation_code}</div>
                : (u.role === 'residente' ? <div className="row-meta">{u.anio}</div> : null)}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
              <span className={'pill ' + (u.role === 'tutor' ? 'pill-blue' : u.role === 'externo' ? 'pill-muted' : 'pill-green')}>{ROLE_LABEL[u.role]}</span>
              {u.role === 'externo' && !u.limites && <span className="mini-note">sin control Vi/Sa/Do</span>}
            </div>
            <Icon name="chevR" size={16} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
          </div>
        ))}
        <div className="mini-note" style={{ padding: '2px 0 10px' }}>Toca un usuario para editar sus datos.</div>
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
            {ROLES.map(r => <button key={r.id} className={f.role === r.id ? 'on' : ''} onClick={() => elegir({ role: r.id })}>{r.label}</button>)}
          </div>
        </div>
        {(f.role === 'residente' || f.role === 'r4') && (
          <div className="field">
            <label className="field-label">Año de residencia</label>
            <div className="seg">
              {['R1', 'R2', 'R3', 'R4'].map(a => <button key={a} className={f.anio === a ? 'on' : ''} onClick={() => elegir({ anio: a })}>{a}</button>)}
            </div>
          </div>
        )}
        {f.role === 'externo' && (
          <button className="set-row plain" onClick={() => elegir({ limites: !f.limites })}>
            <span>Aplicar control de límites Vi/Sa/Do</span>
            <div className="set-toggle" data-on={f.limites}><span /></div>
          </button>
        )}
        {necesitaColor && (
        <div className="field" style={{ marginTop: 6 }}>
          <label className="field-label">Color asignado</label>
          <div className="color-grid">
            {GD.PASTEL_ORDER.map(c => {
              const used = usedColors.has(c);
              return (
                <button key={c} className={'swatch' + (f.color === c ? ' on' : '') + (used ? ' used' : '')}
                  disabled={used} title={used ? 'En uso' : GD.PASTEL_LABEL[c]}
                  style={{ background: GD.PASTELS[c] }}
                  onClick={() => elegir({ color: c })}>
                  {f.color === c && <Icon name="check" size={16} style={{ color: '#1F2937' }} />}
                  {used && <Icon name="close" size={14} style={{ color: '#1F2937', opacity: .4 }} />}
                </button>
              );
            })}
          </div>
          <div className="mini-note" style={{ marginTop: 8 }}>Los colores en uso aparecen deshabilitados.</div>
        </div>
        )}
        {/* Botón final siempre visible (fijo al pie de la hoja), activo al completar los datos */}
        <div style={{
          position: 'sticky', bottom: 0, margin: '14px -18px 0', padding: '12px 18px 4px',
          background: 'var(--surface)', boxShadow: '0 -10px 14px -12px rgba(0,0,0,0.25)',
        }}>
          <button className="btn btn-primary" style={{ width: '100%' }}
            disabled={saving || !completo} onClick={save}>
            <Icon name="check" size={17} /> {saving ? 'Creando…' : 'Aceptar'}
          </button>
          {!completo && (
            <div className="mini-note" style={{ textAlign: 'center', marginTop: 6 }}>
              {necesitaColor ? 'Completa nombre, DNI y color para continuar.' : 'Completa nombre y DNI para continuar.'}
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

      {/* Edición de un usuario existente */}
      <Sheet open={!!editing} onClose={() => setEditing(null)}
        title={editing ? `Editar a ${editing.nombre.split(' ')[0]}` : ''}
        sub="Corrige los datos del usuario. Los cambios quedan registrados en el histórico.">
        {fe && (<>
          <div className="field">
            <label className="field-label">Nombre completo</label>
            <input className="input" value={fe.nombre} onChange={e => setFe({ ...fe, nombre: e.target.value })} />
          </div>
          <div className="field">
            <label className="field-label">DNI</label>
            <input className="input" value={fe.dni} onChange={e => setFe({ ...fe, dni: e.target.value })} autoCapitalize="characters" />
          </div>
          <div className="field">
            <label className="field-label">Rol</label>
            <div className="seg">
              {ROLES.map(r => <button key={r.id} className={fe.role === r.id ? 'on' : ''} onClick={() => elegirE({ role: r.id })}>{r.label}</button>)}
            </div>
          </div>
          {(fe.role === 'residente' || fe.role === 'r4') && (
            <div className="field">
              <label className="field-label">Año de residencia</label>
              <div className="seg">
                {['R1', 'R2', 'R3', 'R4'].map(a => <button key={a} className={fe.anio === a ? 'on' : ''} onClick={() => elegirE({ anio: a })}>{a}</button>)}
              </div>
            </div>
          )}
          {fe.role === 'externo' && (
            <button className="set-row plain" onClick={() => elegirE({ limites: !fe.limites })}>
              <span>Aplicar control de límites Vi/Sa/Do</span>
              <div className="set-toggle" data-on={fe.limites}><span /></div>
            </button>
          )}
          {fe.role !== 'tutor' && (
            <div className="field" style={{ marginTop: 6 }}>
              <label className="field-label">Color asignado</label>
              <div className="color-grid">
                {GD.PASTEL_ORDER.map(c => {
                  // su propio color actual sigue disponible para él
                  const used = usedColors.has(c) && c !== editing.color;
                  return (
                    <button key={c} className={'swatch' + (fe.color === c ? ' on' : '') + (used ? ' used' : '')}
                      disabled={used} title={used ? 'En uso' : GD.PASTEL_LABEL[c]}
                      style={{ background: GD.PASTELS[c] }}
                      onClick={() => elegirE({ color: c })}>
                      {fe.color === c && <Icon name="check" size={16} style={{ color: '#1F2937' }} />}
                      {used && <Icon name="close" size={14} style={{ color: '#1F2937', opacity: .4 }} />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div style={{
            position: 'sticky', bottom: 0, margin: '14px -18px 0', padding: '12px 18px 4px',
            background: 'var(--surface)', boxShadow: '0 -10px 14px -12px rgba(0,0,0,0.25)',
          }}>
            <button className="btn btn-primary" style={{ width: '100%' }}
              disabled={savingEdit || !completoE} onClick={guardarEdicion}>
              <Icon name="check" size={17} /> {savingEdit ? 'Guardando…' : 'Guardar cambios'}
            </button>
            {editing && current && editing.id !== current.id && (
              <button className="btn btn-ghost btn-sm" style={{ width: '100%', marginTop: 8, color: 'var(--red-text)' }}
                disabled={savingEdit} onClick={() => setConfirmBaja(true)}>
                Dar de baja
              </button>
            )}
          </div>
        </>)}
      </Sheet>

      {/* Confirmación de baja */}
      <Dialog open={confirmBaja} onClose={() => setConfirmBaja(false)}>
        {editing && (<>
          <h3 className="dlg-title">¿Dar de baja a {editing.nombre.split(' ')[0]}?</h3>
          <p className="dlg-text">Dejará de poder entrar en la app y su color quedará libre. Su historial se conserva. Esta acción la puede revertir un administrador.</p>
          <button className="btn btn-danger" disabled={savingEdit} onClick={darDeBaja}>
            {savingEdit ? 'Dando de baja…' : 'Sí, dar de baja'}
          </button>
          <button className="btn btn-ghost" style={{ marginTop: 6 }} onClick={() => setConfirmBaja(false)}>Cancelar</button>
        </>)}
      </Dialog>
    </div>
  );
}
window.AdminScreen = AdminScreen;
