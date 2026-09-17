import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileSpreadsheet, Upload, CheckCircle2, AlertTriangle, ArrowRight, History } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../state/AppContext.jsx';
import { Card, Vazio, SkeletonLista } from '../components/ui.jsx';
import { dataHora, numero } from '../lib/format.js';

const ROTULOS = {
  nome_estabelecimento: 'Nome do estabelecimento',
  telefone: 'Telefone / WhatsApp',
  google_maps: 'Google Maps',
  endereco: 'Endereço',
  cidade: 'Cidade',
  instagram: 'Instagram',
  categoria: 'Categoria',
  site: 'Site',
  observacoes: 'Observações',
  nicho: 'Nicho',
  estado: 'Estado (UF)',
  avaliacao: 'Nota no Google',
  total_avaliacoes: 'Nº de avaliações',
  status_site: 'Tem site? (sim/não)'
};

export default function Importar() {
  const { toast, recarregarStats } = useApp();
  const [arquivo, setArquivo] = useState(null);
  const [analise, setAnalise] = useState(null);
  const [resultado, setResultado] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [arrastando, setArrastando] = useState(false);
  const [historico, setHistorico] = useState(null);
  const inputRef = useRef(null);

  const carregarHistorico = useCallback(() => {
    api.get('/leads/import/historico').then(setHistorico).catch(() => setHistorico([]));
  }, []);

  useEffect(() => {
    carregarHistorico();
  }, [carregarHistorico]);

  const analisar = async (f) => {
    setArquivo(f);
    setResultado(null);
    setAnalise(null);
    setOcupado(true);
    try {
      setAnalise(await api.upload('/leads/import/analisar', f));
    } catch (e) {
      toast('erro', 'Não consegui ler a planilha', e.message);
      setArquivo(null);
    } finally {
      setOcupado(false);
    }
  };

  const importar = async () => {
    if (!arquivo) return;
    setOcupado(true);
    try {
      const r = await api.upload('/leads/import', arquivo);
      setResultado(r);
      recarregarStats();
      carregarHistorico();
      toast('sucesso', 'Importação concluída', `${r.importados} novos leads, ${r.duplicados} duplicados ignorados.`);
    } catch (e) {
      toast('erro', 'Erro na importação', e.message);
    } finally {
      setOcupado(false);
    }
  };

  const soltar = (e) => {
    e.preventDefault();
    setArrastando(false);
    const f = e.dataTransfer.files?.[0];
    if (f) analisar(f);
  };

  return (
    <>
      <div className="grid grid-2-1">
        <Card titulo="Importar leads" icone={<FileSpreadsheet size={16} color="var(--accent)" />}>
          <div
            className="empty"
            style={{
              border: `1px dashed ${arrastando ? 'var(--accent)' : 'var(--border-strong)'}`,
              borderRadius: 'var(--radius)',
              background: arrastando ? 'var(--accent-soft)' : 'rgba(148,163,184,.03)',
              transition: 'all var(--fast)',
              cursor: 'pointer'
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setArrastando(true);
            }}
            onDragLeave={() => setArrastando(false)}
            onDrop={soltar}
            onClick={() => inputRef.current?.click()}
          >
            <div className="empty-icon">
              <Upload size={22} />
            </div>
            <strong>{arquivo ? arquivo.name : 'Arraste a planilha aqui'}</strong>
            <p className="fs-13">
              Aceita <b>.xlsx</b> (e .csv). O sistema detecta as colunas sozinho, mesmo com nomes diferentes.
            </p>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xlsm,.csv"
              hidden
              onChange={(e) => e.target.files?.[0] && analisar(e.target.files[0])}
            />
            <button type="button" className="btn btn-primary" disabled={ocupado}>
              Selecionar arquivo
            </button>
          </div>

          {ocupado && !analise && <SkeletonLista linhas={4} altura={34} />}

          {analise && (
            <div className="mt-24">
              <div className="row-between">
                <h3>Colunas detectadas</h3>
                <span className="fs-13 dim">{numero(analise.totalLinhas)} linhas encontradas</span>
              </div>

              <div className="table-wrap mt-8" style={{ maxHeight: 300, border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
                <table className="tabela">
                  <thead>
                    <tr>
                      <th>Coluna da planilha</th>
                      <th>Vai virar</th>
                      <th>Exemplo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analise.colunas.map((c) => (
                      <tr key={c.indice} style={{ cursor: 'default' }}>
                        <td><b>{c.cabecalho}</b></td>
                        <td>
                          {c.campo ? (
                            <span className="chip accent" style={{ height: 22 }}>
                              <ArrowRight size={12} /> {ROTULOS[c.campo] || c.campo}
                            </span>
                          ) : (
                            <span className="dim fs-12">guardado como dado extra</span>
                          )}
                        </td>
                        <td className="fs-12 dim truncate" style={{ maxWidth: 260 }}>{c.exemplo || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {analise.camposAusentes?.length > 0 && (
                <p className="hint mt-8">
                  Não encontrei coluna para: {analise.camposAusentes.map((c) => ROTULOS[c] || c).join(', ')}. Sem problema — esses
                  campos ficam vazios, o sistema nunca inventa dado.
                </p>
              )}

              <div className="row gap-8 mt-16">
                <button type="button" className="btn btn-primary btn-lg" onClick={importar} disabled={ocupado}>
                  <Upload size={16} /> {ocupado ? 'Importando...' : 'IMPORTAR LEADS'}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setArquivo(null);
                    setAnalise(null);
                  }}
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {resultado && (
            <div className="mt-24">
              <h3 className="row gap-8">
                <CheckCircle2 size={17} color="var(--ok)" /> Importação concluída
              </h3>
              <div className="grid grid-4 mt-16">
                <div className="kpi-mini">
                  <span>Novos leads</span>
                  <b style={{ color: 'var(--ok)' }}>{numero(resultado.importados)}</b>
                </div>
                <div className="kpi-mini">
                  <span>Enriquecidos</span>
                  <b style={{ color: 'var(--accent)' }}>{numero(resultado.atualizados)}</b>
                </div>
                <div className="kpi-mini">
                  <span>Duplicados</span>
                  <b style={{ color: 'var(--warn)' }}>{numero(resultado.duplicados)}</b>
                </div>
                <div className="kpi-mini">
                  <span>Inválidos</span>
                  <b style={{ color: 'var(--erro)' }}>{numero(resultado.invalidos)}</b>
                </div>
              </div>
              <div className="aviso-regra mt-16">
                <AlertTriangle size={15} />
                <span>
                  Duplicados foram detectados pelo telefone (e por nome + endereço quando não há telefone). Ninguém será chamado
                  duas vezes.
                </span>
              </div>
              <Link className="btn btn-primary mt-16" to="/prospeccao">
                Ir para a prospecção <ArrowRight size={15} />
              </Link>
            </div>
          )}
        </Card>

        <Card titulo="Importações anteriores" icone={<History size={15} color="var(--accent)" />}>
          {!historico ? (
            <SkeletonLista linhas={3} altura={54} />
          ) : historico.length === 0 ? (
            <Vazio titulo="Nenhuma importação ainda" texto="O histórico das planilhas importadas aparece aqui." />
          ) : (
            <div className="col gap-12">
              {historico.map((h) => (
                <div key={h.id} className="kpi-mini">
                  <div className="row-between">
                    <b className="truncate fs-13" title={h.arquivo}>{h.arquivo}</b>
                    <span className="fs-12 dim">{dataHora(h.created_at)}</span>
                  </div>
                  <span className="fs-12">
                    {numero(h.importados)} novos · {numero(h.atualizados)} enriquecidos · {numero(h.duplicados)} duplicados ·{' '}
                    {numero(h.invalidos)} inválidos
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
