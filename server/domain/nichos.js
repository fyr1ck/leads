/**
 * Nichos de prospeccao (spec 59.1).
 * `termo` e o que vai para a busca; o usuario pode cadastrar qualquer outro.
 */
export const NICHOS_PADRAO = [
  { nome: 'Restaurantes', termo: 'restaurante', emoji: '\u{1F374}' },
  { nome: 'Pizzarias', termo: 'pizzaria', emoji: '\u{1F355}' },
  { nome: 'Hamburguerias', termo: 'hamburgueria', emoji: '\u{1F354}' },
  { nome: 'Barbearias', termo: 'barbearia', emoji: '\u{1F488}' },
  { nome: 'Saloes de beleza', termo: 'salao de beleza', emoji: '\u{1F485}' },
  { nome: 'Clinicas', termo: 'clinica', emoji: '\u{1F3E5}' },
  { nome: 'Dentistas', termo: 'dentista', emoji: '\u{1F9B7}' },
  { nome: 'Oficinas mecanicas', termo: 'oficina mecanica', emoji: '\u{1F527}' },
  { nome: 'Autoeletricas', termo: 'auto eletrica', emoji: '\u{1F50B}' },
  { nome: 'Lojas de roupas', termo: 'loja de roupas', emoji: '\u{1F455}' },
  { nome: 'Lojas de moveis', termo: 'loja de moveis', emoji: '\u{1FA91}' },
  { nome: 'Academias', termo: 'academia', emoji: '\u{1F3CB}' },
  { nome: 'Pet shops', termo: 'pet shop', emoji: '\u{1F436}' },
  { nome: 'Veterinarios', termo: 'clinica veterinaria', emoji: '\u{1F415}' },
  { nome: 'Padarias', termo: 'padaria', emoji: '\u{1F956}' },
  { nome: 'Confeitarias', termo: 'confeitaria', emoji: '\u{1F370}' },
  { nome: 'Hoteis', termo: 'hotel', emoji: '\u{1F3E8}' },
  { nome: 'Imobiliarias', termo: 'imobiliaria', emoji: '\u{1F3E0}' },
  { nome: 'Empresas de servicos', termo: 'empresa de servicos', emoji: '\u{1F6E0}' },
  { nome: 'Fotografos', termo: 'fotografo', emoji: '\u{1F4F7}' },
  { nome: 'Arquitetos', termo: 'arquiteto', emoji: '\u{1F4D0}' },
  { nome: 'Advogados', termo: 'advogado', emoji: '\u{2696}' },
  { nome: 'Contadores', termo: 'contador', emoji: '\u{1F4CA}' }
];

export function slugificarNicho(nome) {
  return String(nome)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
}

/**
 * Dominios que NAO contam como site proprio (spec 59.5).
 * Rede social, agregador e encurtador nao sao site da empresa.
 */
export const DOMINIOS_SOCIAIS = [
  'instagram.com', 'facebook.com', 'fb.com', 'm.facebook.com', 'tiktok.com', 'youtube.com',
  'youtu.be', 'twitter.com', 'x.com', 'linkedin.com', 'wa.me', 'api.whatsapp.com',
  'whatsapp.com', 'linktr.ee', 'linktree.com', 'beacons.ai', 'bio.link', 'linkbio.co',
  't.me', 'telegram.me', 'pinterest.com'
];

/**
 * Agregadores/marketplaces: a empresa aparece la, mas a pagina nao e dela.
 * Nesses casos o certo e pedir verificacao manual (spec 59.4).
 */
export const DOMINIOS_AGREGADORES = [
  'ifood.com.br', 'rappi.com.br', 'ubereats.com', '99food.com', 'aiqfome.com',
  'booking.com', 'airbnb.com', 'tripadvisor.com', 'tripadvisor.com.br', 'decolar.com',
  'doctoralia.com.br', 'boaconsulta.com', 'zapimoveis.com.br', 'vivareal.com.br',
  'olx.com.br', 'mercadolivre.com.br', 'elo7.com.br', 'getninjas.com.br',
  'google.com', 'sites.google.com', 'business.site', 'negocio.site', 'trustindex.io'
];

export function dominioDe(url) {
  if (!url) return null;
  try {
    const u = new URL(String(url).startsWith('http') ? url : `https://${url}`);
    return u.hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return null;
  }
}

const contem = (dominio, lista) => lista.some((d) => dominio === d || dominio.endsWith(`.${d}`));

/**
 * Classifica a situacao do site (spec 59.4).
 * Nunca afirma com certeza que a empresa "nao tem site": quando a fonte nao
 * permite concluir, devolve VERIFICAR.
 */
export function classificarSite(websiteUri) {
  const dominio = dominioDe(websiteUri);
  if (!dominio) {
    return { status: 'SEM_SITE', site: null, instagram: null, motivo: 'Nenhum site informado na fonte.' };
  }
  if (contem(dominio, DOMINIOS_SOCIAIS)) {
    const ehInstagram = dominio.includes('instagram.com');
    return {
      status: 'SEM_SITE',
      site: null,
      instagram: ehInstagram ? websiteUri : null,
      motivo: `O link cadastrado e ${dominio} - rede social nao conta como site proprio.`
    };
  }
  if (contem(dominio, DOMINIOS_AGREGADORES)) {
    return {
      status: 'VERIFICAR',
      site: websiteUri,
      instagram: null,
      motivo: `O link aponta para ${dominio}, que nao e necessariamente um site proprio.`
    };
  }
  return { status: 'COM_SITE', site: websiteUri, instagram: null, motivo: `Site proprio identificado: ${dominio}.` };
}

export const ROTULO_SITE = {
  SEM_SITE: { nome: 'Site nao identificado', emoji: '\u{1F7E2}', cor: '#22c55e' },
  COM_SITE: { nome: 'Site identificado', emoji: '\u{1F7E1}', cor: '#facc15' },
  VERIFICAR: { nome: 'Verificar manualmente', emoji: '\u{1F7E0}', cor: '#f97316' }
};

/**
 * Priorizacao interna da prospeccao (spec 59.17).
 * E so ordem de trabalho - nao diz nada sobre a qualidade da empresa.
 */
export function prioridadeProspeccao({ status_site, telefone, instagram, total_avaliacoes }) {
  const temTelefone = Boolean(telefone);
  const avaliacoes = Number(total_avaliacoes || 0);
  const semSite = status_site === 'SEM_SITE';

  if (semSite && temTelefone && (instagram || avaliacoes >= 30)) {
    return { prioridade: 'ALTA', motivo: 'Site proprio nao identificado, com telefone e presenca digital.' };
  }
  if (semSite && temTelefone) {
    return { prioridade: 'MEDIA', motivo: 'Site proprio nao identificado e telefone disponivel.' };
  }
  if (!temTelefone) {
    return { prioridade: 'BAIXA', motivo: 'Sem telefone publico: nao da para prospectar pelo WhatsApp.' };
  }
  return { prioridade: 'BAIXA', motivo: 'Ja possui site identificado.' };
}
