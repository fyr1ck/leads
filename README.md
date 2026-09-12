# Henvix Sales Panel

Plataforma comercial local: prospecção + CRM + WhatsApp + IA + demonstrações + follow-up + campanhas + reativação + financeiro + analytics.

Importa a planilha de leads, conecta o WhatsApp por QR Code, dispara a primeira
mensagem personalizada com a Skill de Vendas da Henvix, **analisa** as respostas
com a Groq, classifica cada lead com etiqueta e potencial de fechamento — e
coloca no topo quem está mais perto de comprar.

> **Regra de ouro:** o sistema **nunca** responde um cliente automaticamente.
> A IA analisa → classifica → sugere. Você decide → envia.

---

## 1. Arquitetura

```
leads/
├── server/                       # backend local (Node + Express + Socket.IO)
│   ├── index.js                  # boot, banner do terminal, encerramento seguro
│   ├── config.js                 # .env, caminhos, trava da resposta automática
│   ├── db/                       # SQLite nativo (node:sqlite) + schema.sql
│   ├── domain/classificacao.js   # etiquetas, prioridades, pipeline, potencial
│   ├── repositories/             # leads, mensagens, campanhas, histórico, tags...
│   ├── services/
│   │   ├── whatsapp/             # WhatsAppService (fachada) + BaileysProvider + SessionStore
│   │   ├── ai/                   # AIService, GroqClient, skillLoader, prompts
│   │   ├── MessageService.js     # ÚNICO ponto de envio do sistema
│   │   ├── InboundHandler.js     # resposta recebida → análise → etiqueta (nunca responde)
│   │   ├── CampaignRunner.js     # fila, delay aleatório, pausas, travas de segurança
│   │   ├── prospect/             # Encontrar Leads: PlacesProvider + LeadFinderService
│   │   ├── ScoreService.js       # score 0-100 com justificativa auditável
│   │   ├── FollowUpService.js    # +1/+3/+7 dias: IA prepara, você confirma
│   │   ├── DemoService.js        # demonstrações: criada → enviada → acessada
│   │   ├── SalesService.js       # vendas, parcelas e recebimentos
│   │   ├── ReactivationService.js# oportunidades que esfriaram
│   │   ├── ActivityService.js    # timeline do lead + notificações
│   │   ├── ImportService.js      # XLSX → leads (mapeamento + deduplicação)
│   │   ├── ExportService.js      # leads restantes / histórico / CRM
│   │   └── StatsService.js       # números do dashboard (sempre do banco real)
│   ├── routes/                   # API REST em /api
│   ├── realtime/                 # bus de eventos + ponte socket.io
│   └── utils/                    # telefone, saudação dinâmica, delay, logger, erros
├── client/                       # painel (React + Vite, CSS próprio)
│   └── src/{pages,components,styles,lib,state}
├── skills/Skill_Henvix_atualizada.md   # Skill de Vendas (system prompt da IA)
├── tests/fluxo.test.js           # teste ponta a ponta com WhatsApp falso
└── data/                         # banco, sessão do WhatsApp, uploads (gitignored)
```

**Camadas:** o painel só fala com o backend local; o backend só fala com a Groq e
com o WhatsApp. Nenhuma chave de API chega ao navegador.

**WhatsApp trocável:** toda dependência da biblioteca vive em
`server/services/whatsapp/BaileysProvider.js`. Para trocar de biblioteca, basta
escrever outro provider com os mesmos métodos (`iniciar`, `encerrar`,
`enviarTexto`, `existeNoWhatsApp`) e eventos (`status`, `qr`, `mensagem`) e
chamar `whatsapp.trocarProvider(novo)` — o painel não muda.

---

## 2. Como iniciar

```bash
npm install
npm install --prefix client
cp .env.example .env
npm run dev
```

Depois abra **http://localhost:3000**.

