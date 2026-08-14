# Portal de credenciamento: Lagoa Bonita unificado (pendente)

> Pedido do Lucas em 13/08/2026, com print do portal. **Diagnosticado, não implementado.**

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
