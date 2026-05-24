# Panteon - plano de migracao de protocolos AT para OP

Este documento transforma a divergencia `AT -> OP` em plano executavel, sem aplicar migration ou alterar banco real.

## Estado atual

- `AT` fica reservado para atendimentos Iris e comunicacao externa.
- `OP` deve ser usado por atividades operacionais internas do Zeus.
- A regra canonica ja esta documentada em `squadops-center-process.md`.
- A geracao real de `hub_engineering_operation_records` ainda usa o legado `AT-0000` para registros estruturados Zeus.
- Protocolos `AT` antigos do Zeus devem permanecer historicos e nao devem ser renumerados.

Status: `BLOQUEADO` para execucao tecnica ate autorizacao explicita do Lucas, por envolver migration, banco real e possivel reconciliacao historica.

## Objetivo

Fazer com que novos registros internos Zeus nascam como `OP-*`, mantendo:

- Iris como dona de `AT-*`;
- Hades/Cobranca com `CB-*`;
- HelpDesk/TI com `TI-*`;
- Alertas com `AL-*`;
- Deploys/releases com `DP-*`;
- historico antigo preservado;
- vinculos entre protocolos sem trocar identidade do setor.

## Fases

### Fase 0 - Inventario read-only

Sem escrita em banco.

- Contar registros atuais por prefixo em `hub_engineering_operation_records`.
- Identificar quantos `AT-*` sao historicos Zeus e quantos sao atendimento Iris.
- Confirmar funcoes, sequences, defaults e triggers que geram protocolo.
- Confirmar telas/APIs que assumem prefixo `AT`.

Saida esperada: relatorio com contagens, dependencias e risco.

### Fase 1 - Desenho tecnico

Sem apply real.

- Definir sequence dedicada para `OP`.
- Definir funcao server-side para gerar `OP-000001`.
- Definir regra de roteamento por tipo/modulo.
- Definir se a tabela atual recebe campo auxiliar de categoria ou se usa os campos existentes.
- Preparar migration draft somente quando autorizada.

Saida esperada: proposta revisavel de migration e rollback.

### Fase 2 - Homologacao autorizada

Somente com autorizacao explicita.

- Aplicar migration em homologacao.
- Criar registro Zeus novo e confirmar protocolo `OP-*`.
- Confirmar que Iris continua gerando `AT-*`.
- Confirmar que registros antigos `AT-*` continuam consultaveis.
- Validar tela Zeus, release registers e filtros.

Saida esperada: registro em `releases-homologation.md` com validacoes.

### Fase 3 - Producao autorizada

Somente depois de homologacao aprovada.

- Inspecionar aliases e deployment vigente.
- Aplicar migration em producao no ambiente correto.
- Publicar codigo se houver ajuste de API/tela.
- Rodar healthchecks.
- Registrar `EM PRODUCAO`.

Saida esperada: registro em `releases-production.md`, diario canonico e rollback path.

## Politica de historico

- Nao renumerar `AT-*` antigos.
- Nao apagar registros antigos.
- Nao transformar historico Zeus antigo em OP sem decisao separada.
- Se for necessario classificar historico, usar metadado/campo auxiliar, nunca trocar protocolo raiz sem plano de reconciliacao.

## Criterios de aceite

- Novo registro Zeus interno gera `OP-*`.
- Novo atendimento Iris gera `AT-*`.
- Registro Hades/Cobranca preserva `CB-*` e vinculo com `AT-*` quando houver comunicacao externa.
- Filtros e buscas aceitam `AT`, `CB`, `TI`, `OP`, `AL` e `DP`.
- Sync do diario nao sobrescreve protocolo vivo divergente.
- Rollback documentado antes de producao.

## Rollback conceitual

O rollback deve priorizar parar a geracao nova sem reescrever historico:

- reverter funcao/default de geracao para comportamento anterior;
- manter registros `OP-*` criados como historico valido;
- ajustar tela para exibir ambos os prefixos;
- nunca apagar registros de producao como rollback padrao.
