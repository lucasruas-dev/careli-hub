# 2026-09-29 · O Garden validado sai da LSoft Integração e entra no Financeiro (v1.397.0)

Pedido do Lucas, com a planilha `OBSERVAÇÕES DO GARDEN S.xlsx` (exportada da própria LSoft
Integração, aba "OBS. LUCAS"): *"agora eu quero subir as carteiras que estão validadas pelo time
adm (...) as que estiverem com ok (...) vai deixar de existir no lsoft e agora vai para carteira do
garden, as que tiverem algum observação deixar ainda na tela de integração"*. Depois: *"esquece o
c2x, cecilio não tem nenhum vinculo com o legado c2x"* e *"é só copiar e colar na carteira"*.

Autorização: *"tem o meus oks"* (29/09/2026) para migration, gravação e deploy.

## O caminho simples, e por que não o longo

Um projeto técnico completo (carteira nova no banco, casador do Asaas, baixa manual nova, 12 fatias)
foi escrito e começou a ser implementado. O Lucas cortou: *"estou achando muito longo"*, *"uma coisa
simples, que já está validado"*. O projeto ficou em `docs/operations/2026-09-29-carteira-do-garden-no-panteon.md`
e o código dele na branch `wip/carteira-panteon-longa` (commit `77434d07`). Não retomar sem pedido.

O que entrou:
- **Migration 0199** `lsoft_clientes.empreendimentos_na_carteira text[] not null default '{}'`:
  por (cliente, empreendimento), porque 11 dos 106 também têm Giant Towers, patrimônio e outras
  carteiras, que continuam na integração.
- **Sem cópia de dado:** o Financeiro lê do espelho (`lsoft_parcelas` categoria 124 e a view 0107)
  as parcelas do Garden desses clientes, no lote NOVO do boleto (CPF em `boletos_documentos`).
  Clicar no cliente abre a ficha do LSoft (Cadastro, Parcelas, Documentos, Histórico), onde a baixa
  já existe, com trilha.
- **A integração tira o par** (cliente, Garden): some do recorte Garden e, em "Todos", o Garden é
  descontado do total do cliente. A prontidão de boletos continua contando todos.
- **Ficam para depois:** baixa automática pelo Asaas, Indicadores e líquido do Garden (a política de
  gestão de carteira do 39 está nula; a tela diz "não apurado").

## Números (ensaio de 29/09/2026, só leitura)

- Sobem **106 clientes**, 9.868 parcelas (872 pagas, 8.996 em aberto, 24 vencidas).
- Em aberto **R$ 30.556.722,22**, vencido R$ 77.958,98, recebido R$ 4.484.836,13.
- View 0107 = soma das parcelas em 106 de 106; nenhuma marca de Caixa no Garden.
- Status: 95 viram "validado"; os 11 com outra carteira ficam com o status que têm (só a observação).
- **Ficam na integração 35:** 24 com observação na planilha, 10 com OK e pendência (00000440,
  00000487, 00000548, 00000599 sem lote pelo boleto; 00000524 e 00000538 com CPF cruzado entre
  boletos; 00000086 cronograma nunca lançado; 00000587 contrato dividido entre dois pagadores;
  00000560 anuais idênticas às do 00000059; 00000179 permuta, decisão do Lucas) e 1 fora da
  planilha (00000558).

## Deploy

- Migration 0199 aplicada em `bxgukywoxgivlrhjkwjx` (número conferido livre no registro e na main;
  a 0198 é de outra frente). Conferida: `text[]`, not null, default `'{}'`, RLS ligada, 0 marcados.
- Push na main `473404d2..1fd7d9ea` (suíte do pré-push: 724 arquivos, 10.843 testes). A primeira
  tentativa foi recusada por estouro de tempo em 7 testes alheios com a máquina carregada por um
  jogo aberto; sozinhos, os 7 passaram (62 testes em 13 s). Com o jogo fechado, passou inteira.
- Deployment `dpl_HLhREfNdmRb8Kk3L5eiZAuW5M83Y`. Rollback: `dpl_JCxCAN4a1Z3eDetgMPCwT6627qjw`
  (commit `473404d2`, v1.396.0). A marcação se desfaz com
  `node scripts/carteira/subir-garden-para-carteira.mjs --desfazer` (devolve status, carimbo e
  observação pela trilha).

## Gravação e conferência (29/09/2026, depois do deploy)

- `v1.397.0` no ar (`/api/version`), `c2x.app.br` 200, `/api/incorporador/carteira` e
  `/api/incorporador/lsoft` 401 sem sessão.
- `subir-garden-para-carteira.mjs --gravar`: 106 gravados, conferência 106 de 106.
- Conferido no banco, por conta própria: 106 com o Garden na carteira, 95 `validado`, 35 clientes do
  Garden na integração (de 141), 9.868 parcelas e R$ 30.556.722,22 em aberto no Financeiro, 497
  linhas de trilha do script, nenhuma marca estranha.
- O que o Financeiro mostra para o Garden, calculado pela mesma função da rota (só leitura): 106
  unidades, Carteira total R$ 35.041.558,35, Recebido R$ 4.484.836,13, A receber R$ 30.478.763,24,
  Vencido R$ 77.958,98 (24 parcelas, 13 clientes), inadimplência 1,67% (vencido sobre o previsto até
  hoje, a régua do Financeiro), 14 unidades com aviso (outro lote ou lote em conferência), nenhuma
  sem lote.
