import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { socket, EVENTOS } from '../lib/socket.js';
import { api } from '../lib/api.js';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

const MAX_LOGS = 300;

export function AppProvider({ children }) {
  const [whatsapp, setWhatsapp] = useState({ status: 'DESCONECTADO', conectado: false, qr: null });
  const [stats, setStats] = useState(null);
  const [logs, setLogs] = useState([]);
  const [campanhas, setCampanhas] = useState({});
  const [tags, setTags] = useState([]);
  const [settings, setSettings] = useState(null);
  const [ia, setIa] = useState({ configurada: false, respostaAutomatica: false });
  const [naoLidas, setNaoLidas] = useState(0);
  const [oportunidades, setOportunidades] = useState({ quentes: 0, acompanhamento: 0, aguardando: 0, frios: 0 });
  const [toasts, setToasts] = useState([]);
  const [conectadoSocket, setConectadoSocket] = useState(socket.connected);
  const [ultimaResposta, setUltimaResposta] = useState(null);
  const seqToast = useRef(0);

  const toast = useCallback((tipo, titulo, texto) => {
    const id = ++seqToast.current;
    setToasts((t) => [...t, { id, tipo, titulo, texto }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tipo === 'erro' ? 8000 : 5000);
  }, []);

  const fecharToast = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const recarregarBase = useCallback(async () => {
    try {
      const [t, s, c, cont] = await Promise.all([
        api.get('/tags'),
        api.get('/settings'),
        api.get('/conversations'),
        api.get('/opportunities/contadores')
      ]);
      setTags(t);
      setSettings(s);
      setNaoLidas(c.naoLidas || 0);
      setOportunidades(cont);
    } catch {
      /* backend ainda subindo: o socket avisa quando estiver pronto */
    }
  }, []);

  const recarregarStats = useCallback(async () => {
    try {
      setStats(await api.get('/stats'));
    } catch {
      /* silencioso */
    }
  }, []);

  useEffect(() => {
    recarregarBase();

    const onInicial = (estado) => {
      setWhatsapp(estado.whatsapp);
      setStats(estado.stats);
      setLogs(estado.logs || []);
      setIa(estado.ia || { configurada: false, respostaAutomatica: false });
      const mapa = {};
      for (const c of estado.campanhas || []) if (c?.campanha) mapa[c.campanha.id] = c;
      setCampanhas(mapa);
    };

    const onLog = (entrada) => setLogs((l) => [...l.slice(-(MAX_LOGS - 1)), entrada]);
    const onWhats = (estado) => setWhatsapp(estado);
    const onStats = (s) => setStats(s);

    const onProgresso = (p) => {
      if (!p?.campanha) return;
      setCampanhas((c) => ({ ...c, [p.campanha.id]: p }));
    };

    const onCampanhaStatus = ({ status, motivo, automatico }) => {
      if (status === 'PAUSADA' && automatico) toast('erro', 'Campanha pausada', motivo);
      if (status === 'CONCLUIDA') toast('sucesso', 'Prospecção concluída', 'Todos os leads da fila foram processados.');
    };

    const onResposta = ({ lead }) => {
      setNaoLidas((n) => n + 1);
      setUltimaResposta({ lead, em: Date.now() });
    };

    const onAnalise = ({ lead, analise }) => {
      setUltimaResposta({ lead, analise, em: Date.now() });
      api.get('/opportunities/contadores').then(setOportunidades).catch(() => {});
    };

    const onAlerta = ({ tipo, titulo, texto }) => {
      const mapa = { resposta: 'info', erro: 'erro', sucesso: 'sucesso' };
      toast(mapa[tipo] || 'info', titulo, texto);
    };

    const onConectar = () => setConectadoSocket(true);
    const onDesconectar = () => setConectadoSocket(false);

    socket.on('connect', onConectar);
    socket.on('disconnect', onDesconectar);
    socket.on(EVENTOS.INICIAL, onInicial);
    socket.on(EVENTOS.LOG, onLog);
    socket.on(EVENTOS.WHATSAPP_STATUS, onWhats);
    socket.on(EVENTOS.WHATSAPP_QR, onWhats);
    socket.on(EVENTOS.STATS, onStats);
    socket.on(EVENTOS.CAMPANHA_PROGRESSO, onProgresso);
    socket.on(EVENTOS.CAMPANHA_STATUS, onCampanhaStatus);
    socket.on(EVENTOS.MENSAGEM_RECEBIDA, onResposta);
    socket.on(EVENTOS.ANALISE_PRONTA, onAnalise);
    socket.on(EVENTOS.ALERTA, onAlerta);

    return () => {
      socket.off('connect', onConectar);
      socket.off('disconnect', onDesconectar);
      socket.off(EVENTOS.INICIAL, onInicial);
      socket.off(EVENTOS.LOG, onLog);
      socket.off(EVENTOS.WHATSAPP_STATUS, onWhats);
      socket.off(EVENTOS.WHATSAPP_QR, onWhats);
      socket.off(EVENTOS.STATS, onStats);
      socket.off(EVENTOS.CAMPANHA_PROGRESSO, onProgresso);
      socket.off(EVENTOS.CAMPANHA_STATUS, onCampanhaStatus);
      socket.off(EVENTOS.MENSAGEM_RECEBIDA, onResposta);
      socket.off(EVENTOS.ANALISE_PRONTA, onAnalise);
      socket.off(EVENTOS.ALERTA, onAlerta);
    };
  }, [recarregarBase, toast]);

  const campanhaAtiva = useMemo(
    () => Object.values(campanhas).find((c) => c?.campanha?.status === 'ATIVA') || null,
    [campanhas]
  );

  const valor = useMemo(
    () => ({
      whatsapp,
      stats,
      logs,
      campanhas,
      campanhaAtiva,
      tags,
      settings,
      setSettings,
      ia,
      naoLidas,
      setNaoLidas,
      oportunidades,
      ultimaResposta,
      conectadoSocket,
      toast,
      toasts,
      fecharToast,
      recarregarStats,
      recarregarBase
    }),
    [
      whatsapp, stats, logs, campanhas, campanhaAtiva, tags, settings, ia, naoLidas,
      oportunidades, ultimaResposta, conectadoSocket, toast, toasts, fecharToast,
      recarregarStats, recarregarBase
    ]
  );

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}
