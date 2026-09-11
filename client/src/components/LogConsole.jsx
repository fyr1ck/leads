import { useEffect, useRef } from 'react';
import { useApp } from '../state/AppContext.jsx';
import { hora } from '../lib/format.js';

/** Console de logs em tempo real (spec 45). */
export default function LogConsole({ limite = 40, autoScroll = true }) {
  const { logs } = useApp();
  const fim = useRef(null);
  const visiveis = logs.slice(-limite);

  useEffect(() => {
    if (autoScroll) fim.current?.scrollIntoView({ block: 'nearest' });
  }, [logs, autoScroll]);

  if (!visiveis.length) {
    return <div className="log-console dim">Aguardando atividade do sistema...</div>;
  }

  return (
    <div className="log-console">
      {visiveis.map((l, i) => (
        <div key={`${l.created_at}-${i}`} className={`log-line ${l.nivel}`}>
          <time>{hora(l.created_at)}</time>
          <span className="cat">[{l.categoria}]</span>
          <span className="msg grow">{l.mensagem}</span>
        </div>
      ))}
      <div ref={fim} />
    </div>
  );
}
