# ACHAR OS CLIENTES DO VALE DO OURO (lista do Vitor) no LSoft.
#
# Pedido do Lucas (08/09/2026), na Cecilio: dez compradores de lote do Vale do Ouro que NAO estao
# no Panteon nem no C2X — conferido nos dois. Se existem em algum lugar, e aqui.
#
# ⚠️ RODA EM POWERSHELL 32 BITS. O banco e anterior ao Access 2000: o driver moderno (ACE) recusa
# abrir, e o motor que abre (Jet 4.0) so existe em 32 bits.
#
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -File achar-clientes-vale-do-ouro.ps1 -Mdb <copia.mdb> -Saida <pasta>
#
# ⚠️ LE UMA COPIA, nunca o \\SERVIDOR\Sistema\sgc\dados.mdb direto: o sistema fica em uso o dia
# inteiro e abrir o arquivo vivo pode travar quem esta trabalhando.
#
# ⚠️ PROCURA DE TRES JEITOS, porque um so nao acha:
#   1. pelo NOME (com trecho, para "FRABRICIO" achar "FABRICIO" e vice-versa);
#   2. pela CATEGORIA 129 (Portico Loteamento Vale do Ouro) nas parcelas;
#   3. pelo LOTE/QUADRA no texto livre de OBSERVACOES — que e onde a unidade mora no LSoft.
# Quem nao aparecer em NENHUM dos tres provavelmente nao esta no LSoft.

param(
  [Parameter(Mandatory = $true)][string]$Mdb,
  [Parameter(Mandatory = $true)][string]$Saida
)

$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force $Saida | Out-Null

$conn = New-Object System.Data.OleDb.OleDbConnection("Provider=Microsoft.Jet.OLEDB.4.0;Data Source=$Mdb;Mode=Read")
$conn.Open()

function Consultar([string]$sql) {
  $cmd = $conn.CreateCommand()
  $cmd.CommandText = $sql
  $tabela = New-Object System.Data.DataTable
  (New-Object System.Data.OleDb.OleDbDataAdapter $cmd).Fill($tabela) | Out-Null
  return $tabela
}

function Exportar($tabela, [string]$arquivo) {
  $destino = Join-Path $Saida $arquivo
  # ; como separador e BOM: e o que o Excel em pt-BR abre sem pedir nada.
  $tabela | Export-Csv -Path $destino -Delimiter ";" -NoTypeInformation -Encoding UTF8
  "{0,6:N0} linhas -> {1}" -f $tabela.Rows.Count, $arquivo
}

# ── OS DEZ, e o trecho por onde procurar cada um ────────────────────────────
# O trecho e a parte MENOS sujeita a variacao de grafia: sobrenome do meio, geralmente.
$alvos = @(
  @{ Nome = "LIBERIO EUSTAQUIO DE ALMEIDA"; Trecho = "LIBERIO";   Lote = "7";  Quadra = "5"  },
  @{ Nome = "THIAGO TAVARES PEREIRA";       Trecho = "TAVARES";   Lote = "2";  Quadra = "10" },
  @{ Nome = "AMANDA CASSIANO GOMES";        Trecho = "CASSIANO";  Lote = "8";  Quadra = "5"  },
  @{ Nome = "FRABRICIO SOUSA VIEIRA";       Trecho = "VIEIRA";    Lote = "11"; Quadra = "5"  },
  @{ Nome = "LUCAS FRANCO RESENDE";         Trecho = "RESENDE";   Lote = "5";  Quadra = "10" },
  @{ Nome = "FERNANDO CASSIANO GOMES";      Trecho = "CASSIANO";  Lote = "4";  Quadra = "10" },
  @{ Nome = "LUCAS AGUIAR SOARES";          Trecho = "AGUIAR";    Lote = "3";  Quadra = "10" },
  @{ Nome = "JONAS RAIMUNDO DE OLIVEIRA";   Trecho = "RAIMUNDO";  Lote = "37"; Quadra = "10" },
  @{ Nome = "JOAO PAULO CARVALHO SOUZA";    Trecho = "JOAO PAULO"; Lote = "36"; Quadra = "10" },
  @{ Nome = "RAMON MENDES DE CARVALHO";     Trecho = "RAMON";     Lote = "1";  Quadra = "10" }
)

"BUSCA DOS CLIENTES DO VALE DO OURO (lista do Vitor) — LSoft"
"=========================================================="
""

# ── 1. POR NOME, na tabela de clientes ──────────────────────────────────────
"1. POR NOME em CLIENTES"
"------------------------"
$achadosPorNome = New-Object System.Data.DataTable
$primeiro = $true
foreach ($a in $alvos) {
  $t = $a.Trecho.Replace("'", "''")
  $tab = Consultar @"
SELECT C.CODIGO, C.NOME, C.CPF, C.RG, C.NASCIMENTO, C.TELEFONE, C.CELULAR, C.EMAIL,
       C.ENDERECO, C.BAIRRO, C.CIDADE, C.ESTADO, C.CEP, C.CONJUGE, C.PAI, C.MAE,
       C.DATACADAST, C.VENDEDOR
  FROM CLIENTES C
 WHERE C.NOME LIKE '%$t%'
 ORDER BY C.NOME
"@
  if ($tab.Rows.Count -eq 0) {
    "  [ nao achou ] {0}  (procurei por '{1}')" -f $a.Nome, $a.Trecho
  } else {
    foreach ($r in $tab.Rows) {
      "  [ ACHOU    ] {0}  ->  cod {1} | {2} | CPF {3} | {4}" -f $a.Nome, $r.CODIGO, $r.NOME, $r.CPF, $r.CIDADE
    }
    if ($primeiro) { $achadosPorNome = $tab.Clone(); $primeiro = $false }
    foreach ($r in $tab.Rows) { $achadosPorNome.ImportRow($r) }
  }
}
""
if ($achadosPorNome.Rows.Count -gt 0) { Exportar $achadosPorNome "VALEDOOURO_CLIENTES_POR_NOME.csv" }
""

