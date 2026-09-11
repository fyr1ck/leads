import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, Download, Eraser, RefreshCw, Filter, Users } from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { useApp } from '../state/AppContext.jsx';
import { Card, Campo, TagPill, Vazio, SkeletonLista, BotaoMaps, Modal } from '../components/ui.jsx';
import LeadDrawer from '../components/LeadDrawer.jsx';
import { dataHora, numero, naoInformado } from '../lib/format.js';

const ORDENS = [
  { valor: 'relevancia', rotulo: 'Mais relevantes' },
  { valor: 'nao_contatados', rotulo: 'Não contatados primeiro' },
  { valor: 'novos', rotulo: 'Mais novos' },
  { valor: 'sem_site', rotulo: 'Sem site primeiro' },
  { valor: 'cidade', rotulo: 'Cidade' },
  { valor: 'categoria', rotulo: 'Categoria' },
  { valor: 'nome', rotulo: 'Nome (A-Z)' },
  { valor: 'resposta_recente', rotulo: 'Resposta mais recente' }
];

const FILTRO_VAZIO = {
  busca: '',
  cidade: '',
  categoria: '',
  etiqueta: '',
  contatado: '',
  respondeu: '',
  temSite: '',
  temInstagram: '',
  temTelefone: '',
  naProspeccao: ''
};

