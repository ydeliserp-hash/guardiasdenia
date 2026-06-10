/* ============================================================
   Cambios de guardia — solicitud, aviso de exceso, bandeja,
   vista destinatario, vista tutor
   ============================================================ */

const WD = { 4: 'vi', 5: 'sa', 6: 'do' };
const WD_LABEL = { vi: 'viernes', sa: 'sábados', do: 'domingos' };
function wdOf(d, y = GD.YEAR, m = GD.MONTH) { return (new Date(y, m, d).getDay() + 6) % 7; }
function statFor(id, key, y = GD.YEAR) { const s = (GD.STATS[y] || {})[id]; return s ? s[key] : 0; }

/* ---------- request card ---------- */
function RequestCard({ r }) {
  const { current, isTutor, aceptarReq, rechazarReq, aprobarReq, cancelarReq } = useApp();
  const [rejecting, setRejecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [motivo, setMotivo] = useState('');
  const run = async (fn) => { setBusy(true); await fn(); setBusy(false); };
  const ude = GD.byId[r.de], ua = GD.byId[r.a];
  const tipoLabel = r.tipo === 'intercambio' ? 'Intercambio' : 'Cesión';
  const iAmRecipient = r.a === current.id && r.status === 'pend_companero';
  const iApprove = isTutor && r.status === 'pend_tutor';
  const iAmSender = r.de === current.id;
  const canCancel = iAmSender && (r.status === 'pend_companero' || r.status === 'pend_tutor');

  return (
    <div className={'card req-card' + (r.flag ? ' req-flagged' : '')}>
      <div className="req-top">
        <span className="pill pill-muted"><Icon name="swap" size={13} />{tipoLabel}</span>
        <StatusPill status={r.status} />
      </div>

      <div className="req-flow">
        <div className="req-side">
          <Avatar user={ude} size={36} />
          <div className="req-who">{ude.nombre.split(' ')[0]}</div>
          <div className="req-guardia">{r.guardiaDe.label}</div>
        </div>
        <div className="req-arrow"><Icon name={r.tipo === 'intercambio' ? 'swap' : 'chevR'} size={20} /></div>
        <div className="req-side">
          <Avatar user={ua} size={36} />
          <div className="req-who">{ua.nombre.split(' ')[0]}</div>
          <div className="req-guardia">{r.guardiaA ? r.guardiaA.label : 'recibe la guardia'}</div>
        </div>
      </div>

      {r.flag && (
        <div className="req-flag">
          <Icon name="warn" size={15} />
          Supera el límite: {ua.nombre.split(' ')[0]} quedaría con {r.flag.nuevo}/8 {r.flag.tipo}
        </div>
      )}
      {r.nota && <div className="req-note">“{r.nota}”</div>}
      {r.motivo && r.status === 'rechazada' && <div className="req-note req-reject">Motivo: {r.motivo}</div>}

      <div className="req-foot">
        <span className="req-time">{r.fecha}</span>
      </div>

      {iAmRecipient && (
        <div className="btn-row">
          <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => run(() => rechazarReq(r.id, 'No me viene bien.'))}>
            <Icon name="x-circle" size={16} /> Rechazar
          </button>
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => run(() => aceptarReq(r.id))}>
            <Icon name="check" size={16} /> Aceptar
          </button>
        </div>
      )}

      {iApprove && !rejecting && (
        <div className="btn-row">
          <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setRejecting(true)}>
            <Icon name="x-circle" size={16} /> Rechazar
          </button>
          <button className={'btn btn-sm ' + (r.flag ? 'btn-danger' : 'btn-primary')} disabled={busy}
            onClick={() => run(() => aprobarReq(r.id, !!r.flag))}>
            <Icon name="check" size={16} /> {r.flag ? 'Aprobar igualmente' : 'Aprobar'}
          </button>
        </div>
      )}
      {iApprove && rejecting && (
        <div className="reject-box">
          <input className="input" placeholder="Motivo (opcional)" value={motivo} onChange={e => setMotivo(e.target.value)} />
          <div className="btn-row" style={{ marginTop: 8 }}>
            <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setRejecting(false)}>Cancelar</button>
            <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => run(() => rechazarReq(r.id, motivo || 'Sin motivo indicado.'))}>Confirmar rechazo</button>
          </div>
        </div>
      )}

      {canCancel && (
        <button className="btn btn-ghost btn-sm" style={{ width: '100%' }} disabled={busy}
          onClick={() => run(() => cancelarReq(r.id))}>Cancelar solicitud</button>
      )}
    </div>
  );
}

