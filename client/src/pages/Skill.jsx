import { useEffect, useState } from 'react';
import { ScrollText, Save, RotateCcw, ShieldCheck, FileClock, Sparkles } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../state/AppContext.jsx';
import { Card, Campo, SkeletonLista, Segmented } from '../components/ui.jsx';
import { dataHora, numero } from '../lib/format.js';

const CAMPOS = [
  { chave: 'tom', rotulo: 'Tom de voz', hint: 'Como o João Henrique deve soar.' },
  { chave: 'servicos', rotulo: 'Serviços oferecidos', hint: 'O que a Henvixy vende.' },
  { chave: 'precos', rotulo: 'Preços autorizados', hint: 'A ÚNICA fonte de valores. Vazio = a IA não fala preço.' },
  { chave: 'prazo', rotulo: 'Prazo de entrega', hint: '' },
  { chave: 'formas_pagamento', rotulo: 'Formas de pagamento', hint: '' },
  { chave: 'objecoes', rotulo: 'Objeções e respostas', hint: 'Uma por linha.' },
  { chave: 'argumentos', rotulo: 'Argumentos de venda', hint: '' },
  { chave: 'faq', rotulo: 'Perguntas frequentes', hint: '' },
  { chave: 'abordagens', rotulo: 'Abordagens preferidas', hint: '' },
  { chave: 'followups', rotulo: 'Orientação para follow-up', hint: '' },
  { chave: 'regras_extras', rotulo: 'Regras adicionais', hint: '' }
];

export default function Skill() {
  const { toast } = useApp();
  const [dados, setDados] = useState(null);
  const [aba, setAba] = useState('config');
  const [config, setConfig] = useState(null);
  const [conteudo, setConteudo] = useState('');
  const [salvando, setSalvando] = useState(false);

  const carregar = async () => {
    try {
      const d = await api.get('/skill');
      setDados(d);
      setConfig(d.config);
      setConteudo(d.arquivo.conteudo || '');
    } catch (e) {
      toast('erro', 'Erro ao carregar a Skill', e.message);
    }
  };

  useEffect(() => {
    carregar();
  }, []);

  const salvarConfig = async () => {
    setSalvando(true);
    try {
      const d = await api.put('/skill', { config });
      setConfig(d.config);
      toast('sucesso', 'Configuração comercial salva', 'A IA já passa a usar nas próximas mensagens.');
    } catch (e) {
      toast('erro', 'Erro ao salvar', e.message);
    } finally {
      setSalvando(false);
    }
  };

  const salvarArquivo = async () => {
    setSalvando(true);
    try {
      const d = await api.put('/skill', { conteudo });
      setDados((x) => ({ ...x, arquivo: d.arquivo }));
      toast('sucesso', 'Skill salva', 'O arquivo anterior virou backup automático.');
      carregar();
    } catch (e) {
      toast('erro', 'Erro ao salvar a Skill', e.message);
    } finally {
      setSalvando(false);
    }
  };

  if (!dados || !config) return <SkeletonLista linhas={5} altura={80} />;

  return (
    <>
      <Card
        titulo="Skill Henvixy"
        icone={<ScrollText size={16} color="var(--accent)" />}
        acoes={
          <>
            <span className={`chip ${dados.arquivo.carregada ? 'ok' : 'erro'}`}>
              {dados.arquivo.carregada ? `${numero(dados.arquivo.caracteres)} caracteres` : 'arquivo não encontrado'}
            </span>
            <Segmented
              opcoes={[
                { valor: 'config', rotulo: 'Configuração comercial' },
                { valor: 'arquivo', rotulo: 'Arquivo da Skill' }
              ]}
              valor={aba}
              onChange={setAba}
            />
          </>
        }
      >
        <div className="aviso-regra">
          <ShieldCheck size={16} />
          <span>
            A Skill é a fonte das regras de venda e vai inteira para a IA em toda mensagem. A configuração comercial
            abaixo entra junto — é por ela que você autoriza preços, já que <b>inventar valor é proibido</b>.
          </span>
        </div>
        <p className="fs-12 dim mt-8">
          Arquivo: <span className="mono">{dados.arquivo.caminho}</span>
        </p>
      </Card>

      {aba === 'config' ? (
        <Card
          titulo="Configuração comercial"
          icone={<Sparkles size={16} color="var(--accent)" />}
          acoes={
            <button type="button" className="btn btn-sm btn-primary" onClick={salvarConfig} disabled={salvando}>
              <Save size={14} /> {salvando ? 'Salvando...' : 'Salvar'}
            </button>
          }
        >
          <div className="grid grid-2">
            {CAMPOS.map((c) => (
              <Campo key={c.chave} label={c.rotulo} hint={c.hint}>
                <textarea
                  className="textarea"
                  style={{ minHeight: c.chave === 'tom' || c.chave === 'prazo' || c.chave === 'formas_pagamento' ? 64 : 96 }}
                  value={config[c.chave] || ''}
                  onChange={(e) => setConfig((x) => ({ ...x, [c.chave]: e.target.value }))}
                />
              </Campo>
            ))}
          </div>
          <div className="aviso-regra mt-16" style={{ borderColor: 'rgba(250,204,21,.3)', background: 'var(--warn-soft)', color: '#fde68a' }}>
            <span>
              {String(config.precos || '').trim()
                ? 'Preços autorizados: a IA pode citar exatamente esses valores — e nenhum outro.'
                : 'Nenhum preço autorizado: se perguntarem valor, a IA explica o serviço e diz que vai confirmar.'}
            </span>
          </div>
        </Card>
      ) : (
        <Card
          titulo="Arquivo da Skill (.md)"
          acoes={
            <>
              <button type="button" className="btn btn-sm" onClick={carregar}>
                <RotateCcw size={14} /> Descartar alterações
              </button>
              <button type="button" className="btn btn-sm btn-primary" onClick={salvarArquivo} disabled={salvando}>
                <Save size={14} /> {salvando ? 'Salvando...' : 'Salvar Skill'}
              </button>
            </>
          }
        >
          <textarea className="editor-skill" value={conteudo} onChange={(e) => setConteudo(e.target.value)} spellCheck={false} />
          <p className="hint mt-8">
            Ao salvar, o arquivo anterior é copiado para <span className="mono">skills/backups/</span> automaticamente.
          </p>

          {dados.backups?.length > 0 && (
            <div className="mt-16">
              <div className="label row gap-6" style={{ marginBottom: 8 }}>
                <FileClock size={12} /> Backups ({dados.backups.length})
              </div>
              <div className="col gap-6">
                {dados.backups.slice(0, 6).map((b) => (
                  <div key={b.arquivo} className="row-between fs-12 muted">
                    <span className="mono truncate">{b.arquivo}</span>
                    <span className="dim nowrap">{dataHora(b.criado_em)} · {numero(b.tamanho)} bytes</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
