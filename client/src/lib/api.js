/**
 * Cliente da API local. O frontend NUNCA fala com a Groq nem com o WhatsApp
 * diretamente: tudo passa pelo backend em localhost (spec 19 / 1.1).
 */
const BASE = '/api';

async function req(metodo, rota, corpo, opcoes = {}) {
  // credentials: o cookie de sessao precisa ir junto em toda chamada
  const init = { method: metodo, headers: {}, credentials: 'same-origin', ...opcoes };
  if (corpo instanceof FormData) init.body = corpo;
  else if (corpo !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(corpo);
  }

  let resp;
  try {
    resp = await fetch(BASE + rota, init);
  } catch {
    throw new Error('Nao foi possivel falar com o servidor local. Ele ainda esta rodando?');
  }

  const tipo = resp.headers.get('content-type') || '';
  if (!tipo.includes('application/json')) {
    if (!resp.ok) throw new Error(`Erro ${resp.status} em ${rota}`);
    return resp;
  }
  const dados = await resp.json();
  if (!resp.ok) {
    const err = new Error(dados?.erro || `Erro ${resp.status}`);
    err.status = resp.status;
    err.detalhe = dados?.detalhe;
    // sessao expirou: o painel volta para a tela de login
    if (resp.status === 401 && dados?.precisaLogin && !rota.startsWith('/auth/')) {
      window.dispatchEvent(new CustomEvent('henvix:sessao-expirada'));
    }
    throw err;
  }
  return dados;
}

export const api = {
  get: (rota) => req('GET', rota),
  post: (rota, corpo) => req('POST', rota, corpo),
  put: (rota, corpo) => req('PUT', rota, corpo),
  patch: (rota, corpo) => req('PATCH', rota, corpo),
  del: (rota) => req('DELETE', rota),
  upload: (rota, arquivo, campo = 'arquivo') => {
    const fd = new FormData();
    fd.append(campo, arquivo);
    return req('POST', rota, fd);
  },
  /** Downloads passam pelo backend e salvam via link temporario. */
  baixar: async (rota, nomeSugerido) => {
    const resp = await fetch(BASE + rota);
    if (!resp.ok) {
      let msg = `Erro ${resp.status}`;
      try {
        msg = (await resp.json())?.erro || msg;
      } catch {
        /* resposta sem json */
      }
      throw new Error(msg);
    }
    const blob = await resp.blob();
    const nome =
      resp.headers.get('content-disposition')?.match(/filename="?([^";]+)"?/)?.[1] || nomeSugerido || 'henvix.xlsx';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return nome;
  }
};

export const qs = (obj = {}) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === '' || v === 'todos') continue;
    p.set(k, v);
  }
  const s = p.toString();
  return s ? `?${s}` : '';
};
