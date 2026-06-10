/* ============================================================
   Calendario — vista mensual + celda diagonal de 2 residentes
   ============================================================ */

/* one day cell: 0, 1 or 2 residents, with the chosen treatment */
const DOW_FULL = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

function DayCell({ day, ids, dow, isToday, treatment, onClick }) {
  const we = dow >= 4; // Vie/Sáb/Dom
  const ua = ids[0] ? GD.byId[ids[0]] : null;
  const ub = ids[1] ? GD.byId[ids[1]] : null;
  const cls = ['cell'];
  if (we) cls.push('we');
  if (isToday) cls.push('today');
  if (!ua) cls.push('empty-day');

  return (
    <button className={cls.join(' ')} onClick={onClick}>
      <span className="daynum">{day}</span>

      {/* single resident */}
      {ua && !ub && (
        <div className="fill-1" style={{ background: GD.pastel(ua) }}>
          <span className="ini">{ua.ini}</span>
        </div>
      )}

      {/* two residents — diagonal / seam split */}
      {ua && ub && (treatment === 'diagonal' || treatment === 'seam') && (<>
        <div className="tri tri-a" style={{ background: GD.pastel(ua) }} />
        <div className="tri tri-b" style={{ background: GD.pastel(ub) }} />
        {treatment === 'seam' && <div className="seam" style={{ transform: 'rotate(45deg)' }} />}
        <span className="tri-ini a">{ua.ini}</span>
        <span className="tri-ini b">{ub.ini}</span>
      </>)}

      {/* two residents — cuadros (horizontal halves) */}
      {ua && ub && treatment === 'split' && (<>
        <div className="half half-top" style={{ background: GD.pastel(ua) }}><span>{ua.ini}</span></div>
        <div className="half half-bot" style={{ background: GD.pastel(ub) }}><span>{ub.ini}</span></div>
      </>)}

      {/* two residents — fichas: recuadros delimitados apilados */}
      {ua && ub && treatment === 'fichas' && (<>
        <div className="ficha ficha-top" style={{ background: GD.pastel(ua) }}>{ua.ini}</div>
        <div className="ficha ficha-bot" style={{ background: GD.pastel(ub) }}>{ub.ini}</div>
      </>)}
    </button>
  );
}

