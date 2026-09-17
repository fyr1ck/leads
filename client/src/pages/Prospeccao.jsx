import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Rocket, Play, Pause, Square, Timer, Users, CheckCircle2, AlertTriangle, MessageSquare,
  Flame, Clock, SkipForward, Settings2
} from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { useApp } from '../state/AppContext.jsx';
import { Card, Campo, Vazio, Progresso, SkeletonLista, Switch } from '../components/ui.jsx';
import LogConsole from '../components/LogConsole.jsx';
import { numero, contagemRegressiva } from '../lib/format.js';

const relogioBrasilia = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/Sao_Paulo',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
});
const emMinutos = (hhmm) => {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
};

/** Mesma regra do servidor: janela em Brasilia, pode virar a noite (22:00-02:00). */
function dentroDoHorario(inicio, fim) {
  const ini = emMinutos(inicio);
  const end = emMinutos(fim);
  if (ini === null || end === null || ini === end) return true;
  const agora = emMinutos(relogioBrasilia.format(new Date()));
  return ini < end ? agora >= ini && agora < end : agora >= ini || agora < end;
}

export default function Prospeccao() {
  const { toast, whatsapp, settings, campanhas, campanhaAtiva } = useApp();
  const [contadores, setContadores] = useState(null);
  const [opcoes, setOpcoes] = useState({ cidades: [], categorias: [], nichos: [] });
  const [previa, setPrevia] = useState(null);
  const [criando, setCriando] = useState(false);
  // relogio de 1s: mantem a contagem regressiva do proximo envio viva na tela
  const [, setAgora] = useState(Date.now());
  const [form, setForm] = useState({
    quantidade: 50,
    cidade: '',
    nicho: '',
    categoria: '',
    temSite: '',
    delayMin: 30,
    delayMax: 90,
    blocoTamanho: 10,
    blocoPausaMinutos: 5,
    horarioAtivo: true,
    horarioInicio: '08:00',
    horarioFim: '18:00'
  });

  const horarioInvalido = form.horarioAtivo && (!form.horarioInicio || !form.horarioFim || form.horarioInicio === form.horarioFim);
  const foraDoHorario = form.horarioAtivo && !horarioInvalido && !dentroDoHorario(form.horarioInicio, form.horarioFim);

  // campanha em foco: a ativa, senao a ultima pausada/rascunho
  const ultima = campanhaAtiva || Object.values(campanhas).sort((a, b) => (b?.campanha?.id || 0) - (a?.campanha?.id || 0))[0] || null;

  useEffect(() => {
    if (!settings) return;
    setForm((f) => ({
      ...f,
      quantidade: settings.quantidade_padrao_prospeccao ?? f.quantidade,
      delayMin: settings.delay_min ?? f.delayMin,
      delayMax: settings.delay_max ?? f.delayMax,
      blocoTamanho: settings.bloco_tamanho ?? f.blocoTamanho,
      blocoPausaMinutos: settings.bloco_pausa_minutos ?? f.blocoPausaMinutos,
      horarioAtivo: settings.horario_ativo === undefined ? f.horarioAtivo : Boolean(settings.horario_ativo),
      horarioInicio: settings.horario_inicio || f.horarioInicio,
      horarioFim: settings.horario_fim || f.horarioFim
    }));
  }, [settings]);

  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const carregar = useCallback(async () => {
    try {
      const [c, o] = await Promise.all([api.get('/leads/contadores'), api.get('/leads/filtros/opcoes')]);
      setContadores(c);
      setOpcoes(o);
    } catch (e) {
      toast('erro', 'Erro ao carregar dados', e.message);
    }
  }, [toast]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const verPrevia = useCallback(async () => {
    try {
      const r = await api.get(
        `/leads/disponiveis${qs({ quantidade: form.quantidade, cidade: form.cidade, nicho: form.nicho, categoria: form.categoria, temSite: form.temSite })}`
      );
      setPrevia(r);
    } catch (e) {
      toast('erro', 'Erro ao selecionar leads', e.message);
    }
  }, [form.quantidade, form.cidade, form.nicho, form.categoria, form.temSite, toast]);

  useEffect(() => {
    const t = setTimeout(verPrevia, 250);
    return () => clearTimeout(t);
  }, [verPrevia]);

  const set = (campo) => (e) => setForm((f) => ({ ...f, [campo]: e.target.value }));

  const iniciar = async () => {
    setCriando(true);
    try {
      const r = await api.post('/campaigns', {
        quantidade: Number(form.quantidade),
        delayMin: Number(form.delayMin),
        delayMax: Number(form.delayMax),
        blocoTamanho: Number(form.blocoTamanho),
        blocoPausaMinutos: Number(form.blocoPausaMinutos),
        horarioAtivo: form.horarioAtivo,
        horarioInicio: form.horarioInicio,
        horarioFim: form.horarioFim,
        filtros: { cidade: form.cidade, nicho: form.nicho, categoria: form.categoria, temSite: form.temSite }
      });
      await api.post(`/campaigns/${r.campanha.id}/start`, {});
      if (foraDoHorario) {
        toast('sucesso', 'Prospecção agendada', `${r.enfileirados} leads na fila. Começa sozinha às ${form.horarioInicio}.`);
      } else {
        toast('sucesso', 'Prospecção iniciada', `${r.enfileirados} leads na fila.`);
      }
      carregar();
    } catch (e) {
      toast('erro', 'Não foi possível iniciar', e.message);
    } finally {
      setCriando(false);
    }
  };

  const controlar = async (acao) => {
    if (!ultima?.campanha) return;
    try {
      await api.post(`/campaigns/${ultima.campanha.id}/${acao}`, {});
      const nomes = { start: 'retomada', resume: 'retomada', pause: 'pausada', stop: 'parada' };
      toast('info', `Campanha ${nomes[acao] || acao}`, ultima.campanha.nome);
    } catch (e) {
      toast('erro', 'Não foi possível executar', e.message);
    }
  };

  const p = ultima;
  const status = p?.campanha?.status;
  const proximo = contagemRegressiva(p?.proximoEnvioEm);

  return (
    <>
      <div className="grid grid-3 stagger">
        <article className="stat">
          <span className="stat-label">Leads na base</span>
          <div className="stat-value">{numero(contadores?.total || 0)}</div>
          <div className="stat-foot">importados no total</div>
        </article>
        <article className="stat">
          <span className="stat-label">Já contatados</span>
          <div className="stat-value" style={{ color: 'var(--ok)' }}>{numero(contadores?.contatados || 0)}</div>
          <div className="stat-foot">nunca serão chamados de novo</div>
        </article>
        <article className="stat">
          <span className="stat-label">Disponíveis para chamar</span>
          <div className="stat-value" style={{ color: 'var(--accent)' }}>{numero(contadores?.disponiveis || 0)}</div>
          <div className="stat-foot">com telefone válido e sem contato anterior</div>
        </article>
      </div>

      {/* ------------------------------------------------ campanha em andamento */}
      {p?.campanha && ['ATIVA', 'PAUSADA'].includes(status) && (
        <Card
          titulo={`${status === 'ATIVA' ? (p.fase === 'fora_horario' ? '⏰' : '🟢') : '🟡'} ${p.campanha.nome}`}
          acoes={
            <>
              {status === 'ATIVA' ? (
                <button type="button" className="btn btn-sm btn-warn" onClick={() => controlar('pause')}>
                  <Pause size={14} /> Pausar
                </button>
              ) : (
                <button type="button" className="btn btn-sm btn-ok" onClick={() => controlar('resume')} disabled={!whatsapp?.conectado}>
                  <Play size={14} /> Continuar
                </button>
              )}
              <button type="button" className="btn btn-sm btn-danger" onClick={() => controlar('stop')}>
                <Square size={14} /> Parar
              </button>
            </>
          }
        >
          <div className="col gap-16">
            <div>
              <div className="row-between fs-13">
                <b>
                  {numero(p.enviados)} / {numero(p.total)} leads
                </b>
                <span className="dim">
                  {status === 'ATIVA'
                    ? p.fase === 'fora_horario'
                      ? `Fora do horário · começa às ${p.campanha.horario_inicio}${proximo ? ` (em ${proximo})` : ''}`
                      : p.fase === 'pausa_bloco'
                      ? `Pausa de bloco · volta em ${proximo || '...'}`
                      : p.fase === 'aguardando'
                        ? `Próximo envio em ${proximo || '...'}`
                        : p.fase === 'gerando'
                          ? 'Gerando mensagem personalizada...'
                          : 'Enviando...'
                    : p.campanha.motivo_parada || 'Campanha pausada'}
                </span>
              </div>
              <div className="mt-8">
                <Progresso valor={p.enviados} total={p.total} ativo={status === 'ATIVA' && p.fase !== 'fora_horario'} grande />
              </div>
              {p.campanha.horario_inicio && p.campanha.horario_fim && (
                <div className="fs-12 dim mt-8 row gap-6">
                  <Clock size={12} /> Envia das {p.campanha.horario_inicio} às {p.campanha.horario_fim} · se a fila não acabar, continua no dia
                  seguinte
                </div>
              )}
              {p.atual && (
                <div className="fs-12 dim mt-8">
                  Lead atual: <b className="soft">{p.atual.nome}</b>
                  {p.atual.cidade ? ` · ${p.atual.cidade}` : ''}
                </div>
              )}
            </div>

            <div className="grid grid-4">
              {[
                { rotulo: 'Enviadas', valor: p.enviados, icone: <CheckCircle2 size={14} />, cor: 'var(--ok)' },
                { rotulo: 'Aguardando', valor: p.aguardando, icone: <Clock size={14} />, cor: 'var(--warn)' },
                { rotulo: 'Respostas', valor: p.respostas, icone: <MessageSquare size={14} />, cor: 'var(--roxo)' },
                { rotulo: 'Interessados', valor: p.interessados, icone: <Flame size={14} />, cor: 'var(--laranja)' },
                { rotulo: 'Não interessados', valor: p.nao_interessados, icone: <AlertTriangle size={14} />, cor: 'var(--erro)' },
                { rotulo: 'Erros', valor: p.erros, icone: <AlertTriangle size={14} />, cor: 'var(--erro)' },
                { rotulo: 'Ignorados', valor: p.ignorados, icone: <SkipForward size={14} />, cor: 'var(--dim)' },
                { rotulo: 'Na fila', valor: p.pendentes, icone: <Users size={14} />, cor: 'var(--accent)' }
              ].map((k) => (
                <div className="kpi-mini" key={k.rotulo}>
                  <span>
                    {k.icone} {k.rotulo}
                  </span>
                  <b style={{ color: k.cor }}>{numero(k.valor)}</b>
                </div>
              ))}
            </div>

            {status === 'PAUSADA' && p.campanha.motivo_parada && (
              <div className="chip erro" style={{ height: 'auto', padding: '9px 12px', whiteSpace: 'normal' }}>
                <AlertTriangle size={14} /> {p.campanha.motivo_parada}
              </div>
            )}
          </div>
        </Card>
      )}

      {/* ------------------------------------------------ nova prospeccao */}
      <div className="grid grid-2-1">
        <Card titulo="Nova prospecção" icone={<Rocket size={16} color="var(--accent)" />}>
          <div className="filtros">
            <Campo label="Quantidade para hoje" hint="Quantos leads chamar nesta rodada">
              <input className="input" type="number" min="1" max="1000" value={form.quantidade} onChange={set('quantidade')} />
            </Campo>
            <Campo label="Cidade">
              <select className="select" value={form.cidade} onChange={set('cidade')}>
                <option value="">Todas</option>
                {opcoes.cidades?.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </Campo>
            {opcoes.nichos?.length > 0 && (
              <Campo label="Nicho">
                <select className="select" value={form.nicho} onChange={set('nicho')}>
                  <option value="">Todos</option>
                  {opcoes.nichos.map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </Campo>
            )}
            <Campo label="Categoria">
              <select className="select" value={form.categoria} onChange={set('categoria')}>
                <option value="">Todas</option>
                {opcoes.categorias?.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </Campo>
            <Campo label="Site">
              <select className="select" value={form.temSite} onChange={set('temSite')}>
                <option value="">Todos</option>
                <option value="nao">Somente quem não tem site</option>
                <option value="sim">Somente quem já tem site</option>
              </select>
            </Campo>
          </div>

          <div className="divisor mt-16" />

          <div className="row gap-8 mt-8">
            <Timer size={15} color="var(--muted)" />
            <span className="label" style={{ margin: 0 }}>Ritmo de envio</span>
          </div>
          <div className="filtros mt-8">
            <Campo label="Delay mínimo (s)">
              <input className="input" type="number" min="1" value={form.delayMin} onChange={set('delayMin')} />
            </Campo>
            <Campo label="Delay máximo (s)">
              <input className="input" type="number" min="1" value={form.delayMax} onChange={set('delayMax')} />
            </Campo>
            <Campo label="Pausa a cada (msgs)">
              <input className="input" type="number" min="0" value={form.blocoTamanho} onChange={set('blocoTamanho')} />
            </Campo>
            <Campo label="Pausa de (min)">
              <input className="input" type="number" min="0" value={form.blocoPausaMinutos} onChange={set('blocoPausaMinutos')} />
            </Campo>
          </div>
          <p className="hint mt-8">
            O intervalo é sorteado dentro da faixa a cada mensagem — nunca fixo. A cada {form.blocoTamanho || 0} envios o sistema
            descansa {form.blocoPausaMinutos || 0} minuto(s).
          </p>

          <div className="divisor mt-16" />

          <div className="row-between mt-8 gap-12">
            <div className="row gap-8">
              <Clock size={15} color="var(--muted)" />
              <span className="label" style={{ margin: 0 }}>Horário automático</span>
            </div>
            <Switch
              ligado={form.horarioAtivo}
              onChange={(v) => setForm((f) => ({ ...f, horarioAtivo: v }))}
              titulo={form.horarioAtivo ? 'Desligar horário automático' : 'Ligar horário automático'}
            />
          </div>
          {form.horarioAtivo ? (
            <>
              <div className="filtros mt-8">
                <Campo label="Começa às">
                  <input className="input" type="time" value={form.horarioInicio} onChange={set('horarioInicio')} required />
                </Campo>
                <Campo label="Termina às">
                  <input className="input" type="time" value={form.horarioFim} onChange={set('horarioFim')} required />
                </Campo>
              </div>
              <p className="hint mt-8">
                {horarioInvalido
                  ? 'Informe um horário de início e de fim diferentes.'
                  : `Envia só entre ${form.horarioInicio} e ${form.horarioFim} (horário de Brasília). Se a fila não acabar até ${form.horarioFim}, a prospecção para sozinha e continua no dia seguinte às ${form.horarioInicio}.`}
              </p>
              {foraDoHorario && (
                <div className="chip accent mt-8" style={{ height: 'auto', padding: '9px 12px', whiteSpace: 'normal' }}>
                  <Clock size={14} /> Agora está fora do horário: ao clicar, a prospecção fica agendada e começa sozinha às{' '}
                  {form.horarioInicio}.
                </div>
              )}
            </>
          ) : (
            <p className="hint mt-8">Desligado: envia a qualquer hora, assim que você iniciar.</p>
          )}

          <div className="row-between mt-24 wrap gap-12">
            <span className="fs-13 muted">
              {previa ? (
                <>
                  <b className="soft">{numero(previa.total)}</b> leads serão selecionados
                </>
              ) : (
                'Calculando seleção...'
              )}
            </span>
            <button
              type="button"
              className="btn btn-primary btn-lg"
              onClick={iniciar}
              disabled={criando || !whatsapp?.conectado || !previa?.total || horarioInvalido}
            >
              <Rocket size={17} /> {criando ? 'Preparando...' : foraDoHorario ? 'AGENDAR PROSPECÇÃO' : 'INICIAR PROSPECÇÃO'}
            </button>
          </div>
          {!whatsapp?.conectado && (
            <div className="chip warn mt-16" style={{ height: 'auto', padding: '9px 12px', whiteSpace: 'normal' }}>
              <AlertTriangle size={14} /> Conecte o WhatsApp antes de iniciar.{' '}
              <Link to="/whatsapp">Ir para a conexão</Link>
            </div>
          )}
        </Card>

        <div className="col gap-16">
          <Card titulo="Leads selecionados" bodyClass="tight">
            {!previa ? (
              <SkeletonLista linhas={5} altura={36} />
            ) : previa.itens.length === 0 ? (
              <Vazio
                titulo="Nenhum lead disponível"
                texto="Todos os leads com esses filtros já foram contatados. Importe uma nova planilha."
                acao={
                  <Link className="btn btn-sm btn-primary" to="/importar">
                    Importar XLSX
                  </Link>
                }
              />
            ) : (
              <div className="col gap-8" style={{ maxHeight: 320, overflowY: 'auto' }}>
                {previa.itens.slice(0, 60).map((l, i) => (
                  <div key={l.id} className="row gap-8 fs-13">
                    <span className="dim mono" style={{ minWidth: 24 }}>{i + 1}</span>
                    <span className="truncate grow">{l.nome_estabelecimento}</span>
                    {!l.site && <span className="chip" style={{ height: 20 }}>sem site</span>}
                  </div>
                ))}
                {previa.itens.length > 60 && <span className="fs-12 dim">+ {previa.itens.length - 60} leads...</span>}
              </div>
            )}
          </Card>

          <Card titulo="Logs em tempo real" icone={<Settings2 size={15} color="var(--accent)" />} bodyClass="tight">
            <LogConsole limite={14} />
          </Card>
        </div>
      </div>
    </>
  );
}