export default function Leads() {
  const { tags, toast } = useApp();
  const [filtros, setFiltros] = useState(FILTRO_VAZIO);
  const [ordem, setOrdem] = useState('relevancia');
  const [dados, setDados] = useState(null);
  const [opcoes, setOpcoes] = useState({ cidades: [], categorias: [] });
  const [limite, setLimite] = useState(100);
  const [leadAberto, setLeadAberto] = useState(null);
  const [limpando, setLimpando] = useState(false);
  const [baixando, setBaixando] = useState('');

  const carregar = useCallback(async () => {
    try {
      setDados((d) => (d ? { ...d, carregando: true } : null));
      const r = await api.get(`/leads${qs({ ...filtros, ordem, limite })}`);
      setDados(r);
    } catch (e) {
      toast('erro', 'Erro ao carregar leads', e.message);
    }
  }, [filtros, ordem, limite, toast]);

  useEffect(() => {
    const t = setTimeout(carregar, filtros.busca ? 300 : 0);
    return () => clearTimeout(t);
  }, [carregar, filtros.busca]);

  useEffect(() => {
    api.get('/leads/filtros/opcoes').then(setOpcoes).catch(() => {});
  }, []);

  const set = (campo) => (e) => setFiltros((f) => ({ ...f, [campo]: e.target.value }));

  const exportar = async (rota, nome) => {
    setBaixando(rota);
    try {
      const arquivo = await api.baixar(rota, nome);
      toast('sucesso', 'Arquivo gerado', arquivo);
    } catch (e) {
      toast('erro', 'Erro ao exportar', e.message);
    } finally {
      setBaixando('');
    }
  };

  const limparProspeccao = async () => {
    try {
      const r = await api.post('/leads/limpar-prospeccao', {});
      toast('sucesso', 'Lista de prospecção limpa', `${r.removidos} lead(s) saíram da lista. O CRM e o histórico continuam intactos.`);
      setLimpando(false);
      carregar();
    } catch (e) {
      toast('erro', 'Erro ao limpar', e.message);
    }
  };

  const totalFiltros = useMemo(() => Object.values(filtros).filter(Boolean).length, [filtros]);

  return (
    <>
      <Card
        titulo="Filtros"
        icone={<Filter size={16} color="var(--accent)" />}
        acoes={
          <>
            {totalFiltros > 0 && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setFiltros(FILTRO_VAZIO)}>
                Limpar filtros ({totalFiltros})
              </button>
            )}
            <button type="button" className="btn btn-sm" onClick={carregar}>
              <RefreshCw size={14} /> Atualizar
            </button>
          </>
        }
      >
        <div className="filtros">
          <Campo label="Buscar">
            <div style={{ position: 'relative' }}>
              <Search size={15} style={{ position: 'absolute', left: 11, top: 11, color: 'var(--dim)' }} />
              <input
                className="input"
                style={{ paddingLeft: 33 }}
                placeholder="Nome, telefone, cidade..."
                value={filtros.busca}
                onChange={set('busca')}
              />
            </div>
          </Campo>
          <Campo label="Cidade">
            <select className="select" value={filtros.cidade} onChange={set('cidade')}>
              <option value="">Todas</option>
              {opcoes.cidades?.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </Campo>
          <Campo label="Categoria">
            <select className="select" value={filtros.categoria} onChange={set('categoria')}>
              <option value="">Todas</option>
              {opcoes.categorias?.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </Campo>
          <Campo label="Etiqueta">
            <select className="select" value={filtros.etiqueta} onChange={set('etiqueta')}>
              <option value="">Todas</option>
              {tags.map((t) => (
                <option key={t.slug} value={t.slug}>{`${t.emoji} ${t.nome}`}</option>
              ))}
            </select>
          </Campo>
          <Campo label="Contato">
            <select className="select" value={filtros.contatado} onChange={set('contatado')}>
              <option value="">Todos</option>
              <option value="nao">Não contatados</option>
              <option value="sim">Já contatados</option>
            </select>
          </Campo>
          <Campo label="Site">
            <select className="select" value={filtros.temSite} onChange={set('temSite')}>
              <option value="">Todos</option>
              <option value="nao">Não possui site</option>
              <option value="sim">Possui site</option>
            </select>
          </Campo>
          <Campo label="Instagram">
            <select className="select" value={filtros.temInstagram} onChange={set('temInstagram')}>
              <option value="">Todos</option>
              <option value="sim">Possui Instagram</option>
              <option value="nao">Sem Instagram</option>
            </select>
          </Campo>
          <Campo label="Ordenar por">
            <select className="select" value={ordem} onChange={(e) => setOrdem(e.target.value)}>
              {ORDENS.map((o) => (
                <option key={o.valor} value={o.valor}>{o.rotulo}</option>
              ))}
            </select>
          </Campo>
        </div>

        <div className="row gap-8 wrap mt-16">
          <button type="button" className="btn btn-sm" disabled={baixando === '/export/restantes'} onClick={() => exportar('/export/restantes', 'leads-restantes.xlsx')}>
            <Download size={14} /> Exportar leads restantes
          </button>
          <button type="button" className="btn btn-sm" disabled={baixando === '/export/historico'} onClick={() => exportar('/export/historico', 'historico.xlsx')}>
            <Download size={14} /> Exportar histórico
          </button>
          <button type="button" className="btn btn-sm" disabled={baixando === '/export/crm'} onClick={() => exportar('/export/crm', 'crm.xlsx')}>
            <Download size={14} /> Exportar CRM
          </button>
          <button type="button" className="btn btn-sm btn-warn" onClick={() => setLimpando(true)}>
            <Eraser size={14} /> Limpar lista de prospecção
          </button>
        </div>
      </Card>

      <Card
        titulo={`Leads ${dados ? `(${numero(dados.total)})` : ''}`}
        icone={<Users size={16} color="var(--accent)" />}
        bodyClass="flush"
      >
        {!dados ? (
          <div style={{ padding: 18 }}>
            <SkeletonLista linhas={6} />
          </div>
        ) : dados.itens.length === 0 ? (
          <Vazio
            titulo="Nenhum lead encontrado"
            texto="Ajuste os filtros ou importe uma planilha XLSX para começar."
          />
        ) : (
          <>
            <div className="table-wrap">
              <table className="tabela">
                <thead>
                  <tr>
                    <th>Estabelecimento</th>
                    <th>Telefone</th>
                    <th>Cidade</th>
                    <th>Categoria</th>
                    <th>Etiqueta</th>
                    <th>Site</th>
                    <th>Msgs</th>
                    <th>Último contato</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {dados.itens.map((l) => (
                    <tr key={l.id} onClick={() => setLeadAberto(l.id)}>
                      <td>
                        <b>{l.nome_estabelecimento}</b>
                        {l.respondeu === 1 && <span className="chip ok" style={{ height: 19, marginLeft: 8 }}>respondeu</span>}
                      </td>
                      <td className="mono fs-12">{l.telefone_formatado || naoInformado}</td>
                      <td>{l.cidade || naoInformado}</td>
                      <td>{l.categoria || naoInformado}</td>
                      <td><TagPill etiqueta={l.etiqueta} tags={tags} sm /></td>
                      <td>{l.site ? <span className="chip" style={{ height: 20 }}>tem site</span> : <span className="dim fs-12">—</span>}</td>
                      <td className="mono">{l.quantidade_mensagens_enviadas}</td>
                      <td className="fs-12 dim">{l.data_ultimo_contato ? dataHora(l.data_ultimo_contato) : naoInformado}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <BotaoMaps url={l.google_maps} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {dados.total > dados.itens.length && (
              <div className="center" style={{ padding: 14 }}>
                <button type="button" className="btn" onClick={() => setLimite((l) => l + 100)}>
                  Carregar mais ({numero(dados.total - dados.itens.length)} restantes)
                </button>
              </div>
            )}
          </>
        )}
      </Card>

      <Modal
        aberto={limpando}
        titulo="Limpar lista de prospecção"
        onFechar={() => setLimpando(false)}
        rodape={
          <>
            <button type="button" className="btn" onClick={() => setLimpando(false)}>Cancelar</button>
            <button type="button" className="btn btn-warn" onClick={limparProspeccao}>Sim, limpar lista</button>
          </>
        }
      >
        <p className="fs-13 soft">
          Os leads que já foram contatados saem da <b>lista de prospecção</b>, então não voltam a aparecer para chamar de novo.
        </p>
        <div className="aviso-regra mt-16">
          Nada é apagado: eles continuam no CRM, com nome, Google Maps, mensagens, etiquetas e todo o histórico.
        </div>
      </Modal>

      <LeadDrawer leadId={leadAberto} aberto={Boolean(leadAberto)} onFechar={() => setLeadAberto(null)} onAtualizado={carregar} />
    </>
  );
}
