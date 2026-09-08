# EXTRACAO read-only do LSoft — a carteira do VALE DO OURO.
#
# Pedido do Lucas (08/09/2026): "precisamos criar os boletos do vale do ouro desses clientes, ae
# quero que suba igual temos as outras carteiras".
#
# ⚠️ A CATEGORIA NAO SE CHAMA VALE DO OURO. No cadastro do LSoft a 69 e "Loteamento Jose Lino" — o
# nome antigo do loteamento. Foi por isso que a documentacao anterior apontava a 129 (que tem outro
# uso) e a extracao de agosto nao o encontrou. O que prova que a 69 e a carteira certa nao e o nome:
# sao os CLIENTES. Os 10 da planilha do Vitor estao la, e mais um (Leandro Sales Moreira, 1 parcela).
#
# ⚠️ E NAO SE FILTRA POR CLASSE/SUBCLASSE AQUI. No Garden e no Vale do Sol a receita de venda e
# 16.3; no Vale do Ouro as parcelas estao em 17 com subclasse VAZIA. Repetir o filtro dos outros
# devolveria zero — e zero, numa extracao, parece "nao tem" e nao "filtrei errado".
#
# ⚠️ RODA EM POWERSHELL 32 BITS. O banco e anterior ao Access 2000: o driver moderno (ACE) recusa
# abrir, e o motor que abre (Jet 4.0) so existe em 32 bits.
#
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -File extrair-vale-do-ouro.ps1 -Mdb <copia.mdb> -Saida <pasta>
#
# ⚠️ LE UMA COPIA, nunca o \\SERVIDOR\Sistema\sgc\dados.mdb direto: o sistema fica em uso o dia
# inteiro e abrir o arquivo vivo pode travar quem esta trabalhando.
#
# ⚠️ O NOME SAI COMO "Vale do Ouro - 2", e o Lucas escolheu assim (08/09/2026): "Vale do Ouro" ja
# e o nome de uma carteira do outro lado (o VLO do C2X, hoje dividido em VOC e VOL), e duas coisas
# diferentes com o mesmo nome numa tela de cobranca leva alguem a emitir na carteira errada.
#
# Os tres CSVs saem no MESMO formato que `importar-para-supabase.mjs` ja le (colunas EMPREENDIMENTO,
# CLIENTE, PARCELA, VENCIMENTO, VALOR, OBSERVACOES...). Nada de importador novo.

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
  # ; como separador e BOM: e o que o Excel em pt-BR abre sem pedir nada, e o que o importador le.
  $tabela | Export-Csv -Path $destino -Delimiter ";" -NoTypeInformation -Encoding UTF8
  "{0,6:N0} linhas -> {1}" -f $tabela.Rows.Count, $arquivo
}

# ── 1. CADASTRO DOS CLIENTES ────────────────────────────────────────────────
# Quem tem parcela a receber OU ja recebida na 69.
#
# ⚠️ O JET NAO ACEITA `UNION` DENTRO DE SUBCONSULTA: por isso dois `IN ... OR ... IN` em vez de um.
$sqlClientes = @"
SELECT C.CODIGO, C.NOME, C.CPF, C.RG, C.NASCIMENTO, C.TELEFONE, C.CELULAR, C.EMAIL,
       C.ENDERECO, C.BAIRRO, C.CIDADE, C.ESTADO, C.CEP, C.CONJUGE, C.PAI, C.MAE,
       C.DATACADAST, C.VENDEDOR, C.BLOQUEADO
  FROM CLIENTES C
 WHERE C.CODIGO IN (SELECT CLIENTE FROM RECEBER   WHERE CATEGORIA = 69)
    OR C.CODIGO IN (SELECT CLIENTE FROM RECEBIDOS WHERE CATEGORIA = 69)
 ORDER BY C.NOME
"@

# ── 2. PARCELAS A RECEBER ───────────────────────────────────────────────────
# ⚠️ OBSERVACOES E ONDE MORA A UNIDADE, em texto livre: "LOTE: 4 QUADRA: 10", "LOTE 5 QUADRA P10",
# "LOTE 7 QUADRA 5 - VALE DO OURO 1966,67 48X". O importador tira lote e quadra dai por regex, e o
# texto inteiro vai junto para quem precisar conferir a mao.
$sqlReceber = @"
SELECT 'Vale do Ouro - 2' AS EMPREENDIMENTO,
       R.CLIENTE, C.NOME, C.CPF, R.PARCELA, R.VENCIMENTO, R.VALOR, R.VALORRECEBIDO,
       R.OBSERVACOES, R.DATA, R.NRONOTA, R.BOLETO, R.SITUACAO
  FROM RECEBER R LEFT JOIN CLIENTES C ON C.CODIGO = R.CLIENTE
 WHERE R.CATEGORIA = 69
 ORDER BY C.NOME, R.VENCIMENTO
"@

# ── 3. RECEBIDOS ────────────────────────────────────────────────────────────
$sqlRecebidos = @"
SELECT 'Vale do Ouro - 2' AS EMPREENDIMENTO,
       R.CLIENTE, C.NOME, C.CPF, R.PARCELA, R.VENCIMENTO, R.DATARECEBIDO,
       R.VALOR, R.VALORRECEBIDO, R.OBSERVACOES, R.NRONOTA
  FROM RECEBIDOS R LEFT JOIN CLIENTES C ON C.CODIGO = R.CLIENTE
 WHERE R.CATEGORIA = 69
 ORDER BY C.NOME, R.DATARECEBIDO
"@

"EXTRACAO LSoft — VALE DO OURO (categoria 69, 'Loteamento Jose Lino' no cadastro)"
""
Exportar $sqlClientes  "LSOFT_CLIENTES.csv"
Exportar $sqlReceber   "LSOFT_A_RECEBER.csv"
Exportar $sqlRecebidos "LSOFT_RECEBIDOS.csv"

$conn.Close()
""
"Pronto. Agora: node scripts/lsoft/importar-para-supabase.mjs `"$Saida`" --ensaio"
