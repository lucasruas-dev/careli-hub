# 2026-09-29 · Exportar para Excel na LSoft Integração e no Financeiro

Pedido do Lucas, olhando a LSoft Integração no portal da Cecílio Rocha: *"coloca exportação para
xlsx por favor nessa tela"*, e logo depois *"na tela do financeiro tbm"*.

Commit `0878f972` na branch `feat/portal-cecilio-melhorias`. Nenhuma escrita no banco, nenhuma
migration.

**No ar como v1.395.0** (OK do Lucas: *"tem o meu ok"*, 29/09/2026): push na main
`d8c2ec81..26d62344`, deployment `dpl_4RCnDUfYDTWJktf8LoYPhDDgBAK7`. Rollback:
`dpl_FdGkt7F5gESoPw2op8DcghMHDz2P` (commit `d8c2ec81`, v1.394.1). O login não funciona no preview, e
por isso a conferência visual é em produção.

## LSoft Integração

Botão **Excel** no cabeçalho, ao lado do recarregar, só na visão Carteira. Vale nas duas portas: o
`/lsoft` do time interno e o portal (cer, cecilio-rocha).

- **O arquivo é montado no servidor.** As parcelas não chegam à tela (só na ficha de cada cliente),
  então a rota refaz a leitura com o filtro da tela: a busca APLICADA, o empreendimento e os dois
  checkboxes. A mesma função (`lib/lsoft/filtro-da-tela.ts`) filtra a tela e o arquivo.
- **Três abas:** Clientes (a lista da tela, com os números da própria view), Parcelas (todas as
  parcelas desses clientes, com a marca de patrimônio e a situação do subsídio Caixa) e Sobre (o
  filtro, de quando são os dados do LSoft e as regras de cada total).
- **Rotas:** `GET /api/lsoft/carteira?formato=xlsx` (authorizeApoloRead) e
  `GET /api/incorporador/lsoft?formato=xlsx` (autorizar + portalVeBaseLsoft, antes de qualquer
  leitura). No portal o erro volta genérico; o detalhe fica no log.
- **Leitura blindada:** lotes de 100 clientes, páginas ordenadas por id, contagem exata e conferência
  de ids distintos. Qualquer tropeço derruba a exportação em vez de sair arquivo pela metade.
- ⚠️ **O patrimônio é conferido antes do filtro.** `lerCarteiraDoLsoft` zera o patrimônio calado
  quando a leitura dele falha. Com "Só patrimônio" marcado, isso daria um arquivo vazio com cara de
  completo. A exportação relê o patrimônio e recusa se não fechar.
- ⚠️ **Guarda de 1.000 clientes:** a lista lê a view sem paginar. Com 1.000 ou mais, a exportação
  recusa (a TELA continuaria cortada calada; hoje são 475).

### Medido em produção, só leitura, 29/09/2026 14:30

| Recorte | Clientes | Parcelas | Arquivo | Tempo |
|---|---:|---:|---:|---:|
| Todos | 475 | 32.660 | 1,54 MB | 9,9 s |
| Só patrimônio | 73 | 5.048 | 0,26 MB | 5,5 s |
| Garden | 141 | 13.401 | 0,65 MB | 6,8 s |
| Vale do Sol (só o que falta validar) | 120 | 7.605 | 0,37 MB | 4,8 s |
| Giant Towers (só patrimônio) | 8 | 544 | 0,03 MB | 1,0 s |

Parcelas, pagas, vencidas e A receber fecham com a view em 475 de 475 clientes (Todos) e 120 de 120
(Vale do Sol). Limite da Vercel: 4,5 MB por resposta. As duas rotas declaram `maxDuration = 60`.

## Financeiro, aba Carteira

Botão **Excel** na barra da tabela "Carteira por unidade", ao lado do seletor Todas / Inadimplentes
/ Em dia, com o mesmo desenho do Excel do extrato. Vale para todos os portais de incorporador (como
o do extrato); o modo coordenador não mudou.

- **O arquivo nasce no navegador**, a partir das unidades que a tela já tem (a rota manda todas, sem
  teto), com a busca, o filtro e a ordem da tela. Pedir ao servidor repetiria a leitura do C2X, que é
  a consulta cara desta tela. O ExcelJS entra por import dinâmico, só no clique.
- Aba Carteira (18 colunas, total no fim, aviso se o líquido veio parcial) e aba Sobre.
- ⚠️ **A corrida que a revisão achou:** trocar de empreendimento e clicar em Excel antes da carteira
  nova chegar baixava as unidades do recorte anterior com o nome do novo. Consertado em três partes:
  o nome do recorte sai do dado (`dados.filtro`), só a última leitura pedida escreve na tela (uma
  resposta atrasada é descartada), e o botão trava enquanto a carteira carrega. O descarte da resposta
  atrasada corrige também a tela para quem nunca exporta.

### Consertos vizinhos, na mesma tela

- O Excel do **extrato** (aba Indicadores) baixava com o link solto e a URL revogada na mesma volta
  do clique: é a corrida que fez o PDF do extrato do CRM 360 morrer calado (changelog v1.298.1).
  Passou ao padrão seguro.
- O nome do arquivo do extrato usava a data em UTC: das 21h à meia-noite saía datado de amanhã.
  Passou a usar `hojeNaCasa`.

## Revisão

Workflow com 10 agentes: dois implementadores em paralelo, três revisores por tela (paridade com a
tela, segurança e volume, regras da casa), e um agente por tela conferindo e aplicando os achados.
Sete achados distintos (onze, contando os repetidos entre lentes); todos conferidos no código e
reproduzidos, nenhum recusado. Suíte das áreas tocadas: 163 arquivos,
2.408 testes. Typecheck e lint limpos.

## ⚠️ Pendências para o Lucas decidir

1. **O banco calcula "vencida" em UTC.** `current_setting('TimeZone')` = `UTC` (conferido em
   29/09/2026). As views `lsoft_carteira_por_cliente` (0097) e `..._empreendimento` (0107) usam
   `current_date`: das 21h à meia-noite, a parcela que vence HOJE aparece vencida na tela e na aba
   Clientes, mas não na aba Parcelas (que usa o dia de São Paulo). Correção: trocar por
   `(now() at time zone 'America/Sao_Paulo')::date` nas duas views. É migration.
2. **Em "Todos os empreendimentos", a view 0097 soma como dívida do cliente a parcela confirmada como
   subsídio da Caixa.** Só a escolha do Vale do Sol separa. O arquivo diz isso na aba Sobre; a tela
   não avisa. Alinhar é migration na 0097.
3. **"Cadastro p/ C2X" com empreendimento escolhido:** a view 0107 não tem as colunas
   `campos_c2x_*`, e a TELA mostra 0/9 para todos, inclusive os validados. No arquivo a célula sai
   vazia, com a explicação. O conserto de raiz é migration na 0107.
4. O arquivo não traz telefone nem e-mail dos clientes (a tabela da tela também não). Entra se o Lucas
   quiser.
