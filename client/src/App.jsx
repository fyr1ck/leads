import { useEffect, useState } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import Sidebar from './components/Sidebar.jsx';
import Topbar from './components/Topbar.jsx';
import { Toasts } from './components/ui.jsx';
import { useApp } from './state/AppContext.jsx';

import Dashboard from './pages/Dashboard.jsx';
import Oportunidades from './pages/Oportunidades.jsx';
import Leads from './pages/Leads.jsx';
import Conversas from './pages/Conversas.jsx';
import Segmento from './pages/Segmento.jsx';
import Prospeccao from './pages/Prospeccao.jsx';
import Campanhas from './pages/Campanhas.jsx';
import Importar from './pages/Importar.jsx';
import WhatsAppPage from './pages/WhatsApp.jsx';
import Configuracoes from './pages/Configuracoes.jsx';
// v2 - Sales OS
import EncontrarLeads from './pages/EncontrarLeads.jsx';
import FollowUps from './pages/FollowUps.jsx';
import Demonstracoes from './pages/Demonstracoes.jsx';
import Reativacao from './pages/Reativacao.jsx';
import Vendas from './pages/Vendas.jsx';
import Relatorios from './pages/Relatorios.jsx';
import Skill from './pages/Skill.jsx';

const TITULOS = {
  '/': { titulo: 'Dashboard', sub: null },
  '/oportunidades': { titulo: '🎯 Central de Oportunidades', sub: 'Quem está mais perto de fechar aparece primeiro' },
  '/leads': { titulo: 'Leads', sub: 'Base completa do CRM' },
  '/conversas': { titulo: 'Conversas', sub: 'Inbox do WhatsApp — você decide o que responder' },
  '/interessados': { titulo: 'Interessados', sub: 'Leads com maior potencial de fechamento' },
  '/aguardando': { titulo: 'Aguardando', sub: 'Leads que ainda não deram resposta definitiva' },
  '/nao-interessados': { titulo: 'Não interessados', sub: 'Histórico preservado para consulta' },
  '/prospeccao': { titulo: 'Prospecção', sub: 'Quantos leads chamar hoje' },
  '/campanhas': { titulo: 'Campanhas', sub: 'Histórico e controle das prospecções' },
  '/importar': { titulo: 'Importar XLSX', sub: 'Leitura automática das colunas da planilha' },
  '/whatsapp': { titulo: 'WhatsApp', sub: 'Conexão por QR Code' },
  '/configuracoes': { titulo: 'Configurações', sub: 'Delay, limites e comportamento da IA' },
  // v2 - Sales OS
  '/encontrar-leads': { titulo: '🔎 Encontrar Leads', sub: 'Nicho + localização — prioriza quem não tem site próprio' },
  '/follow-ups': { titulo: 'Follow-ups', sub: 'A IA prepara, você revisa e decide o envio' },
  '/demonstracoes': { titulo: 'Demonstrações', sub: 'Do modelo criado até o fechamento' },
  '/reativacao': { titulo: '♻️ Reativação', sub: 'Oportunidades que esfriaram e continuam valendo' },
  '/vendas': { titulo: 'Vendas / Financeiro', sub: 'Faturamento, recebimentos e pendências' },
  '/relatorios': { titulo: 'Relatórios', sub: 'Funil, campanhas e conversão' },
  '/skill': { titulo: 'Skill Henvix', sub: 'As regras comerciais que a IA segue' }
};

export default function App() {
  const { toasts, fecharToast } = useApp();
  const { pathname } = useLocation();
  const [menuAberto, setMenuAberto] = useState(false);

  useEffect(() => {
    setMenuAberto(false);
    window.scrollTo({ top: 0 });
  }, [pathname]);

  const info = TITULOS[pathname] || { titulo: 'Henvix', sub: null };

  return (
    <div className="app">
      <Sidebar aberta={menuAberto} onNavegar={() => setMenuAberto(false)} />
      <div className="main">
        <Topbar titulo={info.titulo} subtitulo={info.sub} onMenu={() => setMenuAberto((v) => !v)} />
        <main className="content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/oportunidades" element={<Oportunidades />} />
            <Route path="/leads" element={<Leads />} />
            <Route path="/conversas" element={<Conversas />} />
            <Route
              path="/interessados"
              element={<Segmento chave="interessados" titulo="Interessados" descricao="Quem demonstrou interesse real na conversa." />}
            />
            <Route
              path="/aguardando"
              element={<Segmento chave="aguardando" titulo="Aguardando" descricao="Pediram para falar depois ou ainda não decidiram." />}
            />
            <Route
              path="/nao-interessados"
              element={<Segmento chave="nao_interessados" titulo="Não interessados" descricao="Recusaram ou não têm interesse no momento." />}
            />
            <Route path="/prospeccao" element={<Prospeccao />} />
            <Route path="/campanhas" element={<Campanhas />} />
            <Route path="/importar" element={<Importar />} />
            <Route path="/whatsapp" element={<WhatsAppPage />} />
            <Route path="/configuracoes" element={<Configuracoes />} />
            {/* v2 - Sales OS */}
            <Route path="/encontrar-leads" element={<EncontrarLeads />} />
            <Route path="/follow-ups" element={<FollowUps />} />
            <Route path="/demonstracoes" element={<Demonstracoes />} />
            <Route path="/reativacao" element={<Reativacao />} />
            <Route path="/vendas" element={<Vendas />} />
            <Route path="/relatorios" element={<Relatorios />} />
            <Route path="/skill" element={<Skill />} />
            <Route path="*" element={<Dashboard />} />
          </Routes>
        </main>
      </div>
      <Toasts itens={toasts} onFechar={fecharToast} />
    </div>
  );
}
