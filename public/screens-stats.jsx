/* ============================================================
   Estadísticas — guardias por residente + límites Vi/Sa/Do
   ============================================================ */

function CountBadge({ n, applies }) {
  if (!applies) return <span className="cnt cnt-na">{n}</span>;
  let cls = 'cnt';
  if (n > 8) cls += ' cnt-red';
  else if (n === 8) cls += ' cnt-amber';
  return (
    <span className={cls}>
      {n > 8 && <Icon name="warn" size={12} />}
      {n}<span className="cnt-lim">/8</span>
    </span>
  );
}

function StatsScreen() {
  const [year, setYear] = useState(GD.YEAR);
  const data = GD.STATS[year] || {};
  const rows = GD.USERS.filter(u => u.guardias && u.activo !== false).map(u => ({ u, s: data[u.id] })).filter(r => r.s);

  return (
    <div className="page-pad">
      <h2 className="page-title">Estadísticas</h2>
      <p className="page-sub">Reparto de guardias y control de fines de semana (límite 8 por día).</p>

      <div className="seg" style={{ marginBottom: 16 }}>
        {[GD.YEAR, GD.YEAR - 1].map(yv => (
          <button key={yv} className={year === yv ? 'on' : ''} onClick={() => setYear(yv)}>{yv}</button>
        ))}
      </div>

      <div className="card stat-table">
        <div className="stat-row stat-h">
          <div className="stat-name">Residente</div>
          <div className="stat-num">Año</div>
          <div className="stat-wd">Vi</div>
          <div className="stat-wd">Sá</div>
          <div className="stat-wd">Do</div>
        </div>
        {rows.map(({ u, s }) => {
          const ap = u.limites;
          const alert = ap && (s.vi > 8 || s.sa > 8 || s.do > 8);
          return (
            <div key={u.id} className={'stat-row' + (alert ? ' stat-alert' : '')}>
              <div className="stat-name">
                <ColorDot color={u.color} />
                <div style={{ minWidth: 0 }}>
                  <div className="sn-name">{u.nombre}</div>
                  <div className="sn-meta">{u.anio}{!u.limites ? ' · sin límites' : ''}</div>
                </div>
              </div>
              <div className="stat-num">{s.anio}</div>
              <div className="stat-wd"><CountBadge n={s.vi} applies={ap} /></div>
              <div className="stat-wd"><CountBadge n={s.sa} applies={ap} /></div>
              <div className="stat-wd"><CountBadge n={s.do} applies={ap} /></div>
            </div>
          );
        })}
      </div>

      {/* legend of the alert system */}
      <div className="card" style={{ padding: '14px 16px', marginTop: 14 }}>
        <div className="section-label" style={{ margin: '0 0 10px' }}>Cómo leer los contadores</div>
        <div className="legend-line"><span className="cnt">5<span className="cnt-lim">/8</span></span> Dentro del límite</div>
        <div className="legend-line"><span className="cnt cnt-amber">8<span className="cnt-lim">/8</span></span> Límite alcanzado</div>
        <div className="legend-line"><span className="cnt cnt-red"><Icon name="warn" size={12} />9<span className="cnt-lim">/8</span></span> Límite superado</div>
        <div className="legend-line"><span className="cnt cnt-na">3</span> Residente externo (sin control)</div>
      </div>
    </div>
  );
}
window.StatsScreen = StatsScreen;
