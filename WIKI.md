# Wiki Pública do Sticker Bot

Manual dos comandos que usuários normais podem usar no bot.

## Como Começar

Use:

```txt
.menu
```

O bot mostra todos os comandos principais. Em grupos, algumas funções só funcionam depois que o ranking for ativado com:

```txt
.iniciarrank
```

## Comandos Gerais

| Comando | O que faz |
| --- | --- |
| `.menu` | Mostra o menu do bot. |
| `.perfil` | Mostra seus pontos, level, tag, tema e informações. |
| `.ia <texto>` | Faz uma pergunta para a IA do bot. |

## Figurinhas

| Comando | O que faz |
| --- | --- |
| `.fig` | Cria figurinha de imagem, vídeo ou GIF. |
| `.sticker` | Atalho alternativo para `.fig`. |
| `.figcrop` | Recorta imagem/vídeo/GIF em 1:1 e cria figurinha. |
| `.roubar` | Troca os dados de uma figurinha respondida. |
| `.figpin <link...>` | Cria figurinha usando link do Pinterest. |
| `.figpp @usuário` | Tenta transformar a foto de perfil de alguém em figurinha. |
| `.figtxt <texto>` | Cria figurinha de texto. |
| `.figtxt rgb <texto>` | Cria figurinha animada de texto colorido sem fundo. |
| `.toimg` | Transforma figurinha respondida em imagem. |

### Como Usar `.fig`

Você pode:

- Enviar imagem/vídeo/GIF com legenda `.fig`.
- Responder uma mídia com `.fig`.
- Enviar uma mídia e depois mandar `.fig`.

### Como Usar `.figcrop`

Use quando quiser que o bot recorte a mídia para ficar quadrada em 1:1.

## Áudio

Use respondendo um áudio ou depois de enviar um áudio recente.

| Comando | O que faz |
| --- | --- |
| `.vozgrave` | Deixa o áudio com voz grave. |
| `.vozfina` | Deixa o áudio com voz fina. |
| `.veloz` | Acelera o áudio. |
| `.lento` | Deixa o áudio lento. |

## Downloads

| Comando | O que faz |
| --- | --- |
| `.tiktok <link>` | Baixa vídeo do TikTok. |
| `.tiktok audio <link>` | Baixa apenas o áudio do TikTok. |
| `.insta <link>` | Baixa vídeo/Reel do Instagram. |
| `.insta audio <link>` | Baixa apenas o áudio do Instagram. |

Limites:

- Vídeos muito longos podem ser recusados.
- O bot baixa um vídeo por vez.
- Se outra pessoa já estiver baixando, tente novamente em alguns segundos.

## Promoções Xbox

| Comando | O que faz |
| --- | --- |
| `.xboxpromo` | Mostra até 20 jogos Xbox em promoção. |

## Ranking

O ranking funciona por grupo. Um grupo não mistura pontos com outro, mas existe também o ranking global.

| Comando | O que faz |
| --- | --- |
| `.iniciarrank` | Ativa o ranking no grupo. |
| `.rank` | Mostra o ranking do grupo. |
| `.rank me` | Mostra sua posição no grupo. |
| `.meurank` | Atalho para ver sua posição. |
| `.rank global` | Mostra ranking somado de todos os grupos. |

### Como Ganhar Pontos

| Atividade | Pontos |
| --- | ---: |
| Mensagem de texto | +1 |
| Figurinha | +1 |
| Imagem, vídeo ou GIF | +2 |

Regras:

- Comandos não dão pontos.
- Existe anti-spam de alguns segundos.
- Pontos também servem como dinheiro da loja.

## Level e Conquistas

| Comando | O que faz |
| --- | --- |
| `.level` | Mostra seu level e XP no grupo. |
| `.toplevel` | Mostra ranking de levels do grupo. |
| `.conquistas` | Mostra suas conquistas/medalhas. |

Você pode ganhar conquistas ao:

- Subir de level.
- Mandar mensagens.
- Enviar figurinhas.
- Enviar mídias.
- Ficar no top do rank.
- Comprar tags ou temas.
- Usar daily.

## Daily, Roleta e Resgate

| Comando | O que faz |
| --- | --- |
| `.daily` | Resgata pontos diários. |
| `.roleta` | Gira a roleta diária com GIF. |
| `.resgatar` | Tenta pegar `.daily` e `.roleta` juntos. |

### Daily

- Dá pontos uma vez por dia.
- Base: 20 pontos.
- Tags e alianças podem aumentar o valor.

### Roleta

Pode cair:

- 0 pontos.
- 5 pontos.
- 10 pontos.
- 20 pontos.
- 35 pontos.
- 50 pontos.
- 100 pontos.

### Resgate Turbo

Para usar `.resgatar`, compre o benefício:

```txt
.comprar resgate
```

Preço:

- 500 pontos.

