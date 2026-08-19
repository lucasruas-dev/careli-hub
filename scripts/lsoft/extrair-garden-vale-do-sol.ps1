# EXTRACAO read-only do LSoft (Access antigo) — clientes do Garden e do Vale do Sol.
#
# Pedido do Lucas (19/08/2026): "precisamos baixar os clientes do garden e vale do sol...
# classificados por centro de custo 124.16.03".
#
# O QUE O CENTRO DE CUSTO SIGNIFICA (descoberto no banco):
#   CATEGORIA = o empreendimento  ->  124 = Condominio Garden · 102 = Vale do Sol
#   CLASSE    = 16 = Receita
#   SUBCLASSE = 3  = Aptos Vendidos
# "Aptos Vendidos" se repete em dezenas de categorias: o que separa a obra e a CATEGORIA.
#
# ⚠️ RODA EM POWERSHELL 32 BITS. O banco e anterior ao Access 2000: o driver moderno (ACE) recusa
# abrir, e o motor que abre (Jet 4.0) so existe em 32 bits.
#
# ⚠️ LE UMA COPIA, nunca o \\SERVIDOR\Sistema\sgc\dados.mdb direto: o sistema fica em uso o dia
# inteiro e abrir o arquivo vivo pode travar quem esta trabalhando.
#
#   powershell32 -File extrair-garden-vale-do-sol.ps1 -Mdb <copia.mdb> -Saida <pasta>

param(
  [Parameter(Mandatory = $true)][string]$Mdb,
  [Parameter(Mandatory = $true)][string]$Saida
)

$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force $Saida | Out-Null

$conn = New-Object System.Data.OleDb.OleDbConnection("Provider=Microsoft.Jet.OLEDB.4.0;Data Source=$Mdb;Mode=Read")
$conn.Open()

function Exportar([string]$sql, [string]$arquivo) {
  $cmd = $conn.CreateCommand()
  $cmd.CommandText = $sql
  $tabela = New-Object System.Data.DataTable
  (New-Object System.Data.OleDb.OleDbDataAdapter $cmd).Fill($tabela) | Out-Null
  $destino = Join-Path $Saida $arquivo
  # ; como separador e BOM: e o que o Excel em pt-BR abre sem pedir nada.
  $tabela | Export-Csv -Path $destino -Delimiter ";" -NoTypeInformation -Encoding UTF8
  "{0,6:N0} linhas -> {1}" -f $tabela.Rows.Count, $arquivo
  return $tabela.Rows.Count
}

# ── 1. CADASTRO DOS CLIENTES ────────────────────────────────────────────────
# Quem tem parcela a receber OU ja recebida no 124.16.3 / 102.16.3.
$sqlClientes = @"
SELECT C.CODIGO, C.NOME, C.CPF, C.RG, C.NASCIMENTO, C.TELEFONE, C.CELULAR, C.EMAIL,
       C.ENDERECO, C.BAIRRO, C.CIDADE, C.ESTADO, C.CEP, C.CONJUGE, C.PAI, C.MAE,
       C.DATACADAST, C.VENDEDOR, C.BLOQUEADO
  FROM CLIENTES C
 WHERE C.CODIGO IN (SELECT CLIENTE FROM RECEBER   WHERE CATEGORIA IN (124,102) AND CLASSE=16 AND SUBCLASSE=3)
    OR C.CODIGO IN (SELECT CLIENTE FROM RECEBIDOS WHERE CATEGORIA IN (124,102) AND CLASSE=16 AND SUBCLASSE=3)
 ORDER BY C.NOME
"@

# ── 2. PARCELAS A RECEBER ───────────────────────────────────────────────────
# OBSERVACOES e onde mora a unidade (no Garden vem "LOTE: 367 - QUADRA: 13"), entao vai junto.
$sqlReceber = @"
SELECT IIF(R.CATEGORIA=124,'Garden','Vale do Sol') AS EMPREENDIMENTO,
       R.CLIENTE, C.NOME, C.CPF, R.PARCELA, R.VENCIMENTO, R.VALOR, R.VALORRECEBIDO,
       R.OBSERVACOES, R.DATA, R.NRONOTA, R.BOLETO, R.SITUACAO
  FROM RECEBER R LEFT JOIN CLIENTES C ON C.CODIGO = R.CLIENTE
 WHERE R.CATEGORIA IN (124,102) AND R.CLASSE=16 AND R.SUBCLASSE=3
 ORDER BY C.NOME, R.VENCIMENTO
"@

# ── 3. RECEBIDOS ────────────────────────────────────────────────────────────
$sqlRecebidos = @"
SELECT IIF(R.CATEGORIA=124,'Garden','Vale do Sol') AS EMPREENDIMENTO,
       R.CLIENTE, C.NOME, C.CPF, R.PARCELA, R.VENCIMENTO, R.DATARECEBIDO,
       R.VALOR, R.VALORRECEBIDO, R.OBSERVACOES, R.NRONOTA
  FROM RECEBIDOS R LEFT JOIN CLIENTES C ON C.CODIGO = R.CLIENTE
 WHERE R.CATEGORIA IN (124,102) AND R.CLASSE=16 AND R.SUBCLASSE=3
 ORDER BY C.NOME, R.DATARECEBIDO
"@

"EXTRACAO LSoft — Garden (124) e Vale do Sol (102), receita de Aptos Vendidos (16.3)"
""
Exportar $sqlClientes  "LSOFT_CLIENTES.csv"        | Out-Null
Exportar $sqlReceber   "LSOFT_A_RECEBER.csv"       | Out-Null
Exportar $sqlRecebidos "LSOFT_RECEBIDOS.csv"       | Out-Null

$conn.Close()
""
"pasta: $Saida"
