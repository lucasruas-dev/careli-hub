---
name: medir-antes-de-afirmar
description: Use antes de afirmar qualquer coisa sobre como o Panteon se comporta — o que uma coluna guarda, quantos registros existem, se uma função é chamada, se a tela mostra o valor certo. Medir no banco, no código que roda ou no teste; e reportar o número com a origem.
---

# Medir antes de afirmar

Fonte: `CLAUDE.md` (infra, Supabase prod `bxgukywoxgivlrhjkwjx`), `AGENTS.md` (Zeus pode ler e
investigar sem autorização), memória do Lucas e os erros de 10/09/2026 abaixo.

## A regra

**Nenhuma afirmação sobre o comportamento do sistema sai sem medição.** Medir = uma destas três:

1. **Banco** — MCP do Supabase (`execute_sql`, projeto `bxgukywoxgivlrhjkwjx`) para o Panteon;
   C2X legado só leitura, via `apps/hub/lib/guardian/db.ts` (MySQL, READ-ONLY, regra-mãe do `CLAUDE.md`).
2. **Código que de fato roda** — abrir o arquivo e ler a linha, não deduzir pelo nome.
3. **Teste** — `npm --prefix apps/hub run test` (vitest) ou um arquivo só:
   `npm --prefix apps/hub run test -- lib/temis/dados-do-contrato.test.ts`.

⚠️ **Typecheck limpo (`npm --prefix apps/hub run check-types`) NÃO prova que a peça está conectada.**
Ele passa em código morto e em regra duplicada. Em 26/07/2026 o aviso "o cliente falou por último"
foi implementado dentro de `closeTicket()` no `IrisPage.tsx`, typecheck verde, informado ao Lucas
como no ar — e a função nunca era chamada por ninguém (`feedback_verificar_peca_conectada`).
Depois de editar, **procure quem CHAMA**.

## Os quatro erros de 10/09/2026 (é por isso que esta skill existe)

1. **Deduzi o significado pelo nome da chave.** Escrevi que `identificacao_cliente` era o RG do
   comprador — e deixei isso num comentário. É o **papel na venda**, e sai como o literal
   `"COMPRADOR"` para todo mundo: `apps/hub/lib/temis/dados-do-contrato.ts:757` faz
   `por("identificacao_cliente", "COMPRADOR")`. A tela teria impresso **"Identidade: COMPRADOR"**.
   ⚠️ Em contrato isso não se desfaz: o documento vai para a Clicksign assinado.
2. **Grep incompleto virou "só usada em testes".** O `import` estava quebrado em várias linhas,
   o grep por `import { nome }` não pegou, e eu declarei morta uma função que o **simulador** usa.
3. **Coluna NULA não quer dizer "não tem".** Ia deixar a tela dizer "sem correção" num contrato que
   quase dobra a parcela: `plano_correcao` e `plano_juros` vinham NULAS (é o que
   `apps/hub/lib/hercules/fluxo-de-venda.ts:340,352` lê), mas o cronograma congelado tinha
   **10 faixas de reajuste, de R$ 1.012,50 a R$ 1.954,32**.
4. **`maybeSingle()` calado.** O card da Têmis era lido por `proposta_id` com `maybeSingle()`;
   com **duas** linhas o PostgREST devolve erro, o resultado vinha nulo e a função saía sem fazer
   nada. Ficou meses assim. Medido em 10/09: a proposta do Henrique (Q01 L05) tem DOIS trabalhos
   — a venda de 06/09 e o cancelamento dela de 08/09 (comentário em
   `apps/hub/lib/assinatura/estado-db.ts`, função `concluirAssinaturaDoCard`).

## Como medir cada coisa

**Antes de generalizar: conte e olhe uma amostra.**
```sql
select count(*) from temis_trabalhos where proposta_id is not null;
select * from temis_trabalhos where proposta_id = '<id>' limit 5;
```
Conte com `count(*)`, nunca contando as linhas que voltaram na tela do resultado.
Antes de escrever `maybeSingle()` ou de confiar num, pergunte **quantas linhas existem por chave**:
```sql
select proposta_id, count(*) from temis_trabalhos group by 1 having count(*) > 1;
```

**Nome de coluna se confere no schema, não se deduz da variável.**
`list_tables` do MCP, ou `select column_name, data_type from information_schema.columns
where table_name = '<tabela>'`. Em TS o campo pode ter outro nome: `guardian_compromisso_comments`
guarda o autor em `metadata.author_name`; `authorName` devolve `undefined`
(`reference_client_c2x_id_colisao`).

