# Panteon Address Architecture

Assunto: [Zeus] arquitetura de enderecamento do Panteon

Status: `ATIVO / FUNDACAO DOCUMENTAL`

Este documento define a arquitetura de enderecamento operacional do Panteon. A
ideia e tratar a producao validada como uma cidade e cada recorte como uma
intervencao em um endereco preciso. O objetivo e impedir que um ajuste em uma
casa publique uma cidade antiga, misturada ou regressiva.

O plano de implantacao por etapas fica em:

```text
docs/operations/panteon-address-architecture-implementation-plan.md
```

## Marco zero

A cidade inicial do Panteon e a producao validada por Lucas em 2026-06-17.

- Codigo da cidade: `01`.
- CEP operacional da cidade: `PNT-01-00-00-000`.
- Dominio principal: `https://c2x.app.br`.
- Deployment validado: `dpl_4FyaXUbn47T45KBWJNGmA3a8orz5`.
- URL tecnica registrada: `https://careli-hub-hub-i2bs-2hmz65b0s-lucasruas-devs-projects.vercel.app`.
- Comportamento preservado:
  - melhorias de carregamento;
  - aba `Disponibilidade`;
  - Hades com fila de cobranca validada;
  - Iris embutida no Hades sem sidebar interno duplicado.

Qualquer recorte futuro deve nascer desta base ativa validada ou provar, por
manifesto e Safety Gate, que preserva exatamente esta base fora do escopo
autorizado.

## CEP operacional

O formato oficial do endereco curto e:

```text
PNT-CC-BB-RR-HHH
```

Onde:

- `PNT`: plataforma Panteon.
- `CC`: cidade/base validada, com dois digitos.
- `BB`: bairro/modulo ou dominio operacional, com dois digitos.
- `RR`: rua/tela, fluxo ou capacidade dentro do modulo, com dois digitos.
- `HHH`: casa/unidade alteravel, com tres digitos.

Exemplo:

```text
PNT-01-10-20-002
```

Leitura humana:

```text
Panteon Marco Zero > Hades > Cobranca > Fila de cobranca
```

## Niveis

### Cidade

A cidade representa uma base validada inteira. Ela nao deve ser alterada
diretamente por recortes comuns. Um novo codigo de cidade so deve existir quando
Lucas validar uma nova base oficial e o Zeus registrar essa decisao.

Exemplo:

```text
PNT-01-00-00-000
Panteon Producao Marco Zero 2026-06-17
```

### Bairro

O bairro representa um modulo ou dominio operacional.

Exemplos iniciais:

- `PNT-01-01-00-000`: Panteon Core, Home e disponibilidade.
- `PNT-01-10-00-000`: Hades.
- `PNT-01-20-00-000`: Iris.
- `PNT-01-30-00-000`: Hermes.
- `PNT-01-40-00-000`: Chronos.
- `PNT-01-50-00-000`: Zeus/Operations Center.

### Rua

A rua representa uma tela, fluxo ou capacidade dentro do modulo.

Exemplos:

- `PNT-01-10-20-000`: Hades / Cobranca.
- `PNT-01-20-10-000`: Iris / Board.
- `PNT-01-40-20-000`: Chronos / Drive.
- `PNT-01-50-10-000`: Zeus / Operations Center.

### Casa

A casa e a menor unidade autorizavel de mudanca. Ela pode representar uma tela,
painel, componente, API, helper, tabela/regra ou documento operacional.

Exemplos:

- `PNT-01-10-20-002`: Hades / Cobranca / Fila.
- `PNT-01-20-10-001`: Iris / Board / Fila de tickets.
- `PNT-01-40-20-001`: Chronos / Drive / Biblioteca.

## Tipos de casa

O CEP fica curto; o catalogo digital guarda o detalhe. Toda casa deve declarar um
`houseType` no registry.

Tipos iniciais:

- `route`: rota ou entrada de pagina.
- `screen`: tela principal.
- `ui-panel`: painel ou bloco visual.
- `component`: componente reutilizavel.
- `api-route`: rota API.
- `server-helper`: helper server-side.
- `business-rule`: regra de negocio.
- `data-contract`: tabela, tipo, schema, migration ou contrato de dado.
- `operational-doc`: documento operacional.
- `safety-marker`: marcador usado para provar preservacao de base.

