import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Search, MapPin, Plus, Check, Download, RefreshCw, Star, Instagram, Globe, Phone,
  AlertTriangle, Trash2, Copy, Play, KeyRound, Target, Building2
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../state/AppContext.jsx';
import { Card, Campo, Vazio, SkeletonLista, Modal, BotaoMaps } from '../components/ui.jsx';
import { numero, dataHora, tempoRelativo } from '../lib/format.js';

const RAIOS = [5, 10, 25, 50];

const FILTROS = [
  { valor: 'todos', rotulo: 'Todos' },
  { valor: 'sem_site', rotulo: '🟢 Somente sem site' },
  { valor: 'sem_site_instagram', rotulo: '📸 Sem site + Instagram' },
  { valor: 'com_site', rotulo: '🟡 Com site' },
  { valor: 'verificar', rotulo: '🟠 Verificar manualmente' }
];

const SITE = {
  SEM_SITE: { rotulo: 'SITE NÃO IDENTIFICADO', cor: '#22c55e', emoji: '🟢' },
  COM_SITE: { rotulo: 'SITE IDENTIFICADO', cor: '#facc15', emoji: '🟡' },
  VERIFICAR: { rotulo: 'VERIFICAR MANUALMENTE', cor: '#f97316', emoji: '🟠' }
};

const PRIORIDADE = { ALTA: '#f97316', MEDIA: '#facc15', BAIXA: '#64748b' };

