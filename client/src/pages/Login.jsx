import { useEffect, useState } from 'react';
import { LogIn, KeyRound, AlertTriangle, Mail, ArrowRight } from 'lucide-react';
import { api } from '../lib/api.js';
import { Campo } from '../components/ui.jsx';

/**
 * Entrada do painel. So os e-mails de USUARIOS_PERMITIDOS existem como usuario.
 * No primeiro acesso a propria pessoa cria a senha - o sistema nunca gera uma.
 */
export default function Login({ onEntrou }) {
  const [estado, setEstado] = useState(null);
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [modo, setModo] = useState('email'); // email | senha | criar
  const [erro, setErro] = useState(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    api
      .get('/auth/sessao')
      .then(setEstado)
      .catch(() => setEstado({ minimoSenha: 8 }));
  }, []);

  const continuar = async (e) => {
    e?.preventDefault();
    setErro(null);
    setOcupado(true);
    try {
      const s = await api.post('/auth/situacao', { email });
      if (!s.permitido) {
        setErro('Esse e-mail não tem acesso ao painel.');
        return;
      }
      setModo(s.precisaDefinirSenha ? 'criar' : 'senha');
    } catch (err) {
      setErro(err.message);
    } finally {
      setOcupado(false);
    }
  };

  const entrar = async (e) => {
    e?.preventDefault();
    setErro(null);
    setOcupado(true);
    try {
      const r = await api.post('/auth/login', { email, senha });
      onEntrou?.(r.usuario);
    } catch (err) {
      setErro(err.message);
    } finally {
      setOcupado(false);
    }
  };

  const criarSenha = async (e) => {
    e?.preventDefault();
    setErro(null);
    if (senha !== confirmacao) {
      setErro('As senhas não são iguais.');
      return;
    }
    setOcupado(true);
    try {
      const r = await api.post('/auth/definir-senha', { email, senha });
      onEntrou?.(r.usuario);
    } catch (err) {
      setErro(err.message);
    } finally {
      setOcupado(false);
    }
  };

  const minimo = estado?.minimoSenha || 8;

  return (
    <div className="login-tela">
      <div className="login-caixa anim-panel">
        <div className="row gap-12" style={{ marginBottom: 22 }}>
          <div className="brand-mark" style={{ width: 42, height: 42, fontSize: 18 }}>H</div>
          <div>
            <strong style={{ fontSize: 17, letterSpacing: '0.02em' }}>HENVIX</strong>
            <div className="fs-12 dim" style={{ letterSpacing: '0.14em', textTransform: 'uppercase' }}>Sales OS</div>
          </div>
        </div>

        {modo === 'email' && (
          <form onSubmit={continuar} className="col gap-16">
            <div>
              <h2>Entrar no painel</h2>
              <p className="fs-13 muted mt-8">Acesso restrito aos e-mails autorizados.</p>
            </div>

            <Campo label="E-mail">
              <div style={{ position: 'relative' }}>
                <Mail size={15} style={{ position: 'absolute', left: 11, top: 11, color: 'var(--dim)' }} />
                <input
                  className="input"
                  style={{ paddingLeft: 33 }}
                  type="email"
                  autoFocus
                  placeholder="voce@gmail.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </Campo>

            {erro && (
              <div className="chip erro" style={{ height: 'auto', padding: '9px 12px', whiteSpace: 'normal' }}>
                <AlertTriangle size={14} /> {erro}
              </div>
            )}

            <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={!email || ocupado}>
              Continuar <ArrowRight size={16} />
            </button>
          </form>
        )}

        {modo === 'senha' && (
          <form onSubmit={entrar} className="col gap-16">
            <div>
              <h2>Sua senha</h2>
              <p className="fs-13 muted mt-8">{email}</p>
            </div>

            <Campo label="Senha">
              <input
                className="input"
                type="password"
                autoFocus
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
              />
            </Campo>

            {erro && (
              <div className="chip erro" style={{ height: 'auto', padding: '9px 12px', whiteSpace: 'normal' }}>
                <AlertTriangle size={14} /> {erro}
              </div>
            )}

            <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={!senha || ocupado}>
              <LogIn size={16} /> {ocupado ? 'Entrando...' : 'Entrar'}
            </button>
            <button type="button" className="btn btn-ghost btn-block" onClick={() => { setModo('email'); setSenha(''); setErro(null); }}>
              Usar outro e-mail
            </button>
          </form>
        )}

        {modo === 'criar' && (
          <form onSubmit={criarSenha} className="col gap-16">
            <div>
              <h2>Primeiro acesso</h2>
              <p className="fs-13 muted mt-8">
                {email} — crie sua senha. Ela fica só neste computador, com hash; ninguém consegue lê-la depois.
              </p>
            </div>

            <Campo label="Nova senha" hint={`mínimo de ${minimo} caracteres`}>
              <input className="input" type="password" autoFocus value={senha} onChange={(e) => setSenha(e.target.value)} />
            </Campo>
            <Campo label="Repita a senha">
              <input className="input" type="password" value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} />
            </Campo>

            {estado && !estado.local && (
              <div className="chip warn" style={{ height: 'auto', padding: '9px 12px', whiteSpace: 'normal' }}>
                <AlertTriangle size={14} /> A senha do primeiro acesso só pode ser criada no computador onde o painel
                está rodando.
              </div>
            )}

            {erro && (
              <div className="chip erro" style={{ height: 'auto', padding: '9px 12px', whiteSpace: 'normal' }}>
                <AlertTriangle size={14} /> {erro}
              </div>
            )}

            <button
              type="submit"
              className="btn btn-primary btn-lg btn-block"
              disabled={senha.length < minimo || ocupado}
            >
              <KeyRound size={16} /> {ocupado ? 'Criando...' : 'Criar senha e entrar'}
            </button>
            <button type="button" className="btn btn-ghost btn-block" onClick={() => { setModo('email'); setSenha(''); setConfirmacao(''); setErro(null); }}>
              Voltar
            </button>
          </form>
        )}

      </div>
    </div>
  );
}