function CalendarScreen() {
  const { calTreatment, schedule, isStaff, editMode, setEditMode, published, setPublished,
          setReqSeed, go, showToast, setSchedule, current, calY, calM, loadMonth } = useApp();
  const [y, setY] = useState(calY);
  const [m, setM] = useState(calM); // 0-indexed
  const [open, setOpen] = useState(null); // day number
  const [assignOpen, setAssignOpen] = useState(null);

  // al cambiar de mes, carga sus guardias desde la API
  useEffect(() => {
    if (y !== calY || m !== calM) loadMonth(y, m);
  }, [y, m]); // eslint-disable-line

  const shifts = schedule;
  const hayGuardias = Object.keys(shifts).length > 0;
  const treat = ['diagonal', 'fichas', 'split'].includes(calTreatment) ? calTreatment : 'diagonal';

  const first = new Date(y, m, 1);
  const lead = (first.getDay() + 6) % 7; // Monday-based offset
  const daysIn = new Date(y, m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= daysIn; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const prev = () => { if (m === 0) { setM(11); setY(y - 1); } else setM(m - 1); };
  const next = () => { if (m === 11) { setM(0); setY(y + 1); } else setM(m + 1); };

  // Deslizar el dedo sobre el calendario para cambiar de mes (móvil)
  const touchRef = useRef(null);
  const onTouchStart = (e) => {
    const t = e.touches[0];
    touchRef.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e) => {
    const inicio = touchRef.current;
    touchRef.current = null;
    if (!inicio) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - inicio.x;
    const dy = t.clientY - inicio.y;
    // gesto claramente horizontal y suficientemente largo
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx < 0) next(); else prev();
    }
  };

  const dowFor = (d) => (new Date(y, m, d).getDay() + 6) % 7;
  const fechaLabel = (d) => `${GD.DOW[dowFor(d)]} ${d} ${GD.MONTHS[m]}`;

  // residents appearing this month, for the legend
  const presentIds = useMemo(() => {
    const s = new Set();
    Object.values(shifts).forEach(arr => arr.forEach(id => s.add(id)));
    return GD.USERS.filter(u => s.has(u.id));
  }, [shifts]);

  // guardias del mes por residente
  const monthCount = (id) => Object.values(shifts).filter(arr => arr.includes(id)).length;

  // mis guardias este mes (días ordenados)
  const myDays = useMemo(() =>
    Object.entries(shifts).filter(([d, ids]) => ids.includes(current.id))
      .map(([d]) => +d).sort((a, b) => a - b), [shifts, current.id]);

  const openIds = open && shifts[open] ? shifts[open] : [];

  function assignResident(uid) {
    const cur = schedule[assignOpen] ? [...schedule[assignOpen]] : [];
    const i = cur.indexOf(uid);
    if (i < 0) {
      // REGLA DURA: nunca guardias en días consecutivos (también en planilla).
      const vecinos = [...(schedule[assignOpen - 1] || []), ...(schedule[assignOpen + 1] || [])];
      if (vecinos.includes(uid)) {
        showToast(`${GD.byId[uid].nombre.split(' ')[0]} tendría guardias en días consecutivos — no permitido`, 'err');
        return;
      }
    }
    if (i >= 0) cur.splice(i, 1);
    else if (cur.length < 2) cur.push(uid);
    else { showToast('Máximo 2 residentes por día', 'warn'); return; }
    // actualización optimista + persistencia real en la API
    setSchedule(prev => {
      const n = { ...prev };
      if (cur.length) n[assignOpen] = cur; else delete n[assignOpen];
      return n;
    });
    API.asignarGuardia(API.iso(y, m, assignOpen), cur)
      .catch(e => { showToast(e.message, 'err'); loadMonth(y, m); });
  }

  return (
    <div className="page-pad">
      {isStaff && editMode && (
        <div className={'edit-banner ' + (published ? 'pub' : 'draft')}>
          <Icon name={published ? 'check-circle' : 'edit'} size={17} />
          <span>{published ? 'Plan publicado' : 'Borrador · sin publicar'}</span>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 12, opacity: .85 }}>Toca un día para asignar</span>
        </div>
      )}

      <div className="cal-head">
        <div className="cal-month">{GD.MONTHS[m]} {y}</div>
        <div className="cal-nav">
          <button className="cal-navbtn" onClick={prev}><Icon name="chevL" size={18} /></button>
          <button className="cal-navbtn" onClick={next}><Icon name="chevR" size={18} /></button>
        </div>
      </div>

      <div className="dow">
        {GD.DOW.map((d, i) => <div key={d} className={i >= 4 ? 'we' : ''}>{d}</div>)}
      </div>

      <div className="grid" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        {cells.map((d, i) => d === null
          ? <div key={'e' + i} />
          : <DayCell key={d} day={d} ids={shifts[d] || []} dow={dowFor(d)}
              isToday={y === GD.YEAR && m === GD.MONTH && d === GD.TODAY} treatment={treat}
              onClick={() => (isStaff && editMode) ? setAssignOpen(d) : setOpen(d)} />)}
      </div>

      {!hayGuardias && (
        <div className="empty">No hay guardias publicadas para este mes.</div>
      )}

      {/* Tus guardias de este mes — solo para quien hace guardias */}
      {hayGuardias && current.guardias && !(isStaff && editMode) && (
        <div className="card mine-card">
          <div className="section-label" style={{ margin: '0 0 10px' }}>Tus guardias · {GD.MONTHS[m]} <span className="mine-count">{myDays.length}</span></div>
          {myDays.length === 0
            ? <div className="mine-empty">No tienes guardias este mes.</div>
            : <div className="mine-chips">
                {myDays.map(d => {
                  const compaId = (shifts[d] || []).find(id => id !== current.id);
                  const compa = compaId ? GD.byId[compaId] : null;
                  return (
                    <button key={d} className={'mine-chip' + (dowFor(d) >= 4 ? ' we' : '')} onClick={() => setOpen(d)}>
                      <span className="mc-dow">{GD.DOW[dowFor(d)]}</span>
                      <span className="mc-d">{d}</span>
                      {compa && <span className="mc-compa" style={{ background: GD.pastel(compa) }}>{compa.ini}</span>}
                    </button>
                  );
                })}
              </div>}
        </div>
      )}

      {/* staff controls */}
      {isStaff && (
        <div className="btn-row" style={{ marginTop: 16 }}>
          <button className="btn btn-secondary" onClick={() => setEditMode(e => !e)}>
            <Icon name="edit" size={17} /> {editMode ? 'Salir de edición' : 'Editar plan'}
          </button>
          {editMode && (
            <button className="btn btn-primary" disabled={published}
              onClick={async () => {
                try {
                  await API.publicarPlan(y, m + 1);
                  setPublished(true);
                  showToast(`Plan de ${GD.MONTHS[m]} publicado`);
                } catch (e) { showToast(e.message, 'err'); }
              }}>
              <Icon name="check" size={17} /> {published ? 'Publicado' : 'Publicar plan'}
            </button>
          )}
        </div>
      )}
      {isStaff && editMode && published && (
        <button className="btn btn-ghost btn-sm" style={{ width: '100%', marginTop: 8 }}
          onClick={async () => {
            try {
              await API.borradorPlan(y, m + 1);
              setPublished(false);
              showToast('Plan marcado como borrador', 'warn');
            } catch (e) { showToast(e.message, 'err'); }
          }}>
          Volver a borrador
        </button>
      )}

      {/* legend */}
      {presentIds.length > 0 && (
        <div className="card legend-card">
          <div className="section-label" style={{ margin: '0 0 12px' }}>Residentes de guardia</div>
          <div className="legend">
            {presentIds.map(u => (
              <div key={u.id} className="legend-item">
                <ColorDot color={u.color} />
                <span>{u.nombre} <b className="legend-count">({monthCount(u.id)})</b></span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---- Day detail sheet ---- */}
      <Sheet open={open !== null} onClose={() => setOpen(null)}
        title={open ? fechaLabel(open) : ''}
        sub={openIds.length ? `${openIds.length} residente${openIds.length > 1 ? 's' : ''} de guardia` : 'Sin guardia asignada'}>
        {openIds.map(id => {
          const u = GD.byId[id];
          return (
            <div key={id} className="detail-res">
              <Avatar user={u} size={42} />
              <div className="row-main">
                <div className="row-title">{u.nombre}</div>
                <div className="row-meta">{u.anio} · {u.role === 'externo' ? 'Externo' : 'Residente'}</div>
              </div>
            </div>
          );
        })}
        {openIds.length === 0 && <div className="empty" style={{ padding: '20px 0' }}>Este día no tiene guardia asignada.</div>}
        {openIds.length > 0 && (
          openIds.includes(current.id) ? (
            <div className="btn-row" style={{ marginTop: 14 }}>
              <button className="btn btn-green" onClick={() => {
                setReqSeed({ fromDay: open, mode: 'intercambio' }); setOpen(null); go('changes');
              }}>
                <Icon name="swap" size={17} /> Solicitar cambio
              </button>
              <button className="btn btn-primary" onClick={() => {
                setReqSeed({ fromDay: open, mode: 'pedir' }); setOpen(null); go('changes');
              }}>
                <Icon name="minus" size={17} /> Vender guardia
              </button>
            </div>
          ) : (
            <div className="detail-note" style={{ marginTop: 14 }}>
              <Icon name="info" size={16} />
              <span>Solo puedes vender o cambiar tus propias guardias.</span>
            </div>
          )
        )}
      </Sheet>

      {/* ---- Assign sheet (edit mode) ---- */}
      <Sheet open={assignOpen !== null} onClose={() => setAssignOpen(null)}
        title={assignOpen ? fechaLabel(assignOpen) : ''}
        sub="Asigna hasta 2 residentes a este día">
        <div className="assign-grid">
          {GD.USERS.filter(u => u.guardias && u.activo !== false).map(u => {
            const on = (schedule[assignOpen] || []).includes(u.id);
            return (
              <button key={u.id} className={'assign-chip' + (on ? ' on' : '')}
                onClick={() => assignResident(u.id)}>
                <Avatar user={u} size={30} />
                <div style={{ minWidth: 0 }}>
                  <div className="nm">{u.nombre.split(' ')[0]}</div>
                  <div className="rl">{u.anio}</div>
                </div>
                {on && <Icon name="check" size={16} style={{ marginLeft: 'auto', color: 'var(--accent)' }} />}
              </button>
            );
          })}
        </div>
        <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => setAssignOpen(null)}>Hecho</button>
      </Sheet>
    </div>
  );
}
window.CalendarScreen = CalendarScreen;
