import { Link } from 'react-router-dom';
import { Flame, MessageSquare, AlarmClock, RotateCw, CheckCircle2 } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import { Card, Vazio, TagPill } from './ui.jsx';
import { tempoRelativo } from '../lib/format.js';

const ICONES = {
  RESPONDER: <MessageSquare size={14} />,
  FOLLOWUP: <AlarmClock size={14} />,
  RETOMAR: <RotateCw size={14} />
};
const CORES = { ALTA: 'var(--laranja)', MEDIA: 'var(--warn)', BAIXA: 'var(--dim)' };

/** 🔥 PRÓXIMAS AÇÕES (spec 67): quem precisa de você agora. */
export default function ProximasAcoes({ limite = 5 }) {
  const { proximasAcoes, tags } = useApp();
  const itens = (proximasAcoes || []).slice(0, limite);

  return (
    <Card
      titulo={`🔥 Próximas ações${itens.length ? ` (${proximasAcoes.length})` : ''}`}
      acoes={
        proximasAcoes?.length > limite && (
          <Link className="btn btn-sm" to="/follow-ups">
            Ver todas
          </Link>
        )
      }
    >
      {itens.length === 0 ? (
        <Vazio
          icone={<CheckCircle2 size={22} />}
          titulo="Nada pendente agora"
          texto="Quando alguém responder ou um follow-up vencer, aparece aqui."
        />
      ) : (
        <div className="col gap-12">
          {itens.map((a, i) => (
            <div
              key={`${a.tipo}-${a.lead_id}-${i}`}
              className="opp"
              style={{ '--cor': CORES[a.urgencia], padding: '12px 14px', gap: 8 }}
            >
              <div className="row-between gap-8">
                <div className="row gap-8" style={{ minWidth: 0 }}>
                  <span style={{ color: CORES[a.urgencia] }}>{ICONES[a.tipo] || <Flame size={14} />}</span>
                  <b className="truncate">{a.nome}</b>
                  <TagPill etiqueta={a.etiqueta} tags={tags} sm />
                </div>
                <span className="fs-12 dim nowrap">{tempoRelativo(a.quando)}</span>
              </div>

              {a.texto && <p className="fs-12 muted truncate">“{a.texto}”</p>}

              <div className="row-between">
                <span className="fs-12 dim">
                  {a.cidade ? `${a.cidade} · ` : ''}score {a.score ?? 0}
                </span>
                <Link
                  className="btn btn-sm btn-primary"
                  to={a.tipo === 'FOLLOWUP' ? '/follow-ups' : `/conversas?lead=${a.lead_id}`}
                >
                  {a.acao}
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
