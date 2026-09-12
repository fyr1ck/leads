import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Wallet, Plus, RefreshCw, CheckCircle2, Trash2, Receipt, TrendingUp } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../state/AppContext.jsx';
import { Card, Campo, Vazio, SkeletonLista, Modal, Segmented } from '../components/ui.jsx';
import { GraficoBarras } from '../components/charts.jsx';
import { dataHora, numero } from '../lib/format.js';

const dinheiro = (v) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v || 0));

const CORES = { PENDENTE: '', PARCIAL: 'warn', PAGO: 'ok', ATRASADO: 'erro', CANCELADO: 'erro' };

export default function Vendas() {
  const { toast } = useApp();
  const [dados, setDados] = useState(null);
  const [filtro, setFiltro] = useState('');
  const [nova, setNova] = useState(null);
  const [detalhe, setDetalhe] = useState(null);
  const [leads, setLeads] = useState([]);

  const carregar = useCallback(async () => {
    try {
      setDados(await api.get(`/sales${filtro ? `?status=${filtro}` : ''}`));
    } catch (e) {
      toast('erro', 'Erro ao carregar vendas', e.message);
    }
  }, [filtro, toast]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const abrirNova = async () => {
    try {
      const r = await api.get('/leads?ordem=relevancia&limite=200');
      setLeads(r.itens);
      setNova({ leadId: '', valor: '', forma_pagamento: 'PIX', descricao: '', parcelas: 1 });
    } catch (e) {
      toast('erro', 'Erro ao carregar leads', e.message);
    }
  };

  const registrar = async () => {
    try {
      const total = Number(String(nova.valor).replace(',', '.'));
      const qtd = Math.max(1, Number(nova.parcelas) || 1);
      const valorParcela = Number((total / qtd).toFixed(2));
      const parcelas = Array.from({ length: qtd }, (_, i) => ({
        valor: i === qtd - 1 ? Number((total - valorParcela * (qtd - 1)).toFixed(2)) : valorParcela,
        data_prevista: new Date(Date.now() + i * 30 * 86400000).toISOString().slice(0, 10)
      }));

      await api.post('/sales', {
        leadId: Number(nova.leadId),
        valor: total,
        forma_pagamento: nova.forma_pagamento,
        descricao: nova.descricao,
        parcelas: qtd > 1 ? parcelas : []
      });
      toast('sucesso', 'Venda registrada', dinheiro(total));
      setNova(null);
      carregar();
    } catch (e) {
      toast('erro', 'Erro ao registrar', e.message);
    }
  };

  const abrirDetalhe = async (venda) => {
    try {
      setDetalhe(await api.get(`/sales/${venda.id}`));
    } catch (e) {
      toast('erro', 'Erro ao abrir venda', e.message);
    }
  };

  const quitar = async (pagamentoId) => {
    try {
      const r = await api.post(`/sales/pagamentos/${pagamentoId}/quitar`, {});
      setDetalhe(r);
      toast('sucesso', 'Parcela recebida');
      carregar();
    } catch (e) {
      toast('erro', 'Erro ao quitar', e.message);
    }
  };

  const m = dados?.metricas;

  return (
    <>
      <div className="grid grid-4 stagger">
        {[
          { rotulo: 'Faturamento', valor: m ? dinheiro(m.faturamento) : '—', cor: 'var(--ok)' },
          { rotulo: 'Recebido', valor: m ? dinheiro(m.recebido) : '—', cor: 'var(--accent)' },
          { rotulo: 'Pendente', valor: m ? dinheiro(m.pendente) : '—', cor: 'var(--warn)' },
          { rotulo: 'Ticket médio', valor: m ? dinheiro(m.ticket_medio) : '—', cor: 'var(--roxo)' }
        ].map((k, i) => (
          <article key={k.rotulo} className="stat" style={{ '--i': i }}>
            <span className="stat-label">{k.rotulo}</span>
            <div className="stat-value" style={{ color: k.cor, fontSize: 23 }}>{k.valor}</div>
            {k.rotulo === 'Faturamento' && m && <div className="stat-foot">{numero(m.vendas)} venda(s)</div>}
          </article>
        ))}
      </div>

      <div className="grid grid-2-1">
        <Card
          titulo="Vendas"
          icone={<Wallet size={16} color="var(--ok)" />}
          acoes={
            <>
              <button type="button" className="btn btn-sm" onClick={carregar}>
                <RefreshCw size={14} /> Atualizar
              </button>
              <button type="button" className="btn btn-sm btn-primary" onClick={abrirNova}>
                <Plus size={14} /> Registrar venda
              </button>
            </>
          }
          bodyClass="flush"
        >
          <div style={{ padding: 14 }}>
            <Segmented
              opcoes={[
                { valor: '', rotulo: 'Todas' },
                { valor: 'PENDENTE', rotulo: 'Pendentes' },
                { valor: 'PARCIAL', rotulo: 'Parciais' },
                { valor: 'PAGO', rotulo: 'Pagas' },
                { valor: 'CANCELADO', rotulo: 'Canceladas' }
              ]}
              valor={filtro}
              onChange={setFiltro}
            />
          </div>

          {!dados ? (
            <div style={{ padding: 18 }}>
              <SkeletonLista linhas={4} />
            </div>
          ) : dados.itens.length === 0 ? (
            <Vazio
              icone={<Receipt size={22} />}
              titulo="Nenhuma venda registrada"
              texto="Quando fechar um negócio, registre aqui para acompanhar faturamento e pagamentos."
            />
          ) : (
            <div className="table-wrap">
              <table className="tabela">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Descrição</th>
                    <th>Valor</th>
                    <th>Recebido</th>
                    <th>Forma</th>
                    <th>Status</th>
                    <th>Data</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.itens.map((v) => (
                    <tr key={v.id} onClick={() => abrirDetalhe(v)}>
                      <td>
                        <b>{v.nome_estabelecimento}</b>
                        {v.cidade && <div className="fs-12 dim">{v.cidade}</div>}
                      </td>
                      <td className="fs-12">{v.descricao || '—'}</td>
                      <td className="mono bold">{dinheiro(v.valor)}</td>
                      <td className="mono" style={{ color: 'var(--ok)' }}>{dinheiro(v.recebido)}</td>
                      <td className="fs-12">{v.forma_pagamento || '—'}</td>
                      <td><span className={`chip ${CORES[v.status]}`} style={{ height: 22 }}>{v.status}</span></td>
                      <td className="fs-12 dim">{dataHora(v.data_venda)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card titulo="Faturamento por mês" icone={<TrendingUp size={16} color="var(--accent)" />}>
          {!dados ? (
            <SkeletonLista linhas={4} altura={28} />
          ) : dados.serie.length === 0 ? (
            <p className="fs-13 dim">Sem dados suficientes.</p>
          ) : (
            <GraficoBarras
              dados={dados.serie.map((s) => ({ rotulo: s.mes, total: s.total }))}
              cor="#22c55e"
            />
          )}
        </Card>
      </div>

      {/* -------------------------------------------------- nova venda */}
      <Modal
        aberto={Boolean(nova)}
        titulo="Registrar venda"
        onFechar={() => setNova(null)}
        rodape={
          <>
            <button type="button" className="btn" onClick={() => setNova(null)}>Cancelar</button>
            <button type="button" className="btn btn-primary" onClick={registrar} disabled={!nova?.leadId || !nova?.valor}>
              <CheckCircle2 size={14} /> Registrar
            </button>
          </>
        }
      >
        {nova && (
          <div className="col gap-12">
            <Campo label="Cliente (lead)">
              <select className="select" value={nova.leadId} onChange={(e) => setNova((n) => ({ ...n, leadId: e.target.value }))}>
                <option value="">Selecione...</option>
                {leads.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.nome_estabelecimento}
                    {l.cidade ? ` · ${l.cidade}` : ''}
                  </option>
                ))}
              </select>
            </Campo>
            <div className="filtros">
              <Campo label="Valor total (R$)">
                <input
                  className="input"
                  inputMode="decimal"
                  placeholder="1200,00"
                  value={nova.valor}
                  onChange={(e) => setNova((n) => ({ ...n, valor: e.target.value }))}
                />
              </Campo>
              <Campo label="Forma de pagamento">
                <select
                  className="select"
                  value={nova.forma_pagamento}
                  onChange={(e) => setNova((n) => ({ ...n, forma_pagamento: e.target.value }))}
                >
                  {['PIX', 'Cartão', 'Boleto', 'Transferência', 'Dinheiro', 'Outro'].map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </Campo>
              <Campo label="Parcelas" hint="mensais, a partir de hoje">
                <input
                  className="input"
                  type="number"
                  min="1"
                  max="24"
                  value={nova.parcelas}
                  onChange={(e) => setNova((n) => ({ ...n, parcelas: e.target.value }))}
                />
              </Campo>
            </div>
            <Campo label="Descrição">
              <input
                className="input"
                placeholder="Site institucional"
                value={nova.descricao}
                onChange={(e) => setNova((n) => ({ ...n, descricao: e.target.value }))}
              />
            </Campo>
            <p className="hint">Ao registrar, o lead é marcado como cliente e movido para a etapa Fechado.</p>
          </div>
        )}
      </Modal>

      {/* -------------------------------------------------- detalhe */}
      <Modal
        aberto={Boolean(detalhe)}
        titulo={`Venda · ${dinheiro(detalhe?.venda?.valor)}`}
        onFechar={() => setDetalhe(null)}
        grande
      >
        {detalhe && (
          <div className="col gap-16">
            <dl className="dados-grid">
              <dt>Status</dt>
              <dd><span className={`chip ${CORES[detalhe.venda.status]}`} style={{ height: 22 }}>{detalhe.venda.status}</span></dd>
              <dt>Descrição</dt>
              <dd>{detalhe.venda.descricao || '—'}</dd>
              <dt>Forma</dt>
              <dd>{detalhe.venda.forma_pagamento || '—'}</dd>
              <dt>Data</dt>
              <dd>{dataHora(detalhe.venda.data_venda)}</dd>
            </dl>

            <div>
              <div className="label" style={{ marginBottom: 8 }}>Parcelas</div>
              {detalhe.pagamentos.length === 0 ? (
                <p className="fs-13 dim">Pagamento à vista, sem parcelas registradas.</p>
              ) : (
                <div className="col gap-8">
                  {detalhe.pagamentos.map((p) => (
                    <div key={p.id} className="kpi-mini">
                      <div className="row-between">
                        <b className="mono">{dinheiro(p.valor)}</b>
                        <span className={`chip ${p.status === 'PAGO' ? 'ok' : ''}`} style={{ height: 21 }}>{p.status}</span>
                      </div>
                      <div className="row-between fs-12 muted">
                        <span>
                          {p.data_pagamento ? `pago em ${p.data_pagamento}` : `previsto para ${p.data_prevista || '—'}`}
                        </span>
                        {p.status !== 'PAGO' && (
                          <button type="button" className="btn btn-sm btn-ok" onClick={() => quitar(p.id)}>
                            <CheckCircle2 size={13} /> Marcar recebida
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="row gap-8">
              <Link className="btn btn-sm" to={`/conversas?lead=${detalhe.venda.lead_id}`}>
                Abrir conversa
              </Link>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() =>
                  api
                    .del(`/sales/${detalhe.venda.id}`)
                    .then(() => {
                      toast('info', 'Venda excluída', 'O histórico do lead continua salvo.');
                      setDetalhe(null);
                      carregar();
                    })
                    .catch((e) => toast('erro', 'Erro', e.message))
                }
              >
                <Trash2 size={13} /> Excluir venda
              </button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
