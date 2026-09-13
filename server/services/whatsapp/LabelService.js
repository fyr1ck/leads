import whatsapp from './WhatsAppService.js';
import * as tagRepo from '../../repositories/tagRepo.js';
import * as settingsRepo from '../../repositories/settingsRepo.js';
import { run, get } from '../../db/index.js';
import { logger } from '../../utils/logger.js';
import { AppError } from '../../utils/errors.js';

/**
 * Espelha as etiquetas do CRM nas ETIQUETAS DO WHATSAPP.
 *
 * Importante: etiqueta de conversa e um recurso do **WhatsApp Business**.
 * Em conta pessoal o WhatsApp simplesmente nao exibe nada - por isso tudo aqui
 * falha em silencio, sem nunca derrubar o envio ou a analise.
 *
 * O mapeamento fica na propria tabela de etiquetas (tags.wa_label_id), entao
 * cada etiqueta do painel conhece o id dela la do outro lado.
 */

/**
 * O WhatsApp tem 20 cores (0-19) e nao expoe o valor hexadecimal.
 * Aqui fica a aproximacao escolhida para cada etiqueta padrao - o que importa
 * e cada etiqueta ter uma cor propria e estavel.
 */
const COR_WHATSAPP = {
  INTERESSADO: 5,
  PEDIU_DEMONSTRACAO: 8,
  QUER_SABER_PRECO: 3,
  NEGOCIANDO: 12,
  QUER_CONTRATAR: 6,
  PEDIU_INFORMACOES: 1,
  QUER_CONTATO: 2,
  FALAR_DEPOIS: 11,
  RESPONDEU: 0,
  AGUARDANDO_RESPOSTA: 4,
  REVISAR_MANUALMENTE: 9,
  JA_POSSUI_SITE: 14,
  NAO_INTERESSADO: 7,
  RECUSOU: 15,
  SEM_RESPOSTA: 13
};

/** Ids 1..5 sao as etiquetas pre-definidas do WhatsApp: nao mexemos nelas. */
const PRIMEIRO_ID_LIVRE = 6;

const ligado = () => Number(settingsRepo.obter('wa_etiquetas_sync') ?? 1) === 1;

const normalizar = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();

/** Proximo id livre, considerando o que ja existe no aparelho e no banco. */
function proximoId(existentes) {
  const usados = new Set([
    ...existentes.map((e) => Number(e.id)),
    ...tagRepo.listar().map((t) => Number(t.wa_label_id)).filter(Boolean)
  ]);
  let id = PRIMEIRO_ID_LIVRE;
  while (usados.has(id)) id += 1;
  return String(id);
}

/**
 * Cria no WhatsApp as etiquetas que ainda nao existem e guarda o id de cada
 * uma. Etiqueta com o mesmo nome ja existente no aparelho e reaproveitada.
 */
