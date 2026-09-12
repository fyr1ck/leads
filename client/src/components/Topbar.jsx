import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Menu, Rocket, QrCode, Activity, LogOut } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import { Progresso } from './ui.jsx';
import Notificacoes from './Notificacoes.jsx';

function saudacaoAgora() {
  const h = Number(
    new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false }).format(new Date())
  ) % 24;
  if (h >= 5 && h < 12) return 'Bom dia';
  if (h >= 12 && h < 18) return 'Boa tarde';
  return 'Boa noite';
}

export default function Topbar({ titulo, subtitulo, onMenu, acoes }) {
  const { whatsapp, campanhaAtiva, usuario, sair } = useApp();
  const [relogio, setRelogio] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setRelogio(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const conectado = whatsapp?.status === 'CONECTADO';
  const estado = conectado ? 'ok' : whatsapp?.status === 'DESCONECTADO' ? 'erro' : 'warn';

  return (
    <header className="topbar">
      <button type="button" className="btn btn-ghost btn-icon" onClick={onMenu} aria-label="Menu">
        <Menu size={18} />
      </button>

      <div className="grow" style={{ minWidth: 0 }}>
        <h1 className="truncate">{titulo}</h1>
        <div className="topbar-sub truncate">
          {subtitulo || `${saudacaoAgora()}! ${relogio.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · horário de Brasília`}
        </div>
      </div>

      {campanhaAtiva && (
        <Link to="/prospeccao" className="chip accent" style={{ height: 38, textDecoration: 'none' }} title="Campanha em andamento">
          <Activity size={14} className={campanhaAtiva.fase === 'pausado' ? '' : 'spin'} />
          <span className="col" style={{ gap: 2, minWidth: 96 }}>
            <span className="fs-12 bold">
              {campanhaAtiva.enviados}/{campanhaAtiva.total}
            </span>
            <Progresso valor={campanhaAtiva.enviados} total={campanhaAtiva.total} ativo={campanhaAtiva.rodando} />
          </span>
        </Link>
      )}

      {acoes}

      <Notificacoes />

      {usuario && (
        <span className="usuario-chip" title={usuario.email}>
          <span className="nowrap">{String(usuario.email).split('@')[0]}</span>
          <button
            type="button"
            className="btn btn-ghost btn-icon btn-sm"
            onClick={sair}
            title="Sair do painel"
            aria-label="Sair"
          >
            <LogOut size={14} />
          </button>
        </span>
      )}

      <Link to="/whatsapp" className={`chip ${estado}`} style={{ textDecoration: 'none' }}>
        <span className={`status-dot ${estado}`} />
        {conectado ? whatsapp?.numero || 'WhatsApp conectado' : whatsapp?.status === 'QRCODE' ? 'Escaneie o QR' : 'WhatsApp off'}
        {!conectado && <QrCode size={13} />}
      </Link>

      <Link to="/prospeccao" className="btn btn-primary">
        <Rocket size={16} /> <span className="nowrap">Nova prospecção</span>
      </Link>
    </header>
  );
}

export { saudacaoAgora };
