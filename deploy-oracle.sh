#!/bin/bash
# ============================================================
# Script de deploy para Oracle Cloud (Ubuntu 22.04/24.04)
# Execute no servidor VPS via SSH
# ============================================================

set -e

echo "=== WhatsApp Sticker Bot — Deploy Oracle Cloud ==="

# 1. Atualiza sistema e instala dependências
echo "[1/6] Atualizando sistema..."
sudo apt-get update && sudo apt-get upgrade -y

echo "[2/6] Instalando Node.js 20.x e ffmpeg..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs ffmpeg git

# Verifica instalação
node --version
ffmpeg -version

# 2. Clona ou cria o projeto
echo "[3/6] Preparando projeto..."
cd /home/ubuntu

if [ ! -d "whatsapp-sticker-bot" ]; then
  mkdir -p whatsapp-sticker-bot
fi

cd whatsapp-sticker-bot

# Se não tiver package.json, copia do diretório atual
if [ ! -f "package.json" ]; then
  echo "Copie os arquivos do bot para /home/ubuntu/whatsapp-sticker-bot/"
  echo "Exemplo: scp -r C:\Users\teste123\Desktop\bot\* ubuntu@SEU_IP:/home/ubuntu/whatsapp-sticker-bot/"
  exit 1
fi

echo "[4/6] Instalando dependências do bot..."
npm install --production

# 3. Instala PM2 para manter rodando 24h
echo "[5/6] Instalando PM2..."
sudo npm install -g pm2

# Para o bot se já estiver rodando
pm2 stop sticker-bot 2>/dev/null || true

# Inicia com PM2
echo "[6/6] Iniciando bot com PM2..."
pm2 start index.js --name sticker-bot

# Configura para iniciar com o servidor
pm2 startup
pm2 save

echo ""
echo "=== Deploy concluído! ==="
echo ""
echo "Comandos úteis:"
echo "  pm2 status          — Ver status do bot"
echo "  pm2 logs sticker-bot — Ver logs em tempo real"
echo "  pm2 restart sticker-bot — Reiniciar o bot"
echo "  pm2 stop sticker-bot    — Parar o bot"
echo ""
echo "Para escanear o QR Code, acesse: http://SEU_IP:3000"
echo "(Libere a porta 3000 no firewall do Oracle Cloud)"
