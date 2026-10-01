# LSoft da Cecílio Rocha: como acessar e o que já está mapeado (01/10/2026)

Roteiro para a sessão que vai fazer importação a partir do LSoft. Junta o que está espalhado pela
memória (`reference_lsoft_*`), pelos scripts de `scripts/lsoft/` e pelos registros de 24/09 a 30/09.
Números do espelho conferidos no banco de produção em 01/10/2026, só com SELECT.

## 1. O que é e onde fica

- **LSoft SGC 6.13**, sistema desktop que a Cecílio usa como **contas a pagar e a receber**. Não é
  usado como ERP: vendas, estoque, nota fiscal e produção estão vazios.
- O banco é um arquivo **Microsoft Access anterior ao Access 2000**:
  `\\SERVIDOR\Sistema\sgc\dados.mdb` (~64 MB). Acessível direto do notebook do Lucas (conferido em
  01/10/2026: arquivo gravado às 11:05 do mesmo dia). O IP `192.168.1.254` (RDP) não é necessário e
  nem sempre responde desta máquina.
- As pastas `sgc1` a `sgc4` são estações (só o executável). O banco é só o `sgc\dados.mdb`.
- ⚠️ **O time da Cecílio trabalha na base o dia inteiro.** Nunca abrir o `.mdb` da rede: copiar para o
  scratchpad e ler a CÓPIA.

## 2. Como ler

1. Copiar: `Copy-Item '\\SERVIDOR\Sistema\sgc\dados.mdb' '<scratchpad>\lsoft\dados-AAAA-MM-DD.mdb'`.
2. Abrir com **`Microsoft.Jet.OLEDB.4.0`, que só existe em 32 bits**. O driver moderno (ACE 12/16)
   recusa com "banco de dados criado com uma versão anterior do aplicativo". Rodar pelo PowerShell
   de 32 bits:
   `C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -File <script.ps1> ...`
3. Conexão: `Provider=Microsoft.Jet.OLEDB.4.0;Data Source=<cópia>;Mode=Read`. Os scripts de
   `scripts/lsoft/` já checam se o processo é 64 bits e param com a instrução certa.

Armadilhas do SQL do Jet, todas já pagas:
- apelido de coluna exige `AS` (`MIN(x) AS de`);
- não existe `COUNT(DISTINCT ...)`: use `SELECT COUNT(*) FROM (SELECT DISTINCT ...)`;
- não aceita `UNION` dentro de subconsulta: troque por dois `IN (...) OR ... IN (...)`;
- `DATA`, `LOCAL`, `OS` e `VALOR` são palavras reservadas: coluna sempre entre colchetes, senão o
  erro é "Syntax error" sem dizer qual coluna;
- data literal é `#MM/dd/yyyy#`;
- script `.ps1` para o PowerShell 5.1 precisa ser salvo com **BOM**, senão os acentos quebram o
  parser.

## 3. O mapa do banco do LSoft

Das **412 tabelas, só 54 têm dados**. As que importam:

| tabela | o que é | volume (ago/2026) |
|---|---|---|
| `CLIENTES` | cadastro dos clientes (chave `CODIGO`, texto com zeros, ex. `00000587`) | 662 |
| `RECEBER` | títulos a receber (em aberto) | ~21 mil |
| `RECEBIDOS` | títulos já recebidos | ~21 mil, desde 2008 |
| `PAGAR` / `PAGOS` | contas a pagar e pagas | PAGOS 98 mil (R$ 160 mi desde 2015) |
| `FORNECEDORES` | fornecedores | 3.159 |
| tabela de categorias | `CODIGO` + nome; o `descobrir-e-extrair-todos.ps1` acha o nome dela sozinho | 137 categorias |

Vazias (não procurar dado nelas): `EXTRATO_BANCARIO`, `MOVIMENTAÇÃO_DIARIA`, `PLANOCONTAS`, vendas,
estoque, NF, produção. `LANCAMENTOS` tem 18 linhas, de combustível.

**Colunas usadas pela extração** (são as que o importador conhece):
- `CLIENTES`: `CODIGO, NOME, CPF, RG, NASCIMENTO, TELEFONE, CELULAR, EMAIL, ENDERECO, BAIRRO,
  CIDADE, ESTADO, CEP, CONJUGE, PAI, MAE, DATACADAST, VENDEDOR, BLOQUEADO`.
- `RECEBER`: `ID, CATEGORIA, CLASSE, SUBCLASSE, CLIENTE, PARCELA, VENCIMENTO, VALOR,
  VALORRECEBIDO, OBSERVACOES, DATA, NRONOTA, BOLETO, SITUACAO`.
- `RECEBIDOS`: as mesmas, mais `DATARECEBIDO`, `RECEBIDO_POR` e `TIPO`.

### As regras que o banco esconde

1. **O "centro de custo" é a tripla `CATEGORIA.CLASSE.SUBCLASSE`, e a CATEGORIA é o
   empreendimento.** "Aptos Vendidos" (classe 16, subclasse 3) se repete em várias categorias.
