import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Search, Send, Sparkles, Copy, Pencil, RefreshCw, ArrowLeft, Bot, MessageSquare, Building2, Phone
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../state/AppContext.jsx';
import { socket, EVENTOS } from '../lib/socket.js';
import { Card, TagPill, Prioridade, Medidor, Vazio, SkeletonLista, BotaoMaps } from '../components/ui.jsx';
import { hora, tempoRelativo, iniciais, rotuloPotencial, naoInformado, dataHora } from '../lib/format.js';

export default function Conversas() {
  const { tags, toast, whatsapp, setNaoLidas } = useApp();
  const [params, setParams] = useSearchParams();
  const leadId = params.get('lead');

  const [conversas, setConversas] = useState(null);
  const [busca, setBusca] = useState('');
  const [aberta, setAberta] = useState(null);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const fimChat = useRef(null);

  const carregarLista = useCallback(async () => {
    try {
      const r = await api.get('/conversations');
      setConversas(r.itens);
      setNaoLidas(r.naoLidas || 0);
    } catch (e) {
      toast('erro', 'Erro ao carregar conversas', e.message);
    }
  }, [toast, setNaoLidas]);

  const carregarConversa = useCallback(
    async (id) => {
      if (!id) return;
      try {
        const r = await api.get(`/conversations/${id}`);
        setAberta(r);
        api.post(`/conversations/${id}/lida`, {}).then((x) => setNaoLidas(x.naoLidas || 0)).catch(() => {});
      } catch (e) {
        toast('erro', 'Erro ao abrir conversa', e.message);
      }
    },
    [toast, setNaoLidas]
  );

  useEffect(() => {
    carregarLista();
  }, [carregarLista]);

  useEffect(() => {
    if (leadId) carregarConversa(leadId);
    else setAberta(null);
  }, [leadId, carregarConversa]);

  useEffect(() => {
    fimChat.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [aberta?.mensagens?.length]);

  // tempo real: nova resposta ou nova analise atualizam a tela na hora
  useEffect(() => {
    const atualizar = ({ lead }) => {
      carregarLista();
      if (lead && String(lead.id) === String(leadId)) carregarConversa(lead.id);
    };
    socket.on(EVENTOS.MENSAGEM_RECEBIDA, atualizar);
    socket.on(EVENTOS.ANALISE_PRONTA, atualizar);
    socket.on(EVENTOS.MENSAGEM_ENVIADA, atualizar);
    return () => {
      socket.off(EVENTOS.MENSAGEM_RECEBIDA, atualizar);
      socket.off(EVENTOS.ANALISE_PRONTA, atualizar);
      socket.off(EVENTOS.MENSAGEM_ENVIADA, atualizar);
    };
  }, [leadId, carregarLista, carregarConversa]);

  const enviar = async () => {
    const corpo = texto.trim();
    if (!corpo || !aberta?.lead) return;
    setEnviando(true);
    try {
      await api.post(`/leads/${aberta.lead.id}/mensagem`, { texto: corpo });
      setTexto('');
      await carregarConversa(aberta.lead.id);
      carregarLista();
      toast('sucesso', 'Mensagem enviada', aberta.lead.nome_estabelecimento);
    } catch (e) {
      toast('erro', 'Não foi possível enviar', e.message);
    } finally {
      setEnviando(false);
    }
  };

  const copiar = async (t) => {
    try {
      await navigator.clipboard.writeText(t);
      toast('sucesso', 'Copiado', 'Sugestão na área de transferência.');
    } catch {
      toast('erro', 'Não consegui copiar', 'Selecione e copie manualmente.');
    }
  };

  const filtradas = (conversas || []).filter((c) =>
    busca ? String(c.nome_estabelecimento || '').toLowerCase().includes(busca.toLowerCase()) : true
  );

  const lead = aberta?.lead;
  const analise = aberta?.analise;
  const pot = rotuloPotencial(lead?.score);

  return (
    <div className="inbox">
      {/* ------------------------------------------------ lista */}
      <Card className={`conv-list ${leadId ? 'escondida' : ''}`} bodyClass="flush">
        <div style={{ padding: 12, borderBottom: '1px solid var(--border)' }}>
          <div style={{ position: 'relative' }}>
            <Search size={15} style={{ position: 'absolute', left: 11, top: 11, color: 'var(--dim)' }} />
            <input
              className="input"
              style={{ paddingLeft: 33 }}
              placeholder="Buscar conversa..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
        </div>
        <div className="conv-scroll">
          {!conversas ? (
            <div style={{ padding: 14 }}>
              <SkeletonLista linhas={6} altura={54} />
            </div>
          ) : filtradas.length === 0 ? (
            <Vazio titulo="Nenhuma conversa ainda" texto="As conversas aparecem aqui depois do primeiro envio." />
          ) : (
            filtradas.map((c) => (
              <button
                type="button"
                key={c.lead_id}
                className={`conv-item ${String(c.lead_id) === String(leadId) ? 'ativo' : ''}`}
                onClick={() => setParams({ lead: String(c.lead_id) })}
              >
                <span className={`avatar ${c.respondeu ? '' : 'cinza'}`}>{iniciais(c.nome_estabelecimento)}</span>
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="row-between">
                    <b className="truncate fs-13">{c.nome_estabelecimento}</b>
                    <span className="fs-12 dim nowrap">{tempoRelativo(c.ultima_mensagem_data)}</span>
                  </span>
                  <span className="truncate fs-12 muted" style={{ display: 'block' }}>
                    {c.ultima_direcao === 'OUT' ? '→ ' : ''}
                    {c.ultima_mensagem || 'sem mensagens'}
                  </span>
                  <span className="row gap-6 mt-8">
                    <TagPill etiqueta={c.etiqueta} tags={tags} sm />
                    {c.nao_lidas > 0 && <span className="nav-count">{c.nao_lidas}</span>}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      </Card>

      {/* ------------------------------------------------ chat */}
      <Card className="chat" bodyClass="flush">
        {!lead ? (
          <Vazio
            icone={<MessageSquare size={22} />}
            titulo="Escolha uma conversa"
            texto="Selecione um estabelecimento à esquerda para ver o histórico completo e responder você mesmo."
          />
        ) : (
          <>
            <header className="card-head">
              <div className="row gap-12" style={{ minWidth: 0 }}>
                <button type="button" className="btn btn-ghost btn-icon btn-sm hidden-desktop" onClick={() => setParams({})} aria-label="Voltar">
                  <ArrowLeft size={16} />
                </button>
                <span className="avatar">{iniciais(lead.nome_estabelecimento)}</span>
                <div style={{ minWidth: 0 }}>
                  <b className="truncate" style={{ display: 'block' }}>{lead.nome_estabelecimento}</b>
                  <span className="fs-12 dim mono">{lead.telefone_formatado || naoInformado}</span>
                </div>
              </div>
              <div className="row gap-8">
                <TagPill etiqueta={lead.etiqueta} tags={tags} sm />
                <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => carregarConversa(lead.id)} aria-label="Atualizar">
                  <RefreshCw size={15} />
                </button>
              </div>
            </header>

            <div className="chat-body">
              {aberta.mensagens.length === 0 && <Vazio titulo="Sem mensagens" texto="Nada foi trocado com este lead ainda." />}
              {aberta.mensagens.map((m) => (
                <div key={m.id} className={`bubble ${m.direcao === 'OUT' ? 'out' : 'in'} ${m.status === 'FALHOU' ? 'falhou' : ''}`}>
                  {m.corpo}
                  <div className="bubble-meta">
                    <span>{hora(m.created_at)}</span>
                    {m.direcao === 'OUT' && <span>· {m.autor === 'IA' ? 'prospecção' : 'você'}</span>}
                    {m.status === 'FALHOU' && <span>· falhou: {m.erro}</span>}
                  </div>
                </div>
              ))}
              <div ref={fimChat} />
            </div>

            {/* sugestao da IA - nunca enviada sozinha (spec 29) */}
            {analise?.sugestao_resposta && (
              <div className="opp-sugestao" style={{ margin: '0 12px 10px' }}>
                <div className="row-between wrap gap-8">
                  <b className="row gap-6 fs-13">
                    <Sparkles size={14} color="var(--accent)" /> Sugestão da IA
                    {analise.confianca != null && <span className="dim fs-12">({Math.round(analise.confianca * 100)}%)</span>}
                  </b>
                  <span className="chip ok" style={{ height: 22 }}>
                    <Bot size={12} /> não enviada automaticamente
                  </span>
                </div>
                <p className="fs-13 mt-8">{analise.sugestao_resposta}</p>
                <div className="row gap-8 mt-8">
                  <button type="button" className="btn btn-sm" onClick={() => copiar(analise.sugestao_resposta)}>
                    <Copy size={13} /> Copiar
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => setTexto(analise.sugestao_resposta)}>
                    <Pencil size={13} /> Editar
                  </button>
                </div>
              </div>
            )}

            <div className="chat-compose">
              <textarea
                className="textarea"
                style={{ minHeight: 78 }}
                placeholder="Escreva sua resposta... (Ctrl+Enter envia)"
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) enviar();
                }}
              />
              <div className="row-between">
                <span className="fs-12 dim">
                  {whatsapp?.conectado ? 'Quem envia é você — a IA só analisa e sugere.' : '⚠ WhatsApp desconectado.'}
                </span>
                <button type="button" className="btn btn-primary" onClick={enviar} disabled={enviando || !texto.trim() || !whatsapp?.conectado}>
                  <Send size={15} /> {enviando ? 'Enviando...' : 'Enviar'}
                </button>
              </div>
            </div>
          </>
        )}
      </Card>

      {/* ------------------------------------------------ dados do lead */}
      <Card className="lead-panel" titulo="Dados do lead" icone={<Building2 size={16} color="var(--accent)" />}>
        {!lead ? (
          <p className="fs-13 dim">Selecione uma conversa para ver os dados do estabelecimento.</p>
        ) : (
          <div className="col gap-16">
            <div>
              <div className="row-between fs-12">
                <span className="dim">Potencial</span>
                <b style={{ color: pot.cor }}>
                  {pot.emoji} {pot.nome} · {lead.score || 0}/100
                </b>
              </div>
              <Medidor valor={lead.score} cor={pot.cor} />
              <div className="mt-8">
                <Prioridade valor={lead.prioridade} />
              </div>
            </div>

            <BotaoMaps url={lead.google_maps} grande />

            <dl className="dados-grid">
              <dt>Telefone</dt>
              <dd className="mono">{lead.telefone_formatado || naoInformado}</dd>
              <dt>Cidade</dt>
              <dd>{lead.cidade || naoInformado}</dd>
              <dt>Categoria</dt>
              <dd>{lead.categoria || naoInformado}</dd>
              <dt>Endereço</dt>
              <dd>{lead.endereco || naoInformado}</dd>
              <dt>Instagram</dt>
              <dd className="truncate">{lead.instagram || naoInformado}</dd>
              <dt>Site</dt>
              <dd className="truncate">{lead.site || 'não possui'}</dd>
              <dt>Etapa</dt>
              <dd>{lead.pipeline}</dd>
              <dt>1º contato</dt>
              <dd>{lead.data_ultimo_contato ? dataHora(lead.data_ultimo_contato) : naoInformado}</dd>
            </dl>

            {analise?.motivo && (
              <div className="kpi-mini">
                <span>Análise da IA</span>
                <p className="fs-12 soft">{analise.motivo}</p>
              </div>
            )}

            <div className="aviso-regra">
              <Phone size={15} />
              <span>Resposta automática está desativada. Nenhuma mensagem sai sem você clicar em Enviar.</span>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
