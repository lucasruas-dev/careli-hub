# Portal de credenciamento: Lagoa Bonita unificado (pendente)

> Pedido do Lucas em 13/08/2026, com print do portal. **✅ CORRIGIDO no mesmo dia** — o que
> está abaixo é o registro do defeito e do conserto.

## O que ele pediu, nas palavras dele

1. "aqui lagoa bonita tem que vim unificado, **ao cadastrar para lagoa bonita habilita os três**"
2. "na verdade a **logo do empreendimento**" (o card mostra texto no lugar da logo)
3. "o **nome em caixa alta**" (aparece "Lagoa Bonita" enquanto os outros são "VALE DO OURO")

## Onde cada coisa está

A lista do portal sai de `listEmpreendimentosAtivos`
(`apps/hub/lib/apolo/credenciamento.ts:48`), servida por
`/api/publico/imobiliaria/empreendimentos`. Ela cruza três fontes:

- `listEnterprisesAtivos` — os ids marcados em `apolo_enterprise_settings.credenciamento_ativo`
- `listEnterpriseLogos` — as logos, **uma por enterpriseId**, no storage sob
  `enterprise-logos/{enterpriseId}` (`lib/apolo/enterprise-logos.ts`, sem tabela)
- `loadApoloEnterprises` — o C2X, que **já consolida** grupos via `ENTERPRISE_GROUPS`
  (`lib/guardian/c2x-analytics.ts:35`: `{ codes: ["LBF","LBR","LBP"], display: "Lagoa Bonita" }`)

## A causa provável dos três sintomas

O agrupamento acontece no C2X (`loadApoloEnterprises`), mas a **logo** e o
**credenciamento_ativo** são por `enterprise_id` individual. Então:

- **Logo:** o operador subiu a logo em UM dos três ids (o print mostra "Logo enviada" na tela do
  empreendimento). O card do grupo pede `logos[id]` do id consolidado, não acha, e cai no
  fallback que desenha o `code` — que no grupo é o texto "LBF + LBR + LBP".
- **Caixa alta:** o nome dos outros cards vem de `enterprises.name` do C2X, que está em caixa
  alta. O do grupo vem do `display` do `ENTERPRISE_GROUPS`, escrito "Lagoa Bonita".
- **Habilitar os três:** ao salvar o credenciamento, é preciso gravar os TRÊS enterprise_ids,
  não o id consolidado. Conferir `/api/publico/imobiliaria/credenciar`.

## O que fazer

1. Resolver a logo do grupo: procurar em qualquer id do grupo (ou replicar o upload nos três).
   Decidir qual das duas, porque a segunda deixa três cópias no storage.
2. `display: "LAGOA BONITA"` em `ENTERPRISE_GROUPS`, ou uppercase no card. Conferir se o
   `display` é usado em outro lugar antes de mexer (o BI usa o mesmo agrupamento).
3. No credenciar, expandir o id do grupo para os códigos `LBF`, `LBR`, `LBP` e gravar os três
   vínculos. **Verificar antes** se os três estão com `credenciamento_ativo`.
4. Conferir no banco quais dos três ids têm logo hoje e qual id o card está usando.

⚠️ Antes de implementar, medir: rodar a rota e ver o que ela devolve para Lagoa Bonita hoje
(`id`, `code`, `logoUrl`). O diagnóstico acima é leitura de código, não medição.


---

## ✅ O que foi feito (13/08/2026)

A causa raiz era uma só, e diferente do que este documento supunha: o Lucas já tinha gravado
`enterprise_id = 'group:Lagoa Bonita'` em `apolo_enterprise_settings`, ou seja, o id sintético do
grupo virou registro. Por isso o card já vinha unificado. O que quebrava era o resto:

1. **Logo** — `uploadEnterpriseLogo` grava o arquivo com `safeId()`, que troca `:` e espaço por
   `_`: `group_Lagoa_Bonita`. O consumidor procurava a chave crua `group:Lagoa Bonita` no mapa e
   nunca achava, caindo no fallback que desenha o `code` ("LBF + LBR + LBP"). Os outros
   empreendimentos têm id numérico e passavam ilesos, por isso só este aparecia quebrado.
   **Fix:** `safeId` virou `chaveDaLogo`, exportada, e o lookup passou a usá-la.
2. **Caixa alta** — o nome dos simples vem do C2X já em maiúsculas; só o do grupo vinha do
   `display` do `ENTERPRISE_GROUPS` ("Lagoa Bonita"). **Fix:** uppercase em
   `listEmpreendimentosAtivos`, que é local do portal. O `display` NÃO foi tocado porque o BI usa
   o mesmo agrupamento.
3. **Habilitar os três** — o credenciamento gravava o vínculo com o id do grupo, que não casa com
   nenhum `enterprise_id` do C2X: a imobiliária ficaria "credenciada" sem poder vender em nenhum
   dos três. **Fix:** `CredenciamentoEmpreendimento` ganhou `stageIds` (os ids reais das etapas,
   de `row.stages`) e a rota `/api/publico/imobiliaria/credenciar` expande o grupo antes de
   gravar, um vínculo por etapa.

⚠️ **Vale para todo grupo, não só Lagoa Bonita.** `ENTERPRISE_GROUPS` também consolida Lavra do
Ouro e outros; qualquer um deles marcado como ativo teria os mesmos três sintomas.

⚠️ **Não retroativo:** imobiliária que já se credenciou em "Lagoa Bonita" antes deste conserto
tem o vínculo gravado no id do grupo. Vale varrer `apolo_relationships` por
`metadata.enterpriseId` começando com `group:` e reescrever para as etapas.