2. **Pagar uma parcela MOVE a linha** de `RECEBER` para `RECEBIDOS` (INSERT + DELETE). Não há campo
   "pago", e o `ID` é autonumeração com sequência própria em cada tabela: não existe id estável da
   parcela entre as duas.
3. **`VALOR` é o devido e `VALORRECEBIDO` é o que entrou.** A diferença é juros, reajuste, desconto
   ou pagamento parcial, e não erro. O `VALOR` nunca se reescreve numa conciliação (isso já custou a
   correção de 154 parcelas).
4. **A unidade vive em texto livre**, em `OBSERVACOES` de cada parcela: no Garden
   `"LOTE: 109 QUADRA: 08"`, com variações (`"LOTE 3 QUADRA 8 70.000 PERMUTA"`,
   `"APTO 1503 LUA/1508 SOL GIANT TOWERS 720.000"`). Não há coluna de unidade.
5. **`CLIENTE + PARCELA + VENCIMENTO` não é único**: cliente com dois lotes repete a mesma parcela
   (já houve 5 linhas iguais). O desempate é `VALOR`, e o que separa de verdade é `OBSERVACOES`.
6. **O Garden no LSoft usa o lote ANTIGO** (numeração corrida pelo loteamento: 109, 212, 421). O
   Panteon, o masterplan e os boletos usam o NOVO (`Q08 L09`). O mapa conferido está em
   `apps/hub/lib/lsoft/lotes-do-garden.ts` (143 lotes).

### Categorias já identificadas

| categoria | empreendimento (nome no Panteon) | observação |
|---|---|---|
| 124 | Garden | extraído só com classe 16, subclasse 3 |
| 102 | Vale do Sol | idem |
| 69 | Vale do Ouro - 2 | no LSoft se chama "Loteamento José Lino". A 129 ("Pórtico") tem zero título |
| 118 | Giant Towers | torres LUA e SOL aparecem no texto |
| 66 e 126 | On Sky | 126 é o "Enxoval On Sky" |
| 70 | Guaimbé | |
| 115 | Ed. Rubi e Ed. Jade | UMA categoria para dois produtos: quem separa é o texto |
| 17 | patrimônio ("Vitor") | mistura vários produtos; o produto sai do texto, e o título leva a tag de patrimônio (decisão do Lucas) |
| 9 | Cecílio Rocha | |
| 125, 133, 134, 135 | do Garden | Leninha, Clube, Marketing, Patrimônio |
| 122 | Edifício Safira | não está no espelho |

Esmeralda e Cristal **não existem** como categoria: só aparecem no texto da 17.

A régua que decide o empreendimento de cada título (categoria primeiro; nas ambíguas 17 e 115, o
texto) está em `apps/hub/lib/lsoft/categorias.ts`, com teste. O nome tem de ser idêntico ao catálogo
de boletos (`lib/apolo/boletos/empreendimentos.ts`), porque a tela casa por igualdade de texto.

## 4. O que já existe no Panteon (o espelho)

Tabelas em `public` (projeto `bxgukywoxgivlrhjkwjx`), todas com prefixo `lsoft_`:

| tabela | papel |
|---|---|
| `lsoft_clientes` | cadastro (44 colunas, chave `codigo`); campos do MOST, `status_validacao`, `empreendimentos_na_carteira` (quem já subiu para o Financeiro) |
| `lsoft_parcelas` | parcelas (`origem` receber ou recebido, `empreendimento`, `categoria_lsoft`, `observacoes`, `lote`, `quadra`, `valor`, `valor_recebido`, `paga`). ⚠️ `lsoft_id` existe e está VAZIO |
| `lsoft_clientes_edicoes` | trilha de toda edição feita na tela; sobrevive à recarga pela impressão digital (0188) |
| `lsoft_classificacao_de_parcela` | classificação (subsídio da Caixa, patrimônio), casada por impressão digital (0103, 0108) |
| `lsoft_credito_da_caixa` | crédito da Caixa (0105, 0107) |
| `lsoft_documentos` | anexos por ficha (bucket `apolo-documents`) |
| `lsoft_sincronizacoes` | registro de cada carga (`iniciado_em`, `concluido_em`, `clientes`, `parcelas`, `ok`, `erro`) |
| `lsoft_carteira_por_cliente` e `lsoft_carteira_por_cliente_empreendimento` | views 0097 e 0107 (carteira por cliente e por cliente x empreendimento) |

Migrations: 0096, 0097, 0098, 0099, 0103, 0104, 0105, 0107, 0108, 0144, 0188, 0189, 0190, 0199.

**Estado em 01/10/2026:** 475 clientes, 32.660 parcelas. Última carga em 24/09/2026 (categorias novas,
243 clientes e 11.794 parcelas, `ok`); Garden, Vale do Sol e Vale do Ouro vêm da carga de 16/09.

