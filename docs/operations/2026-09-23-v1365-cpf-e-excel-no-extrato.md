# v1.365.0 — CPF e exportação em Excel no extrato da carteira

**Deploy:** 23/09/2026, `dpl_GGrb6WdaJTCJhuHAXPuDbS5xVDxH` READY em Production.
**Healthcheck:** `c2x.app.br` HTTP 200 em 0,39 s; `/api/version` devolve
`{"buildTag":"2026-09-23-cpf-e-excel-no-extrato","version":"1.365.0"}`.
**Commit publicado:** `21e39421` (merge) · **Rollback:** `30c38dcc` (v1.364.0, o espelho).
**Autorização:** Lucas, 23/09/2026: *"tem o meu ok"*.

## O pedido

Lucas, 23/09/2026: *"no portal do incorporador, na parte de carteira, temos a parte do extrato.
preciso trazer o CPF para esse painel e ter um botão para exportar em xlsx"*. E, sobre a fonte:
*"acho que todo o cliente está dentro do apolo, o que vem do legado é a parte financeira, a
cadastral temos no apolo"*.

## A decisão da fonte, com a medição que a resolveu

O ponto do Lucas está certo sobre o cadastral, mas o caminho não fecha: o extrato **nasce do C2X** e
a chave dele é `acquisition_requests.client_id`. Ir ao Apolo exigiria casar por **CPF** (circular: é
o dado que se quer descobrir) ou por **`client_c2x_id`**, que colide. Medido em 23/09/2026, o
`users` que o join da carteira **já carrega**:

| clientes na carteira | com CPF | com CNPJ | sem documento |
|---|---|---|---|
| 856 | 839 | 18 | **0** |

Todos os CPFs com 11 dígitos, gravados pontuados (`000.000.000-00`). Nenhum empreendimento tem
cliente sem documento. Virou uma linha no `SELECT`, sem join novo.

## O que mudou

- `carteira-liquida.ts`: `documento` em `LinhaCruaDaCarteira` e `ExtratoParcela`,
  `coalesce(nullif(trim(cli.cpf),''), nullif(trim(cli.cnpj),''))` no SELECT, guardado **só dígitos**
  (quem formata é a tela e a planilha). A busca do extrato casa documento por dígito, com **piso de
  6**: sem ele, procurar a unidade "L18" viraria "18" e traria todo CPF que contém 18.
- `planilha-do-extrato.ts` (novo) + `?formato=xlsx` na rota da carteira.
- `TelaCarteira.tsx`: coluna CPF/CNPJ, botão Excel, e `parametrosDoExtrato` extraído para que a
  busca da aba e a exportação mandem exatamente o mesmo recorte.

⚠️ **A privacidade foi estreitada, não desligada.** O comentário de `ExtratoParcela` dizia "SÓ NOME,
NUNCA DOCUMENTO" (cautela minha de quando montei o portal, não decisão do Lucas). Agora registra a
decisão dele com data, e **telefone e e-mail continuam fora**: esses servem para ABORDAR o cliente,
e a abordagem é da Careli, não do loteador. O teste que travava isso continua acusando `email`,
`telefone`, `entityId`, `url` e `boleto`.

⚠️ **A exportação NÃO podia sair do que está na tela**, ao contrário da planilha de boletos. Lá a
competência inteira cabe no envio (334 boletos no maior mês); aqui o extrato tem teto de payload de
2.000 linhas e o Vale do Ouro sozinho tem **27.721 parcelas**. `montarIndicadores` ganhou
`tetoDoExtrato`, que é teto de **envio**, nunca de conta: `extratoTotal` e os totais do recorte
continuam saindo do recorte inteiro.

⚠️ **A exportação entrou na PRÓPRIA rota da carteira**, e não numa sub-rota. Uma rota própria teria
que repetir a resolução de escopo, o seletor de produtos, o mapa de nomes e a política comercial, e
é exatamente a segunda leitura "quase igual" que faz a planilha e a tela contarem histórias
diferentes.

## Achado de borda, que já valia antes desta entrega

A leitura da carteira para em **30.000 linhas** (`TETO`) e há empreendimento que passa disso
**sozinho**. Medido em 23/09/2026:

```
LOS 37.956   LOU 30.252   VOC 13.942   VOL 13.779   REP 9.014   VAL 4.732
MDS 3.577    RVP 3.034    LBF 2.691    ACP 1.004    (total 120.534)
```

Para portal com LOS ou LOU no escopo, **indicador e líquido já saem parciais hoje**. A rota já
produzia `parcial: true` e a tela já avisava; agora esse sinal atravessa para o arquivo e vira a
frase `PARCIAL: a leitura bateu no teto` na linha do total, mais o header `X-Parcial`. Planilha
truncada em silêncio é pior do que planilha nenhuma. **Não foi decidido o que fazer com o teto** —
o número existe, a decisão não.

## Medição de ponta a ponta (dado real, VOC+VOL)

783 ms de leitura no C2X · 1.067 ms de montagem do xlsx · 1,39 MB · 27.721 linhas · 100% com
documento (165 CPF e 3 CNPJ distintos). Bem dentro do `maxDuration` de 30 s.

## A colisão de versão, e como foi resolvida

O push foi **rejeitado por non-fast-forward**: entre a conferência e o push, outra sessão subiu
`30c38dcc` (o espelho público negociando) usando **a mesma versão 1.364.0** que eu tinha escrito.
Resolução: merge da main, changelog reconstruído a partir da versão dela (entrada do espelho
intacta em 1.364.0) com a minha entrada renumerada para **1.365.0** e o rollback reapontado para
`30c38dcc`. Nenhuma entrada foi perdida; a cadeia de rollback ficou 1.365.0 → 1.364.0 → 1.363.0.

É exatamente o risco descrito em `2026-09-23-portal-cecilio-startup-prompt.md`: o changelog no
índice 0 é o ponto de colisão mais provável entre sessões, e a entrada deve ser criada **no momento
de subir**, conferindo `git log origin/main -1` antes.

## Verificação

Typecheck limpo · lint limpo nos arquivos tocados · **534 arquivos de teste, 8.222 testes, todos
passando** (18 novos nesta entrega). O primeiro push acusou "typecheck falhou" no hook e o segundo
passou sem mudança nenhuma no código: falha transitória de carga, o mesmo padrão já registrado.

## Fica pendente

- O roadmap **não foi mexido**: a `FRENTE_ATUAL` é da Têmis e nenhum item cobre o portal do
  incorporador. Não inventei item para marcar entregue.
- O commit `6a7d5667` (registro da v1.363.0) subiu junto neste push, saindo da fila.
- Decidir o que fazer com o teto de 30.000 para LOS e LOU.