**Grep que aguenta import multilinha:** procure o **nome nu**, nunca `import { nome }`.
```bash
grep -rn "nomeDaFuncao" apps/hub --include=*.ts --include=*.tsx
grep -rn "nomeDaFuncao" apps/hub --include=*.ts --include=*.tsx | grep -v "\.test\."
```
Se sobrar só a definição, é código morto. Se sobrar a definição + testes, ainda assim rode a busca
multilinha (ferramenta Grep com `multiline: true`, padrão `import \{[^}]*nomeDaFuncao`) antes de
dizer "só os testes usam". E, ao corrigir regra de negócio, grepe também **um trecho da lógica**:
já existiram duas cópias de `isSlaCritical`, em `IrisPage.tsx` e em `data/iris-data-client.ts`.

## ⚠️ Armadilhas de leitura que já custaram caro aqui

- **PostgREST corta em 1.000 linhas sem erro.** Sem log, sem 500 — a resposta só vem menor, e quem
  lê trata o que faltou como inexistente. Em 26/08/2026 um `.in()` de 100 pessoas em
  `apolo_financial_snapshots` (~55 linhas por pessoa) pedia 5.478 linhas e trouxe **19 de 100** →
  o card da Iris chamava Comprador de "Prospect". **Pagine, ou agregue.**
  (`reference_postgrest_teto_de_1000_linhas`)
- **`.in()` estoura a URL.** Cada UUID custa ~37 chars; 700 ids = 27.670 chars = **400 Bad Request**
  (medido em 24/07/2026). **Leia em lotes de 100.** Em 24/07 isso derrubou a Iris inteira em
  produção, com typecheck e testes verdes. (`reference_postgrest_in_url_limite`)
- **Nome de coluna não prova nada quando os ids colidem.** `guardian_compromissos.client_c2x_id` é
  `users.id` do C2X, não o id da negociação — e o id 2508 existe nas duas tabelas. Em 03/08/2026
  dois agentes de verificação chegaram a conclusões opostas. Prove por um segundo caminho
  (ex.: `metadata.client_name` + a parcela). (`reference_client_c2x_id_colisao`)
- **`hercules_unidades` é um RETRATO parado de 01/09/2026 16:17**, carregado à mão, sem cron. Todas
  as 5.540 linhas com o mesmo `atualizado_em`. No Vale do Ouro diz 5 lotes disponíveis onde o C2X
  tem 13. Para **situação** (disponível/reservado/vendido) leia o C2X ao vivo;
  `hercules_unidades` só serve para o que não muda (código, quadra, área, matrícula).
  (`reference_hercules_unidades_e_um_retrato_parado`)
- **Efeito colateral "que não derruba o fluxo" some calado.** Depois do primeiro uso em produção,
  conte no destino: `select count(*) from <destino> where criado_em > '<data do deploy>'`.
  (`reference_efeito_colateral_que_nao_derruba_some`)
- **Se a tela discorda do banco, o defeito é de gravação/carga, não de regra.** Em 10/08/2026 o time
  jurava que o cliente "voltava de etapa"; `apolo_audit_events` com `action='etapa_change'` para
  `validacao` = **0**. Nada regrediu no banco. (`reference_apolo_regressao_e_de_tela`)

## Como reportar

Diga **o número, a fonte e a data**. "Medido em 10/09: 4.856 de 4.863 (`apolo_esteira`, filtro
`etapa <> 'arquivado'`)" vale mais do que "a maioria". Todo número no relatório carrega:
tabela/arquivo · filtro usado · data da medição. Sem isso, quem ler daqui a um mês não sabe se
ainda vale — e `hercules_unidades` é a prova de que um número envelhece em silêncio.

O que você **não** mediu, você **não** escreve. Se não deu para medir, diga: "não conferido:
<o quê> — faltou <acesso/dado>".

## Quando a medição contraria o que você ia dizer

**Diga isso explicitamente, em primeiro lugar, e não contorne.** "Eu ia afirmar X; medi e é Y" é
o relatório certo. Foi assim que os quatro erros acima viraram conserto em vez de bug em produção.
Ajustar a redação para a frase continuar de pé é o que produz o comentário errado no código — e
comentário errado sobrevive anos, porque ninguém remede o que já está escrito com convicção.

⚠️ Medir autoriza **afirmar**, não escrever: `execute_sql` de escrita, migration, env e deploy
continuam exigindo OK explícito do Lucas a cada vez (`CLAUDE.md`, BLOQUEIO OPERACIONAL).
