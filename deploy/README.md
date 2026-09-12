# Deixar o painel online 24/7 — de graça

O painel precisa de um **processo vivo o tempo todo** (sessão do WhatsApp,
campanhas de horas, Socket.IO). Isso descarta Vercel, Netlify e qualquer
plataforma serverless. Mas existe VPS **grátis de verdade** — não trial.

---

## Opção 1 — Oracle Cloud Always Free (recomendada)

Máquina virtual real, de graça **para sempre** (não é trial de 12 meses).

| Recurso | Always Free |
| --- | --- |
| ARM Ampere | até 4 vCPU + 24 GB RAM |
| ou AMD | 2 VMs micro (1 vCPU + 1 GB cada) |
| Disco | 200 GB block storage |
| Tráfego | 10 TB/mês de saída |

O que este projeto consome: ~150 MB de RAM e quase nada de CPU. Cabe folgado
até na menor máquina.

**Passo a passo**

1. Crie a conta em <https://cloud.oracle.com> (pede cartão só para validar
   identidade — a conta Always Free não cobra).
2. *Compute → Instances → Create Instance*
   - Image: **Ubuntu 24.04**
   - Shape: **VM.Standard.A1.Flex** (ARM, 1–4 OCPU) ou **VM.Standard.E2.1.Micro**
   - Marque que é **Always Free eligible**
   - Baixe a chave SSH
3. *Networking → VCN → Security List* → libere a porta **443** (e 80 se for usar
   Caddy). Não precisa abrir a 3000 se usar Cloudflare Tunnel.
4. Conecte e instale:

```bash
ssh -i sua-chave.key ubuntu@SEU_IP
sudo apt update && sudo apt install -y git
git clone https://github.com/fyr1ck/leads.git
sudo bash leads/deploy/instalar-vps.sh
sudo nano /opt/henvix/.env      # GROQ_API_KEY e USUARIOS_PERMITIDOS
sudo systemctl start henvix
sudo journalctl -u henvix -f
```

5. Publique com HTTPS (veja abaixo), abra o painel, crie a senha e leia o QR.

**Detalhes honestos:** a capacidade ARM às vezes fica esgotada na região — se
der "out of capacity", tente outra região ou use a shape AMD micro. A Oracle
pode recuperar instâncias Always Free ociosas, mas um serviço rodando 24/7
como este não é considerado ocioso.

---

## Opção 2 — Google Cloud e2-micro (Always Free)

Também gratuita para sempre, nas regiões `us-west1`, `us-central1` e
`us-east1`: 1 e2-micro + 30 GB de disco + 1 GB de saída por mês.

Mesmo roteiro: crie a VM com Ubuntu, rode o `instalar-vps.sh`, publique com
HTTPS. A máquina é mais fraca que a ARM da Oracle, mas dá conta.

⚠️ O e2-micro só é gratuito **nessas regiões dos EUA** — criar em São Paulo
gera cobrança.

---

## Publicar com HTTPS (grátis)

### Cloudflare Tunnel — mais simples, sem abrir porta

Não precisa de IP fixo, nem de porta aberta, nem de certificado. Funciona até
se o painel estiver no seu PC de casa.

```bash
# na maquina onde o painel roda
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared
sudo install cloudflared /usr/local/bin/
cloudflared tunnel login
cloudflared tunnel create henvix
cloudflared tunnel route dns henvix painel.seudominio.com
cloudflared tunnel run --url http://localhost:3000 henvix
```

Para deixar o túnel de pé junto com a máquina:

```bash
sudo cloudflared service install
```

Sem domínio próprio, `cloudflared tunnel --url http://localhost:3000` gera uma
URL `*.trycloudflare.com` na hora — ótima para testar, mas ela muda a cada
execução.

### Caddy — se preferir domínio direto na VPS

```bash
sudo apt install -y caddy
echo 'painel.seudominio.com { reverse_proxy localhost:3000 }' | sudo tee /etc/caddy/Caddyfile
sudo systemctl restart caddy
```

O Caddy tira o certificado Let's Encrypt sozinho e renova sem você mexer.

---

## Depois de publicar: obrigatório

1. `COOKIE_SEGURO=1` no `.env` (o instalador já deixa assim) — o cookie de
   sessão para de trafegar em conexão aberta.
2. `EXIGIR_LOGIN=1`, sempre.
3. **Troque a senha.** Exposto na internet, o login é a única barreira entre o
   mundo e o seu WhatsApp + base de clientes:
   ```bash
   npm run auth:reset -- seu@email.com
   ```
4. **Uma instância só.** Duas brigam pela mesma sessão do WhatsApp (erro 440) e
   se derrubam em looping.
5. Faça backup de `data/` — ali estão o banco e a sessão do WhatsApp.

---

## Atualizar depois de um push no GitHub

```bash
cd /opt/henvix
sudo -u henvix git pull
sudo -u henvix npm install --omit=dev
sudo -u henvix npm run build
sudo systemctl restart henvix
```

---

## O que NÃO funciona (e por quê)

| Plataforma | Problema |
| --- | --- |
| Vercel / Netlify | Serverless: função morre em segundos, a sessão do WhatsApp cai |
| Render free | O serviço hiberna sem tráfego e o disco é efêmero |
| Railway free | Só crédito de teste, não é gratuito contínuo |
| Replit / Glitch free | Hibernam e perdem o disco |
| Heroku free | Não existe mais |

O denominador comum: todos matam processos ociosos ou apagam o disco — e é
exatamente disso que a automação depende.
