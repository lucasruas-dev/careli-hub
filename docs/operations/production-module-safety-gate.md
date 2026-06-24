# Production Module Safety Gate

Este processo e obrigatorio antes de qualquer deploy de producao do Panteon por modulo.

## Objetivo

Impedir que um recorte de um modulo publique um snapshot antigo ou misto e reverta outros modulos. O deploy modular so pode seguir quando provar duas coisas:

- a base do pacote candidato preserva a producao correta atual;
- as diferencas do pacote candidato estao restritas ao modulo autorizado.

## Incidente que originou a trava

Em 2026-06-05, recortes do Hermes foram publicados com pacote limpo montado sobre uma base antiga. O Hermes foi alterado, mas o snapshot publicado removeu a base modular do Chronos, fazendo `https://c2x.app.br/chronos` voltar para a tela antiga `v1 executiva / Reunioes`.

Em 2026-06-06, a producao foi restaurada pelo protocolo `PROD-20260606-001-RESTORE-MODULAR-BASE-HERMES`, usando a base boa `dpl_2zfKXD4FYbQSDQfe49aqGHSsSM4d` e reaplicando somente Hermes.

## Regra operacional

Antes de publicar producao, o agente deve:

1. Identificar o deployment/base boa atual do dominio alvo.
2. Montar pacote candidato a partir dessa base, nao de `HEAD` antigo nem de pacote local aleatorio.
3. Criar ou selecionar commit limpo do recorte; sem commit limpo, producao fica `BLOQUEADO`.
4. Declarar o CEP operacional do recorte em `addressManifest`, com `addressCheckFiles` apontando para os arquivos reais alterados.
5. Aplicar somente os arquivos do modulo autorizado.
6. Preencher manifesto `docs/operations/production-module-safety-gate-template.json`, incluindo `candidateSourceCommit`, `sourceWorktreeClean: true`, `addressManifest` e `addressCheckFiles`.
7. Rodar `node scripts/production-module-safety-gate.mjs --manifest <manifesto>` antes do build remoto/deploy, com pacote candidato ainda limpo, sem `.next`, `.turbo`, `.vercel`, `.git`, `node_modules` ou logs temporarios.
8. Bloquear se houver qualquer mudanca fora de `allowedChangedPaths`.
9. Bloquear se qualquer caminho em `protectedPaths` mudar, sumir ou voltar para marcador antigo.
10. Publicar com `vercel deploy --prod --skip-domain` quando houver risco de mover aliases cruzados.
11. Apontar manualmente apenas o dominio autorizado.
12. Registrar deployment, healthchecks, logs e rollback em `releases-production.md` e no diario.

## Dominios

- Modulos nao-Zeus sobem somente em `https://c2x.app.br`.
- Zeus/Operations Center sobe somente em `https://ops.c2x.app.br`.
- Impacto cruzado exige autorizacao explicita do Lucas, motivo registrado e rollback por dominio.

## Bloqueios automaticos

O gate deve retornar `BLOQUEADO` quando:

- `candidatePackagePath` ou `basePackagePath` nao existir;
- `candidateSourceCommit` nao existir, for placeholder ou nao parecer um SHA de Git;
- `sourceWorktreeClean` nao for `true`;
- `addressManifest` nao existir ou o CEP preflight retornar `BLOQUEADO`;
- o dominio alvo nao bater com o modulo;
- houver `.env`, `.git`, `.vercel`, `.next`, `.turbo`, `node_modules` ou artefatos temporarios dentro do pacote;
- qualquer diff fora de `allowedChangedPaths` aparecer;
- qualquer caminho em `protectedPaths` mudar;
- algum marcador obrigatorio em `requiredMarkers` nao existir;
- algum marcador proibido em `forbiddenMarkers` aparecer;
- nao houver rollback registrado.

## Marcadores minimos recomendados

Para proteger a base modular atual:

- Chronos: `ChronosAgendaScreen`, `ChronosDriveLibraryScreen`, rota `/chronos/[roomSlug]`.
- Hermes: `Hermes`/`PulseX` deve manter rotas `/hermes` e `/api/hermes/messages`.
- Iris: blocos modulares em `apps/hub/modules/caredesk/blocks`.
- Hades: rotas `hades` e `guardian` preservadas conforme snapshot base.
- Zeus/OPS: dominio `ops.c2x.app.br` nao deve ser movido por modulo nao-Zeus.

## Exemplo de uso

```powershell
node scripts/production-module-safety-gate.mjs --init > docs/operations/production-module-safety-gate-example.json
node scripts/production-module-safety-gate.mjs --self-test
node scripts/panteon-address-recorte-check.mjs --manifest <addressManifest> --files <arquivos-do-recorte>
node scripts/production-module-safety-gate.mjs --manifest docs/operations/production-module-safety-gate-example.json
```

## Regra para novo chat Zeus

Todo novo chat/agente Zeus deve ler este arquivo durante a inicializacao. Se Lucas pedir producao, Zeus deve perguntar ou descobrir:

- modulo autorizado;
- dominio alvo;
- deployment/base atual;
- pacote base;
- pacote candidato;
- commit limpo do recorte;
- manifesto CEP do recorte;
- rollback;
- arquivos permitidos.

Sem essas informacoes, sem CEP aprovado, sem commit limpo e sem PASS no gate, producao fica `BLOQUEADO`.
