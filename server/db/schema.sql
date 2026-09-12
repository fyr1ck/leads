-- ============================================================
--  HENVIX SALES PANEL - schema local (SQLite via node:sqlite)
--  Nada aqui e apagado quando o lead sai da lista de prospeccao.
--  O historico e permanente (spec 8 / 11 / 42).
-- ============================================================

CREATE TABLE IF NOT EXISTS leads (
  id                            INTEGER PRIMARY KEY AUTOINCREMENT,
  nome_estabelecimento          TEXT NOT NULL,
  telefone                      TEXT,              -- como veio na planilha
  telefone_e164                 TEXT,              -- normalizado: identificador unico
  google_maps                   TEXT,
  endereco                      TEXT,
  cidade                        TEXT,
  instagram                     TEXT,
  categoria                     TEXT,
  site                          TEXT,
  status                        TEXT NOT NULL DEFAULT 'NOVO',
  etiqueta                      TEXT,
  prioridade                    TEXT,
  score                         INTEGER NOT NULL DEFAULT 0,
  pipeline                      TEXT NOT NULL DEFAULT 'NOVOS',
  data_importacao               TEXT NOT NULL DEFAULT (datetime('now')),
  data_ultimo_contato           TEXT,
  quantidade_mensagens_enviadas INTEGER NOT NULL DEFAULT 0,
  respondeu                     INTEGER NOT NULL DEFAULT 0,
  ultima_mensagem               TEXT,
  ultima_mensagem_data          TEXT,
  primeira_resposta_data        TEXT,
  origem                        TEXT,
  observacoes                   TEXT,
  dedupe_key                    TEXT,              -- nome+endereco (fallback sem telefone)
  na_prospeccao                 INTEGER NOT NULL DEFAULT 1,
  adiado_ate                    TEXT,
  fechado_em                    TEXT,
  dados_extra                   TEXT,              -- JSON com colunas nao mapeadas
  created_at                    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Identificador unico: telefone (spec 10 / 39). Fallback: nome + endereco.
CREATE UNIQUE INDEX IF NOT EXISTS ux_leads_telefone ON leads(telefone_e164) WHERE telefone_e164 IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_leads_dedupe   ON leads(dedupe_key)    WHERE telefone_e164 IS NULL AND dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_leads_status     ON leads(status);
CREATE INDEX IF NOT EXISTS ix_leads_etiqueta   ON leads(etiqueta);
CREATE INDEX IF NOT EXISTS ix_leads_cidade     ON leads(cidade);
CREATE INDEX IF NOT EXISTS ix_leads_categoria  ON leads(categoria);
CREATE INDEX IF NOT EXISTS ix_leads_pipeline   ON leads(pipeline);
CREATE INDEX IF NOT EXISTS ix_leads_respondeu  ON leads(respondeu);

CREATE TABLE IF NOT EXISTS campaigns (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  nome                TEXT NOT NULL,
  quantidade_alvo     INTEGER NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'RASCUNHO', -- RASCUNHO|ATIVA|PAUSADA|CONCLUIDA|PARADA
  delay_min           INTEGER NOT NULL DEFAULT 30,
  delay_max           INTEGER NOT NULL DEFAULT 90,
  bloco_tamanho       INTEGER NOT NULL DEFAULT 10,
  bloco_pausa_minutos INTEGER NOT NULL DEFAULT 5,
  filtros             TEXT,
  enviados            INTEGER NOT NULL DEFAULT 0,
  erros               INTEGER NOT NULL DEFAULT 0,
  ignorados           INTEGER NOT NULL DEFAULT 0,
  ultimo_erro         TEXT,
  motivo_parada       TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  started_at          TEXT,
  finished_at         TEXT,
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Fila persistente da campanha: sobrevive a restart do servidor (spec 54).
CREATE TABLE IF NOT EXISTS campaign_leads (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  lead_id     INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  ordem       INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'PENDENTE', -- PENDENTE|ENVIADO|ERRO|IGNORADO
  mensagem    TEXT,
  erro        TEXT,
  enviado_em  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(campaign_id, lead_id)
);
CREATE INDEX IF NOT EXISTS ix_cl_campanha ON campaign_leads(campaign_id, status, ordem);

CREATE TABLE IF NOT EXISTS messages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id       INTEGER REFERENCES leads(id) ON DELETE CASCADE,
  campaign_id   INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
  direcao       TEXT NOT NULL,                    -- OUT | IN
  corpo         TEXT NOT NULL,
  telefone      TEXT,
  wa_message_id TEXT,
  status        TEXT NOT NULL DEFAULT 'ENVIADA',  -- ENVIADA|FALHOU|RECEBIDA
  erro          TEXT,
  autor         TEXT,                             -- IA | OPERADOR | CLIENTE | SISTEMA
  lida          INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_msg_lead ON messages(lead_id, created_at);
CREATE INDEX IF NOT EXISTS ix_msg_dir  ON messages(direcao, created_at);

-- Historico permanente de contato (spec 8 / 42). Nao e apagado na limpeza.
CREATE TABLE IF NOT EXISTS contact_history (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id        INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  campaign_id    INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
  telefone       TEXT,
  estabelecimento TEXT,
  google_maps    TEXT,
  cidade         TEXT,
  tipo           TEXT NOT NULL,   -- ENVIO|RESPOSTA|ERRO|ETIQUETA|FECHAMENTO|MANUAL
  mensagem       TEXT,
  status         TEXT,
  resposta       TEXT,
  etiqueta       TEXT,
  campanha_nome  TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_hist_tel  ON contact_history(telefone);
CREATE INDEX IF NOT EXISTS ix_hist_lead ON contact_history(lead_id, created_at);
CREATE INDEX IF NOT EXISTS ix_hist_tipo ON contact_history(tipo, created_at);

CREATE TABLE IF NOT EXISTS ai_analyses (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id          INTEGER REFERENCES leads(id) ON DELETE CASCADE,
  message_id       INTEGER REFERENCES messages(id) ON DELETE CASCADE,
  etiqueta         TEXT,
  prioridade       TEXT,
  confianca        REAL,
  score            INTEGER,
  motivo           TEXT,
  sugestao_resposta TEXT,
  proxima_etapa    TEXT,
  modelo           TEXT,
  bruto            TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_ai_lead ON ai_analyses(lead_id, created_at);

CREATE TABLE IF NOT EXISTS tags (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  slug       TEXT NOT NULL UNIQUE,
  nome       TEXT NOT NULL,
  emoji      TEXT,
  cor        TEXT,
  prioridade TEXT NOT NULL DEFAULT 'MEDIA',
  score      INTEGER NOT NULL DEFAULT 40,
  pipeline   TEXT,
  sistema    INTEGER NOT NULL DEFAULT 0,
  ordem      INTEGER NOT NULL DEFAULT 100,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS lead_tags (
  lead_id    INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  tag_id     INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  origem     TEXT,   -- IA | OPERADOR
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (lead_id, tag_id)
);

CREATE TABLE IF NOT EXISTS whatsapp_sessions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  nome            TEXT NOT NULL DEFAULT 'principal',
  numero          TEXT,
  push_name       TEXT,
  status          TEXT NOT NULL DEFAULT 'DESCONECTADO',
  ultima_conexao  TEXT,
  desconectado_em TEXT,
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  chave      TEXT PRIMARY KEY,
  valor      TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  nivel      TEXT NOT NULL DEFAULT 'info',
  categoria  TEXT,
  mensagem   TEXT NOT NULL,
  meta       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_logs_data ON logs(created_at);

CREATE TABLE IF NOT EXISTS imports (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  arquivo        TEXT,
  total_linhas   INTEGER NOT NULL DEFAULT 0,
  importados     INTEGER NOT NULL DEFAULT 0,
  duplicados     INTEGER NOT NULL DEFAULT 0,
  invalidos      INTEGER NOT NULL DEFAULT 0,
  atualizados    INTEGER NOT NULL DEFAULT 0,
  mapeamento     TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
--  v2 - Sales OS: prospeccao, demos, follow-up, vendas, timeline
--  Tudo aditivo: nenhuma tabela acima e alterada ou removida.
-- ============================================================

-- Nichos usados na busca de leads (os personalizados ficam salvos) - spec 59.1
CREATE TABLE IF NOT EXISTS niches (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  nome       TEXT NOT NULL,
  slug       TEXT NOT NULL UNIQUE,
  termo      TEXT,              -- termo enviado para a fonte de dados
  sistema    INTEGER NOT NULL DEFAULT 0,
  buscas     INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Pesquisas salvas - spec 59.14
CREATE TABLE IF NOT EXISTS saved_searches (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  nome             TEXT NOT NULL,
  nicho            TEXT NOT NULL,
  cidade           TEXT,
  estado           TEXT,
  raio_km          INTEGER NOT NULL DEFAULT 10,
  filtros          TEXT,
  total_encontrados INTEGER NOT NULL DEFAULT 0,
  total_adicionados INTEGER NOT NULL DEFAULT 0,
  execucoes        INTEGER NOT NULL DEFAULT 0,
  ultima_execucao  TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Resultado bruto de cada busca - spec 59.6 / 59.12
CREATE TABLE IF NOT EXISTS search_results (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  search_id        INTEGER REFERENCES saved_searches(id) ON DELETE SET NULL,
  place_id         TEXT,
  nome             TEXT NOT NULL,
  categoria        TEXT,
  endereco         TEXT,
  cidade           TEXT,
  estado           TEXT,
  telefone         TEXT,
  telefone_e164    TEXT,
  google_maps      TEXT,
  site             TEXT,
  instagram        TEXT,
  avaliacao        REAL,
  total_avaliacoes INTEGER,
  status_site      TEXT,        -- SEM_SITE | COM_SITE | VERIFICAR
  prioridade       TEXT,        -- ALTA | MEDIA | BAIXA (priorizacao interna)
  nicho            TEXT,
  origem           TEXT,        -- google_places
  lead_id          INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  adicionado       INTEGER NOT NULL DEFAULT 0,
  bruto            TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_sr_busca ON search_results(search_id, created_at);
CREATE INDEX IF NOT EXISTS ix_sr_place ON search_results(place_id);

-- Follow-ups - spec 66
CREATE TABLE IF NOT EXISTS follow_ups (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id        INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  campaign_id    INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
  prazo_dias     INTEGER NOT NULL DEFAULT 1,
  agendado_para  TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'PENDENTE', -- PENDENTE|PREPARADO|AGUARDANDO_CONFIRMACAO|ENVIADO|CANCELADO
  mensagem       TEXT,
  origem         TEXT,          -- AUTOMATICO | OPERADOR
  motivo         TEXT,
  enviado_em     TEXT,
  cancelado_em   TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_fu_lead ON follow_ups(lead_id, status);
CREATE INDEX IF NOT EXISTS ix_fu_prazo ON follow_ups(status, agendado_para);

-- Demonstracoes - spec 68
CREATE TABLE IF NOT EXISTS demos (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id        INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  titulo         TEXT,
  url            TEXT,
  status         TEXT NOT NULL DEFAULT 'CRIADA', -- CRIADA|ENVIADA|ACESSADA|FEEDBACK|NEGOCIACAO|FECHADA|DESCARTADA
  acessos        INTEGER NOT NULL DEFAULT 0,
  criada_em      TEXT NOT NULL DEFAULT (datetime('now')),
  enviada_em     TEXT,
  primeiro_acesso TEXT,
  ultimo_acesso  TEXT,
  feedback       TEXT,
  observacoes    TEXT,
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_demo_lead ON demos(lead_id, status);

-- Vendas e pagamentos - spec 71
CREATE TABLE IF NOT EXISTS sales (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id        INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  demo_id        INTEGER REFERENCES demos(id) ON DELETE SET NULL,
  campaign_id    INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
  descricao      TEXT,
  valor          REAL NOT NULL DEFAULT 0,
  forma_pagamento TEXT,
  status         TEXT NOT NULL DEFAULT 'PENDENTE', -- PENDENTE|PARCIAL|PAGO|ATRASADO|CANCELADO
  data_venda     TEXT NOT NULL DEFAULT (datetime('now')),
  observacoes    TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_sale_lead ON sales(lead_id);

CREATE TABLE IF NOT EXISTS payments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id        INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  valor          REAL NOT NULL DEFAULT 0,
  data_prevista  TEXT,
  data_pagamento TEXT,
  status         TEXT NOT NULL DEFAULT 'PENDENTE', -- PENDENTE|PAGO|ATRASADO|CANCELADO
  forma          TEXT,
  observacoes    TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_pay_sale ON payments(sale_id, status);

-- Timeline unificada do lead - spec 76
CREATE TABLE IF NOT EXISTS activities (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id     INTEGER REFERENCES leads(id) ON DELETE CASCADE,
  tipo        TEXT NOT NULL,
  titulo      TEXT NOT NULL,
  descricao   TEXT,
  icone       TEXT,
  meta        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_act_lead ON activities(lead_id, created_at);
CREATE INDEX IF NOT EXISTS ix_act_tipo ON activities(tipo, created_at);

-- Central de notificacoes - spec 75
CREATE TABLE IF NOT EXISTS notifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo        TEXT NOT NULL,
  titulo      TEXT NOT NULL,
  texto       TEXT,
  lead_id     INTEGER REFERENCES leads(id) ON DELETE CASCADE,
  rota        TEXT,
  lida        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_notif_lida ON notifications(lida, created_at);
