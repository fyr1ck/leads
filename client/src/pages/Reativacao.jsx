import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Recycle, Check, Rocket, RefreshCw, MapPin, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../state/AppContext.jsx';
import { Card, Campo, TagPill, Vazio, SkeletonLista, Medidor } from '../components/ui.jsx';
import { numero, rotuloPotencial } from '../lib/format.js';

export default function Reativacao() {
  const { toast, tags, whatsapp } = useApp();
  const [dias, setDias] = useState(15);
  const [dados, setDados] = useState(null);
  const [selecionados, setSelecionados] = useState(new Set());
  const [criando, setCriando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      setDados(await api.get(`/reactivation?dias=${dias}`));
    } catch (e) {
      toast('erro', 'Erro ao carregar reativação', e.message);
    }
  }, [dias, toast]);

  useEffect(() => {
    const t = setTimeout(carregar, 250);
    return () => clearTimeout(t);
  }, [carregar]);

  const alternar = (id) =>
    setSelecionados((s) => {
      const novo = new Set(s);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });

  const selecionarGrupo = (grupo) => {
    const ids = grupo.itens.filter((l) => l.telefone_e164).map((l) => l.id);
    setSelecionados((s) => {
      const novo = new Set(s);
      const todos = ids.every((id) => novo.has(id));
      for (const id of ids) {
        if (todos) novo.delete(id);
        else novo.add(id);
      }
      return novo;
    });
  };

  const criarCampanha = async () => {
    setCriando(true);
    try {
      const r = await api.post('/reactivation/campanha', { leadIds: [...selecionados] });
      toast(
        'sucesso',
        'Campanha de reativação criada',
        `${r.enfileirados} leads na fila${r.ignorados ? ` · ${r.ignorados} sem telefone ignorados` : ''}.`
      );
      setSelecionados(new Set());
      carregar();
    } catch (e) {
      toast('erro', 'Não foi possível criar', e.message);
    } finally {
      setCriando(false);
    }
  };

  return (
    <>
      <Card
        titulo="Reativar oportunidades"
        icone={<Recycle size={16} color="var(--warn)" />}
        acoes={
          <button type="button" className="btn btn-sm" onClick={carregar}>
            <RefreshCw size={14} /> Atualizar
          </button>
        }
      >
        <div className="row-between wrap gap-16">
          <div>
            <p className="fs-13 soft">
              Oportunidade que esfriou continua sendo oportunidade. Aqui ficam quem demonstrou interesse, recebeu demo,
              perguntou preço ou parou de responder.
            </p>
            {dados && (
              <p className="fs-18 bold mt-8" style={{ color: 'var(--warn)' }}>
                ♻️ {numero(dados.total)} leads disponíveis para reativação
              </p>
            )}
          </div>
          <Campo label="Sem interação há">
            <select className="select" value={dias} onChange={(e) => setDias(Number(e.target.value))}>
              {[7, 15, 30, 60, 90].map((d) => (
                <option key={d} value={d}>{d} dias ou mais</option>
              ))}
            </select>
          </Campo>
        </div>

        <div className="aviso-regra mt-16">
          <AlertTriangle size={16} />
          <span>
            A trava de "não repetir lead" continua valendo para prospecção normal. Na reativação o reenvio é proposital e
            só acontece com os leads que <b>você</b> selecionar aqui.
          </span>
        </div>
      </Card>

      {!dados ? (
        <SkeletonLista linhas={3} altura={120} />
      ) : dados.total === 0 ? (
        <Card>
          <Vazio
            icone={<Recycle size={22} />}
            titulo="Nada para reativar ainda"
            texto="Conforme as conversas esfriarem, elas aparecem aqui automaticamente."
          />
        </Card>
      ) : (
        dados.grupos
          .filter((g) => g.total > 0)
          .map((grupo) => (
            <Card
              key={grupo.chave}
              titulo={`${grupo.nome} (${grupo.total})`}
              acoes={
                <button type="button" className="btn btn-sm" onClick={() => selecionarGrupo(grupo)}>
                  <Check size={13} /> Selecionar grupo
                </button>
              }
            >
              <p className="fs-12 muted" style={{ marginBottom: 12 }}>{grupo.descricao}</p>
              <div className="grid grid-3">
                {grupo.itens.slice(0, 24).map((l) => {
                  const pot = rotuloPotencial(l.score);
                  const marcado = selecionados.has(l.id);
                  const semTelefone = !l.telefone_e164;
                  return (
                    <article
                      key={l.id}
                      className={`lead-card ${marcado ? 'selecionado' : ''} ${semTelefone ? 'duplicado' : ''}`}
                      style={{ '--cor': pot.cor }}
                    >
                      {!semTelefone && (
                        <button
                          type="button"
                          className={`lead-card-check ${marcado ? 'on' : ''}`}
                          onClick={() => alternar(l.id)}
                          aria-label="Selecionar"
                        >
                          {marcado && <Check size={13} />}
                        </button>
                      )}
                      <b className="truncate" title={l.nome_estabelecimento}>{l.nome_estabelecimento}</b>
                      <div className="fs-12 dim row gap-6 wrap">
                        {l.cidade && (
                          <span className="row gap-4">
                            <MapPin size={11} /> {l.cidade}
                          </span>
                        )}
                        <span>· parado há {l.dias_parado} dia(s)</span>
                      </div>
                      <TagPill etiqueta={l.etiqueta} tags={tags} sm />
                      {l.ultima_mensagem && <div className="opp-msg truncate fs-12">“{l.ultima_mensagem}”</div>}
                      <div>
                        <div className="row-between fs-12">
                          <span className="dim">Score</span>
                          <b style={{ color: pot.cor }}>{l.score}/100</b>
                        </div>
                        <Medidor valor={l.score} cor={pot.cor} />
                      </div>
                      {semTelefone ? (
                        <span className="fs-12" style={{ color: 'var(--erro)' }}>sem telefone — não dá para reativar</span>
                      ) : (
                        <Link className="btn btn-sm" to={`/conversas?lead=${l.id}`}>
                          Abrir conversa
                        </Link>
                      )}
                    </article>
                  );
                })}
              </div>
              {grupo.itens.length > 24 && (
                <p className="fs-12 dim mt-16">+ {grupo.itens.length - 24} leads nesse grupo</p>
              )}
            </Card>
          ))
      )}

      {selecionados.size > 0 && (
        <div className="selecao-barra">
          <span className="fs-13">
            <b>{selecionados.size}</b> lead(s) selecionado(s) para reativação
          </span>
          <div className="row gap-8">
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSelecionados(new Set())}>
              Limpar
            </button>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={criarCampanha}
              disabled={criando}
              title={whatsapp?.conectado ? '' : 'A campanha é criada agora e você inicia quando quiser'}
            >
              <Rocket size={14} /> {criando ? 'Criando...' : 'CRIAR CAMPANHA DE REATIVAÇÃO'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