| Serviço  | Endereço                |
| -------- | ----------------------- |
| Painel   | http://localhost:3000   |
| API      | http://localhost:3001   |
| Banco    | `data/henvix.db` (local) |

O terminal mostra o estado de tudo ao subir:

```
╔══════════════════════════════════════════════╗
║              HENVIX SALES PANEL              ║
╠══════════════════════════════════════════════╣
║  Painel:     http://localhost:3000           ║
║  API:        http://localhost:3001           ║
║  Database:   ONLINE (0 leads)                ║
║  Groq:       CONNECTED                       ║
║  WhatsApp:   DISCONNECTED                    ║
║  Skill:      CARREGADA                       ║
║  Resp. auto: DESATIVADA (por design)         ║
╚══════════════════════════════════════════════╝
```

Outros comandos:

```bash
npm test                  # teste ponta a ponta (não precisa de internet nem WhatsApp)
npm run build             # compila o painel para produção
npm start                 # roda tudo em uma porta só (backend serve o painel)
npm run db:reset -- --sim # apaga o banco local e recria o schema
```

Requisito: **Node 22.5+** (o projeto usa o SQLite nativo do Node, sem módulo
nativo para compilar). Testado no Node 24 / Windows 11.

---

## 3. Variáveis de ambiente (`.env`)

| Variável | Para quê |
| --- | --- |
| `PORT` | porta da API local (padrão 3001) |
| `WEB_PORT` | porta do painel (padrão 3000) |
| `DATABASE_URL` | arquivo do banco local (`file:./data/henvix.db`) |
| `GROQ_API_KEY` | chave da Groq — **fica só no backend** |
| `GROQ_MODEL` | modelo que escreve a mensagem (padrão `openai/gpt-oss-120b`) |
| `GROQ_MODEL_ANALISE` | modelo que classifica as respostas (padrão `openai/gpt-oss-20b`) |
| `GROQ_TEMPERATURE` | criatividade da geração de mensagem |
| `HENVIX_SKILL_PATH` | caminho do arquivo da Skill de Vendas |
| `WA_SESSION_DIR` | pasta da sessão do WhatsApp (sessão persistente) |
| `WA_DEVICE_NAME` | nome exibido em "Aparelhos conectados" |
| `LIMITE_DIARIO` | teto de mensagens por dia (0 = sem limite) |
| `DELAY_MIN` / `DELAY_MAX` | faixa do intervalo aleatório entre mensagens |
| `BLOCO_TAMANHO` / `BLOCO_PAUSA_MINUTOS` | pausa a cada N mensagens |
| `MAX_ERROS_CONSECUTIVOS` | erros seguidos que pausam a campanha |
| `LINK_DEMONSTRACAO` | link do modelo pronto (vazio = a IA não envia link) |

O `.env` está no `.gitignore`. Nunca comite a chave.

---

## 4. Configurar a Groq

1. Pegue a chave em <https://console.groq.com/keys>.
2. Coloque no `.env`: `GROQ_API_KEY=gsk_...`
3. Reinicie (`npm run dev`). O banner deve mostrar `Groq: CONNECTED`, e em
   **Configurações → Inteligência artificial** aparece o status e o modelo.

**Confira se os modelos existem na sua conta.** Nem toda conta tem os mesmos
modelos. Para listar os seus:

```bash
curl -s https://api.groq.com/openai/v1/models -H "Authorization: Bearer $GROQ_API_KEY"
```

Se algum não existir, o painel avisa em Configurações com o nome exato do modelo
que faltou — é só trocar `GROQ_MODEL` / `GROQ_MODEL_ANALISE` no `.env`.

São dois modelos de propósito: escrever a mensagem e classificar a resposta são
tarefas diferentes, e o limite de tokens por minuto da Groq é **por modelo** —
separar os dois dobra a folga de quem está no plano gratuito.

