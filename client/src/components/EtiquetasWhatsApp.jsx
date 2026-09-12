import { useCallback, useEffect, useState } from 'react';
import { Tags, RefreshCw, Check, AlertTriangle, Info } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../state/AppContext.jsx';
import { Card, Switch, SkeletonLista } from './ui.jsx';

/**
 * Espelha as etiquetas do CRM nas etiquetas do WhatsApp Business.
 * Fica na pagina do WhatsApp porque depende da conexao.
 */
export default function EtiquetasWhatsApp() {
  const { toast, whatsapp, settings, setSettings } = useApp();
  const [estado, setEstado] = useState(null);
  const [sincronizando, setSincronizando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      setEstado(await api.get('/whatsapp/labels'));
    } catch (e) {
      toast('erro', 'Erro ao ler as etiquetas', e.message);
    }
  }, [toast]);

  useEffect(() => {
    carregar();
  }, [carregar, whatsapp?.status]);

  const sincronizar = async () => {
    setSincronizando(true);
    try {
      const r = await api.post('/whatsapp/labels/sync', {});
      toast(
        r.erros ? 'aviso' : 'sucesso',
        `${r.criadas} criadas · ${r.reaproveitadas} reaproveitadas`,
        r.erros ? `${r.erros} falharam — veja os logs.` : 'As etiquetas já aparecem no seu WhatsApp.'
      );
      carregar();
    } catch (e) {
      toast('erro', 'Não foi possível sincronizar', e.message);
    } finally {
      setSincronizando(false);
    }
  };

  const alternar = async (v) => {
    try {
      const novo = await api.put('/settings', { wa_etiquetas_sync: v ? 1 : 0 });
      setSettings(novo);
      toast('info', v ? 'Etiquetas serão espelhadas' : 'Espelhamento desligado');
    } catch (e) {
      toast('erro', 'Erro ao salvar', e.message);
    }
  };

  const ligado = Boolean(Number(settings?.wa_etiquetas_sync ?? 1));

  return (
    <Card
      titulo="Etiquetas no WhatsApp"
      icone={<Tags size={16} color="var(--accent)" />}
      acoes={
        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={sincronizar}
          disabled={sincronizando || !whatsapp?.conectado}
        >
          <RefreshCw size={14} className={sincronizando ? 'spin' : ''} />
          {sincronizando ? 'Sincronizando...' : 'Sincronizar etiquetas'}
        </button>
      }
    >
      <div className="row-between">
        <div>
          <b className="fs-13">Espelhar etiquetas do CRM no WhatsApp</b>
          <p className="fs-12 muted">
            Quando a IA classifica um lead, a mesma etiqueta é aplicada na conversa do WhatsApp.
          </p>
        </div>
        <Switch ligado={ligado} onChange={alternar} />
      </div>

      <div className="aviso-regra mt-16" style={{ borderColor: 'rgba(250,204,21,.3)', background: 'var(--warn-soft)', color: '#fde68a' }}>
        <AlertTriangle size={16} />
        <span>
          Etiqueta de conversa é um recurso do <b>WhatsApp Business</b>. Em conta pessoal o app não mostra etiquetas — o
          painel continua funcionando normal, só não aparece nada no celular.
        </span>
      </div>

      {!estado ? (
        <div className="mt-16">
          <SkeletonLista linhas={3} altura={30} />
        </div>
      ) : (
        <>
          <div className="grid grid-3 mt-16">
            <div className="kpi-mini">
              <span>Mapeadas</span>
              <b>
                {estado.mapeadas}/{estado.total}
              </b>
            </div>
            <div className="kpi-mini">
              <span>No aparelho</span>
              <b>{estado.noAparelho?.length || 0}</b>
            </div>
            <div className="kpi-mini">
              <span>Situação</span>
              <b style={{ fontSize: 13, color: estado.conectado ? 'var(--ok)' : 'var(--warn)' }}>
                {!estado.suportado ? 'não suportado' : estado.conectado ? 'pronto' : 'conecte o WhatsApp'}
              </b>
            </div>
          </div>

          <div className="row gap-6 wrap mt-16">
            {estado.etiquetas.map((t) => (
              <span
                key={t.slug}
                className="tag"
                style={{ color: t.cor, opacity: t.wa_label_id ? 1 : 0.45 }}
                title={t.wa_label_id ? `etiqueta ${t.wa_label_id} no WhatsApp` : 'ainda não sincronizada'}
              >
                <span className="tag-emoji">{t.emoji}</span>
                {t.nome}
                {t.wa_label_id && <Check size={11} />}
              </span>
            ))}
          </div>

          <p className="hint mt-16 row gap-6">
            <Info size={12} />
            As 5 primeiras etiquetas do WhatsApp são as padrão dele (Novo cliente, Novo pedido...) e não são tocadas.
          </p>
        </>
      )}
    </Card>
  );
}
