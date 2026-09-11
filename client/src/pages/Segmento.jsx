import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageSquare, RefreshCw, MapPin, Inbox } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../state/AppContext.jsx';
import { Card, TagPill, Prioridade, Medidor, Vazio, SkeletonLista, BotaoMaps } from '../components/ui.jsx';
import LeadDrawer from '../components/LeadDrawer.jsx';
import { tempoRelativo, rotuloPotencial, numero } from '../lib/format.js';

/** Paginas Interessados / Aguardando / Nao interessados (spec 35). */
export default function Segmento({ chave, titulo, descricao }) {
  const { tags, toast } = useApp();
  const [itens, setItens] = useState(null);
  const [leadAberto, setLeadAberto] = useState(null);

  const carregar = useCallback(async () => {
    try {
      const r = await api.get(`/opportunities?filtro=${chave}`);
      setItens(r.itens);
    } catch (e) {
      toast('erro', `Erro ao carregar ${titulo}`, e.message);
    }
  }, [chave, titulo, toast]);

  useEffect(() => {
    setItens(null);
    carregar();
  }, [carregar]);

  return (
    <>
      <Card
        titulo={`${titulo} ${itens ? `(${numero(itens.length)})` : ''}`}
        acoes={
          <button type="button" className="btn btn-sm" onClick={carregar}>
            <RefreshCw size={14} /> Atualizar
          </button>
        }
      >
        <p className="fs-13 muted">{descricao}</p>
      </Card>

      {!itens ? (
        <SkeletonLista linhas={4} altura={110} />
      ) : itens.length === 0 ? (
        <Card>
          <Vazio
            icone={<Inbox size={22} />}
            titulo={`Nenhum lead em "${titulo}"`}
            texto="Esta lista é preenchida automaticamente pela análise das respostas recebidas."
          />
        </Card>
      ) : (
        <div className="grid grid-3 stagger">
          {itens.map((l, i) => {
            const pot = rotuloPotencial(l.score);
            return (
              <article key={l.id} className="opp" style={{ '--cor': pot.cor, '--i': i }}>
                <div className="row-between">
                  <TagPill etiqueta={l.etiqueta} tags={tags} sm />
                  <span className="fs-12 dim">{tempoRelativo(l.ultima_mensagem_data)}</span>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ padding: 0, height: 'auto', fontSize: 15, fontWeight: 650, justifyContent: 'flex-start' }}
                  onClick={() => setLeadAberto(l.id)}
                >
                  <span className="truncate">{l.nome_estabelecimento}</span>
                </button>
                <div className="fs-12 dim row gap-6">
                  {l.cidade && (
                    <>
                      <MapPin size={11} /> {l.cidade}
                    </>
                  )}
                  {l.categoria && <span>· {l.categoria}</span>}
                </div>
                {l.ultima_mensagem && <div className="opp-msg truncate">“{l.ultima_mensagem}”</div>}
                <div>
                  <div className="row-between fs-12">
                    <span className="dim">Potencial</span>
                    <b style={{ color: pot.cor }}>{l.score}/100</b>
                  </div>
                  <Medidor valor={l.score} cor={pot.cor} />
                </div>
                <div className="row-between">
                  <Prioridade valor={l.prioridade} />
                  <div className="row gap-6">
                    <BotaoMaps url={l.google_maps} />
                    <Link className="btn btn-sm btn-primary" to={`/conversas?lead=${l.id}`}>
                      <MessageSquare size={13} /> Conversa
                    </Link>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <LeadDrawer leadId={leadAberto} aberto={Boolean(leadAberto)} onFechar={() => setLeadAberto(null)} onAtualizado={carregar} />
    </>
  );
}