export async function sincronizar({ forcar = false } = {}) {
  if (!whatsapp.suportaEtiquetas) {
    throw new AppError('A biblioteca de WhatsApp em uso nao suporta etiquetas.', 501);
  }
  if (!whatsapp.conectado) {
    throw new AppError('Conecte o WhatsApp antes de sincronizar as etiquetas.', 409);
  }

  const noAparelho = whatsapp.listarEtiquetasWhatsApp();
  const porNome = new Map(noAparelho.map((e) => [normalizar(e.nome), e]));

  const resultado = { criadas: 0, reaproveitadas: 0, jaMapeadas: 0, erros: 0, itens: [] };

  for (const tag of tagRepo.listar()) {
    const nome = `${tag.emoji || ''} ${tag.nome}`.trim();
    try {
      if (tag.wa_label_id && !forcar) {
        resultado.jaMapeadas += 1;
        resultado.itens.push({ slug: tag.slug, nome, wa_label_id: tag.wa_label_id, acao: 'JA_MAPEADA' });
        continue;
      }

      const existente = porNome.get(normalizar(nome)) || porNome.get(normalizar(tag.nome));
      const cor = COR_WHATSAPP[tag.slug] ?? (Math.abs(hash(tag.slug)) % 20);

      if (existente) {
        run('UPDATE tags SET wa_label_id = ?, wa_cor = ? WHERE id = ?', String(existente.id), cor, tag.id);
        resultado.reaproveitadas += 1;
        resultado.itens.push({ slug: tag.slug, nome, wa_label_id: String(existente.id), acao: 'REAPROVEITADA' });
        continue;
      }

      const id = proximoId(whatsapp.listarEtiquetasWhatsApp());
      await whatsapp.criarEtiqueta({ id, nome, cor });
      run('UPDATE tags SET wa_label_id = ?, wa_cor = ? WHERE id = ?', id, cor, tag.id);
      resultado.criadas += 1;
      resultado.itens.push({ slug: tag.slug, nome, wa_label_id: id, acao: 'CRIADA' });

      // a criacao vai por app-state: um respiro evita enfileirar tudo de uma vez
      await new Promise((r) => setTimeout(r, 350));
    } catch (err) {
      resultado.erros += 1;
      resultado.itens.push({ slug: tag.slug, nome, acao: 'ERRO', erro: err.message });
      logger.warn('etiquetas', `Falha ao sincronizar "${nome}": ${err.message}`);
    }
  }

  logger.ok(
    'etiquetas',
    `Etiquetas no WhatsApp: ${resultado.criadas} criadas, ${resultado.reaproveitadas} reaproveitadas, ${resultado.erros} erros.`
  );
  return resultado;
}

function hash(texto) {
  let h = 0;
  for (let i = 0; i < texto.length; i += 1) h = (h << 5) - h + texto.charCodeAt(i);
  return h;
}

/**
 * Aplica no chat a etiqueta atual do lead, tirando a anterior.
 * Nunca lanca: etiqueta no WhatsApp e um extra, nao pode travar o CRM.
 */
export async function aplicarNoLead(lead, novoSlug, antigoSlug = null) {
  if (!ligado() || !whatsapp.suportaEtiquetas || !whatsapp.conectado) return { aplicada: false, motivo: 'desligado' };
  const destino = lead?.wa_jid || lead?.telefone_e164; // conversa exata (LID) ou telefone
  if (!destino || !novoSlug) return { aplicada: false, motivo: 'sem conversa ou etiqueta' };
  if (novoSlug === antigoSlug) return { aplicada: false, motivo: 'sem mudanca' };

  try {
    if (antigoSlug) {
      const antiga = get('SELECT wa_label_id FROM tags WHERE slug = ?', antigoSlug);
      if (antiga?.wa_label_id) {
        await whatsapp.removerEtiquetaDoChat(destino, antiga.wa_label_id).catch(() => {});
      }
    }

    const nova = get('SELECT wa_label_id, nome FROM tags WHERE slug = ?', novoSlug);
    if (!nova?.wa_label_id) {
      return { aplicada: false, motivo: 'etiqueta ainda nao sincronizada com o WhatsApp' };
    }

    const aplicou = await whatsapp.aplicarEtiquetaNoChat(destino, nova.wa_label_id);
    if (!aplicou) return { aplicada: false, motivo: 'conversa nao encontrada no WhatsApp' };
    logger.info('etiquetas', `"${nova.nome}" aplicada no WhatsApp de ${lead.nome_estabelecimento}.`);
    return { aplicada: true, wa_label_id: nova.wa_label_id };
  } catch (err) {
    logger.warn('etiquetas', `Nao consegui etiquetar ${lead.nome_estabelecimento} no WhatsApp: ${err.message}`);
    return { aplicada: false, motivo: err.message };
  }
}

export function estado() {
  const tags = tagRepo.listar();
  return {
    suportado: whatsapp.suportaEtiquetas,
    conectado: whatsapp.conectado,
    ligado: ligado(),
    mapeadas: tags.filter((t) => t.wa_label_id).length,
    total: tags.length,
    noAparelho: whatsapp.listarEtiquetasWhatsApp(),
    etiquetas: tags.map((t) => ({
      slug: t.slug,
      nome: t.nome,
      emoji: t.emoji,
      cor: t.cor,
      wa_label_id: t.wa_label_id || null
    }))
  };
}

export default { sincronizar, aplicarNoLead, estado };