**Sobre o plano gratuito:** a Skill inteira vai em toda requisição (~3.500
tokens), e o free tier costuma liberar 8.000 tokens por minuto. Na prática cabem
~2 chamadas por minuto por modelo — o que combina com o ritmo recomendado de
envio (30–90s entre leads). Quando o limite estoura, o sistema lê o tempo de
espera que a própria Groq devolve e aguarda exatamente isso, sem perder o lead.
Para rodar mais rápido, o caminho é o Dev Tier da Groq.

Sem chave o painel continua funcionando: a primeira mensagem usa a **abordagem
padrão da própria Skill** e a classificação das respostas cai num classificador
local por palavras-chave (marcado como `HEURISTICA` no painel).

---

## 5. Conectar o WhatsApp

1. Menu **WhatsApp** → **Conectar**.
2. O QR Code aparece no painel (em tempo real, via WebSocket).
3. No celular: WhatsApp → **Aparelhos conectados** → **Conectar um aparelho**.
4. O painel muda para 🟢 conectado e mostra o número.

A sessão fica salva em `data/wa-session`: ao reiniciar o computador não pede QR
de novo. **Desconectar** apaga a sessão e exige novo QR.

---

## 6. Importar a planilha XLSX

Menu **Importar XLSX** → arraste o arquivo (ou clique para escolher).

O sistema lê o cabeçalho e mapeia as colunas sozinho, mesmo com nomes
diferentes (`Nome`, `Estabelecimento`, `Empresa`, `Telefone`, `WhatsApp`,
`Google Maps`, `Link`, `Endereço`, `Cidade`, `Instagram`, `Categoria`, `Site`…).
Quando o cabeçalho não ajuda, ele olha os **valores** da coluna — uma coluna
chamada só "Link" cheia de URLs do Google Maps é reconhecida como Google Maps.

- Colunas que não existem simplesmente ficam vazias. **Nada é inventado.**
- Colunas desconhecidas são guardadas como "dados extras" do lead.
- Duplicidade: **telefone** é a chave principal; sem telefone, usa
  **nome + endereço**. Lead repetido não é criado de novo — se a linha nova
  tiver algum campo que faltava, ela só completa o lead existente.

Você vê o mapeamento detectado **antes** de confirmar a importação.

---

## 7. Iniciar uma campanha

Menu **Prospecção**:

1. Escolha **quantos leads chamar hoje** (ex.: 50).
2. Filtre por cidade, categoria ou "somente quem não tem site".
3. Ajuste o ritmo: delay mínimo/máximo e pausa a cada N mensagens.
4. **🚀 INICIAR PROSPECÇÃO**.

Durante a campanha o painel mostra, em tempo real: progresso `23/50`, lead
atual, contagem regressiva do próximo envio, enviadas, aguardando, respostas,
interessados, erros e ignorados — com **PAUSAR / CONTINUAR / PARAR**.

Travas de segurança:

- intervalo **aleatório** dentro da faixa (nunca fixo);
- pausa longa a cada bloco de mensagens;
- limite diário configurável;
- **pausa automática** se o WhatsApp cair, se a sessão expirar ou se houver
  erros consecutivos de envio;
- fila persistente no banco: reiniciar o servidor não perde a fila (a campanha
  volta como PAUSADA, nunca sozinha);
- **nunca envia duas vezes para o mesmo telefone** — antes de cada envio o
  sistema consulta o histórico permanente.

---

## 8. Quando o cliente responde

```
CLIENTE RESPONDE → SISTEMA DETECTA → GROQ ANALISA → ETIQUETA
→ SUGESTÃO DE RESPOSTA → OPERADOR VISUALIZA → OPERADOR DECIDE SE ENVIA
```

A IA devolve um JSON estruturado (etiqueta, confiança, motivo, potencial de 0 a
100, próxima etapa e sugestão de resposta). O sistema salva tudo, aplica a
etiqueta e avisa no painel. **A sugestão não é enviada.** Ela aparece na
conversa e na Central de Oportunidades com os botões **Copiar** e **Editar**.

