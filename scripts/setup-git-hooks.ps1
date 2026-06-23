# Ativa os git hooks VERSIONADOS e resilientes do Panteon.
# Roda uma vez por clone/maquina. Reversivel com: git config --unset core.hooksPath
#
# Por que existe: hooks em .git/hooks/ nao sao versionados e somem no proximo
# clone. Os hooks reais ficam em scripts/git-hooks/ (no repo) e este script
# aponta o git para la.
$ErrorActionPreference = "Stop"

$top = (git rev-parse --show-toplevel).Trim()
if (-not $top) { throw "Nao estou dentro de um repositorio git." }

git config core.hooksPath scripts/git-hooks
Write-Host "[panteon] core.hooksPath -> scripts/git-hooks (hooks resilientes ativos)"
Write-Host "[panteon] reverter com: git config --unset core.hooksPath"
