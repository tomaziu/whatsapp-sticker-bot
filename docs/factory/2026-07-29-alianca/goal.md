# Goal Contract — Renomear casamento para aliança

## Current state (≤3)
- O recurso aparece como casamento, casal e divórcio nos comandos e mensagens.
- A lógica e os dados persistidos usam estruturas internas de relacionamento já existentes.

## Desired future state (≤3)
- Todo texto visível ao usuário usa “aliança”.
- Todos os comandos públicos relacionados usam nomes de aliança.
- Relacionamentos, bônus, cooldowns e dados existentes continuam funcionando sem alteração.

## Current constraint (Theory of Constraints)
O nome público atual não corresponde ao tema desejado pelo dono.

## Target user / job (JTBD)
O dono quer apresentar o mesmo recurso como uma aliança, sem mudar regras nem perder dados.

## Non-negotiable constraints (≤5)
- Não alterar lógica, bônus, cooldowns, validações ou formato dos dados.
- Preservar estruturas e nomes internos usados para carregar alianças já existentes.
- Remover dos menus e respostas todos os termos públicos de casamento, casal e divórcio.
- Atualizar os testes antes do código.
- Criar commit exclusivo para rollback.

## Desired outcomes (solution-independent, measurable; ≤5)
- Os comandos públicos passam a usar somente a nomenclatura de aliança.
- Menus, ajuda, perfil, convites, aceitação, recusa e encerramento usam “aliança”.
- Os comandos antigos deixam de ser reconhecidos.
- A suíte comprova que bônus, cooldown e relacionamento mantêm o comportamento anterior.

## Smallest shippable slice   <!-- required -->
Aplicar o seguinte mapa público: `.casamento` → `.alianca`; `.casar` → `.formaralianca`; `.aceitarcasamento` → `.aceitaralianca`; `.recusarcasamento` → `.recusaralianca`; `.cancelarcasamento` → `.cancelaralianca`; `.casal` → `.minhaalianca`; `.divorciar` → `.desfazeralianca`.

## Stop condition   <!-- required -->
Parar e pedir aprovação se a mudança exigir migração dos dados existentes ou alteração das regras do relacionamento.

## Success evidence (≤5)
- Testes dos sete novos comandos passam e os sete antigos falham.
- Busca textual não encontra os termos públicos antigos em menus ou respostas.
- Testes de criação, aceitação, bônus, separação e cooldown continuam passando.
- `npm test` e validação de sintaxe passam localmente e no servidor.

## Visual checkpoints
N/A — interface textual do WhatsApp.

## Risk classification
R2 — mudança textual e de comandos, sem alteração de dados.
EU AI Act: Art 5 prohibited use? N/A · Art 50 labelling? N/A

## Rollback note
Um commit exclusivo permitirá restaurar os nomes anteriores sem tocar nos dados.

## Risks (≤5)
- Usuários tentarem usar comandos antigos.
- Algum texto antigo permanecer escondido em uma resposta rara.
- Renomear identificadores internos quebrar dados existentes.

## Non-goals (≤5)
- Alterar bônus do daily.
- Alterar prazo do convite ou cooldown.
- Apagar ou recriar relacionamentos.
- Migrar chaves internas do JSON.
- Manter aliases dos comandos antigos.

## Release constraints
- TDD local, revisão do diff, commit exclusivo, backup do código remoto e testes no VPS.

## Tracker
none

---
**Fail rule:** if a goal can't produce evidence, it's a wish with better formatting — it doesn't pass.
