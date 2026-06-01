# Prompt de continuidade - Hermes e Chronos - 2026-06-01

Use este prompt se for preciso abrir um novo chat para continuar sem perder contexto.

## Contexto obrigatorio

- Repositorio: `C:\Users\lucas\Documents\Careli_C2x\Sistemas\careli-hub`.
- Trabalhar em portugues do Brasil e responder com `Assunto:` no inicio.
- Ler `docs/operations/README.md`, `docs/operations/engineering-operations.md` e, para frontend, `docs/architecture/design-guidelines.md`.
- Nao executar deploy, alias, env, secret, migration, Supabase admin ou producao sem autorizacao explicita do Lucas.
- Preferir a worktree limpa alinhada com producao: `.codex-deploy/z01-001-engineering-prod-20260601`.

## Hermes - prioridade atual

Protocolo local: `HM-20260601-129-HERMES-TIMELINE-SCROLL`.

O recorte Hermes corrigiu:

- timeline com scroll proprio em `apps/hub/components/pulsex/message-list.tsx`;
- auto-scroll apenas quando o usuario esta perto do fim da conversa ou ao trocar de canal;
- divisores de data com data e dia da semana;
- wrapper do workspace sem scroll concorrente em `apps/hub/components/pulsex/pulsex-workspace.tsx`;
- limite default da API de mensagens Hermes de 150 para 250 em `apps/hub/app/api/pulsex/messages/route.ts`.

Validacoes ja executadas:

- `npx.cmd eslint components/pulsex/message-list.tsx components/pulsex/pulsex-workspace.tsx app/api/pulsex/messages/route.ts --max-warnings 0` em `apps/hub`: PASS, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
- `npm.cmd run check-types:hub`: PASS.

Ainda recomendado:

- rodar `npm.cmd run lint:hub`;
- rodar `npm.cmd run build --workspace @repo/hub`;
- validar visualmente `/hermes` nos canais `Lideranca` e `Tecnologia`, especialmente subir/voltar mensagens antigas e conferir os divisores de data.

## Chronos - pendencias prioritarias apos Hermes

Lucas reportou:

- queda da sala quando o host cai ou o Chrome trava;
- gravacao nao pode ficar presa ao host, deve continuar se a chamada ainda estiver ativa;
- gravacao so deve encerrar por stop explicito ou fim real da chamada;
- transcricao misturou falantes, atribuindo falas da Nivea para Lucas/Northon/Cinthia;
- latencia de voz em apresentacao;
- reuniao real durou mais de 50 minutos, mas registro gravado ficou curto;
- agenda deve ser por usuario Google conectado, nao herdada do Lucas.

Diagnostico ja identificado:

- Vercel e Supabase estavam saudaveis em geral, mas `/chronos/careli` era lento e a rota `/api/chronos/public/rooms/careli/transcript` tinha alto volume;
- transcricao atual provavelmente usa reconhecimento local por participante/navegador, o que nao garante diarizacao real por falante;
- gravacao atual fica no navegador que iniciou a captura e pode ser perdida se essa aba cair;
- composicao de video/transcricao pode pesar em CPU/memoria do Chrome.

Plano tecnico recomendado para Chronos:

1. Reduzir volume de transcricao ao vivo com buffer/coalescing por janela de tempo.
2. Trocar atribuicao de falante para fonte confiavel: participante local no cliente que capturou o audio, ou registrar como "Transcricao sem falante confiavel" quando nao houver evidencia.
3. Implementar gravacao segmentada/rolling upload para nao perder 50 minutos se a aba cair.
4. Separar estado de gravacao da permanencia do host: sala ativa deve permitir outro participante continuar/assumir captura ou no minimo preservar segmentos ja enviados.
5. Reduzir custo da composicao de video: preferir VP8, 12 fps e bitrate controlado.
6. Corrigir Google Agenda por usuario: botao conectar/sincronizar deve abrir OAuth com login_hint do usuario logado e auto-sync apos retorno.

## Proximo comando mental

Continuar do Hermes validado localmente, fechar validacoes globais/visuais e so depois abrir recorte Chronos. Nao misturar deploy de producao sem autorizacao explicita do Lucas.