Funcionamento:

- Se você não usou nada no dia, pega daily + roleta.
- Se já usou daily, tenta só a roleta.
- Se já usou roleta, tenta só o daily.
- Se já usou os dois, o bot avisa.

## Loja

| Comando | O que faz |
| --- | --- |
| `.loja` | Mostra tags, caixas e benefícios. |
| `.comprar <item>` | Compra uma tag, caixa ou benefício. |
| `.usartag <tag>` | Equipa uma tag no rank. |
| `.minhastags` | Mostra suas tags compradas. |
| `.removertag` | Remove a tag equipada. |
| `.perfil temas` | Mostra os temas de perfil. |

Os pontos do rank são usados como dinheiro. Ao comprar algo, seus pontos diminuem.

## Tags

Tags aparecem no ranking e podem dar bônus no `.daily`.

| ID | Tag | Preço | Bônus Daily |
| --- | --- | ---: | ---: |
| `vulto` | 🌫️ Vulto do Chat | 1.000 | +10% |
| `energia` | 🧃 Energia Duvidosa | 2.000 | +12% |
| `presenca` | 🪩 Presença Confirmada | 3.500 | +15% |
| `trovao` | ⚡ Eco do Trovão | 6.000 | +22% |
| `mutacao` | 🧬 Mutação Social | 9.000 | +28% |
| `sombra` | 🕶️ Sombra Elegante | 13.000 | +35% |
| `dragao` | 🐉 Dragão do Zap | 20.000 | +50% |
| `diamante` | 💎 Aura Diamante | 30.000 | +65% |
| `monarca` | 👑 Monarca do Caos | 45.000 | +90% |
| `entidade` | 🔥 Entidade Suprema | 70.000 | +120% |

Exemplo:

```txt
.comprar dragao
.usartag dragao
```

## Temas de Perfil

| ID | Tema | Preço |
| --- | --- | ---: |
| `neon` | 💚 Neon | 5.000 |
| `royal` | 👑 Royal | 12.000 |
| `cosmico` | 🌌 Cósmico | 25.000 |

Comandos:

```txt
.perfil temas
.perfil comprar neon
.perfil tema neon
```

## Inventário

| Comando | O que faz |
| --- | --- |
| `.inventario` | Mostra suas caixas, itens e benefícios. |

O inventário mostra:

- Caixa Misteriosa.
- Giro Extra.
- Imã de Pontos.
- Resgate Turbo.

## Caixa Misteriosa

| Comando | O que faz |
| --- | --- |
| `.caixa` | Mostra prêmios e chances. |
| `.comprar caixa` | Compra uma Caixa Misteriosa. |
| `.abrircaixa` | Abre uma Caixa Misteriosa. |

Preço:

- 300 pontos.

Limite:

- 3 caixas por dia.

### Prêmios da Caixa

| Prêmio | Chance |
| --- | ---: |
| +50 pontos | 38% |
| +200 pontos | 27% |
| +500 pontos | 16% |
| 🎰 Giro Extra x1 | 12% |
| 🧲 Imã de Pontos 2h | 6% |
| 💎 Jackpot +3000 pontos | 1% |

### Giro Extra

Permite girar `.roleta` mais uma vez se você já usou a roleta diária.

### Imã de Pontos

Durante 2 horas, mensagens pontuadas valem x2.

Exemplos:

- Texto: 1 ponto vira 2 pontos.
- Figurinha: 1 ponto vira 2 pontos.
- Imagem/vídeo/GIF: 2 pontos viram 4 pontos.

## Presente

| Comando | O que faz |
| --- | --- |
| `.presente @user <pts>` | Envia pontos para alguém. |

Regras:

- Só funciona em grupos com rank ativo.
- Mínimo: 10 pontos.
- Não dá para doar mais pontos do que você tem.
- Não dá para enviar presente para si mesmo.

Exemplo:

```txt
.presente @usuario 50
```

## Aliança

| Comando | O que faz |
| --- | --- |
| `.alianca` | Explica como funciona a aliança. |
| `.formaralianca @user` | Envia pedido de aliança. |
| `.aceitaralianca` | Aceita um pedido recebido. |
| `.recusaralianca` | Recusa um pedido recebido. |
| `.cancelaralianca` | Cancela pedido enviado. |
| `.minhaalianca` | Mostra sua aliança atual. |
| `.desfazeralianca` | Desfaz a aliança. |

Benefício:

- Cada pessoa da aliança ganha +10% no `.daily`.

Regras:

- Só funciona no grupo.
- Só a pessoa convidada pode aceitar.
- Pedido expira em 10 minutos.
- Após desfazer, existe espera para formar outra aliança.

## Sorteio

| Comando | O que faz |
| --- | --- |
| `.sorteio` | Sorteia uma pessoa do grupo. |

O bot tenta sortear apenas participantes reais do grupo.

