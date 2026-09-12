import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  X, MessageSquare, CheckCheck, Clock3, Sparkles, Copy, Instagram, Globe, Building2,
  History, Globe2, AlarmClock, Wallet
} from 'lucide-react';
import { api } from '../lib/api.js';
import { dataHora, tempoRelativo, rotuloPotencial, naoInformado } from '../lib/format.js';
import { useApp } from '../state/AppContext.jsx';
import { Drawer, TagPill, Prioridade, Medidor, SkeletonLista, BotaoMaps, Vazio } from './ui.jsx';

/**
 * Ficha do estabelecimento (spec 24).
 * Mostra apenas o que existe de verdade no banco - campo sem dado fica "—".
 */
export default function LeadDrawer({ leadId, aberto, onFechar, onAtualizado }) {
  const { tags, toast, recarregarAcoes } = useApp();
  const [dados, setDados] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [ocupado, setOcupado] = useState(null);

  useEffect(() => {
    if (!aberto || !leadId) return;
    let vivo = true;
    setCarregando(true);
    Promise.all([api.get(`/leads/${leadId}`), api.get(`/activities?leadId=${leadId}&limite=60`)])
      .then(([d, t]) => {
        if (!vivo) return;
        setDados(d);
        setTimeline(t || []);
      })
      .catch((e) => toast('erro', 'Não foi possível abrir o lead', e.message))
      .finally(() => vivo && setCarregando(false));
    return () => {
      vivo = false;
    };
  }, [leadId, aberto, toast]);

  const agendarFollowUp = async () => {
    setOcupado('followup');
    try {
      await api.post('/followups', { leadId, prazoDias: 1, motivo: 'Agendado manualmente pela ficha do lead.' });
      const t = await api.get(`/activities?leadId=${leadId}&limite=60`);
      setTimeline(t || []);
      recarregarAcoes?.();
      toast('sucesso', 'Follow-up agendado', 'Ele aparece em Follow-ups para você preparar e enviar.');
    } catch (e) {
      toast('erro', 'Erro ao agendar', e.message);
    } finally {
      setOcupado(null);
    }
  };

  const lead = dados?.lead;

  const mudarEtiqueta = async (slug) => {
    try {
      const atualizado = await api.post(`/leads/${leadId}/etiqueta`, { etiqueta: slug });
      setDados((d) => ({ ...d, lead: atualizado }));
      onAtualizado?.(atualizado);
      toast('sucesso', 'Etiqueta atualizada', atualizado.nome_estabelecimento);
    } catch (e) {
      toast('erro', 'Erro ao mudar etiqueta', e.message);
    }
  };

  const fechar = async () => {
    try {
      const atualizado = await api.post(`/leads/${leadId}/fechar`, {});
      setDados((d) => ({ ...d, lead: atualizado }));
      onAtualizado?.(atualizado);
      toast('sucesso', 'Negócio fechado! 🎉', atualizado.nome_estabelecimento);
    } catch (e) {
      toast('erro', 'Erro ao marcar como fechado', e.message);
    }
  };

  const adiar = async () => {
    try {
      const atualizado = await api.post(`/leads/${leadId}/adiar`, { horas: 24 });
      setDados((d) => ({ ...d, lead: atualizado }));
      onAtualizado?.(atualizado);
      toast('info', 'Lead adiado por 24h', atualizado.nome_estabelecimento);
    } catch (e) {
      toast('erro', 'Erro ao adiar', e.message);
    }
  };

  const copiar = async (texto) => {
    try {
      await navigator.clipboard.writeText(texto);
      toast('sucesso', 'Copiado', 'A sugestão está na área de transferência.');
    } catch {
      toast('erro', 'Não consegui copiar', 'Copie manualmente pelo painel.');
    }
  };

  const analise = dados?.analises?.[0];
  const potencial = rotuloPotencial(lead?.score);

  return (
    <Drawer aberto={aberto} onFechar={onFechar}>
      <header className="drawer-head">
        <div className="row-between">
          <div className="grow" style={{ minWidth: 0 }}>
            <h2 className="truncate">{lead?.nome_estabelecimento || 'Carregando...'}</h2>
            <div className="row gap-8 mt-8 wrap">
              {lead?.etiqueta && <TagPill etiqueta={lead.etiqueta} tags={tags} sm />}
              <Prioridade valor={lead?.prioridade} />
            </div>
          </div>
          <button type="button" className="btn btn-ghost btn-icon" onClick={onFechar} aria-label="Fechar">
            <X size={17} />
          </button>
        </div>

        <div className="row gap-8 mt-16 wrap">
          <BotaoMaps url={lead?.google_maps} grande />
          <Link className="btn" to={`/conversas?lead=${leadId}`}>
            <MessageSquare size={15} /> Abrir conversa
          </Link>
        </div>
      </header>

      <div className="card-body col gap-16">
        {carregando && !lead && <SkeletonLista linhas={5} />}

        {lead && (
          <>
            {/* -------------------------------------------------- potencial */}
            <section className="col gap-8">
              <div className="row-between">
                <span className="label">Potencial da oportunidade</span>
                <b style={{ color: potencial.cor }}>
                  {potencial.emoji} {potencial.nome} · {lead.score || 0}/100
                </b>
              </div>
              <Medidor valor={lead.score} cor={potencial.cor} />
            </section>

            {/* -------------------------------------------------- dados */}
            <section>
              <div className="label" style={{ marginBottom: 8 }}>
                <Building2 size={12} style={{ verticalAlign: -2 }} /> Dados do estabelecimento
              </div>
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
                <dd>
                  {lead.instagram ? (
                    <a href={lead.instagram.startsWith('http') ? lead.instagram : `https://instagram.com/${lead.instagram.replace('@', '')}`} target="_blank" rel="noreferrer">
                      <Instagram size={12} style={{ verticalAlign: -1 }} /> {lead.instagram}
                    </a>
                  ) : (
                    naoInformado
                  )}
                </dd>
                <dt>Site</dt>
                <dd>
                  {lead.site ? (
                    <a href={lead.site.startsWith('http') ? lead.site : `https://${lead.site}`} target="_blank" rel="noreferrer">
                      <Globe size={12} style={{ verticalAlign: -1 }} /> {lead.site}
                    </a>
                  ) : (
                    <span className="chip warn" style={{ height: 22 }}>não possui site</span>
                  )}
                </dd>
                <dt>Google Maps</dt>
                <dd>{lead.google_maps ? <a href={lead.google_maps} target="_blank" rel="noreferrer">abrir link</a> : naoInformado}</dd>
                <dt>Status</dt>
                <dd>{lead.status}</dd>
                <dt>Etapa</dt>
                <dd>{lead.pipeline}</dd>
                <dt>Importado em</dt>
                <dd>{dataHora(lead.data_importacao)}</dd>
                <dt>Último contato</dt>
                <dd>{lead.data_ultimo_contato ? dataHora(lead.data_ultimo_contato) : naoInformado}</dd>
                <dt>Mensagens</dt>
                <dd>{lead.quantidade_mensagens_enviadas} enviada(s)</dd>
                <dt>Origem</dt>
                <dd className="truncate" title={lead.origem}>{lead.origem || naoInformado}</dd>
              </dl>
              {lead.dados_extra && (
                <div className="mt-8">
                  <div className="label" style={{ marginBottom: 6 }}>Outras colunas da planilha</div>
                  <dl className="dados-grid">
                    {Object.entries(lead.dados_extra).map(([k, v]) => (
                      <div key={k} style={{ display: 'contents' }}>
                        <dt className="truncate" title={k}>{k}</dt>
                        <dd>{String(v)}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
            </section>

            {/* -------------------------------------------------- IA */}
            {analise && (
              <section className="opp-sugestao col gap-8">
                <div className="row-between">
                  <b className="row gap-6">
                    <Sparkles size={14} color="var(--accent)" /> Análise da IA
                  </b>
                  <span className="fs-12 dim">{Math.round((analise.confianca || 0) * 100)}% de confiança</span>
                </div>
                <p className="fs-13 soft">{analise.motivo}</p>
                {analise.sugestao_resposta && (
                  <>
                    <div className="divisor" />
                    <span className="label">Sugestão de resposta (não enviada)</span>
                    <p className="fs-13">{analise.sugestao_resposta}</p>
                    <div className="row gap-8">
                      <button type="button" className="btn btn-sm" onClick={() => copiar(analise.sugestao_resposta)}>
                        <Copy size={13} /> Copiar
                      </button>
                      <Link className="btn btn-sm" to={`/conversas?lead=${leadId}`}>
                        Editar e enviar
                      </Link>
                    </div>
                  </>
                )}
              </section>
            )}

            {/* -------------------------------------------------- etiquetas */}
            <section className="col gap-8">
              <span className="label">Alterar etiqueta</span>
              <div className="row gap-6 wrap">
                {tags.map((t) => (
                  <button
                    key={t.slug}
                    type="button"
                    className="tag"
                    style={{ color: t.cor, opacity: lead.etiqueta === t.slug ? 1 : 0.55, cursor: 'pointer' }}
                    onClick={() => mudarEtiqueta(t.slug)}
                  >
                    <span className="tag-emoji">{t.emoji}</span>
                    {t.nome}
                  </button>
                ))}
              </div>
            </section>

            {/* -------------------------------------------------- acoes comerciais */}
            <section className="col gap-8">
              <span className="label">Ações</span>
              <div className="row gap-8 wrap">
                <Link className="btn btn-primary" to={`/demonstracoes?lead=${leadId}`}>
                  <Globe2 size={15} /> Criar demonstração
                </Link>
                <button type="button" className="btn" onClick={agendarFollowUp} disabled={ocupado === 'followup'}>
                  <AlarmClock size={15} /> {ocupado === 'followup' ? 'Agendando...' : 'Agendar follow-up'}
                </button>
                <Link className="btn" to="/vendas">
                  <Wallet size={15} /> Registrar venda
                </Link>
              </div>
              <div className="row gap-8 wrap">
                <button type="button" className="btn btn-ok" onClick={fechar} disabled={lead.status === 'FECHADO'}>
                  <CheckCheck size={15} /> Marcar como fechado
                </button>
                <button type="button" className="btn" onClick={adiar}>
                  <Clock3 size={15} /> Adiar 24h
                </button>
              </div>
            </section>

            {/* -------------------------------------------------- timeline (spec 76) */}
            <section>
              <div className="label row gap-6" style={{ marginBottom: 10 }}>
                <History size={12} /> Linha do tempo ({timeline.length})
              </div>
              {timeline.length === 0 ? (
                <Vazio titulo="Sem atividade ainda" texto="Tudo que acontecer com este lead fica registrado aqui." />
              ) : (
                <div className="timeline">
                  {timeline.slice(0, 30).map((a) => (
                    <div className="timeline-item" key={a.id}>
                      <span className="timeline-bolha">{a.icone || '•'}</span>
                      <div className="grow" style={{ minWidth: 0 }}>
                        <div className="row-between gap-8">
                          <b className="fs-13">{a.titulo}</b>
                          <span className="fs-12 dim nowrap">{tempoRelativo(a.created_at)}</span>
                        </div>
                        {a.descricao && (
                          <p className="fs-12 muted" style={{ whiteSpace: 'pre-wrap' }}>
                            {String(a.descricao).slice(0, 220)}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </Drawer>
  );
}
