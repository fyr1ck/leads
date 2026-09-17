import { useEffect, useState } from 'react';
import { Save, Bot, Timer, Tag as TagIcon, Trash2, Plus, Database, Sparkles, ShieldCheck, Download } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../state/AppContext.jsx';
import { Card, Campo, Switch, Modal, SkeletonLista, StatusDot } from '../components/ui.jsx';
import { numero } from '../lib/format.js';

export default function Configuracoes() {
  const { toast, tags, settings, setSettings, recarregarBase } = useApp();
  const [form, setForm] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [saude, setSaude] = useState(null);
  const [novaTag, setNovaTag] = useState(null);

  useEffect(() => {
    if (settings && !form) setForm(settings);
  }, [settings, form]);

  useEffect(() => {
    api.get('/health').then(setSaude).catch(() => {});
  }, []);

  const set = (campo) => (e) => setForm((f) => ({ ...f, [campo]: e.target.value }));

  const salvar = async () => {
    setSalvando(true);
    try {
      const novo = await api.put('/settings', {
        delay_min: Number(form.delay_min),
        delay_max: Number(form.delay_max),
        bloco_tamanho: Number(form.bloco_tamanho),
        bloco_pausa_minutos: Number(form.bloco_pausa_minutos),
        limite_diario: Number(form.limite_diario),
        max_erros_consecutivos: Number(form.max_erros_consecutivos),
        quantidade_padrao_prospeccao: Number(form.quantidade_padrao_prospeccao),
        link_demonstracao: form.link_demonstracao || '',
        ia_analise_automatica: form.ia_analise_automatica ? 1 : 0,
        remover_da_prospeccao_ao_contatar: form.remover_da_prospeccao_ao_contatar ? 1 : 0
      });
      setSettings(novo);
      setForm(novo);
      toast('sucesso', 'Configurações salvas');
    } catch (e) {
      toast('erro', 'Erro ao salvar', e.message);
    } finally {
      setSalvando(false);
    }
  };

  const criarTag = async (dados) => {
    try {
      await api.post('/tags', dados);
      await recarregarBase();
      setNovaTag(null);
      toast('sucesso', 'Etiqueta criada', dados.nome);
    } catch (e) {
      toast('erro', 'Erro ao criar etiqueta', e.message);
    }
  };

  const excluirTag = async (slug) => {
    try {
      await api.del(`/tags/${slug}`);
      await recarregarBase();
      toast('info', 'Etiqueta removida');
    } catch (e) {
      toast('erro', 'Não foi possível remover', e.message);
    }
  };

  if (!form) return <SkeletonLista linhas={6} altura={60} />;

  return (
    <>
      <div className="grid grid-2">
        {/* -------------------------------------------------- envio */}
        <Card
          titulo="Ritmo e limites de envio"
          icone={<Timer size={16} color="var(--accent)" />}
          acoes={
            <button type="button" className="btn btn-sm btn-primary" onClick={salvar} disabled={salvando}>
              <Save size={14} /> {salvando ? 'Salvando...' : 'Salvar'}
            </button>
          }
        >
          <div className="filtros">
            <Campo label="Delay mínimo (s)" hint="nunca é fixo: sorteado na faixa">
              <input className="input" type="number" min="1" value={form.delay_min} onChange={set('delay_min')} />
            </Campo>
            <Campo label="Delay máximo (s)">
              <input className="input" type="number" min="1" value={form.delay_max} onChange={set('delay_max')} />
            </Campo>
            <Campo label="Pausa a cada (msgs)" hint="0 desliga a pausa de bloco">
              <input className="input" type="number" min="0" value={form.bloco_tamanho} onChange={set('bloco_tamanho')} />
            </Campo>
            <Campo label="Duração da pausa (min)">
              <input className="input" type="number" min="0" value={form.bloco_pausa_minutos} onChange={set('bloco_pausa_minutos')} />
            </Campo>
            <Campo label="Limite diário" hint="0 = sem limite">
              <input className="input" type="number" min="0" value={form.limite_diario} onChange={set('limite_diario')} />
            </Campo>
            <Campo label="Erros seguidos p/ pausar">
              <input className="input" type="number" min="1" value={form.max_erros_consecutivos} onChange={set('max_erros_consecutivos')} />
            </Campo>
            <Campo label="Quantidade padrão por prospecção">
              <input className="input" type="number" min="1" value={form.quantidade_padrao_prospeccao} onChange={set('quantidade_padrao_prospeccao')} />
            </Campo>
          </div>

          <div className="divisor mt-16" />

          <div className="row-between mt-16">
            <div>
              <b className="fs-13">Tirar o lead da prospecção ao contatar</b>
              <p className="fs-12 muted">Ele sai da lista de chamadas, mas continua no CRM com todo o histórico.</p>
            </div>
            <Switch
              ligado={Boolean(Number(form.remover_da_prospeccao_ao_contatar))}
              onChange={(v) => setForm((f) => ({ ...f, remover_da_prospeccao_ao_contatar: v ? 1 : 0 }))}
            />
          </div>
        </Card>

        {/* -------------------------------------------------- IA */}
        <Card titulo="Inteligência artificial" icone={<Bot size={16} color="var(--accent)" />}>
          <div className="col gap-16">
            <div className="row-between">
              <div>
                <b className="fs-13">Análise automática de mensagens</b>
                <p className="fs-12 muted">Classifica, etiqueta e pontua cada resposta recebida.</p>
              </div>
              <Switch
                ligado={Boolean(Number(form.ia_analise_automatica))}
                onChange={(v) => setForm((f) => ({ ...f, ia_analise_automatica: v ? 1 : 0 }))}
              />
            </div>

            <div className="row-between">
              <div>
                <b className="fs-13">Resposta automática</b>
                <p className="fs-12 muted">
                  Travada em <b>DESATIVADA</b> por design: o sistema nunca responde um cliente sozinho.
                </p>
              </div>
              <Switch ligado={false} travado titulo="Bloqueado: quem responde é você" />
            </div>

            <div className="aviso-regra">
              <ShieldCheck size={16} />
              <span>
                A IA analisa → classifica → sugere. Você decide → envia. Não existe caminho no código que envie a sugestão
                sozinho.
              </span>
            </div>

            <Campo label="Link de demonstração (opcional)" hint="Se vazio, a IA não envia link nenhum na primeira mensagem.">
              <input className="input" placeholder="https://..." value={form.link_demonstracao || ''} onChange={set('link_demonstracao')} />
            </Campo>

            <div className="divisor" />

            <div className="col gap-8">
              <div className="row-between">
                <span className="label" style={{ margin: 0 }}>Status da Groq</span>
                <span className="row gap-6 fs-12">
                  <StatusDot estado={saude?.ia?.groq?.conectado ? 'ok' : 'warn'} />
                  {saude?.ia?.groq?.conectado ? 'conectada' : saude?.ia?.groq?.motivo || 'verificando...'}
                </span>
              </div>
              <div className="row-between fs-12 muted">
                <span>Modelo</span>
                <span className="mono">{saude?.ia?.groq?.modelo || '—'}</span>
              </div>
              <div className="row-between fs-12 muted">
                <span>Skill Henvixy</span>
                <span>
                  {saude?.ia?.skill?.carregada
                    ? `carregada (${numero(saude.ia.skill.caracteres)} caracteres)`
                    : 'não encontrada'}
                </span>
              </div>
              <p className="hint">
                A chave fica apenas no arquivo <b>.env</b> do backend e nunca é enviada para esta tela.
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* -------------------------------------------------- etiquetas */}
      <Card
        titulo="Etiquetas"
        icone={<TagIcon size={16} color="var(--accent)" />}
        acoes={
          <button type="button" className="btn btn-sm" onClick={() => setNovaTag({ nome: '', emoji: '🏷️', cor: '#38bdf8', prioridade: 'MEDIA', score: 50 })}>
            <Plus size={14} /> Nova etiqueta
          </button>
        }
      >
        <div className="row gap-8 wrap">
          {tags.map((t) => (
            <span key={t.slug} className="tag" style={{ color: t.cor, height: 30, paddingRight: t.sistema ? 10 : 4 }}>
              <span className="tag-emoji">{t.emoji}</span>
              {t.nome}
              <span className="dim fs-12">· {t.prioridade}</span>
              {!t.sistema && (
                <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => excluirTag(t.slug)} aria-label="Remover">
                  <Trash2 size={12} />
                </button>
              )}
            </span>
          ))}
        </div>
      </Card>

      {/* -------------------------------------------------- sistema */}
      <div className="grid grid-2">
        <Card titulo="Sistema" icone={<Database size={16} color="var(--accent)" />}>
          <dl className="dados-grid">
            <dt>Banco local</dt>
            <dd className="mono fs-12 truncate" title={saude?.banco?.arquivo}>{saude?.banco?.arquivo || '—'}</dd>
            <dt>Leads</dt>
            <dd>{numero(saude?.banco?.leads || 0)}</dd>
            <dt>Mensagens</dt>
            <dd>{numero(saude?.banco?.mensagens || 0)}</dd>
            <dt>Histórico</dt>
            <dd>{numero(saude?.banco?.historico || 0)} registros</dd>
            <dt>Campanhas</dt>
            <dd>{numero(saude?.banco?.campanhas || 0)}</dd>
            <dt>Horário</dt>
            <dd>
              {saude?.horario?.horaLocal} · {saude?.horario?.saudacao}!
            </dd>
            <dt>Uptime</dt>
            <dd>{Math.round((saude?.uptimeSegundos || 0) / 60)} min</dd>
          </dl>
        </Card>

        <Card titulo="Exportações" icone={<Download size={16} color="var(--accent)" />}>
          <p className="fs-13 muted">
            Os arquivos preservam sempre o <b>nome do estabelecimento</b> e o <b>link do Google Maps</b>.
          </p>
          <div className="row gap-8 wrap mt-16">
            <button type="button" className="btn" onClick={() => api.baixar('/export/restantes', 'leads-restantes.xlsx').then(() => toast('sucesso', 'Arquivo gerado'))}>
              <Download size={15} /> Leads restantes
            </button>
            <button type="button" className="btn" onClick={() => api.baixar('/export/historico', 'historico.xlsx').then(() => toast('sucesso', 'Arquivo gerado'))}>
              <Download size={15} /> Histórico completo
            </button>
            <button type="button" className="btn" onClick={() => api.baixar('/export/crm', 'crm.xlsx').then(() => toast('sucesso', 'Arquivo gerado'))}>
              <Download size={15} /> CRM
            </button>
          </div>
        </Card>
      </div>

      <Modal
        aberto={Boolean(novaTag)}
        titulo="Nova etiqueta"
        onFechar={() => setNovaTag(null)}
        rodape={
          <>
            <button type="button" className="btn" onClick={() => setNovaTag(null)}>Cancelar</button>
            <button type="button" className="btn btn-primary" onClick={() => criarTag(novaTag)} disabled={!novaTag?.nome?.trim()}>
              <Sparkles size={14} /> Criar
            </button>
          </>
        }
      >
        {novaTag && (
          <div className="col gap-12">
            <Campo label="Nome">
              <input className="input" value={novaTag.nome} onChange={(e) => setNovaTag((t) => ({ ...t, nome: e.target.value }))} />
            </Campo>
            <div className="filtros">
              <Campo label="Emoji">
                <input className="input" maxLength={4} value={novaTag.emoji} onChange={(e) => setNovaTag((t) => ({ ...t, emoji: e.target.value }))} />
              </Campo>
              <Campo label="Cor">
                <input className="input" type="color" style={{ padding: 4 }} value={novaTag.cor} onChange={(e) => setNovaTag((t) => ({ ...t, cor: e.target.value }))} />
              </Campo>
              <Campo label="Prioridade">
                <select className="select" value={novaTag.prioridade} onChange={(e) => setNovaTag((t) => ({ ...t, prioridade: e.target.value }))}>
                  <option value="MAXIMA">Máxima</option>
                  <option value="ALTA">Alta</option>
                  <option value="MEDIA">Média</option>
                  <option value="BAIXA">Baixa</option>
                </select>
              </Campo>
              <Campo label="Potencial base (0-100)">
                <input className="input" type="number" min="0" max="100" value={novaTag.score} onChange={(e) => setNovaTag((t) => ({ ...t, score: Number(e.target.value) }))} />
              </Campo>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
