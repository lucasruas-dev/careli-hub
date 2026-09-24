# EXTRACAO read-only do LSoft por CATEGORIA, no formato que `importar-para-supabase.mjs` le.
#
# Pedido do Lucas (24/09/2026): subir os demais empreendimentos para o LSoft Integracao.
#
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -File extrair-por-categoria.ps1 -Mdb <copia.mdb> -Saida <pasta> -Categorias 118,66,126,70,115,17
#
# ⚠️ RODA EM POWERSHELL 32 BITS. O banco e anterior ao Access 2000: o driver moderno (ACE) recusa,
# e o Jet 4.0, que abre, so existe em 32 bits.
#
# ⚠️ LE UMA COPIA, nunca o \\SERVIDOR\Sistema\sgc\dados.mdb direto: o sistema fica em uso o dia
# inteiro.
#
# ⚠️ SAI A COLUNA CATEGORIA, NAO O NOME DO EMPREENDIMENTO. A categoria 17 mistura produtos (Vale do
# Sol, Guaimbe, Giant Towers, On Sky...) e o produto so existe no texto de OBSERVACOES. Quem decide o
# nome e o importador, com `apps/hub/lib/lsoft/categorias.ts`, que e testado. Uma segunda regra aqui,
# em SQL do Jet, seria uma segunda copia para discordar da primeira.
#
# ⚠️ SEM FILTRO DE CLASSE, ao contrario do extrator do Garden (16.3). Medido: a categoria 70
# (Guaimbe) tem titulos em subclasse 2, a 115 (Rubi e Jade) tem titulos sem classe, e a 17 tem
# classes 16, 20, 29, 33 e outras. O Lucas decidiu que a 17 inteira e patrimonio. Filtrar classe
# aqui perderia cliente em silencio.
#
# ⚠️ NAO USE PARA 124 (Garden), 102 (Vale do Sol) nem 69 (Vale do Ouro): essas ja estao no espelho,
# vieram com filtro de classe 16.3 (as duas primeiras), e a carga substitui pela categoria. Extrair
# a 124 aqui, sem o filtro, trocaria as 13.401 parcelas do Garden por outro recorte.

param(
  [Parameter(Mandatory = $true)][string]$Mdb,
  [Parameter(Mandatory = $true)][string]$Saida,
  # Texto e nao int[]: chamado com -File, o PowerShell entrega "118,66,17" como UMA string.
  [Parameter(Mandatory = $true)][string]$Categorias
)

$ErrorActionPreference = "Stop"
# Variavel NOVA: reatribuir a $Categorias, que e [string], converteria o array de volta em texto.
$numeros = @($Categorias -split '[,\s]+' | Where-Object { $_ } | ForEach-Object { [int]$_ })

if ([Environment]::Is64BitProcess) {
  Write-Host "PARE: este processo e 64 bits e o Jet 4.0 so existe em 32. Use C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe" -ForegroundColor Red
  exit 1
}

$jaNoEspelho = @(124, 102, 69) | Where-Object { $numeros -contains $_ }
if ($jaNoEspelho) {
  Write-Host "PARE: as categorias $($jaNoEspelho -join ',') ja estao no espelho com outro recorte. Veja o cabecalho." -ForegroundColor Red
  exit 1
}

New-Item -ItemType Directory -Force $Saida | Out-Null
$lista = ($numeros | Sort-Object -Unique) -join ","

$conn = New-Object System.Data.OleDb.OleDbConnection("Provider=Microsoft.Jet.OLEDB.4.0;Data Source=$Mdb;Mode=Read")
$conn.Open()

function Exportar([string]$sql, [string]$arquivo) {
  $cmd = $conn.CreateCommand()
  $cmd.CommandText = $sql
  $tabela = New-Object System.Data.DataTable
  (New-Object System.Data.OleDb.OleDbDataAdapter $cmd).Fill($tabela) | Out-Null
  $destino = Join-Path $Saida $arquivo
  $tabela | Export-Csv -Path $destino -Delimiter ";" -NoTypeInformation -Encoding UTF8
  "{0,6:N0} linhas -> {1}" -f $tabela.Rows.Count, $arquivo
}

"EXTRACAO LSoft por categoria: $lista"
""

Exportar @"
SELECT C.CODIGO, C.NOME, C.CPF, C.RG, C.NASCIMENTO, C.TELEFONE, C.CELULAR, C.EMAIL,
       C.ENDERECO, C.BAIRRO, C.CIDADE, C.ESTADO, C.CEP, C.CONJUGE, C.PAI, C.MAE,
       C.DATACADAST, C.VENDEDOR, C.BLOQUEADO
  FROM CLIENTES C
 WHERE C.CODIGO IN (SELECT CLIENTE FROM RECEBER   WHERE CATEGORIA IN ($lista))
    OR C.CODIGO IN (SELECT CLIENTE FROM RECEBIDOS WHERE CATEGORIA IN ($lista))
 ORDER BY C.NOME
"@ "LSOFT_CLIENTES.csv"

Exportar @"
SELECT R.CATEGORIA, '' AS EMPREENDIMENTO,
       R.CLIENTE, C.NOME, C.CPF, R.PARCELA, R.VENCIMENTO, R.VALOR, R.VALORRECEBIDO,
       R.OBSERVACOES, R.DATA, R.NRONOTA, R.BOLETO, R.SITUACAO
  FROM RECEBER R LEFT JOIN CLIENTES C ON C.CODIGO = R.CLIENTE
 WHERE R.CATEGORIA IN ($lista)
 ORDER BY C.NOME, R.VENCIMENTO
"@ "LSOFT_A_RECEBER.csv"

Exportar @"
SELECT R.CATEGORIA, '' AS EMPREENDIMENTO,
       R.CLIENTE, C.NOME, C.CPF, R.PARCELA, R.VENCIMENTO, R.DATARECEBIDO,
       R.VALOR, R.VALORRECEBIDO, R.OBSERVACOES, R.NRONOTA
  FROM RECEBIDOS R LEFT JOIN CLIENTES C ON C.CODIGO = R.CLIENTE
 WHERE R.CATEGORIA IN ($lista)
 ORDER BY C.NOME, R.DATARECEBIDO
"@ "LSOFT_RECEBIDOS.csv"

$conn.Close()
""
"Pronto. Rode: node scripts/lsoft/importar-para-supabase.mjs `"$Saida`" --ensaio"
