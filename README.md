# WhatsApp Sticker Bot

Bot local de WhatsApp que usa QR Code para conectar sua própria conta e criar figurinhas 1:1 a partir de imagens, GIFs e vídeos.

## Requisitos

- Node.js 18+
- ffmpeg e ffprobe no PATH

No Windows:

```bash
winget install FFmpeg
```

## Rodar

```bash
node index.js
```

Depois abra:

```text
http://localhost:3000
```

No celular, vá em **WhatsApp > Dispositivos conectados > Vincular dispositivo** e escaneie o QR Code.

## Comandos

- `.menu` — mostra os comandos.
- `.fig` — cria figurinha da imagem/vídeo/GIF.
- `.sticker` — alias de `.fig`.

## Formas de usar

1. Envie uma imagem/vídeo/GIF com legenda `.fig`.
2. Responda uma imagem/vídeo/GIF com `.fig`.
3. Envie uma mídia e depois mande `.fig` em até 5 minutos.

O bot também aceita comandos enviados pelo próprio número conectado, para facilitar teste consigo mesmo.

## Conversão

- Imagens viram WebP 512×512.
- Vídeos/GIFs viram WebP animado quadrado.
- Se o vídeo ficar pesado, o bot tenta cortar duração, reduzir FPS, qualidade e tamanho até caber.
- Limite alvo: 500 KB.

## Estrutura

```text
index.js
config.js
lib/
  bot.js
  logger.js
  server.js
  stickerConverter.js
session/
logs/
test.js
```

## Testes

```bash
node test.js
```

Se o ambiente bloquear ffmpeg, o teste de vídeo é pulado, mas o bot ainda exige ffmpeg para rodar.

## Problemas comuns

| Problema | Solução |
| --- | --- |
| Porta 3000 em uso | Feche outro `node.exe` ou rode `taskkill /F /IM node.exe` |
| QR não aparece | Abra `http://localhost:3000` |
| Sessão quebrada/Bad MAC | Pare o bot, apague `session/`, rode de novo e escaneie o QR |
| Vídeo não vira sticker | Use vídeo menor/mais curto ou confira se ffmpeg está instalado |

## Aviso

Use para fins pessoais. Evite spam ou automação em massa para não arriscar bloqueio da conta.
