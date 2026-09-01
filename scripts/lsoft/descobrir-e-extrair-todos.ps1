#Requires -Version 5
<#
  EXTRACAO read-only do LSoft — TODOS os empreendimentos, nao so Garden e Vale do Sol.

  POR QUE ESTE SCRIPT EXISTE (31/08/2026):
  Faltam 87 CPFs para emitir os boletos, e 79 deles sao de sete empreendimentos que "nao estao no
  LSoft". Nao e verdade: eles estao no MESMO arquivo Access — o que aconteceu e que a extracao de
  19/08 filtrou `CATEGORIA IN (124,102)`, porque naquele dia o pedido era so Garden e Vale do Sol.
  A carga foi unica e ninguem voltou para buscar o resto.

  CATEGORIA = o empreendimento. 124 = Condominio Garden · 102 = Vale do Sol. Os codigos de Guaimbe,
  Giant Towers, On Sky, Ed. Rubi, Ed. Jade e Ed. Cristal estao no banco e este script os DESCOBRE
  em vez de exigir que alguem adivinhe: a primeira etapa lista todas as categorias que tem cliente
  com titulo a receber, com nome e contagem.

  ⚠️ RODA EM POWERSHELL 32 BITS. O banco e anterior ao Access 2000: o driver moderno (ACE) recusa
  abrir, e o Jet 4.0, que abre, so existe em 32 bits.
      C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -File <este arquivo> ...

  ⚠️ LE UMA COPIA, nunca o \\SERVIDOR\Sistema\sgc\dados.mdb direto: o sistema fica em uso o dia
  inteiro e abrir o arquivo vivo pode travar quem esta trabalhando.

  USO
    # 1. so descobrir quais sao os empreendimentos e seus codigos:
    powershell32 -File descobrir-e-extrair-todos.ps1 -Mdb <copia.mdb> -Saida <pasta> -SoDescobrir

    # 2. extrair os clientes de TODAS as categorias:
    powershell32 -File descobrir-e-extrair-todos.ps1 -Mdb <copia.mdb> -Saida <pasta>

    # 3. ou so de algumas, quando ja se sabe os codigos:
    powershell32 -File descobrir-e-extrair-todos.ps1 -Mdb <copia.mdb> -Saida <pasta> -Categorias 130,131
#>
param(
  [Parameter(Mandatory = $true)][string]$Mdb,
  [Parameter(Mandatory = $true)][string]$Saida,
  [int[]]$Categorias,
  [switch]$SoDescobrir
)

$ErrorActionPreference = "Stop"

if ([Environment]::Is64BitProcess) {
  Write-Host ""
  Write-Host "  PARE: este processo e 64 bits e o Jet 4.0 so existe em 32." -ForegroundColor Red
  Write-Host "  Rode assim:" -ForegroundColor Yellow
  Write-Host "    C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -File `"$PSCommandPath`" -Mdb `"$Mdb`" -Saida `"$Saida`"" -ForegroundColor Yellow
  Write-Host ""
  exit 1
}

New-Item -ItemType Directory -Force $Saida | Out-Null

$conn = New-Object System.Data.OleDb.OleDbConnection("Provider=Microsoft.Jet.OLEDB.4.0;Data Source=$Mdb;Mode=Read")
$conn.Open()

function Consultar([string]$sql) {
  $cmd = $conn.CreateCommand()
  $cmd.CommandText = $sql
  $t = New-Object System.Data.DataTable
  (New-Object System.Data.OleDb.OleDbDataAdapter $cmd).Fill($t) | Out-Null
  # ⚠️ A VIRGULA NAO E ENFEITE. `return $t` faz o PowerShell ENUMERAR o DataTable e devolver as
  # linhas soltas — a tabela some, `.Columns` vem vazio e o CSV sai com todas as celulas em branco.
  # `,$t` embrulha em array de um item e preserva o objeto.
  return ,$t
}

function Exportar([string]$sql, [string]$arquivo) {
  $t = Consultar $sql
  $destino = Join-Path $Saida $arquivo
  # ; como separador e BOM: e o que o Excel em pt-BR abre sem pedir nada.
  $t | Export-Csv -Path $destino -Delimiter ";" -NoTypeInformation -Encoding UTF8
  "{0,6:N0} linhas -> {1}" -f $t.Rows.Count, $arquivo | Write-Host
  return $t.Rows.Count
}

# ── 1. DESCOBRIR os empreendimentos ────────────────────────────────────────────
# A tabela de categorias costuma se chamar CATEGORIA ou CATEGORIAS e ter CODIGO + DESCRICAO/NOME.
# Como o nome varia entre versoes do LSoft, procuramos no catalogo do proprio Access em vez de
# chutar — errar o nome aqui aborta a extracao inteira.
Write-Host ""
Write-Host "== CATEGORIAS COM TITULO A RECEBER (todas as classes) ==" -ForegroundColor Cyan

$tabelas = $conn.GetSchema("Tables") | Where-Object { $_.TABLE_TYPE -eq "TABLE" } | ForEach-Object { $_.TABLE_NAME }
$tabCategoria = $tabelas | Where-Object { $_ -match '^CATEGORIA' } | Select-Object -First 1