# ── 2. TUDO da categoria 129 (Portico Loteamento Vale do Ouro) ──────────────
# ⚠️ A CATEGORIA E O EMPREENDIMENTO no LSoft — 129 e o Vale do Ouro. A classe/subclasse NAO e
# filtrada aqui de proposito: no Garden a receita de venda e 16.3, mas nada garante que o
# loteamento use a mesma, e um filtro errado devolveria zero sem dizer por que.
"2. TUDO da CATEGORIA 129 (Vale do Ouro)"
"----------------------------------------"
$porCategoria = Consultar @"
SELECT R.CLASSE, R.SUBCLASSE, R.CLIENTE, C.NOME, C.CPF, C.CELULAR, C.CIDADE,
       R.PARCELA, R.VENCIMENTO, R.VALOR, R.OBSERVACOES
  FROM RECEBER R LEFT JOIN CLIENTES C ON C.CODIGO = R.CLIENTE
 WHERE R.CATEGORIA = 129
 ORDER BY C.NOME, R.VENCIMENTO
"@
"  RECEBER na categoria 129: {0} parcelas" -f $porCategoria.Rows.Count
if ($porCategoria.Rows.Count -gt 0) { Exportar $porCategoria "VALEDOOURO_RECEBER_CAT129.csv" }

$recebidos129 = Consultar @"
SELECT R.CLASSE, R.SUBCLASSE, R.CLIENTE, C.NOME, C.CPF, R.PARCELA, R.VENCIMENTO,
       R.DATARECEBIDO, R.VALOR, R.VALORRECEBIDO, R.OBSERVACOES
  FROM RECEBIDOS R LEFT JOIN CLIENTES C ON C.CODIGO = R.CLIENTE
 WHERE R.CATEGORIA = 129
 ORDER BY C.NOME, R.DATARECEBIDO
"@
"  RECEBIDOS na categoria 129: {0} parcelas" -f $recebidos129.Rows.Count
if ($recebidos129.Rows.Count -gt 0) { Exportar $recebidos129 "VALEDOOURO_RECEBIDOS_CAT129.csv" }
""

# ── 3. PELO LOTE/QUADRA no texto livre ──────────────────────────────────────
# ⚠️ A UNIDADE VIVE EM TEXTO LIVRE no campo OBSERVACOES, e a grafia varia ("LOTE: 8 QUADRA: 5",
# "LOTE 8 QD 5", "L8 Q5"). Aqui a busca e larga de proposito: pega qualquer observacao que cite o
# numero do lote, e quem le decide. Sem isso, uma variacao de grafia esconde o cliente inteiro.
"3. POR LOTE/QUADRA nas OBSERVACOES (qualquer categoria)"
"-------------------------------------------------------"
$porTexto = Consultar @"
SELECT R.CATEGORIA, R.CLASSE, R.SUBCLASSE, R.CLIENTE, C.NOME, C.CPF,
       R.PARCELA, R.VENCIMENTO, R.VALOR, R.OBSERVACOES
  FROM RECEBER R LEFT JOIN CLIENTES C ON C.CODIGO = R.CLIENTE
 WHERE R.OBSERVACOES LIKE '%VALE DO OURO%' OR R.OBSERVACOES LIKE '%VITOR%'
 ORDER BY R.CATEGORIA, C.NOME
"@
"  parcelas citando 'VALE DO OURO' ou 'VITOR': {0}" -f $porTexto.Rows.Count
if ($porTexto.Rows.Count -gt 0) { Exportar $porTexto "VALEDOOURO_POR_TEXTO.csv" }
""

# ── 4. ONDE MAIS PROCURAR, se os tres acima vierem vazios ───────────────────
# Lista as categorias que existem, para conferir se 129 continua sendo o Vale do Ouro. O cadastro
# de centro de custo muda de nome com o tempo, e um numero que era do loteamento pode ter virado
# outra coisa — descobrir isso aqui e mais rapido do que concluir que "o cliente nao existe".
"4. AS CATEGORIAS QUE TEM MOVIMENTO (para conferir o numero 129)"
"---------------------------------------------------------------"
$cats = Consultar @"
SELECT R.CATEGORIA, COUNT(*) AS PARCELAS
  FROM RECEBER R
 GROUP BY R.CATEGORIA
 ORDER BY COUNT(*) DESC
"@
foreach ($r in $cats.Rows) { "  categoria {0,5} -> {1,6:N0} parcelas" -f $r.CATEGORIA, $r.PARCELAS }
Exportar $cats "LSOFT_CATEGORIAS_COM_MOVIMENTO.csv"

$conn.Close()
""
"Pronto. CSVs em: $Saida"