## Registry

O catalogo inicial fica em:

```text
docs/operations/panteon-address-registry.json
```

Cada endereco deve declarar, no minimo:

- `addressId`;
- `addressCode`;
- `level`;
- `name`;
- `module`;
- `owner`;
- `routes`;
- `paths`;
- `allowedChangedPaths`;
- `protectedPaths`;
- `requiredMarkers`;
- `forbiddenMarkers`;
- `validationCommands`;
- `releaseDomain`;
- `rollbackReference`;
- `status`;
- `notes`.

O registry deve comecar pequeno e confiavel. Novos enderecos entram quando um
recorte real exigir mais precisao.

## Template de recorte

O template usando CEP operacional fica em:

```text
docs/operations/panteon-address-recorte-template.json
```

Todo recorte candidato a Preview, Homo ou Producao deve informar:

- cidade/base preservada;
- bairro/modulo autorizado;
- rua/tela/fluxo autorizado;
- casas/arquivos autorizados;
- casas protegidas;
- marcadores obrigatorios;
- marcadores proibidos;
- validacoes;
- rollback.

## Validador local

O validador inicial fica em:

```text
scripts/panteon-address-recorte-check.mjs
```

Uso recomendado:

```powershell
node scripts/panteon-address-recorte-check.mjs --manifest docs/operations/panteon-address-recorte-pilot-hades-iris-embed-20260617.json
node scripts/panteon-address-recorte-check.mjs --manifest docs/operations/panteon-address-recorte-pilot-hades-iris-embed-20260617.json --files apps/hub/modules/caredesk/embeds/iris-collection-queue-embed.tsx
node scripts/panteon-address-recorte-check.mjs --self-test
```

O script valida:

- formato do CEP operacional;
- existencia de cidade, bairro, rua e casas no registry;
- consistencia entre `addressCode` e `addressId`;
- cadeia de parentesco cidade -> bairro -> rua -> casa;
- `requiredMarkers` e `forbiddenMarkers`;
- `allowedChangedPaths` e `protectedPaths` quando `--files` ou `--from-git` for usado;
- bloqueios basicos de producao quando `candidateSourceCommit`, `sourceWorktreeClean` ou pacotes estiverem ausentes.

O validador nao substitui Homologation Safety Gate nem Production Module Safety
Gate. Ele roda antes, como trava de escopo por CEP.

## Regras de bloqueio

Um recorte fica `BLOQUEADO` quando:

- nao declara CEP operacional;
- declara cidade diferente da base ativa real;
- toca arquivo fora das casas autorizadas;
- remove ou altera casa protegida;
- remove marcador obrigatorio;
- reintroduz marcador proibido;
- nasce de worktree sujo ou pacote misto sem separacao limpa;
- tenta publicar producao sem commit limpo;
- tenta mover dominio, alias, env, secret, Supabase, banco, migration ou Vercel
  sem autorizacao explicita do Lucas.

## Como usar no dia a dia

1. Lucas pede uma mudanca.
2. Zeus ou o agente do modulo localiza o CEP: cidade, bairro, rua e casa.
3. O recorte declara os CEPs no manifesto.
4. O agente altera somente as casas autorizadas.
5. O diff e comparado contra `allowedChangedPaths` e `protectedPaths`.
6. O Safety Gate valida base, pacote, marcadores e rollback.
7. Se houver divergencia, o status correto e `BLOQUEADO`.

## Expansao do catalogo digital

Depois da fundacao documental, o catalogo pode evoluir para:

- tela no Zeus/Operations Center;
- busca por CEP, modulo, rota, arquivo ou owner;
- link entre protocolo, CEP e deployment;
- diff automatico por endereco;
- alerta quando um recorte tocar CEP fora do escopo;
- geracao de manifesto de homologacao/producao a partir dos enderecos.

Essa evolucao deve acontecer em recorte proprio do Zeus, sem alterar modulos de
produto fora do escopo e sem operacao sensivel sem autorizacao.

## Conclusao

A arquitetura de enderecamento cria uma linguagem comum entre Lucas, Zeus
e agentes de modulo. O impacto pratico e simples: antes de mudar algo,
o agente precisa dizer exatamente onde esta mexendo e provar que o resto da
cidade continua igual.
