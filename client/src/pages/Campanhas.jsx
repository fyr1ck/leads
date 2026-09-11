import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Play, Pause, Square, Trash2, ChevronDown, ChevronRight, Megaphone, RefreshCw } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../state/AppContext.jsx';
import { Card, Progresso, Vazio, SkeletonLista, TagPill } from '../components/ui.jsx';
import { dataHora, numero } from '../lib/format.js';

const CORES = {
  ATIVA: 'ok',
  PAUSADA: 'warn',
  CONCLUIDA: 'accent',
  PARADA: 'erro',
  RASCUNHO: ''
};

export default function Campanhas() {
  const { toast, tags, whatsapp, campanhas: aoVivo } = useApp();
  const [lista, setLista] = useState(null);
  const [aberta, setAberta] = useState(null);
  const [itens, setItens] = useState({});

  const carregar = useCallback(async () => {
    try {
      setLista(await api.get('/campaigns'));
    } catch (e) {
      toast('erro', 'Erro ao carregar campanhas', e.message);
    }
  }, [toast]);

  useEffect(() => {
    carregar();
  }, [carregar, aoVivo]);

  const controlar = async (id, acao) => {
    try {
      await api.post(`/campaigns/${id}/${acao}`, {});
      toast('info', 'Comando enviado', `Campanha ${acao}`);
      carregar();
    } catch (e) {
      toast('erro', 'Não foi possível executar', e.message);
    }
  };

  const excluir = async (id) => {
    try {
      await api.del(`/campaigns/${id}`);
      toast('sucesso', 'Campanha excluída', 'O histórico de contatos continua salvo no CRM.');
      carregar();
    } catch (e) {
      toast('erro', 'Erro ao excluir', e.message);
    }
  };

  const alternar = async (id) => {
    if (aberta === id) {
      setAberta(null);
      return;
    }
    setAberta(id);
    if (!itens[id]) {
      try {
        const d = await api.get(`/campaigns/${id}`);
        setItens((m) => ({ ...m, [id]: d.itens }));
      } catch (e) {
        toast('erro', 'Erro ao abrir campanha', e.message);
      }
    }
  };

  return (
    <Card
      titulo="Campanhas"
      icone={<Megaphone size={16} color="var(--accent)" />}
      acoes={
        <>
          <button type="button" className="btn btn-sm" onClick={carregar}>
            <RefreshCw size={14} /> Atualizar
          </button>
          <Link className="btn btn-sm btn-primary" to="/prospeccao">
            Nova prospecção
          </Link>
        </>
      }
    >
      {!lista ? (
        <SkeletonLista linhas={4} altura={72} />
      ) : lista.length === 0 ? (
        <Vazio
          icone={<Megaphone size={22} />}
          titulo="Nenhuma campanha ainda"
          texto="Crie sua primeira prospecção escolhendo quantos leads chamar hoje."
          acao={
            <Link className="btn btn-primary" to="/prospeccao">
              Criar prospecção
            </Link>
          }
        />
      ) : (
        <div className="col gap-12">
          {lista.map((c) => {
            const p = aoVivo[c.id] || c.progresso || {};
            const total = p.total || c.quantidade_alvo || 0;
            return (
              <article key={c.id} className="card" style={{ boxShadow: 'none' }}>
                <div className="card-head">
                  <button type="button" className="btn btn-ghost" style={{ padding: 0, height: 'auto' }} onClick={() => alternar(c.id)}>
                    {aberta === c.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    <b>{c.nome}</b>
                  </button>
                  <div className="row gap-8 wrap">
                    <span className={`chip ${CORES[c.status] || ''}`}>{c.status}</span>
                    {c.status === 'ATIVA' && (
                      <button type="button" className="btn btn-sm btn-warn" onClick={() => controlar(c.id, 'pause')}>
                        <Pause size={13} /> Pausar
                      </button>
                    )}
                    {['PAUSADA', 'RASCUNHO'].includes(c.status) && (
                      <button type="button" className="btn btn-sm btn-ok" onClick={() => controlar(c.id, 'resume')} disabled={!whatsapp?.conectado}>
                        <Play size={13} /> Continuar
                      </button>
                    )}
                    {['ATIVA', 'PAUSADA'].includes(c.status) && (
                      <button type="button" className="btn btn-sm btn-danger" onClick={() => controlar(c.id, 'stop')}>
                        <Square size={13} /> Parar
                      </button>
                    )}
                    {!['ATIVA'].includes(c.status) && (
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => excluir(c.id)} title="Excluir campanha (o histórico fica salvo)">
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>

                <div className="card-body">
                  <div className="row-between fs-12 dim">
                    <span>Criada em {dataHora(c.created_at)}</span>
                    <span>
                      {numero(p.enviados || c.enviados || 0)} / {numero(total)} · delay {c.delay_min}-{c.delay_max}s · pausa a cada{' '}
                      {c.bloco_tamanho} msgs
                    </span>
                  </div>
                  <div className="mt-8">
                    <Progresso valor={p.enviados || c.enviados || 0} total={total} ativo={c.status === 'ATIVA'} />
                  </div>

                  <div className="grid grid-4 mt-16">
                    {[
                      ['Enviadas', p.enviados ?? c.enviados, 'var(--ok)'],
                      ['Respostas', p.respostas ?? 0, 'var(--roxo)'],
                      ['Interessados', p.interessados ?? 0, 'var(--laranja)'],
                      ['Erros', p.erros ?? c.erros, 'var(--erro)']
                    ].map(([rotulo, valor, cor]) => (
                      <div className="kpi-mini" key={rotulo}>
                        <span>{rotulo}</span>
                        <b style={{ color: cor }}>{numero(valor || 0)}</b>
                      </div>
                    ))}
                  </div>

                  {c.motivo_parada && <p className="fs-12 mt-8" style={{ color: 'var(--warn)' }}>⚠ {c.motivo_parada}</p>}

                  {aberta === c.id && (
                    <div className="mt-16">
                      {!itens[c.id] ? (
                        <SkeletonLista linhas={4} altura={34} />
                      ) : (
                        <div className="table-wrap" style={{ maxHeight: 340 }}>
                          <table className="tabela">
                            <thead>
                              <tr>
                                <th>#</th>
                                <th>Estabelecimento</th>
                                <th>Situação</th>
                                <th>Etiqueta</th>
                                <th>Enviado em</th>
                                <th>Observação</th>
                              </tr>
                            </thead>
                            <tbody>
                              {itens[c.id].map((it) => (
                                <tr key={it.item_id}>
                                  <td className="mono dim">{it.ordem}</td>
                                  <td>{it.nome_estabelecimento}</td>
                                  <td>
                                    <span
                                      className={`chip ${it.item_status === 'ENVIADO' ? 'ok' : it.item_status === 'ERRO' ? 'erro' : it.item_status === 'IGNORADO' ? 'warn' : ''}`}
                                      style={{ height: 21 }}
                                    >
                                      {it.item_status}
                                    </span>
                                  </td>
                                  <td>
                                    <TagPill etiqueta={it.etiqueta} tags={tags} sm />
                                  </td>
                                  <td className="fs-12 dim">{it.enviado_em ? dataHora(it.enviado_em) : '—'}</td>
                                  <td className="fs-12 dim truncate" style={{ maxWidth: 240 }}>{it.erro || '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </Card>
  );
}