/* ---------- new request flow ---------- */
function NewRequest({ onDone }) {
  const { current, crearReq, showToast, schedule, reqSeed, calY, calM } = useApp();
  const seeded = !!reqSeed; // viene de "Solicitar cambio" / "Vender guardia" → tipo fijado, sin paso 1
  const minStep = seeded ? 2 : 1;
  const [step, setStep] = useState(minStep);
  const [tipo, setTipo] = useState(reqSeed?.mode === 'pedir' ? 'cesion' : 'intercambio');
  const [myDay, setMyDay] = useState(reqSeed?.fromDay || null);
  const [target, setTarget] = useState(null); // resident id
  const [theirDay, setTheirDay] = useState(null);
  const [note, setNote] = useState('');
  const [warn, setWarn] = useState(null);
  const [sending, setSending] = useState(false);

  // día de la semana y etiqueta referidos al mes que se está viendo
  const wd = (d) => wdOf(d, calY, calM);
  const myDays = Object.entries(schedule).filter(([d, ids]) => ids.includes(current.id)).map(([d]) => +d).sort((a, b) => a - b);
  const others = GD.USERS.filter(u => u.guardias && u.id !== current.id && u.activo !== false);
  const theirDays = target ? Object.entries(schedule).filter(([d, ids]) => ids.includes(target)).map(([d]) => +d).sort((a, b) => a - b) : [];

  const label = (d) => `${GD.DOW[wd(d)]} ${d} ${GD.MONTHS[calM].slice(0, 3)}`;

  // ---- prohibición: nunca 2 guardias en días consecutivos ----
  const daysOf = (id) => Object.entries(schedule).filter(([d, ids]) => ids.includes(id)).map(([d]) => +d);
  const hasConsec = (arr) => {
    const s = [...new Set(arr)].sort((a, b) => a - b);
    for (let i = 1; i < s.length; i++) if (s[i] - s[i - 1] === 1) return true;
    return false;
  };
  function checkConsecutive() {
    if (!myDay || !target) return null;
    // el destino recibe MI guardia (myDay)
    let tgt = daysOf(target).filter(d => tipo === 'intercambio' ? d !== theirDay : true);
    tgt.push(myDay);
    if (hasConsec(tgt)) return { who: GD.byId[target], dia: myDay };
    // en intercambio, yo recibo su guardia (theirDay)
    if (tipo === 'intercambio' && theirDay) {
      let mine = daysOf(current.id).filter(d => d !== myDay);
      mine.push(theirDay);
      if (hasConsec(mine)) return { who: current, dia: theirDay };
    }
    return null;
  }

  function checkExcess() {
    // receiver of MY (weekend) day is the target resident
    const wk = WD[wd(myDay)];
    if (wk && target && GD.byId[target].limites) {
      const cur = statFor(target, wk, calY);
      if (cur >= 8) return { who: GD.byId[target], tipo: WD_LABEL[wk], actual: cur, nuevo: cur + 1 };
    }
    return null;
  }

  async function submit(force) {
    const blk = checkConsecutive();
    if (blk) {
      const nombre = blk.who.id === current.id ? 'Tú' : blk.who.nombre.split(' ')[0];
      showToast(`${nombre} tendría 2 guardias seguidas — no permitido`, 'err');
      return;
    }
    const ex = checkExcess();
    if (ex && !force) { setWarn(ex); return; }
    const ua = GD.byId[target];
    setSending(true);
    // la API valida de nuevo (días consecutivos, exceso, propiedad de la guardia)
    const ok = await crearReq({
      tipo,
      a_user_id: target,
      guardia_de: API.iso(calY, calM, myDay),
      guardia_a: tipo === 'intercambio' && theirDay ? API.iso(calY, calM, theirDay) : undefined,
      nota: note.trim() || undefined,
    }, 'Solicitud enviada a ' + ua.nombre.split(' ')[0]);
    setSending(false);
    if (ok) onDone();
  }

  const canNext = step === 1 ? !!tipo
    : step === 2 ? !!myDay
    : step === 3 ? (tipo === 'cesion' ? !!target : (!!target && !!theirDay))
    : true;

  return (
    <div className="page-pad">
      <div className="flow-head">
        <button className="auth-back" onClick={() => step === minStep ? onDone() : setStep(step - 1)}>
          <Icon name="arrow-left" size={18} /> {step === minStep ? 'Cancelar' : 'Atrás'}
        </button>
        <div className="flow-steps">{(seeded ? [2, 3, 4] : [1, 2, 3, 4]).map(s => <span key={s} className={'fdot' + (s <= step ? ' on' : '')} />)}</div>
      </div>

      {step === 1 && (<>
        <h2 className="page-title">Nueva solicitud</h2>
        <p className="page-sub">¿Qué tipo de cambio quieres pedir?</p>
        <div className="opt-list">
          <button className={'opt' + (tipo === 'intercambio' ? ' on' : '')} onClick={() => setTipo('intercambio')}>
            <Icon name="swap" size={22} />
            <div><div className="opt-t">Intercambio 1:1</div><div className="opt-d">Cambias tu guardia por la de un compañero.</div></div>
          </button>
          <button className={'opt' + (tipo === 'cesion' ? ' on' : '')} onClick={() => setTipo('cesion')}>
            <Icon name="arrow-left" size={22} style={{ transform: 'rotate(180deg)' }} />
            <div><div className="opt-t">Cesión simple</div><div className="opt-d">Cedes tu guardia a un compañero sin recibir otra.</div></div>
          </button>
        </div>
      </>)}

      {step === 2 && (<>
        <h2 className="page-title">Tu guardia</h2>
        <p className="page-sub">{tipo === 'intercambio' ? 'Elige la guardia que quieres cambiar.' : 'Elige la guardia que quieres ceder.'}</p>
        <div className="chip-list">
          {myDays.map(d => (
            <button key={d} className={'daychip' + (myDay === d ? ' on' : '')} onClick={() => setMyDay(d)}>
              <span className={'dc-dow' + (wd(d) >= 4 ? ' we' : '')}>{GD.DOW[wd(d)]}</span>
              <span className="dc-d">{d}</span>
              {WD[wd(d)] && <span className="dc-tag">fin de semana</span>}
            </button>
          ))}
          {myDays.length === 0 && <div className="empty">No tienes guardias este mes.</div>}
        </div>
      </>)}

      {step === 3 && (<>
        <h2 className="page-title">{tipo === 'intercambio' ? 'Con quién' : 'A quién'}</h2>
        <p className="page-sub">{tipo === 'intercambio' ? 'Elige compañero y su guardia.' : 'Elige a quién cedes la guardia.'}</p>
        <div className="assign-grid">
          {others.map(u => (
            <button key={u.id} className={'assign-chip' + (target === u.id ? ' on' : '')} onClick={() => { setTarget(u.id); setTheirDay(null); }}>
              <Avatar user={u} size={30} />
              <div style={{ minWidth: 0 }}><div className="nm">{u.nombre.split(' ')[0]}</div><div className="rl">{u.anio}</div></div>
            </button>
          ))}
        </div>
        {tipo === 'intercambio' && target && (
          <>
            <div className="section-label">Guardia de {GD.byId[target].nombre.split(' ')[0]}</div>
            <div className="chip-list">
              {theirDays.map(d => (
                <button key={d} className={'daychip' + (theirDay === d ? ' on' : '')} onClick={() => setTheirDay(d)}>
                  <span className={'dc-dow' + (wd(d) >= 4 ? ' we' : '')}>{GD.DOW[wd(d)]}</span>
                  <span className="dc-d">{d}</span>
                </button>
              ))}
              {theirDays.length === 0 && <div className="empty">Sin guardias este mes.</div>}
            </div>
          </>
        )}
      </>)}

      {step === 4 && (<>
        <h2 className="page-title">Resumen</h2>
        <p className="page-sub">Revisa y confirma tu solicitud.</p>
        <div className="card" style={{ padding: 16 }}>
          <div className="sum-row"><span>Tipo</span><b>{tipo === 'intercambio' ? 'Intercambio 1:1' : 'Cesión simple'}</b></div>
          <div className="sum-row"><span>Tu guardia</span><b>{label(myDay)}</b></div>
          <div className="sum-row"><span>{tipo === 'intercambio' ? 'Compañero' : 'Recibe'}</span>
            <b style={{ display: 'flex', alignItems: 'center', gap: 7 }}><ColorDot color={GD.byId[target].color} />{GD.byId[target].nombre}</b></div>
          {tipo === 'intercambio' && <div className="sum-row"><span>Su guardia</span><b>{label(theirDay)}</b></div>}
        </div>
        <div className="field" style={{ marginTop: 14 }}>
          <label className="field-label">Mensaje para {GD.byId[target].nombre.split(' ')[0]} <span style={{ color: 'var(--text-faint)', fontWeight: 500 }}>(opcional)</span></label>
          <textarea className="input msg-area" rows={3} value={note} maxLength={240}
            onChange={e => setNote(e.target.value)}
            placeholder={tipo === 'intercambio' ? 'Ej.: ¿Te viene bien cambiar? Tengo una cita médica ese día.' : 'Ej.: ¿Me cubres ese día? Te lo devuelvo el mes que viene.'} />
        </div>
        {checkExcess() && !checkConsecutive() && (
          <div className="req-flag" style={{ marginTop: 12 }}>
            <Icon name="warn" size={15} /> Este cambio supera el límite de {checkExcess().tipo} de {GD.byId[target].nombre.split(' ')[0]}.
          </div>
        )}
        {checkConsecutive() && (
          <div className="req-flag block" style={{ marginTop: 12 }}>
            <Icon name="warn" size={15} /> No permitido: {checkConsecutive().who.id === current.id ? 'tendrías' : GD.byId[target].nombre.split(' ')[0] + ' tendría'} guardia en dos días seguidos. Nunca se pueden encadenar dos guardias.
          </div>
        )}
      </>)}

      <div className="flow-foot">
        {step < 4
          ? <button className="btn btn-primary" disabled={!canNext} onClick={() => setStep(step + 1)}>Continuar</button>
          : <button className="btn btn-primary" disabled={!!checkConsecutive() || sending} onClick={() => submit(false)}>
              {checkConsecutive() ? 'Cambio no permitido' : sending ? 'Enviando…' : 'Enviar solicitud'}
            </button>}
      </div>

      {/* excess warning dialog — double confirm */}
      <Dialog open={!!warn} onClose={() => setWarn(null)}>
        {warn && (<>
          <div className="dlg-icon warn"><Icon name="warn" size={26} /></div>
          <h3 className="dlg-title">Se supera el límite</h3>
          <p className="dlg-text">Este cambio hará que <b>{warn.who.nombre.split(' ')[0]}</b> supere el máximo de {warn.tipo} permitidos (quedaría con <b>{warn.nuevo}/8</b>).</p>
          <button className="btn btn-danger" onClick={() => { setWarn(null); submit(true); }}>Confirmar de todos modos</button>
          <button className="btn btn-ghost" style={{ marginTop: 6 }} onClick={() => setWarn(null)}>Cancelar</button>
        </>)}
      </Dialog>
    </div>
  );
}

