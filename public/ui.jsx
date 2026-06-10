/* Shared UI primitives — exports to window */

function Icon({ name, size = 22, stroke = 2, style = {} }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: stroke, strokeLinecap: 'round', strokeLinejoin: 'round', style };
  switch (name) {
    case 'calendar': return (<svg {...p}><rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9h18M8 2.5v4M16 2.5v4"/></svg>);
    case 'stats': return (<svg {...p}><path d="M5 21V10M12 21V4M19 21v-7"/></svg>);
    case 'swap': return (<svg {...p}><path d="M7 10H4l4-4 4 4M17 14h3l-4 4-4-4"/><path d="M8 6v9M16 18V9" strokeWidth={stroke*0.9}/></svg>);
    case 'user': return (<svg {...p}><circle cx="12" cy="8" r="4"/><path d="M4 20c0-3.5 3.6-6 8-6s8 2.5 8 6"/></svg>);
    case 'shield': return (<svg {...p}><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z"/></svg>);
    case 'bell': return (<svg {...p}><path d="M6 9a6 6 0 1112 0c0 4 1.5 6 2 7H4c.5-1 2-3 2-7z"/><path d="M10 20a2 2 0 004 0"/></svg>);
    case 'chevL': return (<svg {...p}><path d="M15 5l-7 7 7 7"/></svg>);
    case 'chevR': return (<svg {...p}><path d="M9 5l7 7-7 7"/></svg>);
    case 'chevDown': return (<svg {...p}><path d="M5 9l7 7 7-7"/></svg>);
    case 'close': return (<svg {...p}><path d="M6 6l12 12M18 6L6 18"/></svg>);
    case 'check': return (<svg {...p}><path d="M5 12.5l4.5 4.5L19 7"/></svg>);
    case 'clock': return (<svg {...p}><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>);
    case 'plus': return (<svg {...p}><path d="M12 5v14M5 12h14"/></svg>);
    case 'minus': return (<svg {...p}><path d="M5 12h14"/></svg>);
    case 'warn': return (<svg {...p}><path d="M12 3.5L21.5 20H2.5L12 3.5z"/><path d="M12 10v4M12 17.5v.01"/></svg>);
    case 'sun': return (<svg {...p}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19"/></svg>);
    case 'moon': return (<svg {...p}><path d="M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z"/></svg>);
    case 'info': return (<svg {...p}><circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8v.01"/></svg>);
    case 'edit': return (<svg {...p}><path d="M4 20h4L18 10l-4-4L4 16v4z"/><path d="M13 7l4 4" strokeWidth={stroke*0.9}/></svg>);
    case 'logout': return (<svg {...p}><path d="M15 4h3a2 2 0 012 2v12a2 2 0 01-2 2h-3"/><path d="M10 12H3m0 0l3.5-3.5M3 12l3.5 3.5"/></svg>);
    case 'check-circle': return (<svg {...p}><circle cx="12" cy="12" r="8.5"/><path d="M8.5 12l2.5 2.5L16 9"/></svg>);
    case 'x-circle': return (<svg {...p}><circle cx="12" cy="12" r="8.5"/><path d="M9 9l6 6M15 9l-6 6"/></svg>);
    case 'dot': return (<svg {...p}><circle cx="12" cy="12" r="4" fill="currentColor"/></svg>);
    case 'lock': return (<svg {...p}><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 018 0v3"/></svg>);
    case 'arrow-left': return (<svg {...p}><path d="M19 12H5m0 0l6-6M5 12l6 6"/></svg>);
    default: return null;
  }
}

function Avatar({ user, size = 38 }) {
  return (
    <div className="av" style={{
      width: size, height: size,
      background: GD.pastel(user),
      fontSize: size * 0.38,
    }}>{GD.initials(user)}</div>
  );
}

function ColorDot({ color }) {
  return <span className="chip-dot" style={{ background: GD.PASTELS[color] }} />;
}

/* mini diagonal cell preview (for legend / treatment picker) */
function MiniCell({ a, b, mode = 'diagonal', size = 30 }) {
  const ua = GD.byId[a], ub = b ? GD.byId[b] : null;
  if (!ub) {
    return <div className="mini-cell" style={{ width: size, height: size, background: GD.pastel(ua) }} />;
  }
  return (
    <div className={'mini-cell' + (mode === 'corners' ? ' corners-mode' : '')}
         style={{ width: size, height: size, background: mode === 'corners' ? 'var(--surface)' : undefined }}>
      <div className="tri tri-a" style={{ background: GD.pastel(ua) }} />
      <div className="tri tri-b" style={{ background: GD.pastel(ub) }} />
      {mode === 'seam' && <div className="seam" style={{ transform: 'rotate(45deg)' }} />}
    </div>
  );
}

/* Bottom sheet */
function Sheet({ open, onClose, children, title, sub }) {
  if (!open) return null;
  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <div className="sheet-grab" />
        {title && <div className="sheet-title">{title}</div>}
        {sub && <div className="sheet-sub">{sub}</div>}
        {children}
      </div>
    </div>
  );
}

/* Centered dialog (alerts / confirmations) */
function Dialog({ open, onClose, children }) {
  if (!open) return null;
  return (
    <div className="scrim center" onClick={onClose}>
      <div className="dialog" onClick={e => e.stopPropagation()}>{children}</div>
    </div>
  );
}

/* Status pill */
function StatusPill({ status }) {
  const m = GD.STATUS_META[status];
  if (!m) return null;
  return <span className={'pill ' + m.cls}>{m.label}</span>;
}

/* Resident name + dot + role */
function NameRow({ user, showRole = true }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:8, minWidth:0 }}>
      <ColorDot color={user.color} />
      <span style={{ fontWeight:600, fontSize:14, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{user.nombre}</span>
      {showRole && <span className="pill pill-muted" style={{ fontSize:10.5, padding:'2px 7px' }}>{user.anio}</span>}
    </div>
  );
}

Object.assign(window, { Icon, Avatar, ColorDot, MiniCell, Sheet, Dialog, StatusPill, NameRow });