Em **Configurações**, "Resposta automática" aparece desativada e **travada** —
não existe caminho no código que envie a sugestão sozinho, e a API recusa
qualquer tentativa de ligar essa opção.

---

## 9. Central de Oportunidades

A área prioritária do CRM: responde "quem eu devo chamar agora para ter mais
chance de fechar".

- ordena por prioridade da IA → potencial → resposta mais recente;
- contadores de quentes / acompanhamento / aguardando / sem interesse;
- card com etiqueta, cidade, categoria, última mensagem, horário, confiança da
  IA, potencial (0–100) e o motivo da classificação;
- ações rápidas: abrir conversa, Google Maps, copiar sugestão, alterar
  etiqueta, marcar como fechado, adiar;
- visão **Pipeline** (Kanban) com as etapas Novos → Responderam → Interessados →
  Demonstração → Negociação → Fechamento → Cliente, arrastando o card.

Contexto acima de palavra solta: "já tenho site, mas está bem antigo" vira
oportunidade; "agora estou sem tempo, mas pode mandar" vira acompanhamento — não
"não interessado".

---

## 10. Prospecção x CRM

- **Lista de prospecção** = quem ainda não foi trabalhado.
- **CRM** = todo mundo que já foi importado, contatado ou respondeu.

Ao contatar, o lead sai da lista de prospecção e continua no CRM. Em
**Leads → Limpar lista de prospecção** você tira da fila todos os já
trabalhados sem apagar nada.

Exportações (sempre preservando **nome do estabelecimento** e **Google Maps**):

- `Exportar leads restantes` — quem ainda falta chamar;
- `Exportar histórico` — todo contato, mensagem, resposta e etiqueta;
- `Exportar CRM` — a base completa com etiqueta, potencial e etapa.

---

## 11. API interna

| Método | Rota | Para quê |
| --- | --- | --- |
| POST | `/api/leads/import` | importa a planilha |
| POST | `/api/leads/import/analisar` | prévia do mapeamento de colunas |
| GET | `/api/leads` | lista com filtros e ordenação |
| GET | `/api/leads/:id` | ficha + mensagens + histórico + análises |
| GET | `/api/leads/disponiveis` | quem entraria na próxima prospecção |
| POST | `/api/leads/:id/mensagem` | envio **manual** do operador |
| POST | `/api/leads/:id/etiqueta` · `/pipeline` · `/fechar` · `/adiar` | ações do CRM |
| POST | `/api/leads/limpar-prospeccao` | tira os contatados da fila |
| GET/POST | `/api/campaigns` | lista / cria campanha |
| POST | `/api/campaigns/:id/start` · `pause` · `resume` · `stop` | controles |
| GET | `/api/conversations` · `/:leadId` · `/responderam` | inbox |
| GET | `/api/opportunities` · `/contadores` · `/pipeline` | Central de Oportunidades |
| POST | `/api/ai/generate` · `/analyze` · `/suggest` | IA (sempre sem enviar nada) |
| GET | `/api/whatsapp/status` · POST `/connect` `/reconnect` `/disconnect` | sessão |
| GET | `/api/stats` · `/stats/graficos` · `/messages` · `/logs` · `/historico` | dados do painel |
| GET/PUT | `/api/settings` | configurações de operação |
| GET | `/api/export/restantes` · `/historico` · `/crm` | XLSX |
| GET | `/api/health` | saúde de banco, WhatsApp, Groq e Skill |

Eventos em tempo real (Socket.IO): `whatsapp:status`, `whatsapp:qr`,
`campanha:progresso`, `campanha:status`, `mensagem:enviada`,
`mensagem:recebida`, `analise:pronta`, `lead:atualizado`, `stats:atualizado`,
`alerta`, `log`.

---

## 12. Testes

```bash
npm test
```

