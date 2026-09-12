import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlarmClock, Sparkles, Send, XCircle, RefreshCw, Copy, MessageSquare, Clock, ShieldCheck
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../state/AppContext.jsx';
import { Card, TagPill, Vazio, SkeletonLista, Segmented, Modal } from '../components/ui.jsx';
import { dataHora, tempoRelativo } from '../lib/format.js';

const STATUS = {
  PENDENTE: { cor: '', rotulo: 'Pendente' },
  PREPARADO: { cor: 'accent', rotulo: 'Preparado' },
  AGUARDANDO_CONFIRMACAO: { cor: 'warn', rotulo: 'Aguardando sua confirmação' },
  ENVIADO: { cor: 'ok', rotulo: 'Enviado' },
  CANCELADO: { cor: 'erro', rotulo: 'Cancelado' }
};

const FILTROS = [
  { valor: '', rotulo: 'Todos' },
  { valor: 'PENDENTE', rotulo: 'Pendentes' },
  { valor: 'AGUARDANDO_CONFIRMACAO', rotulo: 'Aguardando confirmação' },
  { valor: 'ENVIADO', rotulo: 'Enviados' },
  { valor: 'CANCELADO', rotulo: 'Cancelados' }
];

export default function FollowUps() {
  const { toast, tags, whatsapp } = useApp();
  const [dados, setDados] = useState(null);
  const [filtro, setFiltro] = useState('');
  const [ocupado, setOcupado] = useState(null);
  const [revisando, setRevisando] = useState(null);
  const [texto, setTexto] = useState('');

  const carregar = useCallback(async () => {
    try {
      setDados(await api.get(`/followups${filtro ? `?status=${filtro}` : ''}`));
    } catch (e) {
      toast('erro', 'Erro ao carregar follow-ups', e.message);
    }
  }, [filtro, toast]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const preparar = async (fu) => {
    setOcupado(fu.id);
    try {
      const r = await api.post(`/followups/${fu.id}/preparar`, {});
      toast('info', 'Mensagem preparada pela IA', 'Revise antes de enviar — nada foi enviado ainda.');
      setRevisando(r);
      setTexto(r.mensagem || '');
      carregar();
    } catch (e) {
      toast('erro', 'Erro ao preparar', e.message);
    } finally {
      setOcupado(null);
    }
  };

  const enviar = async () => {
    if (!revisando) return;
    setOcupado(revisando.id);
    try {
      await api.post(`/followups/${revisando.id}/enviar`, { texto });
      toast('sucesso', 'Follow-up enviado', revisando.nome_estabelecimento || '');
      setRevisando(null);
      carregar();
    } catch (e) {
      toast('erro', 'Não foi possível enviar', e.message);
    } finally {
      setOcupado(null);
    }
  };

  const cancelar = async (fu) => {
    try {
      await api.post(`/followups/${fu.id}/cancelar`, { motivo: 'Cancelado pelo operador.' });
      toast('info', 'Follow-up cancelado');
      carregar();
    } catch (e) {
      toast('erro', 'Erro ao cancelar', e.message);
    }
  };

  const itens = dados?.itens || [];

  return (
    <>
      <Card
        titulo="Follow-ups"
        icone={<AlarmClock size={16} color="var(--accent)" />}
        acoes={
          <>
            {dados?.vencidos > 0 && <span className="chip warn">{dados.vencidos} vencido(s)</span>}
            <button type="button" className="btn btn-sm" onClick={carregar}>
              <RefreshCw size={14} /> Atualizar
            </button>
          </>
        }
      >
        <Segmented opcoes={FILTROS} valor={filtro} onChange={setFiltro} />
        <div className="aviso-regra mt-16">
          <ShieldCheck size={16} />
          <span>
            O fluxo é sempre: <b>IA prepara → você revisa → você confirma → envia</b>. Nenhum follow-up sai sozinho.
          </span>
        </div>
      </Card>

      {!dados ? (
        <SkeletonLista linhas={4} altura={88} />
      ) : itens.length === 0 ? (
        <Card>
          <Vazio
            icone={<Clock size={22} />}
            titulo="Nenhum follow-up nesse filtro"
            texto="A sequência +1, +3 e +7 dias é agendada automaticamente quando uma prospecção envia a primeira mensagem."
          />
        </Card>
      ) : (
        <Card bodyClass="flush">
          <div className="table-wrap">
            <table className="tabela">
              <thead>
                <tr>
                  <th>Estabelecimento</th>
                  <th>Etiqueta</th>
                  <th>Prazo</th>
                  <th>Agendado para</th>
                  <th>Situação</th>
                  <th>Score</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {itens.map((fu) => {
                  const st = STATUS[fu.status] || STATUS.PENDENTE;
                  const vencido =
                    ['PENDENTE', 'PREPARADO', 'AGUARDANDO_CONFIRMACAO'].includes(fu.status) &&
                    new Date(`${String(fu.agendado_para).replace(' ', 'T')}Z`) <= new Date();
                  return (
                    <tr key={fu.id} style={{ cursor: 'default' }}>
                      <td>
                        <b>{fu.nome_estabelecimento}</b>
                        {fu.cidade && <div className="fs-12 dim">{fu.cidade}</div>}
                      </td>
                      <td><TagPill etiqueta={fu.etiqueta} tags={tags} sm /></td>
                      <td className="mono fs-12">+{fu.prazo_dias}d</td>
                      <td className="fs-12">
                        {dataHora(fu.agendado_para)}
                        {vencido && <div className="fs-12" style={{ color: 'var(--warn)' }}>vencido {tempoRelativo(fu.agendado_para)}</div>}
                      </td>
                      <td><span className={`chip ${st.cor}`} style={{ height: 22 }}>{st.rotulo}</span></td>
                      <td className="mono">{fu.score ?? 0}</td>
                      <td>
                        <div className="row gap-6 wrap">
                          {['PENDENTE', 'PREPARADO'].includes(fu.status) && (
                            <button
                              type="button"
                              className="btn btn-sm"
                              onClick={() => preparar(fu)}
                              disabled={ocupado === fu.id}
                            >
                              <Sparkles size={13} /> {ocupado === fu.id ? '...' : 'Preparar com IA'}
                            </button>
                          )}
                          {fu.status === 'AGUARDANDO_CONFIRMACAO' && (
                            <button
                              type="button"
                              className="btn btn-sm btn-primary"
                              onClick={() => {
                                setRevisando(fu);
                                setTexto(fu.mensagem || '');
                              }}
                            >
                              <Send size={13} /> Revisar e enviar
                            </button>
                          )}
                          <Link className="btn btn-sm btn-ghost" to={`/conversas?lead=${fu.lead_id}`} title="Abrir conversa">
                            <MessageSquare size={13} />
                          </Link>
                          {!['ENVIADO', 'CANCELADO'].includes(fu.status) && (
                            <button type="button" className="btn btn-sm btn-ghost" onClick={() => cancelar(fu)} title="Cancelar">
                              <XCircle size={13} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal
        aberto={Boolean(revisando)}
        titulo={`Follow-up · ${revisando?.nome_estabelecimento || ''}`}
        onFechar={() => setRevisando(null)}
        grande
        rodape={
          <>
            <button type="button" className="btn" onClick={() => setRevisando(null)}>Cancelar</button>
            <button
              type="button"
              className="btn"
              onClick={() =>
                navigator.clipboard
                  .writeText(texto)
                  .then(() => toast('sucesso', 'Copiado'))
                  .catch(() => toast('erro', 'Não consegui copiar'))
              }
            >
              <Copy size={14} /> Copiar
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={enviar}
              disabled={!texto.trim() || !whatsapp?.conectado || ocupado === revisando?.id}
            >
              <Send size={14} /> Confirmar e enviar
            </button>
          </>
        }
      >
        <p className="fs-13 muted">
          A IA escreveu com base no histórico real da conversa. Edite à vontade — só sai quando você confirmar.
        </p>
        <textarea className="textarea mt-16" style={{ minHeight: 170 }} value={texto} onChange={(e) => setTexto(e.target.value)} />
        {!whatsapp?.conectado && (
          <div className="chip warn mt-16" style={{ height: 'auto', padding: '9px 12px', whiteSpace: 'normal' }}>
            WhatsApp desconectado — conecte para poder enviar.
          </div>
        )}
      </Modal>
    </>
  );
}
