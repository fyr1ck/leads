import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Users, Send, MessageSquare, Flame, Clock, ThumbsDown, Handshake, Trophy,
  Target, ArrowRight, Activity, MapPin, Tag as TagIcon
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../state/AppContext.jsx';
import { Card, StatCard, TagPill, Vazio, SkeletonLista, Medidor } from '../components/ui.jsx';
import { GraficoLinha, GraficoBarras, GraficoRosca } from '../components/charts.jsx';
import LogConsole from '../components/LogConsole.jsx';
import { numero, porcento, tempoRelativo, rotuloPotencial } from '../lib/format.js';

export default function Dashboard() {
  const { stats, tags, recarregarStats } = useApp();
  const [graficos, setGraficos] = useState(null);
  const [quentes, setQuentes] = useState(null);

  const carregar = async () => {
    try {
      const [g, q] = await Promise.all([api.get('/stats/graficos?dias=14'), api.get('/stats/oportunidades?limite=5')]);
      setGraficos(g);
      setQuentes(q);
    } catch {
      /* o toast global ja avisa em caso de falha de rede */
    }
  };

  useEffect(() => {
    recarregarStats();
    carregar();
    const t = setInterval(carregar, 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const c = stats?.cards || {};
  const o = stats?.operacao || {};
  const taxas = stats?.taxas || {};

  const cards = [
    { rotulo: 'Leads importados', valor: c.leads_importados, icone: <Users size={17} />, cor: '', rodape: `${numero(o.disponiveis || 0)} disponíveis para chamar` },
    { rotulo: 'Leads contatados', valor: c.leads_contatados, icone: <Send size={17} />, cor: 'ok', rodape: `${numero(o.enviadas_hoje || 0)} enviadas hoje` },
    { rotulo: 'Responderam', valor: c.responderam, icone: <MessageSquare size={17} />, cor: 'roxo', rodape: `taxa de resposta ${porcento(taxas.resposta)}` },
    { rotulo: 'Interessados', valor: c.interessados, icone: <Flame size={17} />, cor: 'laranja', rodape: `taxa de interesse ${porcento(taxas.interesse)}` },
    { rotulo: 'Aguardando', valor: c.aguardando, icone: <Clock size={17} />, cor: 'warn', rodape: 'em acompanhamento' },
    { rotulo: 'Não interessados', valor: c.nao_interessados, icone: <ThumbsDown size={17} />, cor: 'erro', rodape: 'histórico preservado' },
    { rotulo: 'Negociações', valor: c.negociacoes, icone: <Handshake size={17} />, cor: 'roxo', rodape: 'em negociação agora' },
    { rotulo: 'Conversões', valor: c.conversoes, icone: <Trophy size={17} />, cor: 'ok', rodape: `conversão ${porcento(taxas.conversao)}` }
  ];

  return (
    <>
      <div className="grid grid-4 stagger">
        {cards.map((card, i) => (
          <StatCard key={card.rotulo} {...card} i={i} />
        ))}
      </div>

      <div className="grid grid-2-1">
        <Card
          titulo="Atividade dos últimos 14 dias"
          icone={<Activity size={16} color="var(--accent)" />}
          acoes={
            <div className="legend">
              <span className="legend-item"><i className="legend-dot" style={{ background: '#22d3ee' }} /> Enviadas</span>
              <span className="legend-item"><i className="legend-dot" style={{ background: '#a855f7' }} /> Respostas</span>
              <span className="legend-item"><i className="legend-dot" style={{ background: '#f97316' }} /> Interessados</span>
            </div>
          }
        >
          {graficos ? (
            <GraficoLinha
              dados={graficos.serie}
              series={[
                { chave: 'enviadas', cor: '#22d3ee', rotulo: 'enviadas' },
                { chave: 'respostas', cor: '#a855f7', rotulo: 'respostas' },
                { chave: 'interessados', cor: '#f97316', rotulo: 'interessados' }
              ]}
            />
          ) : (
            <SkeletonLista linhas={1} altura={240} />
          )}
        </Card>

        <Card titulo="Leads por etiqueta" icone={<TagIcon size={16} color="var(--accent)" />}>
          {graficos ? (
            <GraficoRosca dados={graficos.porEtiqueta.filter((e) => e.slug !== 'SEM_ETIQUETA').slice(0, 8)} />
          ) : (
            <SkeletonLista linhas={3} />
          )}
        </Card>
      </div>

      <div className="grid grid-2-1">
        <Card
          titulo="🎯 Oportunidades quentes"
          acoes={
            <Link className="btn btn-sm" to="/oportunidades">
              Ver todas <ArrowRight size={14} />
            </Link>
          }
        >
          {!quentes ? (
            <SkeletonLista linhas={3} />
          ) : quentes.length === 0 ? (
            <Vazio
              icone={<Target size={22} />}
              titulo="Nenhuma oportunidade quente ainda"
              texto="Assim que um estabelecimento responder, a IA classifica e os mais próximos de fechar aparecem aqui."
              acao={
                <Link className="btn btn-primary" to="/prospeccao">
                  Iniciar prospecção
                </Link>
              }
            />
          ) : (
            <div className="col gap-12">
              {quentes.map((l) => {
                const pot = rotuloPotencial(l.score);
                return (
                  <Link
                    key={l.id}
                    to={`/conversas?lead=${l.id}`}
                    className="opp"
                    style={{ '--cor': pot.cor, textDecoration: 'none', color: 'inherit' }}
                  >
                    <div className="row-between">
                      <div className="grow" style={{ minWidth: 0 }}>
                        <div className="row gap-8">
                          <b className="truncate">{l.nome_estabelecimento}</b>
                          <TagPill etiqueta={l.etiqueta} tags={tags} sm />
                        </div>
                        <div className="fs-12 dim row gap-6 mt-8">
                          {l.cidade && (
                            <>
                              <MapPin size={11} /> {l.cidade} ·
                            </>
                          )}
                          {tempoRelativo(l.ultima_mensagem_data)}
                        </div>
                      </div>
                      <div className="text-right" style={{ minWidth: 92 }}>
                        <b style={{ color: pot.cor }}>{pot.emoji} {l.score}</b>
                        <Medidor valor={l.score} cor={pot.cor} />
                      </div>
                    </div>
                    {l.ultima_mensagem && <div className="opp-msg truncate">“{l.ultima_mensagem}”</div>}
                  </Link>
                );
              })}
            </div>
          )}
        </Card>

        <div className="col gap-16">
          <Card titulo="Taxas">
            <div className="col gap-16">
              {[
                { rotulo: 'Taxa de resposta', valor: taxas.resposta, cor: '#a855f7' },
                { rotulo: 'Taxa de interesse', valor: taxas.interesse, cor: '#f97316' },
                { rotulo: 'Taxa de conversão', valor: taxas.conversao, cor: '#22c55e' }
              ].map((t) => (
                <div key={t.rotulo} className="col gap-6">
                  <div className="row-between fs-13">
                    <span className="soft">{t.rotulo}</span>
                    <b style={{ color: t.cor }}>{porcento(t.valor)}</b>
                  </div>
                  <Medidor valor={t.valor} cor={t.cor} />
                </div>
              ))}
            </div>
          </Card>

          <Card titulo="Leads por cidade">
            {graficos ? <GraficoBarras dados={graficos.porCidade.slice(0, 6)} /> : <SkeletonLista linhas={4} altura={28} />}
          </Card>
        </div>
      </div>

      <div className="grid grid-2">
        <Card titulo="Leads por categoria">
          {graficos ? <GraficoBarras dados={graficos.porCategoria.slice(0, 7)} cor="#a855f7" /> : <SkeletonLista linhas={4} altura={28} />}
        </Card>
        <Card titulo="Atividade do sistema" bodyClass="tight">
          <LogConsole limite={12} />
        </Card>
      </div>
    </>
  );
}
