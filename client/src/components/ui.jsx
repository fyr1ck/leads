import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Inbox, CheckCircle2, AlertTriangle, Info, XCircle, MapPin, Lock } from 'lucide-react';
import { numero } from '../lib/format.js';

/* ------------------------------------------------------------------ marca */
/** Logo da Henvixy (client/public/logo.png) com brilho que percorre so os tracos. */
export function Logo({ className = '' }) {
  return (
    <span className={`brand-logo ${className}`} role="img" aria-label="Henvixy">
      <img src="/logo.png" alt="" draggable="false" />
    </span>
  );
}

/* ------------------------------------------------------------------ numeros */
/** Numero que "conta" ate o valor novo (spec 33). */
export function AnimatedNumber({ valor = 0, duracao = 800, formatar = numero }) {
  const [atual, setAtual] = useState(valor);
  const anterior = useRef(valor);
  const raf = useRef(0);

  useEffect(() => {
    const de = anterior.current;
    const para = Number(valor) || 0;
    if (de === para) return undefined;
    const inicio = performance.now();
    const passo = (t) => {
      const p = Math.min(1, (t - inicio) / duracao);
      const eased = 1 - (1 - p) ** 3;
      setAtual(Math.round(de + (para - de) * eased));
      if (p < 1) raf.current = requestAnimationFrame(passo);
      else anterior.current = para;
    };
    raf.current = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(raf.current);
  }, [valor, duracao]);

  return <>{formatar(atual)}</>;
}

/* -------------------------------------------------------------------- cards */
export function Card({ titulo, icone, acoes, children, className = '', bodyClass = '', ...rest }) {
  return (
    <section className={`card ${className}`} {...rest}>
      {(titulo || acoes) && (
        <header className="card-head">
          <h2>
            {icone}
            {titulo}
          </h2>
          {acoes && <div className="row gap-8 wrap">{acoes}</div>}
        </header>
      )}
      <div className={`card-body ${bodyClass}`}>{children}</div>
    </section>
  );
}

export function StatCard({ rotulo, valor, icone, cor = '', rodape, i = 0 }) {
  return (
    <article className="stat" style={{ '--i': i }}>
      <div className="stat-top">
        <span className="stat-label">{rotulo}</span>
        {icone && <span className={`stat-icon ${cor}`}>{icone}</span>}
      </div>
      <div className="stat-value">
        <AnimatedNumber valor={valor} />
      </div>
      {rodape && <div className="stat-foot">{rodape}</div>}
    </article>
  );
}

/* ---------------------------------------------------------------- etiquetas */
export function TagPill({ etiqueta, tags = [], sm = false }) {
  if (!etiqueta) return <span className="dim fs-12">sem etiqueta</span>;
  const t = tags.find((x) => x.slug === etiqueta);
  const cor = t?.cor || '#64748b';
  return (
    <span className={`tag ${sm ? 'sm' : ''}`} style={{ color: cor }}>
      <span className="tag-emoji">{t?.emoji || '🏷️'}</span>
      {t?.nome || String(etiqueta).replace(/_/g, ' ')}
    </span>
  );
}

const CORES_PRIO = { MAXIMA: '#f97316', ALTA: '#fb923c', MEDIA: '#facc15', BAIXA: '#ef4444' };
const EMOJI_PRIO = { MAXIMA: '🔥', ALTA: '🟠', MEDIA: '🟡', BAIXA: '🔴' };

export function Prioridade({ valor }) {
  if (!valor) return null;
  return (
    <span className="prio" style={{ color: CORES_PRIO[valor] || 'var(--muted)' }}>
      {EMOJI_PRIO[valor]} {valor}
    </span>
  );
}

/* ----------------------------------------------------------------- diversos */
export const StatusDot = ({ estado }) => <span className={`status-dot ${estado}`} />;

