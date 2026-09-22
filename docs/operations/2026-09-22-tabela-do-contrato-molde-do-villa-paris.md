# 2026-09-22 — A tabela do contrato e o molde do Villa Paris

> Registro operacional. Mora em arquivo próprio porque `engineering-operations.md` está com 3,8 MB
> e o hook de pre-commit bloqueia qualquer commit que o traga no stage. Mesmo padrão do registro de
> 21/09/2026. O conserto de verdade é a rotação do diário, e ela continua sem decisão.

Registro de diario:

- `Zeus`
- Data e hora local: 2026-09-22 12:53:41 -03:00.
- Tipo: Deploy de producao (v1.360.5) e analise do contrato do Villa Paris no C2X legado.
- Motivo da analise: o contrato do VOL Q11 L07 (VITORIA SILVA ARAUJO) voltou do juridico com quatro
  queixas da Nivea em 22/09/2026 -- o quadro de pagamento trazia a comissao dentro do fluxo, a area
  saia com a unidade repetida, o preco parecia nao corrigido e a tela de anexos nao aceitava
  arquivo. Lucas mandou analisar um contrato do Villa Paris no C2X *"para vc entender a tabela e
  como isso e montado"*.
- O que foi lido no legado (SOMENTE SELECT, `lib/guardian/db.ts`, banco `prod_careli`):
  `acquisition_requests` 4834 (code RVP2, lote RVPA01, `enterprises` 38), `commercial_plans` 3288,
  184 linhas de `payments` com `split_data`, `acquisition_request_contracts` 3011 (`complete_text`,
  132.188 chars) e `draft_contracts` 82.
- O MOLDE DA CASA, medido: a tabela do Quadro-Resumo do C2X tem as colunas TIPO DE PARCELA /
  CORRECAO MONETARIA / JUROS / PRIMEIRO VENCIMENTO / N.o DE PARCELAS / VALOR DA PARCELA / VALOR
  TOTAL, e obedece a tres regras.
  1. A serie financiada sai pelo NOMINAL: `180 | R$ 1.195,00 | R$ 215.100,00`, e 180 x 1.195,00 da
     exatamente 215.100,00. IPCA e juros nao entram nos valores, ficam DECLARADOS em coluna e
     detalhados na clausula VII.
  2. As linhas de entrada trazem so a parte do INCORPORADOR, por RATEIO PROPORCIONAL EXATO sobre
     as parcelas de sinal do PLANO. `signal_commercial_plans` do `commercial_plans` 3288 guarda
     8.000,00 / 7.950,00 / 7.950,00 (soma 23.900,00 = 10% de 239.000). A comissao de R$ 16.730,00
     da 16.730 / 23.900 = 0,70 EXATO, e 8.000 x 0,30 = 2.400,00, 7.950 x 0,30 = 2.385,00,
     7.950 x 0,30 = 2.385,00 -- as tres celulas da tabela, sem arredondamento nenhum.

     ⚠️ A FONTE E O PLANO, NAO A TABELA `payments`. Em `payments` a mesma venda aparece como Ato
     1.000,00 + Sinal 7.000,00 + 7.950,00 + 7.950,00: o Ato foi DESMEMBRADO dos 8.000,00 da
     primeira parcela do plano. Quem montasse a tabela lendo `payments` produziria quatro linhas e
     um primeiro valor de 2.100,00 em vez de 2.400,00. E a razao pela qual o Ato nao vira linha no
     contrato: no plano ele nunca existiu separado.

     ⚠️ ERRO MEU CORRIGIDO NO MESMO DIA: eu havia concluido, olhando `payments.split_data`, que a
     tabela imprimia a fatia do incorporador no split do Asaas (2.399,67 / 2.384,67 / 2.384,67).
     Os numeros ficam perto porque o split segue a MESMA proporcao, menos as taxas de boleto de
     R$ 1,99 -- mas o mecanismo e o rateio sobre o plano, e a diferenca importa: o split so existe
     depois que a cobranca e emitida, e o contrato e escrito antes. O split daquela venda tem sete
     pontas (Coordenacao, Imobiliaria, Gerente, Captador, Gestora de receiveis, Taxa administrativa
     e Incorporador) e nenhuma delas e a fonte do papel.
  3. O rodape do quadro E o 6.1 PRECO DO LOTE: 7.170,00 + 215.100,00 = 222.270,00, contra um 6.2
     PRECO TOTAL DA AQUISICAO de R$ 239.000,00.
- Decisao do Lucas nesta rodada: total nominal (*"como o Villa Paris"*) e, quando o cronograma
  passar a separar o ato da entrada, o ato soma na primeira linha de Entrada. E a definicao de
  comissao no Panteon: *"no panteon a comissao e a soma desses dois campos, imobiliaria e
  coordenadora"*.
- Arquivos/modulos afetados: `lib/temis/tabela-de-pagamentos.ts` (abatimento da comissao no fluxo da
  entrada + series pelo nominal + total geral pela soma das linhas), `lib/temis/dados-do-contrato.ts`
  (`comissaoTotalEmCentavos`, fonte unica), `lib/temis/preencher-contrato.ts` (trava da unidade de
  area repetida), `modules/apolo/blocks/empreendimentos/anexos-do-contrato.tsx` (campo de arquivo
  limpo em toda recusa, erro que some ao digitar, botao travado ate a linha estar pronta; a
  `CapaDaMinuta` tinha o mesmo defeito, inclusive no caminho de sucesso).
- Achado que explica a queixa do preco: os contratos de hoje JA saiam certos. O v3 da VITORIA
  (11:54) e o da MARIA LUIZA (11:30) usaram a minuta VOL v10, corrigida; o PDF do print da Nivea era
  o v2, das 04:10, gerado com a v7 arquivada.
- Achado que explica a queixa dos anexos: o envio dispara no `onChange` do campo de arquivo e a
  validacao recusava SEM limpar o campo. Escolher o MESMO PDF de novo nao disparava nada, e o botao
  passava a parecer quebrado -- Nivea: *"nao consigo colocar dessa forma"*.
- Resultado no contrato real da VITORIA (proposta c5855a63, montado pelo motor): 6.1
  R$ 125.537,94, 6.2 R$ 133.551,00, `Entrada 1 x R$ 5.342,04`, `Mensal 156 x R$ 770,49 =
  R$ 120.195,90`, rodape R$ 125.537,94. Antes do deploy o rodape dava R$ 209.759,04 embaixo de um
  6.1 de R$ 125.537,94, e o documento se contradizia na mesma pagina.
- Validacao: `check-types` limpo; suite completa com 500 arquivos e 7.829 testes passando.
- Deploy: commit `aff21ebb`, deployment `dpl_Cs1ZkNAJiK4XW7Pfc94e6oCXkmVx`, autorizado pelo Lucas
  (*"pode subir"*). Rollback: `dpl_HoTU2LryZp9wSx6uMGW3QjQvtU5W` (commit `bd6bd8b1`, v1.360.4).
- Riscos: o desenho do quadro mudou para TODO contrato novo, nao so para o VOL; contratos ja gerados
  nao sao reprocessados.
- Confirmacao posterior ao deploy: o rateio proporcional que subiu e EXATAMENTE o que o legado faz
  (medido em `signal_commercial_plans` 3288, fator 0,30 exato). O codigo nao precisou de ajuste.
- Pendencias: validacao visual do Lucas e da Nivea em um contrato novo; decidir se o quadro leva uma
  linha dizendo que os valores sao os devidos a VENDEDORA (a corretagem fica no item VIII); orientar
  a Nivea sobre o cadastro de anexos agora que a tela destravou.
- Status: EM PRODUCAO.
