import { useId, useMemo } from 'react';
import { numero } from '../lib/format.js';

/* ============================================================
   Graficos em SVG puro - sem biblioteca externa, funcionam
   offline e combinam com o tema do painel (spec 31 / 33).
   Todos os valores vem do banco real.
   ============================================================ */

const L = 46;
const R = 14;
const T = 16;
const B = 30;
const W = 800;
const H = 260;

const diaCurto = (iso) => {
  const [, m, d] = String(iso).split('-');
  return d && m ? `${d}/${m}` : iso;
};

export function GraficoLinha({ dados = [], series = [], altura = 260 }) {
  const uid = useId().replace(/:/g, '');
  const pontos = dados.length;

  const { max, escalaX, escalaY } = useMemo(() => {
    const valores = dados.flatMap((d) => series.map((s) => Number(d[s.chave] || 0)));
    const maximo = Math.max(1, ...valores);
    const arredondado = Math.ceil(maximo / 4) * 4 || 4;
    return {
      max: arredondado,
      escalaX: (i) => (pontos <= 1 ? L : L + (i * (W - L - R)) / (pontos - 1)),
      escalaY: (v) => H - B - (Number(v || 0) / arredondado) * (H - T - B)
    };
  }, [dados, series, pontos]);

  if (!pontos) return <div className="empty fs-13">Sem dados para o período.</div>;

  const linhasGrade = [0, 0.25, 0.5, 0.75, 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: altura }} role="img">
      <defs>
        {series.map((s) => (
          <linearGradient key={s.chave} id={`g-${uid}-${s.chave}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={s.cor} stopOpacity="0.32" />
            <stop offset="100%" stopColor={s.cor} stopOpacity="0" />
          </linearGradient>
        ))}
      </defs>

      {linhasGrade.map((g) => {
        const y = T + g * (H - T - B);
        const valor = Math.round(max * (1 - g));
        return (
          <g key={g}>
            <line x1={L} x2={W - R} y1={y} y2={y} stroke="rgba(148,163,184,.12)" strokeWidth="1" />
            <text x={L - 9} y={y + 4} textAnchor="end" fontSize="11" fill="#5a6a82">
              {valor}
            </text>
          </g>
        );
      })}

      {dados.map((d, i) => {
        if (pontos > 8 && i % 2 !== 0 && i !== pontos - 1) return null;
        return (
          <text key={d.dia} x={escalaX(i)} y={H - 9} textAnchor="middle" fontSize="11" fill="#5a6a82">
            {diaCurto(d.dia)}
          </text>
        );
      })}

      {series.map((s) => {
        const pts = dados.map((d, i) => [escalaX(i), escalaY(d[s.chave])]);
        const linha = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
        const area = `${linha} L${pts.at(-1)[0].toFixed(1)} ${H - B} L${pts[0][0].toFixed(1)} ${H - B} Z`;
        return (
          <g key={s.chave}>
            <path d={area} fill={`url(#g-${uid}-${s.chave})`} className="anim-fade-in" />
            <path
              d={linha}
              fill="none"
              stroke={s.cor}
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ '--len': 2400, strokeDasharray: 2400, animation: 'drawLine 1.1s ease-out forwards' }}
            />
            {pts.map(([x, y], i) => (
              <circle key={i} cx={x} cy={y} r="3.1" fill="#0a0e15" stroke={s.cor} strokeWidth="2">
                <title>{`${diaCurto(dados[i].dia)}: ${numero(dados[i][s.chave])} ${s.rotulo}`}</title>
              </circle>
            ))}
          </g>
        );
      })}
    </svg>
  );
}

export function GraficoBarras({ dados = [], cor = '#22d3ee', altura = 'auto', max: maxProp }) {
  const max = Math.max(1, maxProp || Math.max(...dados.map((d) => Number(d.total || 0)), 1));
  if (!dados.length) return <div className="empty fs-13">Sem dados ainda.</div>;
  return (
    <div className="col gap-8" style={{ height: altura }}>
      {dados.map((d, i) => (
        <div key={d.rotulo || d.slug || i} className="col gap-4" style={{ animation: 'fadeUp 320ms both', animationDelay: `${i * 40}ms` }}>
          <div className="row-between fs-12">
            <span className="truncate soft" title={d.rotulo}>
              {d.emoji ? `${d.emoji} ` : ''}
              {d.rotulo}
            </span>
            <b className="mono">{numero(d.total)}</b>
          </div>
          <div className="meter">
            <i style={{ width: `${(Number(d.total || 0) / max) * 100}%`, background: d.cor || cor }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function GraficoRosca({ dados = [], tamanho = 168, espessura = 18 }) {
  const total = dados.reduce((s, d) => s + Number(d.total || 0), 0);
  const raio = (tamanho - espessura) / 2;
  const circ = 2 * Math.PI * raio;
  let acumulado = 0;

  if (!total) {
    return (
      <div className="center" style={{ height: tamanho }}>
        <span className="dim fs-13">Sem dados ainda.</span>
      </div>
    );
  }

  return (
    <div className="row gap-16 wrap">
      <svg width={tamanho} height={tamanho} viewBox={`0 0 ${tamanho} ${tamanho}`} style={{ flex: 'none' }}>
        <g transform={`rotate(-90 ${tamanho / 2} ${tamanho / 2})`}>
          <circle cx={tamanho / 2} cy={tamanho / 2} r={raio} fill="none" stroke="rgba(148,163,184,.1)" strokeWidth={espessura} />
          {dados.map((d) => {
            const fatia = (Number(d.total || 0) / total) * circ;
            const offset = acumulado;
            acumulado += fatia;
            return (
              <circle
                key={d.slug || d.rotulo}
                cx={tamanho / 2}
                cy={tamanho / 2}
                r={raio}
                fill="none"
                stroke={d.cor || '#475569'}
                strokeWidth={espessura}
                strokeDasharray={`${fatia} ${circ - fatia}`}
                strokeDashoffset={-offset}
                strokeLinecap="butt"
                style={{ transition: 'stroke-dasharray 700ms ease, stroke-dashoffset 700ms ease' }}
              >
                <title>{`${d.rotulo}: ${numero(d.total)}`}</title>
              </circle>
            );
          })}
        </g>
        <text x="50%" y="47%" textAnchor="middle" fontSize="26" fontWeight="700" fill="#e8eef9">
          {numero(total)}
        </text>
        <text x="50%" y="61%" textAnchor="middle" fontSize="11" fill="#8494ab">
          leads
        </text>
      </svg>
      <div className="legend grow">
        {dados
          .filter((d) => Number(d.total) > 0)
          .map((d) => (
            <span className="legend-item" key={d.slug || d.rotulo}>
              <i className="legend-dot" style={{ background: d.cor || '#475569' }} />
              {d.rotulo}
              <b className="mono">{numero(d.total)}</b>
            </span>
          ))}
      </div>
    </div>
  );
}

export function Sparkline({ valores = [], cor = '#22d3ee', altura = 34 }) {
  if (valores.length < 2) return null;
  const max = Math.max(1, ...valores);
  const w = 120;
  const pts = valores.map((v, i) => [(i * w) / (valores.length - 1), altura - (v / max) * (altura - 4) - 2]);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${altura}`} className="stat-spark" preserveAspectRatio="none">
      <path d={`${d} L${w} ${altura} L0 ${altura} Z`} fill={cor} opacity="0.14" />
      <path d={d} fill="none" stroke={cor} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
