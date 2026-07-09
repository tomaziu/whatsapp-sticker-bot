# WhatsApp Sticker Bot

Bot de WhatsApp que converte imagens e GIFs/vídeos em figurinhas (stickers) usando apenas ferramentas gratuitas e conversão local.

## Pré-requisitos

- **Node.js** >= 18.0.0
- **ffmpeg** e **ffprobe** instalados e no PATH do sistema

### Instalando o ffmpeg

| Sistema | Comando |
|---------|---------|
| Windows | `winget install FFmpeg` ou baixe em https://ffmpeg.org |
| macOS | `brew install ffmpeg` |
| Linux | `sudo apt install ffmpeg` |

## Instalação

```bash
cd whatsapp-sticker-bot
npm install
```

## Como rodar

```bash
npm start
```

1. Abra **http://localhost:3000** no navegador
2. No celular: WhatsApp > Dispositivos conectados > Vincular dispositivo
3. Escaneie o QR Code que aparece no navegador
4. Pronto! O bot está online

## Como usar

Envie uma **imagem**, **GIF** ou **vídeo curto** com a legenda `.fig` ou `.sticker`.

O bot converte e envia a figurinha de volta automaticamente.

### Limites

| Parâmetro | Valor |
|-----------|-------|
| Tamanho máximo | 500 KB |
| Resolução | 512×512 px |
| Duração máxima (vídeo) | 10 segundos |
| FPS padrão | 15 fps |

---

## Hospedagem gratuita 24h

### Opção 1: Oracle Cloud (recomendado — grátis pra sempre)

1. Crie conta gratuita em [cloud.oracle.com](https://cloud.oracle.com)
2. Crie uma instância **Always Free** (Ubuntu 22.04, 1GB RAM)
3. Conecte via SSH no servidor
4. Execute o script de deploy:

```bash
# No seu PC, copie os arquivos para o servidor:
scp -r ./* ubuntu@SEU_IP:/home/ubuntu/whatsapp-sticker-bot/

# No servidor via SSH:
cd /home/ubuntu/whatsapp-sticker-bot
chmod +x deploy-oracle.sh
./deploy-oracle.sh
```

5. Libere a porta 3000 no firewall do Oracle Cloud
6. Acesse `http://SEU_IP:3000` para escanear o QR

**Comandos úteis (no servidor):**
```bash
pm2 status              # Ver status
pm2 logs sticker-bot    # Ver logs
pm2 restart sticker-bot # Reiniciar
```

### Opção 2: Render (mais fácil)

1. Faça push do projeto num repositório GitHub
2. Crie conta em [render.com](https://render.com)
3. New → Background Worker → Connect GitHub repo
4. Configure:
   - Build Command: `npm install`
   - Start Command: `node index.js`
5. Clique em Deploy

⚠️ O Render dorme após 15 min sem uso no free tier.

### Opção 3: Docker (qualquer VPS)

```bash
# Build e rodar
docker-compose up -d

# Ver logs
docker-compose logs -f

# Parar
docker-compose down
```

---

## Estrutura do projeto

```
whatsapp-sticker-bot/
├── index.js               # Ponto de entrada
├── config.js              # Configurações
├── lib/
│   └── stickerConverter.js # Conversores de mídia
├── session/               # Dados de autenticação
├── Dockerfile             # Para deploy com Docker
├── docker-compose.yml     # Docker Compose
├── deploy-oracle.sh       # Script de deploy Oracle Cloud
├── render.yaml            # Config Render
├── package.json
└── README.md
```

## Personalização

Edite `config.js`:

- **Comando**: troque `.fig` / `.sticker`
- **Limites**: tamanho, resolução, duração, FPS
- **Porta do QR**: `qrServerPort` (padrão: 3000)

## Solução de problemas

| Problema | Solução |
|----------|---------|
| `ffmpeg não encontrado` | Instale o ffmpeg |
| QR Code não aparece | Acesse http://localhost:3000 |
| `EADDRINUSE` | Mata o processo antigo: `taskkill /F /IM node.exe` |
| Bot desconecta | Apague a pasta `session/` e escaneie de novo |

## Licença

Uso pessoal. Não use para spam ou envio em massa.
