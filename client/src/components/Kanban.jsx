import { useState } from 'react';
import { MapPin } from 'lucide-react';
import { TagPill } from './ui.jsx';

/**
 * Pipeline visual (spec 58.12). Arraste o card para mudar a etapa.
 * A IA sugere a etapa na analise; quem move de verdade e o operador.
 */
export default function Kanban({ colunas = [], tags = [], onMover, onAbrir }) {
  const [arrastando, setArrastando] = useState(null);
  const [alvo, setAlvo] = useState(null);

  return (
    <div className="kanban">
      {colunas.map((col) => (
        <section
          key={col.slug}
          className={`kanban-col ${alvo === col.slug ? 'alvo' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setAlvo(col.slug);
          }}
          onDragLeave={() => setAlvo((a) => (a === col.slug ? null : a))}
          onDrop={(e) => {
            e.preventDefault();
            setAlvo(null);
            const id = Number(e.dataTransfer.getData('text/plain') || arrastando);
            if (id && onMover) onMover(id, col.slug);
          }}
        >
          <header className="kanban-head">
            <span>{col.nome}</span>
            <span className="nav-count">{col.leads.length}</span>
          </header>
          <div className="kanban-body">
            {col.leads.length === 0 && <span className="dim fs-12 center" style={{ padding: 14 }}>vazio</span>}
            {col.leads.map((l) => (
              <article
                key={l.id}
                className="kanban-card"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/plain', String(l.id));
                  setArrastando(l.id);
                }}
                onDragEnd={() => setArrastando(null)}
                onClick={() => onAbrir?.(l.id)}
              >
                <b className="fs-13 truncate" style={{ display: 'block' }}>{l.nome_estabelecimento}</b>
                <div className="row gap-6 mt-8 wrap">
                  <TagPill etiqueta={l.etiqueta} tags={tags} sm />
                  <span className="fs-12 dim mono">{l.score ?? 0}</span>
                </div>
                {l.cidade && (
                  <div className="fs-12 dim row gap-4 mt-8">
                    <MapPin size={11} /> {l.cidade}
                  </div>
                )}
                {l.ultima_mensagem && (
                  <p className="fs-12 soft truncate mt-8" title={l.ultima_mensagem}>
                    “{l.ultima_mensagem}”
                  </p>
                )}
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
