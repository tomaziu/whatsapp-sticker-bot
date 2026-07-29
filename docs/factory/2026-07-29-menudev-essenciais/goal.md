# Goal Contract — Comandos essenciais do menu dev

## Current state (≤3)
- O menu dev já controla manutenção, IA, reinício, rank, level, tags e temas.
- Não há um diagnóstico unificado, backup manual do rank, consulta detalhada da sessão ou resumo do rank.
- Ações destrutivas podem ser executadas imediatamente pelo dono.

## Desired future state (≤3)
- O dono pode consultar diagnóstico, sessão e estado do rank pelo WhatsApp.
- O dono pode criar um backup seguro do rank sem modificar o placar.
- Comandos perigosos exigem confirmação explícita antes de executar.

## Current constraint (Theory of Constraints)
Faltam observabilidade e proteção contra execução acidental no próprio menu administrativo.

## Target user / job (JTBD)
O dono do bot precisa diagnosticar e administrar a produção pelo WhatsApp sem expor controles a outros usuários nem arriscar o rank.

## Non-negotiable constraints (≤5)
- Somente mensagens enviadas pela própria conta do bot/dono (`fromMe`) podem executar os novos comandos.
- Não alterar pontos, XP, tags, temas ou sessões existentes durante a implantação.
- `.backuprank` cria uma cópia separada e nunca sobrescreve `rank-stats.json`.
- Confirmações expiram e só valem para o mesmo dono, chat e ação solicitada.
- Criar commits de checkpoint e da funcionalidade para permitir rollback isolado.

## Desired outcomes (solution-independent, measurable; ≤5)
- `.diagnostico` informa conexão, sessão, última queda, reconexões, uptime e recursos.
- `.sessao status` informa o estado do login sem limpar ou reconectar.
- `.rankstatus` informa grupos, usuários e estado do arquivo do rank.
- `.backuprank` cria e confirma um arquivo de backup válido.
- Ações perigosas não executam na primeira solicitação e exigem confirmação válida.

## Smallest shippable slice   <!-- required -->
Adicionar os quatro comandos ao `.menudev`, restringi-los ao dono e proteger `.reiniciar`, `.zerarrank`, `.zerarrank global` e `.removerank` com confirmação temporária.

## Stop condition   <!-- required -->
Parar e pedir nova aprovação se for necessário mudar o formato do `rank-stats.json`, apagar/recriar a sessão ou ampliar o acesso além do dono.

## Success evidence (≤5)
- Testes provam que usuários comuns não executam os comandos.
- Testes validam o conteúdo das consultas sem depender do relógio real.
- Teste cria backup em diretório temporário e compara o JSON com a origem.
- Testes provam confirmação ausente, incorreta, expirada e válida.
- `npm test` passa integralmente e a verificação é registrada.

## Visual checkpoints
N/A — alteração textual em comandos do WhatsApp.

## Risk classification
R2 — administração de baixo risco com proteção de ações destrutivas.
EU AI Act: Art 5 prohibited use? N/A · Art 50 labelling? N/A

## Rollback note
Criar um checkpoint do estado atual antes da implementação e um commit exclusivo da funcionalidade; reverter o segundo commit remove somente esta entrega.

## Risks (≤5)
- Backup falhar por permissão ou falta de espaço.
- Confirmação ser reutilizada para outra ação.
- Informações internas excessivas aparecerem no grupo.
- Mudanças em arquivos já modificados serem misturadas no rollback.

## Non-goals (≤5)
- Restaurar backups pelo WhatsApp.
- Limpar ou reconectar a sessão.
- Alterar o funcionamento ou as probabilidades da roleta.
- Criar novos níveis, pontos ou itens.
- Enviar comandos administrativos para vários grupos.

## Release constraints
- Implementar primeiro localmente com TDD.
- Revisar o diff antes do commit e da implantação.
- Implantar somente os arquivos necessários, preservando `data/`, sessão e logs.

## Tracker
none

---
**Fail rule:** if a goal can't produce evidence, it's a wish with better formatting — it doesn't pass.
