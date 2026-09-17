import { useState } from 'react';
import { Bot, Copy, RefreshCw, PenLine, Sparkles, ShieldCheck } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../state/AppContext.jsx';

const TEMPERATURA = {
  QUENTE: { emoji: '🔥', cor: '#f97316' },
  MORNO: { emoji: '🟠', cor: '#fb923c' },
  FRIO: { emoji: '🟡', cor: '#facc15' },
  GELADO: { emoji: '🔵', cor: '#64748b' }
};

/**
 * COPILOTO DE VENDAS (spec 63).
 * Le a conversa + a memoria do lead e entrega leitura comercial pronta.
 * Os botoes so copiam ou preenchem o campo: o envio continua sendo seu.
 */
export default function Copiloto({ leadId, onUsarResposta }) {
  const { toast, ia } = useApp();
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(false);

  const analisar = async () => {
    setCarregando(true);
    try {
      const r = await api.post('/ai/copiloto', { leadId });
      setDados(r);
    } catch (e) {
      toast('erro', 'Copiloto indisponível', e.message);
    } finally {
      setCarregando(false);
    }
  };

  const copiar = async (texto) => {
    try {
      await navigator.clipboard.writeText(texto);
      toast('sucesso', 'Copiado', 'A sugestão está na área de transferência.');
    } catch {
      toast('erro', 'Não consegui copiar', 'Selecione o texto e copie manualmente.');
    }
  };

  if (!dados) {
    return (
      <div className="copiloto">
        <div className="row-between">
          <b className="row gap-6 fs-13">
            <Bot size={15} color="var(--roxo)" /> Copiloto Henvixy
          </b>
          <button type="button" className="btn btn-sm" onClick={analisar} disabled={carregando}>
            <Sparkles size={13} /> {carregando ? 'Analisando...' : 'Analisar conversa'}
          </button>
        </div>
        <p className="fs-12 muted">
          {ia?.configurada
            ? 'Resumo, intenção, objeção, temperatura e próximo passo — com a resposta pronta para você revisar.'
            : 'Configure a GROQ_API_KEY no .env para ativar a leitura completa da conversa.'}
        </p>
      </div>
    );
  }

  const t = TEMPERATURA[dados.temperatura] || TEMPERATURA.FRIO;

  return (
    <div className="copiloto">
      <div className="row-between wrap gap-8">
        <b className="row gap-6 fs-13">
          <Bot size={15} color="var(--roxo)" /> Copiloto Henvixy
        </b>
        <div className="row gap-8">
          <span className="chip" style={{ height: 22, color: t.cor, borderColor: t.cor }}>
            {t.emoji} {dados.temperatura}
          </span>
          <button type="button" className="btn btn-sm btn-ghost" onClick={analisar} disabled={carregando} title="Regenerar">
            <RefreshCw size={13} className={carregando ? 'spin' : ''} />
          </button>
        </div>
      </div>

      <div className="col gap-6">
        <div className="copiloto-linha">
          <b>Resumo</b>
          <span className="soft">{dados.resumo}</span>
        </div>
        <div className="copiloto-linha">
          <b>Intenção</b>
          <span className="soft">{dados.intencao}</span>
        </div>
        <div className="copiloto-linha">
          <b>Objeção</b>
          <span className="soft">{dados.objecao}</span>
        </div>
        <div className="copiloto-linha">
          <b>Próxima ação</b>
          <span className="soft">{dados.proxima_acao}</span>
        </div>
      </div>

      {dados.resposta_sugerida && (
        <>
          <div className="divisor" />
          <div className="row-between">
            <span className="label" style={{ margin: 0 }}>Resposta sugerida</span>
            <span className="chip ok" style={{ height: 21 }}>
              <ShieldCheck size={11} /> não enviada
            </span>
          </div>
          <p className="fs-13" style={{ whiteSpace: 'pre-wrap' }}>{dados.resposta_sugerida}</p>
          <div className="row gap-8 wrap">
            <button type="button" className="btn btn-sm" onClick={() => copiar(dados.resposta_sugerida)}>
              <Copy size={13} /> Copiar
            </button>
            <button type="button" className="btn btn-sm btn-primary" onClick={() => onUsarResposta?.(dados.resposta_sugerida)}>
              <PenLine size={13} /> Usar no campo
            </button>
          </div>
          <p className="fs-12 dim">Depois de usar, revise o texto e clique em Enviar — o disparo é sempre seu.</p>
        </>
      )}
    </div>
  );
}
