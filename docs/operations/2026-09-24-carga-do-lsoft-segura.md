# 2026-09-24 · A carga do LSoft fica segura e religa sozinha

Commits na branch `feat/portal-cecilio-melhorias`: `861532c7` (religador da trilha) e `0e647122`
(carga nova). Nenhuma escrita no banco nesses dois commits.

## O que a carga fazia, e o que já custou

Registro de `lsoft_sincronizacoes`:

| quando | o que houve |
|---|---|
| 08/09 17:06 | a carga caiu no CHECK de empreendimento **depois** de apagar todas as parcelas: espelho **vazio** por 41 min |
| 08/09 17:47 | carga só do Vale do Ouro apagou o Garden e o Vale do Sol |
| 08/09 17:48 | carga completa restaurou |
| 08/09 e 16/09 | o upsert de clientes apagou com nulo **200 nomes de mãe e 218 nascimentos** que o MOST tinha trazido em 19/08 |

## O que a carga faz agora

1. **Grava antes de apagar.** Parcelas novas com uma marca única; as antigas só saem depois.
2. **Só apaga os empreendimentos que vieram na carga.**
3. **Falhou no meio: desfaz** e o espelho volta ao de antes.
4. **Não desfaz às cegas:** erro no apagamento das antigas primeiro conta o que sobrou.
5. **Cadastro mesclado:** LSoft em branco não apaga; edição da tela vence; a lista de
   empreendimentos soma.
6. **Conferência antes de gravar:** se a carga for desfazer baixa ou correção feita na tela, ela
   **recusa**, a menos de `--aceitar-perda-de-edicao`.
7. **Uma carga por vez**, e a marca fica anotada no registro desde a abertura.
8. **No fim, os dois religadores rodam sozinhos** (trilha e classificação da Caixa).

Uso:

```bash
node scripts/lsoft/importar-para-supabase.mjs <pasta-dos-csv> --ensaio
node scripts/lsoft/importar-para-supabase.mjs <pasta-dos-csv>
```

## Ensaio contra a base de 24/09 (Garden e Vale do Sol, 20.242 parcelas)

- 152 parcelas editadas pelo time, todas com par na carga nova.
- **1 divergência real:** cliente `00000587`, parcela 007/084 de 10/09, valor recebido
  **R$ 2.207,18 na tela** contra **R$ 4.414,36 no LSoft** (o dobro). A carga real do Garden e do
  Vale do Sol **para** aqui até alguém conferir.

## Revisão adversarial

35 agentes, 31 achados, 16 confirmados pelo cético. Entraram: upsert que apagava cadastro, baixa
desfeita pela carga, desfazer às cegas, carga simultânea, marca anotada, e o nome "Guaimbé" (estava
com circunflexo; o catálogo usa agudo).

Ficaram para depois:
- **Carimbo "dados de" é global:** depois de uma carga parcial, a tela diz que o Garden foi
  atualizado sem ter sido. Correção na tela (`lerCarteiraDoLsoft`).
- **O campo empreendimento é editável na parcela:** uma parcela movida de empreendimento vira
  duplicata na próxima carga. Hoje há zero edições desse campo; o caminho é tirar da edição.
- **Nome fora do CHECK** suja o cadastro de clientes novos antes da carga falhar nas parcelas.

## ⚠️ O que ainda impede subir os demais empreendimentos

1. **O CHECK** de `lsoft_parcelas.empreendimento` só aceita Garden, Vale do Sol e Vale do Ouro - 2.
2. **A categoria 17 mistura empreendimentos.** Vale do Sol, Guaimbê, Giant Towers e On Sky recebem
   título da categoria própria E da 17. Como a carga substitui por empreendimento, carregar a 17
   depois apagaria a parte que veio da categoria própria. O desenho certo é substituir pela
   **categoria de origem**, o que pede uma coluna nova em `lsoft_parcelas` (migration).
3. **O extrator** não produz o nome do empreendimento para as categorias novas: precisa aplicar
   `lib/lsoft/categorias.ts`.
4. **A tela** só oferece Garden e Vale do Sol no seletor (`EMPREENDIMENTOS_DO_LSOFT`).

## O que já se perdeu e não volta sozinho

As 200 mães e os 218 nascimentos estão no JSON `lsoft_clientes.enriquecimento`. Devolver às colunas
é escrita no banco e pede OK do Lucas.