/* ---------- main screen ---------- */
function ChangesScreen() {
  const { requests, current, isStaff, isTutor, reqSeed, setReqSeed } = useApp();
  const [view, setView] = useState('inbox');
  const [tab, setTab] = useState(() => isTutor ? 'aprob' : 'mias');

  useEffect(() => { if (reqSeed) { setView('new'); } }, [reqSeed]);

  if (view === 'new') {
    return <NewRequest onDone={() => { setView('inbox'); setReqSeed(null); }} />;
  }

  const approvals = requests.filter(r => r.status === 'pend_tutor');
  const received = requests.filter(r => r.a === current.id && r.status === 'pend_companero');
  // sólo las solicitudes en las que participo (las mías)
  const mias = requests.filter(r => r.de === current.id || r.a === current.id);
  let list = mias;
  if (tab === 'aprob') list = approvals;
  else if (tab === 'recib') list = received;

  return (
    <div className="page-pad">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <h2 className="page-title" style={{ flex: 1 }}>Cambios</h2>
        <button className="btn btn-primary btn-sm" onClick={() => setView('new')}><Icon name="plus" size={16} /> Nueva</button>
      </div>
      <p className="page-sub">Solicitudes de intercambio y cesión en las que participas.</p>

      <div className="seg" style={{ marginBottom: 16 }}>
        <button className={tab === 'mias' ? 'on' : ''} onClick={() => setTab('mias')}>Mías</button>
        <button className={tab === 'recib' ? 'on' : ''} onClick={() => setTab('recib')}>Recibidas{received.length ? ` (${received.length})` : ''}</button>
        {isTutor && <button className={tab === 'aprob' ? 'on' : ''} onClick={() => setTab('aprob')}>Aprobar{approvals.length ? ` (${approvals.length})` : ''}</button>}
      </div>

      {list.length === 0
        ? <div className="empty">No hay solicitudes en esta vista.</div>
        : <div className="req-list">{list.map(r => <RequestCard key={r.id} r={r} />)}</div>}
    </div>
  );
}
window.ChangesScreen = ChangesScreen;