export default function EncontrarLeads() {
  const { toast, settings } = useApp();
  const [status, setStatus] = useState(null);
  const [nichos, setNichos] = useState([]);
  const [pesquisas, setPesquisas] = useState([]);
  const [form, setForm] = useState({ nicho: '', cidade: '', estado: 'SP', raioKm: 10, filtro: 'sem_site' });
  const [buscando, setBuscando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [selecionados, setSelecionados] = useState(new Set());
  const [novoNicho, setNovoNicho] = useState(null);
  const [adicionando, setAdicionando] = useState(null);

  const carregar = useCallback(async () => {
    try {
      const [s, n, p] = await Promise.all([
        api.get('/prospect/status'),
        api.get('/prospect/nichos'),
        api.get('/prospect/pesquisas')
      ]);
      setStatus(s);
      setNichos(n);
      setPesquisas(p);
      setForm((f) => ({ ...f, nicho: f.nicho || n[0]?.slug || '' }));
    } catch (e) {
      toast('erro', 'Erro ao carregar a busca de leads', e.message);
    }
  }, [toast]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  useEffect(() => {
    if (settings?.busca_raio_km) setForm((f) => ({ ...f, raioKm: Number(settings.busca_raio_km) }));
  }, [settings]);

  const set = (campo) => (e) => setForm((f) => ({ ...f, [campo]: e.target.value }));

  const buscar = async (pesquisaId = null) => {
    if (!form.nicho) return toast('aviso', 'Escolha um nicho', 'Selecione ou cadastre o segmento que quer prospectar.');
    setBuscando(true);
    setSelecionados(new Set());
    try {
      const r = await api.post('/prospect/buscar', { ...form, raioKm: Number(form.raioKm), pesquisaId });
      setResultado(r);
      carregar();
      toast(
        'sucesso',
        `${r.resumo.exibidos} oportunidades`,
        `${r.resumo.total} encontrados · ${r.resumo.sem_site} sem site · ${r.resumo.duplicados} já no CRM.`
      );
    } catch (e) {
      toast('erro', 'Não foi possível buscar', e.message);
    } finally {
      setBuscando(false);
    }
  };

  const alternar = (id) =>
    setSelecionados((s) => {
      const novo = new Set(s);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });

  const selecionarTodos = () => {
    const elegiveis = (resultado?.itens || []).filter((r) => !r.duplicado).map((r) => r.id);
    setSelecionados((s) => (s.size === elegiveis.length ? new Set() : new Set(elegiveis)));
  };

  const adicionarUm = async (r) => {
    setAdicionando(r.id);
    try {
      const resp = await api.post('/prospect/adicionar', { resultadoId: r.id });
      if (resp.acao === 'DUPLICADO') {
        toast('aviso', 'Já está no CRM', `${r.nome} foi encontrado por ${resp.criterio}.`);
      } else {
        toast('sucesso', 'Lead adicionado', r.nome);
      }
      setResultado((atual) => ({
        ...atual,
        itens: atual.itens.map((x) => (x.id === r.id ? { ...x, adicionado: 1, duplicado: true, criterio: resp.criterio } : x))
      }));
    } catch (e) {
      toast('erro', 'Erro ao adicionar', e.message);
    } finally {
      setAdicionando(null);
    }
  };

  const adicionarSelecionados = async () => {
    const ids = [...selecionados];
    if (!ids.length) return;
    setAdicionando('lote');
    try {
      const r = await api.post('/prospect/adicionar-varios', { ids });
      toast(
        'sucesso',
        `${r.adicionados} adicionados`,
        `${r.duplicados} duplicados · ${r.erros} erros.`
      );
      setSelecionados(new Set());
      setResultado((atual) => ({
        ...atual,
        itens: atual.itens.map((x) => (ids.includes(x.id) ? { ...x, adicionado: 1, duplicado: true } : x))
      }));
    } catch (e) {
      toast('erro', 'Erro ao adicionar', e.message);
    } finally {
      setAdicionando(null);
    }
  };

  const criarNicho = async () => {
    const nome = String(novoNicho || '').trim();
    if (!nome) return;
    try {
      const n = await api.post('/prospect/nichos', { nome });
      await carregar();
      setForm((f) => ({ ...f, nicho: n.slug }));
      setNovoNicho(null);
      toast('sucesso', 'Nicho cadastrado', n.nome);
    } catch (e) {
      toast('erro', 'Erro ao cadastrar nicho', e.message);
    }
  };

  const semChave = status && !status.configurado;

  return (
    <>
      {/* -------------------------------------------------- sem chave */}
      {semChave && (
        <Card titulo="Configuração necessária" icone={<KeyRound size={16} color="var(--warn)" />}>
          <p className="fs-13 soft">
            A busca automática usa a <b>Google Places API (New)</b> — a fonte oficial de dados públicos de
            estabelecimentos. Para ativar:
          </p>
          <ol className="fs-13 soft" style={{ paddingLeft: 20, lineHeight: 1.9 }}>
            <li>
              Crie uma chave no{' '}
              <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">
                Google Cloud Console
              </a>
              .
            </li>
            <li>
              Habilite <b>Places API (New)</b> e <b>Geocoding API</b> no projeto.
            </li>
            <li>
              Coloque no arquivo <code className="mono">.env</code>: <code className="mono">GOOGLE_MAPS_API_KEY=...</code>
            </li>
            <li>Reinicie o servidor.</li>
          </ol>
          <div className="aviso-regra mt-16">
            <AlertTriangle size={16} />
            <span>
              Enquanto isso o restante do painel funciona normalmente — você pode trazer leads pela{' '}
              <Link to="/importar">importação de XLSX</Link>.
            </span>
          </div>
        </Card>
      )}

      {/* -------------------------------------------------- formulario */}
      <Card
        titulo="Encontrar leads"
        icone={<Search size={16} color="var(--accent)" />}
        acoes={
          status?.conectado ? (
            <span className="chip ok">
              <span className="status-dot ok" /> {status.fonte}
            </span>
          ) : (
            <span className="chip warn">{status?.motivo || 'verificando fonte...'}</span>
          )
        }
      >
        <div className="filtros">
          <Campo label="Nicho / segmento">
            <select className="select" value={form.nicho} onChange={set('nicho')}>
              {nichos.map((n) => (
                <option key={n.slug} value={n.slug}>
                  {n.nome}
                  {n.sistema ? '' : ' (personalizado)'}
                </option>
              ))}
            </select>
          </Campo>
          <Campo label="Cidade">
            <input className="input" placeholder="Ribeirão Preto" value={form.cidade} onChange={set('cidade')} />
          </Campo>
          <Campo label="Estado">
            <input className="input" maxLength={2} placeholder="SP" value={form.estado} onChange={set('estado')} />
          </Campo>
          <Campo label="Raio">
            <select className="select" value={form.raioKm} onChange={set('raioKm')}>
              {RAIOS.map((r) => (
                <option key={r} value={r}>{r} km</option>
              ))}
            </select>
          </Campo>
          <Campo label="Mostrar">
            <select className="select" value={form.filtro} onChange={set('filtro')}>
              {FILTROS.map((f) => (
                <option key={f.valor} value={f.valor}>{f.rotulo}</option>
              ))}
            </select>
          </Campo>
        </div>

        <div className="row-between mt-16 wrap gap-12">
          <button type="button" className="btn btn-sm" onClick={() => setNovoNicho('')}>
            <Plus size={14} /> Adicionar novo nicho
          </button>
          <button type="button" className="btn btn-primary btn-lg" onClick={() => buscar()} disabled={buscando || semChave}>
            <Search size={17} /> {buscando ? 'Procurando...' : '🔎 PROCURAR LEADS'}
          </button>
        </div>

        <p className="hint mt-8">
          A busca usa apenas dados públicos da API oficial. Rede social não conta como site próprio, e quando a fonte não
          permite concluir, o lead fica como <b>verificar manualmente</b> — o sistema nunca afirma o que não sabe.
        </p>
      </Card>

      {/* -------------------------------------------------- resultados */}
      {buscando && <SkeletonLista linhas={4} altura={132} />}

      {!buscando && resultado && (
        <>
          <Card bodyClass="tight">
            <div className="row-between wrap gap-12">
              <div className="row gap-16 wrap fs-13">
                <span><b>{numero(resultado.resumo.exibidos)}</b> exibidos</span>
                <span className="dim">de {numero(resultado.resumo.total)} encontrados</span>
                <span style={{ color: 'var(--ok)' }}>🟢 {resultado.resumo.sem_site} sem site</span>
                <span style={{ color: 'var(--warn)' }}>🟡 {resultado.resumo.com_site} com site</span>
                <span style={{ color: 'var(--laranja)' }}>🟠 {resultado.resumo.verificar} verificar</span>
                <span className="dim">⚠️ {resultado.resumo.duplicados} já no CRM</span>
                {!resultado.raioAplicado && <span className="chip warn">raio não aplicado (cidade não localizada)</span>}
              </div>
              <div className="row gap-8">
                <button type="button" className="btn btn-sm" onClick={selecionarTodos}>
                  <Check size={14} /> Selecionar disponíveis
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() =>
                    api
                      .baixar(`/prospect/pesquisas/${resultado.pesquisa.id}/export`, 'busca.xlsx')
                      .then((a) => toast('sucesso', 'Arquivo gerado', a))
                      .catch((e) => toast('erro', 'Erro ao exportar', e.message))
                  }
                >
                  <Download size={14} /> Exportar XLSX
                </button>
              </div>
            </div>
          </Card>

          {resultado.itens.length === 0 ? (
            <Card>
              <Vazio
                icone={<Target size={22} />}
                titulo="Nenhum estabelecimento nesse filtro"
                texto="Tente outro filtro, aumente o raio ou mude a cidade."
              />
            </Card>
          ) : (
            <div className="grid grid-3 stagger">
              {resultado.itens.map((r, i) => {
                const site = SITE[r.status_site] || SITE.VERIFICAR;
                const marcado = selecionados.has(r.id);
                return (
                  <article
                    key={r.id}
                    className={`lead-card ${marcado ? 'selecionado' : ''} ${r.duplicado ? 'duplicado' : ''}`}
                    style={{ '--cor': site.cor, '--i': i }}
                  >
                    {!r.duplicado && (
                      <button
                        type="button"
                        className={`lead-card-check ${marcado ? 'on' : ''}`}
                        onClick={() => alternar(r.id)}
                        aria-label="Selecionar"
                      >
                        {marcado && <Check size={13} />}
                      </button>
                    )}

                    <span className="fs-12 bold" style={{ color: site.cor, letterSpacing: '0.04em' }}>
                      {site.emoji} {site.rotulo}
                    </span>

                    <div>
                      <b style={{ fontSize: 15, display: 'block' }} className="truncate" title={r.nome}>
                        {r.nome}
                      </b>
                      <div className="fs-12 dim row gap-6 wrap mt-8">
                        {r.categoria && (
                          <span className="row gap-4">
                            <Building2 size={11} /> {r.categoria}
                          </span>
                        )}
                        {r.cidade && (
                          <span className="row gap-4">
                            <MapPin size={11} /> {r.cidade}
                            {r.estado ? ` - ${r.estado}` : ''}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="fs-12 col gap-4">
                      {r.avaliacao != null && (
                        <span className="row gap-6">
                          <Star size={12} color="#facc15" /> {String(r.avaliacao).replace('.', ',')}
                          {r.total_avaliacoes ? ` · ${numero(r.total_avaliacoes)} avaliações` : ''}
                        </span>
                      )}
                      <span className="row gap-6 mono">
                        <Phone size={12} color={r.telefone_e164 ? 'var(--ok)' : 'var(--dim)'} />
                        {r.telefone_formatado || 'Telefone não disponível'}
                      </span>
                      <span className="row gap-6">
                        <Instagram size={12} color={r.instagram ? 'var(--rosa)' : 'var(--dim)'} />
                        {r.instagram ? 'Instagram disponível' : 'Instagram não identificado'}
                      </span>
                      <span className="row gap-6 truncate">
                        <Globe size={12} color={r.site ? 'var(--warn)' : 'var(--dim)'} />
                        {r.site || 'Site: não identificado'}
                      </span>
                    </div>

                    <div className="row-between">
                      <span className="fs-12" style={{ color: PRIORIDADE[r.prioridade] || 'var(--dim)' }}>
                        prioridade {String(r.prioridade || '').toLowerCase()}
                      </span>
                    </div>

                    {r.duplicado && (
                      <div className="chip warn" style={{ height: 'auto', padding: '8px 11px', whiteSpace: 'normal' }}>
                        <AlertTriangle size={13} />
                        <span className="fs-12">
                          Já está no CRM ({r.criterio}) · {r.status || 'sem status'}
                          {r.score != null ? ` · score ${r.score}` : ''}
                          {r.ultimo_contato ? ` · contato ${tempoRelativo(r.ultimo_contato)}` : ''}
                        </span>
                      </div>
                    )}

                    <div className="row gap-8 wrap">
                      <BotaoMaps url={r.google_maps} />
                      {r.duplicado ? (
                        <Link className="btn btn-sm" to={`/conversas?lead=${r.lead_id}`}>
                          Ver no CRM
                        </Link>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          onClick={() => adicionarUm(r)}
                          disabled={adicionando === r.id}
                        >
                          <Plus size={13} /> {adicionando === r.id ? 'Adicionando...' : 'Adicionar lead'}
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {selecionados.size > 0 && (
            <div className="selecao-barra">
              <span className="fs-13">
                <b>{selecionados.size}</b> estabelecimento(s) selecionado(s)
              </span>
              <div className="row gap-8">
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSelecionados(new Set())}>
                  Limpar
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  onClick={adicionarSelecionados}
                  disabled={adicionando === 'lote'}
                >
                  <Plus size={14} /> {adicionando === 'lote' ? 'Adicionando...' : 'ADICIONAR SELECIONADOS'}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* -------------------------------------------------- pesquisas salvas */}
      <Card
        titulo="Pesquisas salvas"
        acoes={
          <button type="button" className="btn btn-sm" onClick={carregar}>
            <RefreshCw size={14} /> Atualizar
          </button>
        }
      >
        {pesquisas.length === 0 ? (
          <p className="fs-13 muted">Cada busca fica salva aqui para você repetir depois sem redigitar nada.</p>
        ) : (
          <div className="table-wrap" style={{ maxHeight: 320 }}>
            <table className="tabela">
              <thead>
                <tr>
                  <th>Pesquisa</th>
                  <th>Nicho</th>
                  <th>Local</th>
                  <th>Raio</th>
                  <th>Encontrados</th>
                  <th>Execuções</th>
                  <th>Última</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {pesquisas.map((p) => (
                  <tr key={p.id} style={{ cursor: 'default' }}>
                    <td><b>{p.nome}</b></td>
                    <td className="fs-12">{p.nicho}</td>
                    <td className="fs-12">{[p.cidade, p.estado].filter(Boolean).join(' - ') || '—'}</td>
                    <td className="mono fs-12">{p.raio_km} km</td>
                    <td className="mono">{numero(p.total_encontrados)}</td>
                    <td className="mono">{p.execucoes}</td>
                    <td className="fs-12 dim">{p.ultima_execucao ? dataHora(p.ultima_execucao) : '—'}</td>
                    <td>
                      <div className="row gap-6">
                        <button
                          type="button"
                          className="btn btn-sm"
                          title="Executar novamente"
                          onClick={() => {
                            setForm({
                              nicho: p.nicho,
                              cidade: p.cidade || '',
                              estado: p.estado || '',
                              raioKm: p.raio_km,
                              filtro: form.filtro
                            });
                            buscar(p.id);
                          }}
                        >
                          <Play size={13} />
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm"
                          title="Duplicar"
                          onClick={() =>
                            api
                              .post(`/prospect/pesquisas/${p.id}/duplicar`, {})
                              .then(() => {
                                carregar();
                                toast('sucesso', 'Pesquisa duplicada');
                              })
                              .catch((e) => toast('erro', 'Erro', e.message))
                          }
                        >
                          <Copy size={13} />
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          title="Excluir"
                          onClick={() =>
                            api
                              .del(`/prospect/pesquisas/${p.id}`)
                              .then(() => {
                                carregar();
                                toast('info', 'Pesquisa excluída');
                              })
                              .catch((e) => toast('erro', 'Erro', e.message))
                          }
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        aberto={novoNicho !== null}
        titulo="Novo nicho"
        onFechar={() => setNovoNicho(null)}
        rodape={
          <>
            <button type="button" className="btn" onClick={() => setNovoNicho(null)}>Cancelar</button>
            <button type="button" className="btn btn-primary" onClick={criarNicho} disabled={!String(novoNicho || '').trim()}>
              Cadastrar
            </button>
          </>
        }
      >
        <Campo label="Nome do segmento" hint="Ex.: Funilaria e pintura. Fica salvo para as próximas buscas.">
          <input
            className="input"
            autoFocus
            value={novoNicho || ''}
            onChange={(e) => setNovoNicho(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && criarNicho()}
          />
        </Campo>
      </Modal>
    </>
  );
}
