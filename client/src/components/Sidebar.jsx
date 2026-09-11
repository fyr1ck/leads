import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Target, Users, Rocket, MessagesSquare, Flame, Clock, XCircle,
  Megaphone, FileSpreadsheet, Smartphone, Settings, Database, Bot
} from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import { StatusDot } from './ui.jsx';

const GRUPOS = [
  {
    titulo: 'Principal',
    itens: [
      { para: '/', rotulo: 'Dashboard', icone: LayoutDashboard, exato: true },
      { para: '/oportunidades', rotulo: 'Oportunidades', icone: Target, contador: 'quentes' }
    ]
  },
  {
    titulo: 'CRM',
    itens: [
      { para: '/leads', rotulo: 'Leads', icone: Users },
      { para: '/conversas', rotulo: 'Conversas', icone: MessagesSquare, contador: 'naoLidas' },
      { para: '/interessados', rotulo: 'Interessados', icone: Flame },
      { para: '/aguardando', rotulo: 'Aguardando', icone: Clock },
      { para: '/nao-interessados', rotulo: 'Não interessados', icone: XCircle }
    ]
  },
  {
    titulo: 'Operação',
    itens: [
      { para: '/prospeccao', rotulo: 'Prospecção', icone: Rocket },
      { para: '/campanhas', rotulo: 'Campanhas', icone: Megaphone },
      { para: '/importar', rotulo: 'Importar XLSX', icone: FileSpreadsheet }
    ]
  },
  {
    titulo: 'Sistema',
    itens: [
      { para: '/whatsapp', rotulo: 'WhatsApp', icone: Smartphone },
      { para: '/configuracoes', rotulo: 'Configurações', icone: Settings }
    ]
  }
];

export default function Sidebar({ aberta, onNavegar }) {
  const { whatsapp, ia, naoLidas, oportunidades, conectadoSocket } = useApp();

  const contadores = { naoLidas, quentes: oportunidades?.quentes || 0 };
  const estadoWa =
    whatsapp?.status === 'CONECTADO' ? 'ok' : whatsapp?.status === 'DESCONECTADO' ? 'erro' : 'warn';

  return (
    <aside className={`sidebar ${aberta ? 'aberta' : ''}`}>
      <div className="brand">
        <div className="brand-mark">H</div>
        <div className="brand-text">
          <strong>HENVIX</strong>
          <span>Sales Panel</span>
        </div>
      </div>

      <nav className="nav">
        {GRUPOS.map((g) => (
          <div key={g.titulo}>
            <div className="nav-group">{g.titulo}</div>
            {g.itens.map((item) => {
              const Icone = item.icone;
              const n = item.contador ? contadores[item.contador] : 0;
              return (
                <NavLink
                  key={item.para}
                  to={item.para}
                  end={item.exato}
                  onClick={onNavegar}
                  className={({ isActive }) => `nav-item ${isActive ? 'ativo' : ''}`}
                >
                  <Icone size={17} />
                  <span>{item.rotulo}</span>
                  {n > 0 && (
                    <span className={`nav-count ${item.contador === 'quentes' ? 'quente' : ''}`}>{n > 99 ? '99+' : n}</span>
                  )}
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="side-status">
        <div className="side-status-line">
          <span className="row gap-6">
            <StatusDot estado={estadoWa} />
            <span className="fs-12 soft">WhatsApp</span>
          </span>
          <span className="fs-12 dim">{whatsapp?.status === 'CONECTADO' ? 'online' : whatsapp?.status?.toLowerCase()}</span>
        </div>
        <div className="side-status-line">
          <span className="row gap-6">
            <StatusDot estado={ia?.configurada ? 'ok' : 'warn'} />
            <span className="fs-12 soft">
              <Bot size={11} style={{ verticalAlign: -1 }} /> IA Groq
            </span>
          </span>
          <span className="fs-12 dim">{ia?.configurada ? 'pronta' : 'sem chave'}</span>
        </div>
        <div className="side-status-line">
          <span className="row gap-6">
            <StatusDot estado={conectadoSocket ? 'ok' : 'erro'} />
            <span className="fs-12 soft">
              <Database size={11} style={{ verticalAlign: -1 }} /> Servidor
            </span>
          </span>
          <span className="fs-12 dim">{conectadoSocket ? 'local' : 'offline'}</span>
        </div>
      </div>
    </aside>
  );
}