| empreendimento | categorias | parcelas | em aberto | clientes |
|---|---|---:|---:|---:|
| Garden | 124 | 13.401 | 12.317 | 141 |
| Vale do Sol | 102 + 17 | 7.605 | 5.610 | 120 |
| On Sky | 66 + 126 + 17 | 3.282 | 439 | 120 |
| Giant Towers | 118 + 17 | 2.267 | 1.685 | 47 |
| Guaimbé | 70 + 17 | 2.264 | 531 | 51 |
| A classificar | 17 | 1.811 | 156 | 124 |
| Mirage Residence | 17 | 651 | 23 | 30 |
| Vale do Ouro - 2 | 69 | 621 | 587 | 11 |
| Manhattan | 17 | 307 | 0 | 11 |
| Ed. Rubi | 115 + 17 | 187 | 104 | 5 |
| Ed. Jade | 115 | 138 | 116 | 4 |
| Ed. Cristal | 17 | 81 | 32 | 10 |
| Ed. Esmeralda | 17 | 45 | 2 | 2 |

(Clientes somados por categoria: quem está em duas categorias conta duas vezes.)

O que já saiu do espelho para o Panteon de verdade: **106 clientes do Garden** validados pelo time estão
no Financeiro do portal `cecilio-rocha` (v1.397.0 a v1.399.0). ⚠️ **De setembro em diante, quem dá
baixa nas parcelas do Garden é o hub**, pelo boleto do Asaas (autor "Hub · boleto Asaas <id>", de
hora em hora). Uma recarga da categoria 124 vinda do LSoft precisa respeitar essas baixas: a
conferência da carga recusa desfazer baixa feita no Panteon, a menos de `--aceitar-perda-de-edicao`.

## 5. As ferramentas que já existem (rodar da raiz do worktree)

| script | o que faz |
|---|---|
| `scripts/lsoft/descobrir-e-extrair-todos.ps1 -Mdb <cópia> -Saida <pasta> -SoDescobrir` | lista as categorias com título e a contagem de cada uma |
| `scripts/lsoft/extrair-por-categoria.ps1 -Mdb <cópia> -Saida <pasta> -Categorias 118,66` | extrai clientes, a receber e recebidos no formato do importador. Recusa 124, 102 e 69 |
| `scripts/lsoft/extrair-garden-vale-do-sol.ps1` e `extrair-vale-do-ouro.ps1` | extratores das três carteiras antigas (com o filtro de classe delas) |
| `node scripts/lsoft/importar-para-supabase.mjs <pasta> --ensaio` | lê os CSVs, confere contra o espelho e PARA antes de gravar |
| `node scripts/lsoft/importar-para-supabase.mjs <pasta>` | grava antes de apagar, só nas categorias que vieram, desfaz se falhar, e no fim religa a trilha e a classificação sozinho |
| `reconciliar-classificacao.mjs`, `reconciliar-trilha.mjs` | religadores (já rodam no fim da carga; usar à mão só para conferir) |

Os CSVs saem com `;` e BOM (`LSOFT_CLIENTES.csv`, `LSOFT_A_RECEBER.csv`, `LSOFT_RECEBIDOS.csv`). O
importador lê o `.env.local` de `apps/hub` ou, no worktree, o do checkout principal
(`careli-hub/apps/hub/.env.local`).

Para levar um empreendimento NOVO ao espelho: nome em `EMPREENDIMENTOS_DO_ESPELHO`
(`lib/lsoft/categorias.ts`) **e** no CHECK `lsoft_parcelas_empreendimento_check` (migration nova;
um teste compara os dois). Sem isso, a carga cai no banco.

## 6. Regras que valem para a importação

- **O LSoft é só leitura.** Escrita de volta no Access só aconteceu uma vez (baixas de setembro),
  com backup do `.mdb`, transação, casamento conferido 1 para 1 e OK do Lucas. A receita está na
  memória `reference_lsoft_como_dar_baixa`.
- **Banco do Panteon:** ensaio é livre; carga, migration e qualquer escrita em produção exigem OK
  explícito do Lucas, a cada vez.
- **A Cecílio não tem vínculo com o C2X.** Nada vai para o legado, nem como consulta.
- **Sem CPF nem nome de cliente** em arquivo que vai para o git. Cópias do `.mdb`, CSVs e relatórios
  ficam no scratchpad ou em `Documents\Relatórios Panteon`.
- **O simples primeiro:** o Lucas quer o caminho curto e a estimativa de tempo antes de começar.

## 7. Pendências conhecidas que podem cruzar com a importação

1. A recarga do Garden e do Vale do Sol estava **travada** em 24/09 por uma divergência: cliente
   `00000587`, parcela 007/084, recebido R$ 2.207,18 na tela contra R$ 4.414,36 no LSoft. Conferir se
   ainda vale antes de recarregar a 124 ou a 102.
2. "A classificar" (categoria 17 sem produto no texto): 156 parcelas em aberto, valores altos.
3. `lsoft_id` nunca foi gravado. A extração já lê `RECEBER.ID` e `RECEBIDOS.ID`; gravar é barato e
   facilita qualquer escrita de volta.
4. 3 classificações da Caixa órfãs desde 16/09 (parcelas que sumiram do LSoft).
5. O carimbo "dados de" da tela é global: depois de uma carga parcial, a tela diz que tudo foi
   atualizado.