`tests/fluxo.test.js` sobe o sistema com um **provider de WhatsApp falso** e
verifica: saudação dinâmica, normalização de telefone, deduplicação por telefone
e por nome+endereço, enriquecimento sem duplicar, fila de campanha com envio e
delay, bloqueio de reenvio para o mesmo telefone, pausa automática quando a
conexão cai, preservação do histórico após limpar a prospecção e — o mais
importante — que **uma resposta do cliente nunca gera envio automático**.

---

## 13. Encontrar Leads (busca automática)

Menu **🔎 Encontrar Leads**: escolha nicho e cidade, e o sistema traz
estabelecimentos reais da região — priorizando quem **não tem site próprio**.

```
Nicho: Barbearias   Cidade: Ribeirão Preto - SP   Raio: 10 km
Filtro: ☑ Somente sem site
```

- **Fonte:** Google Places API (New), oficial. Não há scraping, bypass de
  CAPTCHA, evasão de bloqueio nem leitura de área privada.
- **Classificação do site:** 🟢 não identificado · 🟡 identificado · 🟠 verificar
  manualmente. Instagram, Facebook e linktree **não contam como site próprio**;
  agregadores (iFood, Doctoralia, marketplaces) caem em "verificar".
- **Nada é inventado:** o que a fonte não devolve fica vazio.
- **Seleção múltipla** com resumo (`18 adicionados · 2 duplicados · 0 erros`).
- **Deduplicação em 5 níveis:** identificador da fonte → telefone → domínio do
  site → Google Maps → nome + endereço. O card avisa quando o lead já está no
  CRM, com status, score e último contato.
- **Pesquisas salvas:** executar de novo, duplicar, excluir.
- **Exportação XLSX** dos resultados — sempre um arquivo novo; a planilha
  original de prospecção nunca é sobrescrita.

Para ativar, no `.env`:

```
GOOGLE_MAPS_API_KEY=sua_chave
```

A chave precisa de **Places API (New)** e **Geocoding API** habilitadas no
Google Cloud (é uma API paga, com cota gratuita mensal). Sem ela a página
explica o passo a passo e o restante do painel funciona normalmente.

---

## 14. Score do lead (0–100)

Cada ponto vem de um sinal real gravado no banco, com justificativa visível:

```
Score: 69/100
+35 Perguntou o preço
+15 Respondeu o contato
 +5 Site próprio não identificado
 +4 Manteve a conversa (2 mensagens)
```

Positivos: respondeu, pediu informações/preço/demonstração, acessou a demo, deu
feedback, negociação, venda. Negativos: contatado sem resposta, recusou, demo
enviada e não acessada, dias sem interação, sem telefone.

A leitura da IA entra como **um** dos sinais (peso limitado), não como palavra
final — dá para discordar com base em fato.

Temperatura: 🔥 90–100 · 🟠 70–89 · 🟡 40–69 · 🔴 0–39.

---

## 15. Copiloto de vendas

Dentro da conversa, o Copiloto lê o histórico **e a memória do lead** (demos
enviadas/acessadas, feedbacks, análises anteriores, follow-ups, venda):

```
Resumo        Cliente pediu preço e quer discutir com sócio
Intenção      obter preço
Objeção       precisa ver com sócio
Próxima ação  Enviar proposta detalhada com valores e opções
Resposta sugerida   [ Copiar ]  [ Usar no campo ]     🛡 não enviada
```

Os botões só copiam ou preenchem o campo. O envio continua exigindo seu clique
em **Enviar**.

---

## 16. Follow-up

Sequência **+1, +3 e +7 dias**, agendada quando a prospecção envia a primeira
mensagem (configurável em `followup_dias`).

```
IA prepara → você revisa → você confirma → envia
```

Status: `PENDENTE → PREPARADO → AGUARDANDO_CONFIRMACAO → ENVIADO` (ou
`CANCELADO`). Quando o cliente responde, os follow-ups pendentes dele são
cancelados sozinhos — ninguém recebe cobrança depois de responder.

