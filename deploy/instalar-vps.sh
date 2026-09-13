#!/usr/bin/env bash
# ============================================================
#  Henvix Sales OS - instalacao em VPS Linux (Ubuntu/Debian)
#
#  Funciona igual em Oracle Cloud Always Free, Google Cloud
#  e2-micro, Hetzner, Contabo ou qualquer VPS.
#
#  Uso (na VPS, como root ou com sudo):
#    bash instalar-vps.sh
# ============================================================
set -euo pipefail

REPO="${REPO:-https://github.com/fyr1ck/leads.git}"
DESTINO="${DESTINO:-/opt/henvix}"
USUARIO="${USUARIO:-henvix}"
NODE_MAJOR=22   # o projeto usa node:sqlite: precisa de Node 22.5+

azul() { printf '\033[36m%s\033[0m\n' "$1"; }
ok()   { printf '\033[32m%s\033[0m\n' "$1"; }
erro() { printf '\033[31m%s\033[0m\n' "$1" >&2; }

[ "$(id -u)" -eq 0 ] || { erro "Rode com sudo."; exit 1; }

azul "1/6  Pacotes base"
apt-get update -qq
apt-get install -y -qq curl git ca-certificates

# Maquina de 1 GB (Oracle E2.1.Micro, Google e2-micro): o build do painel
# estoura a memoria sem swap. 2 GB de swap resolvem.
MEM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
if [ "$MEM_MB" -lt 2000 ] && ! swapon --show | grep -q .; then
  azul "     Memoria baixa (${MEM_MB} MB): criando 2 GB de swap"
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

azul "2/6  Node.js ${NODE_MAJOR}"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt "$NODE_MAJOR" ]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y -qq nodejs
fi
node -v

azul "3/6  Usuario do servico"
id -u "$USUARIO" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$USUARIO"

azul "4/6  Codigo em ${DESTINO}"
if [ -d "$DESTINO/.git" ]; then
  git -C "$DESTINO" pull --ff-only
else
  git clone --depth 1 "$REPO" "$DESTINO"
fi
cd "$DESTINO"

npm install --omit=dev --no-audit --no-fund
npm install --prefix client --no-audit --no-fund
npm run build

mkdir -p "$DESTINO/data"
chown -R "$USUARIO:$USUARIO" "$DESTINO"

azul "5/6  Configuracao"
if [ ! -f "$DESTINO/.env" ]; then
  cp "$DESTINO/.env.example" "$DESTINO/.env"
  # publicado na internet: login obrigatorio e cookie so por HTTPS
  sed -i 's/^EXIGIR_LOGIN=.*/EXIGIR_LOGIN=1/'   "$DESTINO/.env"
  sed -i 's/^COOKIE_SEGURO=.*/COOKIE_SEGURO=1/' "$DESTINO/.env"
  sed -i 's/^PORT=.*/PORT=3000/'                "$DESTINO/.env"
  chown "$USUARIO:$USUARIO" "$DESTINO/.env"
  chmod 600 "$DESTINO/.env"
  ok "   .env criado. EDITE antes de seguir:  sudo nano $DESTINO/.env"
  echo "   Preencha GROQ_API_KEY e confira USUARIOS_PERMITIDOS."
else
  ok "   .env ja existe - mantido como esta."
fi

azul "6/6  Servico systemd"
cp "$DESTINO/deploy/henvix.service" /etc/systemd/system/henvix.service
systemctl daemon-reload
systemctl enable henvix >/dev/null

ok ""
ok "Instalado."
echo
echo "  1) Edite o .env:        sudo nano $DESTINO/.env"
echo "  2) Crie as senhas:      cd $DESTINO && sudo -u $USUARIO node server/scripts/definirSenha.js seu@email.com"
echo "  3) Suba o painel:       sudo systemctl start henvix"
echo "  4) Acompanhe:           sudo journalctl -u henvix -f"
echo
echo "  O painel responde na porta 3000. Publique com HTTPS usando"
echo "  Cloudflare Tunnel (gratis) ou Caddy - veja deploy/README.md."
echo
echo "  Depois, entre no painel e leia o QR Code do WhatsApp."
