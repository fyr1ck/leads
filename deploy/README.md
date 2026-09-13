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

### 1. Criar a conta

1. Acesse <https://signup.cloud.oracle.com>.
2. País **Brazil**, nome e e-mail → confirme o e-mail.
3. Crie a senha da conta Oracle e o *Cloud Account Name* (ex.: `henvix`).
4. **Home Region** — atenção, não dá para trocar depois e o Always Free só vale
   nela. Use **Brazil East (Sao Paulo)**.
5. Endereço, telefone e cartão. O cartão é só verificação de identidade (pode
   aparecer uma pré-autorização pequena que volta). Conta Always Free não cobra
   enquanto você não fizer upgrade manual para "Pay As You Go".
6. Espere o e-mail "Your account is ready" (costuma levar de 5 a 30 minutos).

### 2. Criar a VPS

No console, menu **☰ → Compute → Instances → Create instance**:

| Campo | O que escolher |
| --- | --- |
| Name | `henvix` |
| Image | *Change image* → **Canonical Ubuntu 24.04** |
| Shape | *Change shape* → **Ampere → VM.Standard.A1.Flex**, 1 OCPU e 6 GB |
| Networking | deixe *Create new virtual cloud network* e **Assign a public IPv4 address** marcado |
| Add SSH keys | **Generate a key pair for me** → clique em **Save private key** (guarde esse arquivo!) |
| Boot volume | deixe o padrão |

Clique **Create**. Quando ficar verde (*Running*), copie o **Public IP address**.

> Se aparecer **"Out of capacity"** na shape ARM: *Change shape* →
> **Specialty and previous generation → VM.Standard.E2.1.Micro** (também
> Always Free). O instalador cria swap para o build caber em 1 GB.

Procure o selo **Always Free-eligible** ao lado da shape antes de criar.

### 3. Entrar na VPS pelo Windows

O Windows 10/11 já vem com SSH. Abra o **PowerShell**:

```powershell
# o Windows recusa chave com permissao aberta - trava para so voce ler
icacls "$HOME\Downloads\ssh-key-*.key" /inheritance:r
icacls "$HOME\Downloads\ssh-key-*.key" /grant:r "$($env:USERNAME):R"

ssh -i "$HOME\Downloads\ssh-key-AAAA-MM-DD.key" ubuntu@SEU_IP
```

Troque o nome do arquivo e o IP pelos seus. Na primeira vez ele pergunta
*"Are you sure you want to continue connecting?"* → digite `yes`.

### 4. Instalar o painel

Já dentro da VPS:

```bash
sudo apt update && sudo apt install -y git
git clone https://github.com/fyr1ck/leads.git
sudo bash leads/deploy/instalar-vps.sh
```

Configure a chave da Groq e os e-mails:

```bash
sudo nano /opt/henvix/.env
# preencha GROQ_API_KEY e confira USUARIOS_PERMITIDOS
# salvar: Ctrl+O, Enter  ·  sair: Ctrl+X
```

### 5. Criar as senhas (pelo SSH)

Na VPS o painel é acessado pela internet, então **a senha do primeiro acesso não
pode ser criada pelo navegador** — senão qualquer um que chegasse na URL antes
de vocês criaria. Quem tem SSH é o dono, então é por aqui:

```bash
cd /opt/henvix
sudo -u henvix node server/scripts/definirSenha.js joao.jhcc31@gmail.com
sudo -u henvix node server/scripts/definirSenha.js castrinvini@gmail.com
```

A senha é digitada sem aparecer na tela e não fica no histórico.

### 6. Ligar

```bash
sudo systemctl start henvix
sudo journalctl -u henvix -f     # Ctrl+C sai do log (o painel continua rodando)
```

O banner com `Database: ONLINE` e `Groq: CONNECTED` significa que subiu. A partir
daqui ele liga sozinho se a VPS reiniciar e volta sozinho se cair.

### 7. Publicar com HTTPS e ler o QR

Siga **Publicar com HTTPS** logo abaixo, abra o endereço, entre com a senha e
leia o QR Code do WhatsApp.

> ⚠️ **Desligue o painel do seu PC antes.** Dois servidores com o mesmo
> WhatsApp se derrubam em looping (erro 440).

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
# VPS ARM (A1.Flex): cloudflared-linux-arm64  ·  VPS AMD/Intel: cloudflared-linux-amd64
ARQ=$(dpkg --print-architecture)   # arm64 ou amd64
curl -L "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-$ARQ" -o cloudflared
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
3. **Senha forte e individual.** Exposto na internet, o login é a única barreira
   entre o mundo e o seu WhatsApp + base de clientes. Para trocar, na VPS:
   ```bash
   cd /opt/henvix && sudo -u henvix node server/scripts/definirSenha.js seu@email.com
   ```
4. **Uma instância só.** Duas brigam pela mesma sessão do WhatsApp (erro 440) e
   se derrubam em looping.
5. Faça backup de `data/` — ali estão o banco e a sessão do WhatsApp.

---

## Atualizar depois de um push no GitHub

```bash
cd /opt/henvix
sudo -u henvix -H git pull
sudo -u henvix -H npm install --omit=dev
sudo -u henvix -H npm install --prefix client
sudo -u henvix -H npm run build
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