O Dashboard mostra **🔥 Próximas ações**: quem respondeu e não foi atendido,
follow-ups vencidos e oportunidades quentes paradas há mais de 2 dias.

---

## 17. Demonstrações

Pipeline próprio: **sem demo → criada → enviada → acessada → feedback →
negociação → fechada**. A criação já vem preenchida com os dados do lead (nome,
nicho, cidade, Maps, Instagram, telefone) — não existe segundo cadastro de
estabelecimento.

Cada evento alimenta o score e a timeline; demo acessada gera notificação.

---

## 18. Reativação

Separa por grupo quem esfriou: interessados que pararam de responder, quem
perguntou preço e sumiu, demonstrações sem desfecho, negociações paradas e
contatados que nunca responderam.

Você seleciona quem entra e o sistema monta uma **campanha de reativação**.
Essa é a **única** exceção à trava de não repetir lead, e existe porque foi você
quem escolheu cada um. Campanha comum continua ignorando quem já foi contatado
— comportamento coberto por teste automatizado.

---

## 19. Vendas e financeiro

Registrar a venda fecha o lead (status e etapa `FECHADO`), cria as parcelas e
alimenta faturamento, recebido, pendente, ticket médio e número de vendas.
Parcela prevista é **quitada**, não duplicada.

---

## 20. Timeline e notificações

A ficha do lead mostra a linha do tempo completa:

```
🔎 Lead encontrado na busca      💬 Cliente respondeu
📅 Lead importado da planilha    🔥 Score alterado para 82
📤 Mensagem enviada              🌐 Demonstração criada
🏷️ Etiqueta aplicada             🔗 Demonstração enviada
⏰ Follow-up agendado            👀 Demonstração acessada
💰 Venda registrada              💳 Pagamento registrado
```

O sino da barra superior guarda as notificações (lead quente, resposta, demo
acessada, venda, leads adicionados) até você lê-las.

---

## 21. Skill Henvix editável

Menu **📝 Skill Henvix**, em duas abas:

- **Configuração comercial** — tom, serviços, **preços autorizados**, prazo,
  formas de pagamento, objeções, argumentos, FAQ, abordagens, follow-up e regras
  extras. Esse bloco entra no system prompt junto com a Skill.
- **Arquivo da Skill** — edita o `.md` direto no painel, com backup automático
  em `skills/backups/`.

Campo de preços vazio = a IA **não fala valores**. Preenchido = ela cita
exatamente aqueles, e nenhum outro.

---

## 22. Endpoints da v2

| Método | Rota | Para quê |
| --- | --- | --- |
| GET | `/api/prospect/status` · `/nichos` | fonte de dados e catálogo de nichos |
| POST | `/api/prospect/buscar` | busca por nicho + localização |
| POST | `/api/prospect/adicionar` · `/adicionar-varios` | joga no CRM |
| GET/POST/DELETE | `/api/prospect/pesquisas...` | pesquisas salvas |
| GET | `/api/prospect/pesquisas/:id/export` | XLSX dos resultados |
| GET/POST | `/api/followups` · `/proximas-acoes` · `/vencidos` | follow-up |
| POST | `/api/followups/:id/preparar` · `/enviar` · `/cancelar` | IA prepara / você envia |
| GET/POST | `/api/demos` · `/preparar/:leadId` · `/:id/enviada` · `/acesso` · `/feedback` | demonstrações |
| GET/POST | `/api/sales` · `/:id/pagamentos` · `/pagamentos/:id/quitar` | vendas e parcelas |
| GET/POST | `/api/reactivation` · `/campanha` | reativação |
| GET/PUT | `/api/skill` | Skill + configuração comercial |
| POST | `/api/ai/copiloto` | copiloto de vendas |
| GET | `/api/activities` · `/notifications` · `/reports` | timeline, sino e relatórios |
