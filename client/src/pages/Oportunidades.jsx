import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  MessageSquare, Copy, Tag as TagIcon, CheckCheck, Clock3, RefreshCw,
  Sparkles, MapPin, Target
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../state/AppContext.jsx';
import {
  Card, TagPill, Prioridade, Medidor, Vazio, SkeletonLista, Segmented, Modal, BotaoMaps
} from '../components/ui.jsx';
import Kanban from '../components/Kanban.jsx';
import LeadDrawer from '../components/LeadDrawer.jsx';
import { tempoRelativo, rotuloPotencial, numero, dataHora } from '../lib/format.js';

const FILTROS = [
  { valor: 'todos', rotulo: 'Todos' },
  { valor: 'quentes', rotulo: '🔥 Quentes' },
  { valor: 'alta', rotulo: '🟠 Alta prioridade' },
  { valor: 'aguardando', rotulo: '🟡 Aguardando' },
  { valor: 'preco', rotulo: '💰 Preço' },
  { valor: 'demonstracao', rotulo: '🎯 Demonstração' },
  { valor: 'interessados', rotulo: '🟢 Interessados' },
  { valor: 'nao_interessados', rotulo: '🔴 Não interessados' }
];

export default function Oportunidades() {
  const { tags, toast, oportunidades } = useApp();
  const [filtro, setFiltro] = useState('todos');
  const [visao, setVisao] = useState('lista');
  const [itens, setItens] = useState(null);
  const [pipeline, setPipeline] = useState(null);
  const [contadores, setContadores] = useState(oportunidades);
  const [leadAberto, setLeadAberto] = useState(null);
  const [etiquetaDe, setEtiquetaDe] = useState(null);
  const [sugerindo, setSugerindo] = useState(null);

  const carregar = useCallback(async () => {
    try {
      const [lista, cont] = await Promise.all([
        api.get(`/opportunities?filtro=${filtro}`),
        api.get('/opportunities/contadores')
      ]);
      setItens(lista.itens);
      setContadores(cont);
      if (visao === 'pipeline') setPipeline(await api.get('/opportunities/pipeline'));
    } catch (e) {
      toast('erro', 'Erro ao carregar oportunidades', e.message);
    }
  }, [filtro, visao, toast]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const copiar = async (texto) => {
    try {
      await navigator.clipboard.writeText(texto);
      toast('sucesso', 'Sugestão copiada', 'Cole no WhatsApp ou na conversa e ajuste como quiser.');
    } catch {
      toast('erro', 'Não consegui copiar', 'Selecione o texto e copie manualmente.');
    }
  };

  const acao = async (fn, mensagem) => {
    try {
      await fn();
      toast('sucesso', mensagem);
      carregar();
    } catch (e) {
      toast('erro', 'Não foi possível concluir', e.message);
    }
  };

  const pedirSugestao = async (lead) => {
    setSugerindo(lead.id);
    try {
      const r = await api.post('/ai/suggest', { leadId: lead.id });
      if (!r.sugestao) {
        toast('aviso', 'IA indisponível', r.motivo || 'Configure a GROQ_API_KEY no .env para gerar sugestões.');
        return;
      }
      setItens((lista) => lista.map((l) => (l.id === lead.id ? { ...l, sugestao_resposta: r.sugestao } : l)));
      toast('info', 'Sugestão gerada', 'Ela aparece no card — nada foi enviado ao cliente.');
    } catch (e) {
      toast('erro', 'Erro ao gerar sugestão', e.message);
    } finally {
      setSugerindo(null);
    }
  };

  return (
    <>
      {/* -------------------------------------------------- contadores */}
      <div className="grid grid-4 stagger">
        {[
          { rotulo: '🔥 Oportunidades quentes', valor: contadores.quentes, cor: 'var(--laranja)' },
          { rotulo: '🟠 Em acompanhamento', valor: contadores.acompanhamento, cor: '#fb923c' },
          { rotulo: '🟡 Aguardando resposta', valor: contadores.aguardando, cor: 'var(--warn)' },
          { rotulo: '🔴 Sem interesse', valor: contadores.frios, cor: 'var(--erro)' }
        ].map((k, i) => (
          <article key={k.rotulo} className="stat" style={{ '--i': i }}>
            <span className="stat-label">{k.rotulo}</span>
            <div className="stat-value" style={{ color: k.cor }}>{numero(k.valor)}</div>
          </article>
        ))}
      </div>

      <Card
        titulo="Quem eu devo chamar agora"
        icone={<Target size={16} color="var(--laranja)" />}
        acoes={
          <>
            <Segmented
              opcoes={[
                { valor: 'lista', rotulo: '☰ Lista' },
                { valor: 'pipeline', rotulo: '▦ Pipeline' }
              ]}
              valor={visao}
              onChange={setVisao}
            />
            <button type="button" className="btn btn-sm" onClick={carregar}>
              <RefreshCw size={14} /> Atualizar
            </button>
          </>
        }
      >
        <Segmented opcoes={FILTROS} valor={filtro} onChange={setFiltro} />
      </Card>

      {visao === 'pipeline' ? (
        <Card bodyClass="tight">
          {pipeline ? (
            <Kanban
              colunas={pipeline.colunas}
              tags={tags}
              onAbrir={setLeadAberto}
              onMover={(id, etapa) =>
                acao(() => api.post(`/leads/${id}/pipeline`, { pipeline: etapa }), 'Lead movido de etapa')
              }
            />
          ) : (
            <SkeletonLista linhas={1} altura={320} />
          )}
        </Card>
      ) : !itens ? (
        <SkeletonLista linhas={4} altura={120} />
      ) : itens.length === 0 ? (
        <Card>
          <Vazio
            icone={<Target size={22} />}
            titulo="Nenhuma oportunidade nesse filtro"
            texto="A Central se enche sozinha conforme os estabelecimentos respondem e a IA classifica as conversas."
            acao={
              <Link className="btn btn-primary" to="/prospeccao">
                Iniciar prospecção
              </Link>
            }
          />
        </Card>
      ) : (
        <div className="grid grid-2 stagger">
          {itens.map((l, i) => {
            const pot = rotuloPotencial(l.score);
            const quente = l.prioridade === 'MAXIMA';
            return (
              <article key={l.id} className={`opp ${quente ? 'quente' : ''}`} style={{ '--cor': pot.cor, '--i': i }}>
                <div className="row-between">
                  <div className="row gap-8 wrap">
                    <TagPill etiqueta={l.etiqueta} tags={tags} />
                    <Prioridade valor={l.prioridade} />
                  </div>
                  <span className="fs-12 dim nowrap">{tempoRelativo(l.ultima_mensagem_data)}</span>
                </div>

                <div>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ padding: 0, height: 'auto', fontSize: 16, fontWeight: 650 }}
                    onClick={() => setLeadAberto(l.id)}
                  >
                    {l.nome_estabelecimento}
                  </button>
                  <div className="fs-12 dim row gap-8 wrap mt-8">
                    {l.cidade && (
                      <span className="row gap-4">
                        <MapPin size={11} /> {l.cidade}
                      </span>
                    )}
                    {l.categoria && <span>· {l.categoria}</span>}
                    <span>· {numero(l.total_mensagens || 0)} mensagens</span>
                    {l.data_ultimo_contato && <span>· 1º contato {dataHora(l.data_ultimo_contato)}</span>}
                  </div>
                </div>

                {l.ultima_mensagem && <div className="opp-msg">“{l.ultima_mensagem}”</div>}

                <div className="row-between gap-12">
                  <div className="grow">
                    <div className="row-between fs-12">
                      <span className="dim">Potencial</span>
                      <b style={{ color: pot.cor }}>
                        {pot.emoji} {pot.nome} · {l.score}/100
                      </b>
                    </div>
                    <Medidor valor={l.score} cor={pot.cor} />
                  </div>
                  {l.confianca != null && (
                    <span className="chip" title="Confiança da classificação da IA">
                      <Sparkles size={12} /> {Math.round(l.confianca * 100)}%
                    </span>
                  )}
                </div>

                {l.motivo && <p className="fs-12 dim">🤖 {l.motivo}</p>}

                {l.sugestao_resposta ? (
                  <div className="opp-sugestao">
                    <div className="row-between">
                      <b className="row gap-6 fs-13">
                        <Sparkles size={13} color="var(--accent)" /> Sugestão da IA
                      </b>
                      <span className="chip ok" style={{ height: 22 }}>não enviada</span>
                    </div>
                    <p className="fs-13 mt-8">{l.sugestao_resposta}</p>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => pedirSugestao(l)}
                    disabled={sugerindo === l.id}
                  >
                    <Sparkles size={13} /> {sugerindo === l.id ? 'Gerando...' : 'Gerar sugestão da IA'}
                  </button>
                )}

                <div className="opp-acoes">
                  <Link className="btn btn-sm btn-primary" to={`/conversas?lead=${l.id}`}>
                    <MessageSquare size={13} /> Abrir conversa
                  </Link>
                  <BotaoMaps url={l.google_maps} />
                  {l.sugestao_resposta && (
                    <button type="button" className="btn btn-sm" onClick={() => copiar(l.sugestao_resposta)}>
                      <Copy size={13} /> Copiar
                    </button>
                  )}
                  <button type="button" className="btn btn-sm" onClick={() => setEtiquetaDe(l)}>
                    <TagIcon size={13} /> Etiqueta
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-ok"
                    onClick={() => acao(() => api.post(`/leads/${l.id}/fechar`, {}), 'Negócio marcado como fechado')}
                  >
                    <CheckCheck size={13} /> Fechado
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => acao(() => api.post(`/leads/${l.id}/adiar`, { horas: 24 }), 'Lead adiado por 24h')}
                  >
                    <Clock3 size={13} /> Adiar
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <Modal aberto={Boolean(etiquetaDe)} titulo={`Etiqueta de ${etiquetaDe?.nome_estabelecimento || ''}`} onFechar={() => setEtiquetaDe(null)}>
        <div className="row gap-8 wrap">
          {tags.map((t) => (
            <button
              key={t.slug}
              type="button"
              className="tag"
              style={{ color: t.cor, cursor: 'pointer', opacity: etiquetaDe?.etiqueta === t.slug ? 1 : 0.6 }}
              onClick={async () => {
                await acao(() => api.post(`/leads/${etiquetaDe.id}/etiqueta`, { etiqueta: t.slug }), 'Etiqueta atualizada');
                setEtiquetaDe(null);
              }}
            >
              <span className="tag-emoji">{t.emoji}</span>
              {t.nome}
            </button>
          ))}
        </div>
      </Modal>

      <LeadDrawer
        leadId={leadAberto}
        aberto={Boolean(leadAberto)}
        onFechar={() => setLeadAberto(null)}
        onAtualizado={carregar}
      />
    </>
  );
}
