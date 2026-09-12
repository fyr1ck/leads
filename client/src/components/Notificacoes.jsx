import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, Inbox } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../state/AppContext.jsx';
import { tempoRelativo } from '../lib/format.js';

const ICONES = {
  lead_quente: '🔥',
  resposta: '💬',
  demo: '🌐',
  venda: '💰',
  leads: '👥',
  followup: '⏰',
  erro: '⚠️'
};

/** Central de notificacoes (spec 75). */
export default function Notificacoes() {
  const { notificacoes, notificacoesNaoLidas, setNotificacoes, setNotificacoesNaoLidas } = useApp();
  const [aberto, setAberto] = useState(false);
  const caixa = useRef(null);
  const navegar = useNavigate();

  useEffect(() => {
    if (!aberto) return undefined;
    const fora = (e) => {
      if (caixa.current && !caixa.current.contains(e.target)) setAberto(false);
    };
    const esc = (e) => e.key === 'Escape' && setAberto(false);
    document.addEventListener('mousedown', fora);
    window.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', fora);
      window.removeEventListener('keydown', esc);
    };
  }, [aberto]);

  const abrir = async (n) => {
    setAberto(false);
    if (!n.lida) {
      try {
        await api.post(`/notifications/${n.id}/lida`, {});
        setNotificacoes((lista) => lista.map((x) => (x.id === n.id ? { ...x, lida: 1 } : x)));
        setNotificacoesNaoLidas((v) => Math.max(0, v - 1));
      } catch {
        /* nao bloqueia a navegacao */
      }
    }
    if (n.rota) navegar(n.rota);
  };

  const lerTodas = async () => {
    try {
      await api.post('/notifications/lidas', {});
      setNotificacoes((lista) => lista.map((x) => ({ ...x, lida: 1 })));
      setNotificacoesNaoLidas(0);
    } catch {
      /* silencioso */
    }
  };

  return (
    <div style={{ position: 'relative' }} ref={caixa}>
      <button
        type="button"
        className="btn btn-ghost btn-icon"
        onClick={() => setAberto((v) => !v)}
        aria-label="Notificações"
        title="Notificações"
        style={{ position: 'relative' }}
      >
        <Bell size={18} />
        {notificacoesNaoLidas > 0 && (
          <span
            className="nav-count quente"
            style={{ position: 'absolute', top: -4, right: -4, minWidth: 17, height: 17, fontSize: 10 }}
          >
            {notificacoesNaoLidas > 9 ? '9+' : notificacoesNaoLidas}
          </span>
        )}
      </button>

      {aberto && (
        <div className="popover anim-panel">
          <header className="card-head" style={{ padding: '11px 14px' }}>
            <h3 className="fs-13">Notificações</h3>
            {notificacoesNaoLidas > 0 && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={lerTodas}>
                <CheckCheck size={13} /> Marcar lidas
              </button>
            )}
          </header>
          <div className="popover-body">
            {notificacoes.length === 0 ? (
              <div className="empty" style={{ padding: 26 }}>
                <div className="empty-icon">
                  <Inbox size={18} />
                </div>
                <span className="fs-13">Nada por aqui ainda.</span>
              </div>
            ) : (
              notificacoes.map((n) => (
                <button
                  type="button"
                  key={n.id}
                  className={`notif ${n.lida ? '' : 'nova'}`}
                  onClick={() => abrir(n)}
                >
                  <span className="notif-icone">{ICONES[n.tipo] || '🔔'}</span>
                  <span className="grow" style={{ minWidth: 0 }}>
                    <span className="row-between gap-8">
                      <b className="fs-13 truncate">{n.titulo}</b>
                      <span className="fs-12 dim nowrap">{tempoRelativo(n.created_at)}</span>
                    </span>
                    {n.texto && <span className="fs-12 muted truncate" style={{ display: 'block' }}>{n.texto}</span>}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
