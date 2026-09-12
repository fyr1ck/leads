import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Globe, Plus, Send, Eye, MessageSquare, RefreshCw, ExternalLink, Trash2, MapPin, Star
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../state/AppContext.jsx';
import { Card, Campo, TagPill, Vazio, SkeletonLista, Modal, Segmented, BotaoMaps } from '../components/ui.jsx';
import { dataHora, tempoRelativo, numero, porcento } from '../lib/format.js';

const CORES = {
  CRIADA: '#38bdf8',
  ENVIADA: '#a855f7',
  ACESSADA: '#22c55e',
  FEEDBACK: '#f97316',
  NEGOCIACAO: '#eab308',
  FECHADA: '#14b8a6',
  DESCARTADA: '#ef4444'
};

export default function Demonstracoes() {
  const { toast, tags } = useApp();
  const [params, setParams] = useSearchParams();
  const [dados, setDados] = useState(null);
  const [filtro, setFiltro] = useState('');
  const [nova, setNova] = useState(null);
  const [feedbackDe, setFeedbackDe] = useState(null);
  const [texto, setTexto] = useState('');

  const leadParam = params.get('lead');

  const carregar = useCallback(async () => {
    try {
      setDados(await api.get(`/demos${filtro ? `?status=${filtro}` : ''}`));
    } catch (e) {
      toast('erro', 'Erro ao carregar demonstrações', e.message);
    }
  }, [filtro, toast]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // Vindo de "Criar demonstracao" na ficha do lead: ja abre preenchido (spec 59.13)
  useEffect(() => {
    if (!leadParam) return;
    api
      .get(`/demos/preparar/${leadParam}`)
      .then((d) => setNova({ ...d, url: '', titulo: d.titulo_sugerido }))
      .catch((e) => toast('erro', 'Erro ao preparar demonstração', e.message));
  }, [leadParam, toast]);

  const criar = async () => {
    try {
      await api.post('/demos', {
        leadId: nova.lead_id,
        url: nova.url,
        titulo: nova.titulo,
        observacoes: nova.observacoes
      });
      toast('sucesso', 'Demonstração criada', nova.nome);
      setNova(null);
      setParams({});
      carregar();
    } catch (e) {
      toast('erro', 'Erro ao criar', e.message);
    }
  };

  const acao = async (rota, mensagem) => {
    try {
      await api.post(rota, {});
      toast('sucesso', mensagem);
      carregar();
    } catch (e) {
      toast('erro', 'Não foi possível concluir', e.message);
    }
  };

  const salvarFeedback = async () => {
    try {
      await api.post(`/demos/${feedbackDe.id}/feedback`, { feedback: texto });
      toast('sucesso', 'Feedback registrado');
      setFeedbackDe(null);
      setTexto('');
      carregar();
    } catch (e) {
      toast('erro', 'Erro ao salvar', e.message);
    }
  };

  const est = dados?.estatisticas;
  const etapas = dados?.etapas || [];

  return (
    <>
      <div className="grid grid-4 stagger">
        {[
          { rotulo: 'Demonstrações', valor: est?.total, cor: 'var(--accent)' },
          { rotulo: 'Enviadas', valor: est?.enviadas, cor: 'var(--roxo)' },
          { rotulo: 'Acessadas', valor: est?.acessadas, cor: 'var(--ok)' },
          { rotulo: 'Taxa de acesso', valor: est ? porcento(est.taxa_acesso) : '—', cor: 'var(--laranja)', texto: true }
        ].map((k, i) => (
          <article key={k.rotulo} className="stat" style={{ '--i': i }}>
            <span className="stat-label">{k.rotulo}</span>
            <div className="stat-value" style={{ color: k.cor }}>
              {k.texto ? k.valor : numero(k.valor || 0)}
            </div>
          </article>
        ))}
      </div>

      <Card
        titulo="Pipeline das demonstrações"
        icone={<Globe size={16} color="var(--accent)" />}
        acoes={
          <button type="button" className="btn btn-sm" onClick={carregar}>
            <RefreshCw size={14} /> Atualizar
          </button>
        }
      >
        <Segmented
          opcoes={[{ valor: '', rotulo: 'Todas' }, ...etapas.map((e) => ({ valor: e.slug, rotulo: e.nome }))]}
          valor={filtro}
          onChange={setFiltro}
        />
        <p className="hint mt-16">
          Sem demo → criada → enviada → acessada → feedback → negociação → fechada. A demo é o gatilho da Skill: “já criei
          um modelo pensando no negócio de vocês”.
        </p>
      </Card>

      {!dados ? (
        <SkeletonLista linhas={3} altura={120} />
      ) : dados.itens.length === 0 ? (
        <Card>
          <Vazio
            icone={<Globe size={22} />}
            titulo="Nenhuma demonstração ainda"
            texto="Abra um lead no CRM e clique em “Criar demonstração” — os dados já vêm preenchidos."
            acao={
              <Link className="btn btn-primary" to="/leads">
                Ir para os leads
              </Link>
            }
          />
        </Card>
      ) : (
        <div className="grid grid-2 stagger">
          {dados.itens.map((d, i) => (
            <article key={d.id} className="opp" style={{ '--cor': CORES[d.status] || '#64748b', '--i': i }}>
              <div className="row-between">
                <span className="chip" style={{ color: CORES[d.status], borderColor: CORES[d.status] }}>
                  {d.status}
                </span>
                <span className="fs-12 dim">{tempoRelativo(d.updated_at || d.criada_em)}</span>
              </div>

              <div>
                <b style={{ fontSize: 15 }}>{d.nome_estabelecimento}</b>
                <div className="fs-12 dim row gap-8 wrap mt-8">
                  {d.cidade && (
                    <span className="row gap-4">
                      <MapPin size={11} /> {d.cidade}
                    </span>
                  )}
                  {d.nicho && <span>· {d.nicho}</span>}
                  <TagPill etiqueta={d.etiqueta} tags={tags} sm />
                </div>
              </div>

              {d.url && (
                <a className="opp-msg truncate" href={d.url} target="_blank" rel="noreferrer" style={{ display: 'block' }}>
                  <ExternalLink size={12} style={{ verticalAlign: -2 }} /> {d.url}
                </a>
              )}

              <div className="row gap-16 fs-12 dim wrap">
                <span>criada {dataHora(d.criada_em)}</span>
                {d.enviada_em && <span>· enviada {dataHora(d.enviada_em)}</span>}
                <span>· {numero(d.acessos)} acesso(s)</span>
                {d.ultimo_acesso && <span>· último {tempoRelativo(d.ultimo_acesso)}</span>}
              </div>

              {d.feedback && <div className="opp-sugestao fs-13">💬 {d.feedback}</div>}

              <div className="opp-acoes">
                {!d.enviada_em && (
                  <button type="button" className="btn btn-sm" onClick={() => acao(`/demos/${d.id}/enviada`, 'Marcada como enviada')}>
                    <Send size={13} /> Marcar enviada
                  </button>
                )}
                <button type="button" className="btn btn-sm" onClick={() => acao(`/demos/${d.id}/acesso`, 'Acesso registrado')}>
                  <Eye size={13} /> Registrar acesso
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    setFeedbackDe(d);
                    setTexto(d.feedback || '');
                  }}
                >
                  <MessageSquare size={13} /> Feedback
                </button>
                <BotaoMaps url={d.google_maps} />
                <Link className="btn btn-sm btn-primary" to={`/conversas?lead=${d.lead_id}`}>
                  Abrir conversa
                </Link>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  title="Excluir demonstração"
                  onClick={() =>
                    api
                      .del(`/demos/${d.id}`)
                      .then(() => {
                        toast('info', 'Demonstração excluída');
                        carregar();
                      })
                      .catch((e) => toast('erro', 'Erro', e.message))
                  }
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* -------------------------------------------------- nova demo */}
      <Modal
        aberto={Boolean(nova)}
        titulo="Criar demonstração"
        onFechar={() => {
          setNova(null);
          setParams({});
        }}
        rodape={
          <>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setNova(null);
                setParams({});
              }}
            >
              Cancelar
            </button>
            <button type="button" className="btn btn-primary" onClick={criar}>
              <Plus size={14} /> Criar
            </button>
          </>
        }
      >
        {nova && (
          <div className="col gap-16">
            <div className="kpi-mini">
              <span>Dados do estabelecimento (já preenchidos)</span>
              <b className="fs-13">{nova.nome}</b>
              <span className="fs-12 muted">
                {[nova.categoria || nova.nicho, nova.cidade, nova.telefone].filter(Boolean).join(' · ')}
              </span>
              {nova.avaliacao != null && (
                <span className="fs-12 muted row gap-4">
                  <Star size={11} color="#facc15" /> {String(nova.avaliacao).replace('.', ',')} ·{' '}
                  {numero(nova.total_avaliacoes || 0)} avaliações
                </span>
              )}
              {nova.status_site === 'SEM_SITE' && <span className="fs-12" style={{ color: 'var(--ok)' }}>🟢 site próprio não identificado</span>}
            </div>

            <Campo label="Título">
              <input className="input" value={nova.titulo || ''} onChange={(e) => setNova((n) => ({ ...n, titulo: e.target.value }))} />
            </Campo>
            <Campo label="Link do modelo" hint="Cole aqui a URL da demonstração que você criou.">
              <input
                className="input"
                placeholder="https://..."
                value={nova.url || ''}
                onChange={(e) => setNova((n) => ({ ...n, url: e.target.value }))}
              />
            </Campo>
            <Campo label="Observações">
              <textarea
                className="textarea"
                style={{ minHeight: 78 }}
                value={nova.observacoes || ''}
                onChange={(e) => setNova((n) => ({ ...n, observacoes: e.target.value }))}
              />
            </Campo>

            {nova.demos_existentes?.length > 0 && (
              <div className="chip warn" style={{ height: 'auto', padding: '9px 12px', whiteSpace: 'normal' }}>
                Esse lead já tem {nova.demos_existentes.length} demonstração(ões) registrada(s).
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* -------------------------------------------------- feedback */}
      <Modal
        aberto={Boolean(feedbackDe)}
        titulo={`Feedback · ${feedbackDe?.nome_estabelecimento || ''}`}
        onFechar={() => setFeedbackDe(null)}
        rodape={
          <>
            <button type="button" className="btn" onClick={() => setFeedbackDe(null)}>Cancelar</button>
            <button type="button" className="btn btn-primary" onClick={salvarFeedback} disabled={!texto.trim()}>
              Salvar
            </button>
          </>
        }
      >
        <Campo label="O que o cliente falou sobre o modelo?">
          <textarea className="textarea" value={texto} onChange={(e) => setTexto(e.target.value)} />
        </Campo>
      </Modal>
    </>
  );
}
