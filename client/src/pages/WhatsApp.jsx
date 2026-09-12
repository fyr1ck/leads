import { useState } from 'react';
import { Smartphone, QrCode, LogOut, RefreshCw, Plug, ShieldCheck, Info } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../state/AppContext.jsx';
import { Card, StatusDot } from '../components/ui.jsx';
import LogConsole from '../components/LogConsole.jsx';
import EtiquetasWhatsApp from '../components/EtiquetasWhatsApp.jsx';
import { dataHora } from '../lib/format.js';

const TEXTO_STATUS = {
  CONECTADO: { titulo: 'WhatsApp conectado', cor: 'ok', dica: 'A sessão fica salva: ao reiniciar o computador não será preciso escanear de novo.' },
  CONECTANDO: { titulo: 'Conectando...', cor: 'warn', dica: 'Aguarde alguns segundos.' },
  QRCODE: { titulo: 'Escaneie o QR Code', cor: 'warn', dica: 'Abra o WhatsApp no celular → Aparelhos conectados → Conectar um aparelho.' },
  DESCONECTADO: { titulo: 'WhatsApp desconectado', cor: 'erro', dica: 'Clique em Conectar para gerar o QR Code.' }
};

export default function WhatsAppPage() {
  const { whatsapp, toast } = useApp();
  const [ocupado, setOcupado] = useState('');

  const chamar = async (rota, acao, mensagem) => {
    setOcupado(acao);
    try {
      await api.post(rota, acao === 'disconnect' ? { logout: true } : {});
      toast('info', mensagem);
    } catch (e) {
      toast('erro', 'Não foi possível concluir', e.message);
    } finally {
      setOcupado('');
    }
  };

  const info = TEXTO_STATUS[whatsapp?.status] || TEXTO_STATUS.DESCONECTADO;
  const conectado = whatsapp?.status === 'CONECTADO';

  return (
    <div className="grid grid-1-2">
      <Card titulo="Conexão" icone={<Smartphone size={16} color="var(--accent)" />}>
        <div className="col gap-16">
          <div className="row gap-12">
            <StatusDot estado={info.cor} />
            <div>
              <b>{info.titulo}</b>
              <p className="fs-12 muted">{whatsapp?.motivo || info.dica}</p>
            </div>
          </div>

          <dl className="dados-grid">
            <dt>Número</dt>
            <dd className="mono">{whatsapp?.numero ? `+${whatsapp.numero}` : '—'}</dd>
            <dt>Aparelho</dt>
            <dd>{whatsapp?.pushName || '—'}</dd>
            <dt>Sessão salva</dt>
            <dd>{whatsapp?.sessaoSalva ? 'sim (não pede QR de novo)' : 'não'}</dd>
            <dt>Última conexão</dt>
            <dd>{whatsapp?.ultimaConexao ? dataHora(whatsapp.ultimaConexao) : '—'}</dd>
            <dt>Biblioteca</dt>
            <dd>{whatsapp?.provider || '—'}</dd>
          </dl>

          <div className="row gap-8 wrap">
            <button
              type="button"
              className="btn btn-primary"
              disabled={conectado || Boolean(ocupado)}
              onClick={() => chamar('/whatsapp/connect', 'connect', 'Iniciando conexão...')}
            >
              <Plug size={15} /> Conectar
            </button>
            <button
              type="button"
              className="btn"
              disabled={Boolean(ocupado)}
              onClick={() => chamar('/whatsapp/reconnect', 'reconnect', 'Reconectando...')}
            >
              <RefreshCw size={15} /> Reconectar
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={!conectado || Boolean(ocupado)}
              onClick={() => chamar('/whatsapp/disconnect', 'disconnect', 'Sessão encerrada.')}
            >
              <LogOut size={15} /> Desconectar
            </button>
          </div>

          <div className="aviso-regra">
            <ShieldCheck size={16} />
            <span>
              Ao desconectar, a sessão salva é apagada e um novo QR Code será necessário. Campanhas em andamento pausam
              automaticamente se a conexão cair.
            </span>
          </div>
        </div>
      </Card>

      <div className="col gap-16">
        <Card titulo="QR Code" icone={<QrCode size={16} color="var(--accent)" />}>
          <div className="center col gap-16" style={{ padding: '8px 0' }}>
            {whatsapp?.qr ? (
              <>
                <div className="qr-box anim-panel">
                  <img src={whatsapp.qr} alt="QR Code para conectar o WhatsApp" />
                </div>
                <p className="fs-13 muted center" style={{ maxWidth: 340, textAlign: 'center' }}>
                  WhatsApp → <b>Aparelhos conectados</b> → <b>Conectar um aparelho</b> → aponte a câmera para este código.
                </p>
              </>
            ) : conectado ? (
              <div className="qr-vazio" style={{ borderColor: 'rgba(34,197,94,.35)' }}>
                <div className="col gap-8 center">
                  <ShieldCheck size={30} color="var(--ok)" />
                  <b>Tudo certo!</b>
                  <span className="fs-13">Seu WhatsApp já está conectado a este painel.</span>
                </div>
              </div>
            ) : (
              <div className="qr-vazio">
                <div className="col gap-8 center">
                  <QrCode size={30} />
                  <b>Nenhum QR Code ativo</b>
                  <span className="fs-13">Clique em “Conectar” para gerar o código.</span>
                </div>
              </div>
            )}
          </div>
        </Card>

        <EtiquetasWhatsApp />

        <Card titulo="Eventos da conexão" icone={<Info size={15} color="var(--accent)" />} bodyClass="tight">
          <LogConsole limite={16} />
        </Card>
      </div>
    </div>
  );
}