export function Progresso({ valor = 0, total = 0, ativo = true, grande = false }) {
  const pct = total > 0 ? Math.min(100, (valor / total) * 100) : 0;
  return (
    <div className={`progress ${grande ? 'grande' : ''} ${ativo ? '' : 'parado'}`}>
      <div className="progress-bar" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Medidor({ valor = 0, cor = 'var(--accent)' }) {
  return (
    <div className="meter">
      <i style={{ width: `${Math.max(0, Math.min(100, valor))}%`, background: cor }} />
    </div>
  );
}

export const Skeleton = ({ h = 16, w = '100%', r = 10, style = {} }) => (
  <div className="skeleton" style={{ height: h, width: w, borderRadius: r, ...style }} />
);

export function SkeletonLista({ linhas = 5, altura = 46 }) {
  return (
    <div className="col gap-8">
      {Array.from({ length: linhas }, (_, i) => (
        <Skeleton key={i} h={altura} style={{ opacity: 1 - i * 0.13 }} />
      ))}
    </div>
  );
}

export function Vazio({ titulo, texto, icone, acao }) {
  return (
    <div className="empty anim-fade-in">
      <div className="empty-icon">{icone || <Inbox size={22} />}</div>
      <strong>{titulo}</strong>
      {texto && <p className="fs-13" style={{ maxWidth: 420 }}>{texto}</p>}
      {acao}
    </div>
  );
}

export function Campo({ label, hint, children }) {
  return (
    <label className="field">
      {label && <span className="label">{label}</span>}
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export function Segmented({ opcoes, valor, onChange }) {
  return (
    <div className="segmented">
      {opcoes.map((o) => (
        <button
          type="button"
          key={o.valor}
          className={valor === o.valor ? 'ativo' : ''}
          onClick={() => onChange(o.valor)}
        >
          {o.rotulo}
          {o.contador !== undefined && ` (${o.contador})`}
        </button>
      ))}
    </div>
  );
}

export function Switch({ ligado, onChange, travado = false, titulo }) {
  return (
    <button
      type="button"
      title={titulo}
      aria-pressed={ligado}
      disabled={travado}
      className={`switch ${ligado ? 'on' : ''} ${travado ? 'travado' : ''}`}
      onClick={() => !travado && onChange?.(!ligado)}
    />
  );
}

/* ------------------------------------------------------------------- modais */
export function Modal({ aberto, titulo, onFechar, children, rodape, grande = false }) {
  useEffect(() => {
    if (!aberto) return undefined;
    const esc = (e) => e.key === 'Escape' && onFechar?.();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [aberto, onFechar]);

  if (!aberto) return null;
  return createPortal(
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onFechar?.()}>
      <div className={`modal ${grande ? 'grande' : ''}`} role="dialog" aria-modal="true">
        <header className="card-head">
          <h2>{titulo}</h2>
          <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={onFechar} aria-label="Fechar">
            <X size={16} />
          </button>
        </header>
        <div className="card-body">{children}</div>
        {rodape && <footer className="card-head" style={{ borderTop: '1px solid var(--border)', borderBottom: 0, justifyContent: 'flex-end' }}>{rodape}</footer>}
      </div>
    </div>,
    document.body
  );
}

export function Drawer({ aberto, onFechar, children }) {
  useEffect(() => {
    if (!aberto) return undefined;
    const esc = (e) => e.key === 'Escape' && onFechar?.();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [aberto, onFechar]);

  if (!aberto) return null;
  return createPortal(
    <>
      <div className="backdrop" style={{ display: 'block' }} onMouseDown={onFechar} />
      <aside className="drawer">{children}</aside>
    </>,
    document.body
  );
}

/* ------------------------------------------------------------------- toasts */
const ICONES_TOAST = {
  sucesso: <CheckCircle2 size={17} />,
  erro: <XCircle size={17} />,
  aviso: <AlertTriangle size={17} />,
  info: <Info size={17} />
};
const CORES_TOAST = {
  sucesso: { background: 'var(--ok-soft)', color: 'var(--ok)' },
  erro: { background: 'var(--erro-soft)', color: 'var(--erro)' },
  aviso: { background: 'var(--warn-soft)', color: 'var(--warn)' },
  info: { background: 'var(--accent-soft)', color: 'var(--accent)' }
};

export function Toasts({ itens, onFechar }) {
  if (!itens?.length) return null;
  return createPortal(
    <div className="toast-stack">
      {itens.map((t) => (
        <div key={t.id} className={`toast ${t.tipo}`}>
          <span className="toast-icon" style={CORES_TOAST[t.tipo] || CORES_TOAST.info}>
            {ICONES_TOAST[t.tipo] || ICONES_TOAST.info}
          </span>
          <div className="grow">
            <strong>{t.titulo}</strong>
            {t.texto && <p>{t.texto}</p>}
          </div>
          <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => onFechar(t.id)} aria-label="Fechar">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>,
    document.body
  );
}

/* --------------------------------------------------------------- google maps */
/** Botao do Google Maps: so aparece quando existe link salvo (spec 25). */
export function BotaoMaps({ url, grande = false }) {
  if (!url) return null;
  return (
    <a
      className={grande ? 'link-maps' : 'btn btn-sm'}
      href={url}
      target="_blank"
      rel="noreferrer"
      title="Abrir no Google Maps"
    >
      <MapPin size={grande ? 17 : 14} /> {grande ? 'ABRIR NO GOOGLE MAPS' : 'Maps'}
    </a>
  );
}

export const Travado = ({ texto }) => (
  <span className="chip ok" title={texto}>
    <Lock size={12} /> {texto}
  </span>
);
