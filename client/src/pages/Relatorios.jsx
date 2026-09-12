import { useEffect, useState } from 'react';
import { BarChart3, RefreshCw, Filter, Download } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../state/AppContext.jsx';
import { Card, Vazio, SkeletonLista } from '../components/ui.jsx';
import { GraficoLinha, GraficoBarras, GraficoRosca } from '../components/charts.jsx';
import { numero, porcento, dataHora } from '../lib/format.js';

const dinheiro = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v || 0));

export default function Relatorios() {
  const { toast } = useApp();
  const [dados, setDados] = useState(null);
  const [dias, setDias] = useState(30);

  const carregar = async (d = dias) => {
    try {
      setDados(await api.get(`/reports?dias=${d}`));
    } catch (e) {
      toast('erro', 'Erro ao carregar relatórios', e.message);
    }
  };

  useEffect(() => {
    carregar(dias);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dias]);

  if (!dados) return <SkeletonLista linhas={5} altura={110} />;

  const { dashboard, graficos, funil, demos, financeiro, campanhas } = dados;
  const maxFunil = Math.max(1, ...funil.map((f) => f.total));
  const temDados = dashboard.cards.leads_importados > 0;

  return (
    <>
      <Card
        titulo="Relatórios"
        icone={<BarChart3 size={16} color="var(--accent)" />}
        acoes={
          <>
            <select className="select" style={{ width: 150, height: 31 }} value={dias} onChange={(e) => setDias(Number(e.target.value))}>
              {[7, 14, 30, 60, 90].map((d) => (
                <option key={d} value={d}>Últimos {d} dias</option>
              ))}
            </select>
            <button type="button" className="btn btn-sm" onClick={() => carregar()}>
              <RefreshCw size={14} /> Atualizar
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() =>
                api
                  .baixar('/export/crm', 'crm.xlsx')
                  .then((a) => toast('sucesso', 'Arquivo gerado', a))
                  .catch((e) => toast('erro', 'Erro ao exportar', e.message))
              }
            >
              <Download size={14} /> Exportar CRM
            </button>
          </>
        }
      >
        <div className="grid grid-4">
          {[
            ['Leads', dashboard.cards.leads_importados],
            ['Contatos', dashboard.cards.leads_contatados],
            ['Respostas', dashboard.cards.responderam],
            ['Interessados', dashboard.cards.interessados],
            ['Demonstrações', demos.total],
            ['Negociações', dashboard.cards.negociacoes],
            ['Clientes', dashboard.cards.conversoes],
            ['Faturamento', dinheiro(financeiro.faturamento), true]
          ].map(([rotulo, valor, texto]) => (
            <div className="kpi-mini" key={rotulo}>
              <span>{rotulo}</span>
              <b style={{ fontSize: texto ? 16 : 19 }}>{texto ? valor : numero(valor)}</b>
            </div>
          ))}
        </div>
      </Card>

      {!temDados ? (
        <Card>
          <Vazio titulo="Sem dados suficientes" texto="Importe leads ou faça uma busca para os relatórios ganharem conteúdo." />
        </Card>
      ) : (
        <>
          <div className="grid grid-2-1">
            <Card titulo="Funil comercial">
              <div className="funil">
                {funil.map((f, i) => (
                  <div className="funil-etapa" key={f.rotulo}>
                    <span style={{ minWidth: 112 }} className="fs-13 soft">{f.rotulo}</span>
                    <div
                      className="funil-barra"
                      style={{
                        width: `${Math.max(6, (f.total / maxFunil) * 100)}%`,
                        opacity: 1 - i * 0.09,
                        animation: 'fadeUp 400ms both',
                        animationDelay: `${i * 60}ms`
                      }}
                    >
                      {numero(f.total)}
                    </div>
                    {i > 0 && funil[i - 1].total > 0 && (
                      <span className="fs-12 dim">{porcento((f.total / funil[i - 1].total) * 100)}</span>
                    )}
                  </div>
                ))}
              </div>
            </Card>

            <Card titulo="Leads por nicho">
              <GraficoBarras dados={graficos.porNicho.slice(0, 8)} cor="#a855f7" />
            </Card>
          </div>

          <div className="grid grid-2-1">
            <Card titulo={`Atividade dos últimos ${dias} dias`}>
              <GraficoLinha
                dados={graficos.serie}
                series={[
                  { chave: 'enviadas', cor: '#22d3ee', rotulo: 'enviadas' },
                  { chave: 'respostas', cor: '#a855f7', rotulo: 'respostas' },
                  { chave: 'interessados', cor: '#f97316', rotulo: 'interessados' }
                ]}
              />
            </Card>
            <Card titulo="Distribuição por etiqueta">
              <GraficoRosca dados={graficos.porEtiqueta.filter((e) => e.slug !== 'SEM_ETIQUETA').slice(0, 8)} />
            </Card>
          </div>

          <Card titulo="Desempenho por campanha" icone={<Filter size={16} color="var(--accent)" />} bodyClass="flush">
            {campanhas.length === 0 ? (
              <Vazio titulo="Nenhuma campanha ainda" texto="As métricas aparecem depois da primeira prospecção." />
            ) : (
              <div className="table-wrap">
                <table className="tabela">
                  <thead>
                    <tr>
                      <th>Campanha</th>
                      <th>Tipo</th>
                      <th>Status</th>
                      <th>Leads</th>
                      <th>Enviados</th>
                      <th>Respostas</th>
                      <th>Interessados</th>
                      <th>Demos</th>
                      <th>Fechamentos</th>
                      <th>Taxa resposta</th>
                      <th>Taxa interesse</th>
                      <th>Conversão</th>
                      <th>Data</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campanhas.map((c) => (
                      <tr key={c.id} style={{ cursor: 'default' }}>
                        <td><b>{c.nome}</b></td>
                        <td className="fs-12">{c.tipo || 'PROSPECCAO'}</td>
                        <td><span className="chip" style={{ height: 21 }}>{c.status}</span></td>
                        <td className="mono">{numero(c.leads)}</td>
                        <td className="mono">{numero(c.enviados)}</td>
                        <td className="mono">{numero(c.respostas)}</td>
                        <td className="mono">{numero(c.interessados)}</td>
                        <td className="mono">{numero(c.demos)}</td>
                        <td className="mono">{numero(c.fechamentos)}</td>
                        <td className="mono" style={{ color: 'var(--roxo)' }}>{porcento(c.taxa_resposta)}</td>
                        <td className="mono" style={{ color: 'var(--laranja)' }}>{porcento(c.taxa_interesse)}</td>
                        <td className="mono" style={{ color: 'var(--ok)' }}>{porcento(c.taxa_conversao)}</td>
                        <td className="fs-12 dim">{dataHora(c.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </>
  );
}