# ⚠️ O Jet 4.0 NAO tem COUNT(DISTINCT). O jeito que funciona no Access antigo e contar sobre uma
# subconsulta que ja veio distinta — e por isso que a contagem de titulos vem separada.
$resumo = Consultar @"
SELECT D.CATEGORIA, COUNT(*) AS CLIENTES
  FROM (SELECT DISTINCT R.CATEGORIA, R.CLIENTE
          FROM RECEBER R
        ) AS D
 GROUP BY D.CATEGORIA
 ORDER BY COUNT(*) DESC
"@

$titulos = @{}
foreach ($r in (Consultar @"
SELECT R.CATEGORIA, COUNT(*) AS TITULOS
  FROM RECEBER R
 GROUP BY R.CATEGORIA
"@).Rows) { $titulos[[string]$r.CATEGORIA] = $r.TITULOS }

$nomes = @{}
if ($tabCategoria) {
  $colunas = (Consultar "SELECT TOP 1 * FROM [$tabCategoria]").Columns | ForEach-Object { $_.ColumnName }
  $colNome = $colunas | Where-Object { $_ -match 'DESCRI|NOME' } | Select-Object -First 1
  $colCod  = $colunas | Where-Object { $_ -match 'CODIGO|COD$' }  | Select-Object -First 1
  if ($colNome -and $colCod) {
    foreach ($r in (Consultar "SELECT [$colCod] AS C, [$colNome] AS N FROM [$tabCategoria]").Rows) {
      $nomes[[string]$r.C] = [string]$r.N
    }
  }
}

$linhas = @()
foreach ($r in $resumo.Rows) {
  $cod = [string]$r.CATEGORIA
  $linhas += [pscustomobject]@{
    CATEGORIA = $cod
    NOME      = if ($nomes.ContainsKey($cod)) { $nomes[$cod] } else { "(sem nome na tabela)" }
    CLIENTES  = $r.CLIENTES
    TITULOS   = if ($titulos.ContainsKey($cod)) { $titulos[$cod] } else { 0 }
    JA_TEMOS  = if ($cod -eq "124" -or $cod -eq "102") { "sim" } else { "" }
  }
}
$linhas | Format-Table -AutoSize | Out-String | Write-Host
$linhas | Export-Csv -Path (Join-Path $Saida "categorias.csv") -Delimiter ";" -NoTypeInformation -Encoding UTF8
Write-Host "  -> categorias.csv" -ForegroundColor DarkGray

if ($SoDescobrir) {
  Write-Host ""
  Write-Host "  Confira a lista acima, e rode de novo sem -SoDescobrir (ou com -Categorias)." -ForegroundColor Yellow
  $conn.Close()
  exit 0
}

# ── 2. EXTRAIR ────────────────────────────────────────────────────────────────
# Sem -Categorias, leva TODAS as que tem cliente. Guardamos o codigo da categoria em cada linha:
# sem ele, o CSV vira uma pilha de nomes sem dizer de que empreendimento cada um e.
$alvo = if ($Categorias -and $Categorias.Count) { $Categorias } else { $resumo.Rows | ForEach-Object { [int]$_.CATEGORIA } }
$lista = ($alvo | Sort-Object -Unique) -join ","

Write-Host ""
Write-Host "== EXTRAINDO CATEGORIAS: $lista ==" -ForegroundColor Cyan

# ⚠️ AQUI NAO SE FILTRA SUBCLASSE. A extracao de 19/08 usava CLASSE=16 AND SUBCLASSE=3 ("Aptos
# Vendidos"), e isso perde gente: medido nesta base, a categoria 70 (Guaimbe) tem 16 titulos em
# subclasse 2 e a 115 (Rubi e Jade) tem 31 sem classe nenhuma. Para BUSCAR CPF, cliente a mais nao
# atrapalha e cliente a menos e exatamente o problema que viemos resolver.
Exportar @"
SELECT C.*
  FROM CLIENTES C
 WHERE C.CODIGO IN (SELECT CLIENTE FROM RECEBER   WHERE CATEGORIA IN ($lista))
    OR C.CODIGO IN (SELECT CLIENTE FROM RECEBIDOS WHERE CATEGORIA IN ($lista))
"@ "clientes.csv" | Out-Null

# O de-para cliente -> categoria, que e o que diz de qual empreendimento cada um e.
Exportar @"
SELECT DISTINCT R.CATEGORIA, R.CLIENTE FROM RECEBER   R WHERE R.CATEGORIA IN ($lista)
"@ "cliente-categoria-aberto.csv" | Out-Null

Exportar @"
SELECT DISTINCT R.CATEGORIA, R.CLIENTE FROM RECEBIDOS R WHERE R.CATEGORIA IN ($lista)
"@ "cliente-categoria-pago.csv" | Out-Null

Exportar @"
SELECT R.CATEGORIA, R.CLIENTE, R.DOCUMENTO, R.PARCELA, R.VENCIMENTO, R.VALOR, R.OBS
  FROM RECEBER R
 WHERE R.CATEGORIA IN ($lista)
"@ "receber.csv" | Out-Null

Exportar @"
SELECT R.CATEGORIA, R.CLIENTE, R.DOCUMENTO, R.PARCELA, R.VENCIMENTO, R.VALOR, R.RECEBIDO, R.DATARECEB, R.OBS
  FROM RECEBIDOS R
 WHERE R.CATEGORIA IN ($lista)
"@ "recebidos.csv" | Out-Null

$conn.Close()
Write-Host ""
Write-Host "  Pronto. Os CSV estao em $Saida" -ForegroundColor Green
Write-Host "  O que interessa agora e a coluna de CPF em clientes.csv." -ForegroundColor DarkGray
