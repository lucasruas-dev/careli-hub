-- MERGE DAS FICHAS DUPLICADAS DO APOLO (04/08/2026).
--
-- O PROBLEMA
-- Cada pessoa do lançamento Vale do Ouro ficou com DUAS fichas no CRM:
--   • a ficha do CAD    — nasce do import do Asana, tem os documentos, a esteira e os contatos;
--   • a ficha do comprador — nasce do sync do C2X quando a venda é registrada, praticamente vazia.
-- O CRM 360 abre a do comprador (é a ligada à venda), então os documentos pareciam não existir.
-- Levantamento de 04/08: 415 pares duplicados, 2.151 documentos com arquivo presos na ficha errada
-- contra 1 na ficha certa.
--
-- QUAL FICHA FICA
-- A do C2X. O id dela é DETERMINÍSTICO (uuid v5 derivado do cadastro): apagá-la faria o próximo
-- sync recriá-la e o problema voltaria em dias. Então o conteúdo vem para ela, e a outra é
-- ARQUIVADA (nunca apagada) com o ponteiro de para onde foi.
--
-- ANTES DE RODAR
-- As tabelas apolo_merge_backup_pares e apolo_merge_backup_linhas já existem e estão POPULADAS
-- (415 pares, 12.898 linhas). São elas que dizem quem vai para quem, e são o caminho de volta.
-- Se estiverem vazias, NÃO rode: o merge não faria nada e a origem do pareamento se perde.
--
-- COMO RODAR
--   select * from apolo_merge_fichas_executar();
-- Devolve uma linha por tabela com quantas linhas se moveram. É atômico: ou vai tudo, ou nada.

create or replace function apolo_merge_fichas_executar()
returns table (tabela text, linhas_movidas bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  n bigint;
begin
  -- O índice de busca é DERIVADO e a ficha que fica já tem o seu (a PK é o entity_id, então mover
  -- colidiria). Apagar o da ficha absorvida tira ela da busca, que é exatamente o efeito desejado.
  delete from apolo_search_entries s using apolo_merge_backup_pares p
   where s.entity_id = p.ficha_mesclada;
  get diagnostics n = row_count; tabela := 'apolo_search_entries (apagado)'; linhas_movidas := n; return next;

  update apolo_documents t set entity_id = p.ficha_mantida
    from apolo_merge_backup_pares p where t.entity_id = p.ficha_mesclada;
  get diagnostics n = row_count; tabela := 'apolo_documents'; linhas_movidas := n; return next;

  update apolo_contacts t set entity_id = p.ficha_mantida
    from apolo_merge_backup_pares p where t.entity_id = p.ficha_mesclada;
  get diagnostics n = row_count; tabela := 'apolo_contacts'; linhas_movidas := n; return next;

  update apolo_addresses t set entity_id = p.ficha_mantida
    from apolo_merge_backup_pares p where t.entity_id = p.ficha_mesclada;
  get diagnostics n = row_count; tabela := 'apolo_addresses'; linhas_movidas := n; return next;

  update apolo_entity_identifiers t set entity_id = p.ficha_mantida
    from apolo_merge_backup_pares p where t.entity_id = p.ficha_mesclada;
  get diagnostics n = row_count; tabela := 'apolo_entity_identifiers'; linhas_movidas := n; return next;

  update apolo_entity_profiles t set entity_id = p.ficha_mantida
    from apolo_merge_backup_pares p where t.entity_id = p.ficha_mesclada;
  get diagnostics n = row_count; tabela := 'apolo_entity_profiles'; linhas_movidas := n; return next;

  update apolo_source_links t set entity_id = p.ficha_mantida
    from apolo_merge_backup_pares p where t.entity_id = p.ficha_mesclada;
  get diagnostics n = row_count; tabela := 'apolo_source_links'; linhas_movidas := n; return next;

  update apolo_relationships t set entity_id = p.ficha_mantida
    from apolo_merge_backup_pares p where t.entity_id = p.ficha_mesclada;
  get diagnostics n = row_count; tabela := 'apolo_relationships (entity)'; linhas_movidas := n; return next;

  update apolo_relationships t set related_entity_id = p.ficha_mantida
    from apolo_merge_backup_pares p where t.related_entity_id = p.ficha_mesclada;
  get diagnostics n = row_count; tabela := 'apolo_relationships (related)'; linhas_movidas := n; return next;

  update apolo_timeline_events t set entity_id = p.ficha_mantida
    from apolo_merge_backup_pares p where t.entity_id = p.ficha_mesclada;
  get diagnostics n = row_count; tabela := 'apolo_timeline_events'; linhas_movidas := n; return next;

  update apolo_esteira t set entity_id = p.ficha_mantida
    from apolo_merge_backup_pares p where t.entity_id = p.ficha_mesclada;
  get diagnostics n = row_count; tabela := 'apolo_esteira'; linhas_movidas := n; return next;

  update apolo_c2x_sync t set entity_id = p.ficha_mantida
    from apolo_merge_backup_pares p where t.entity_id = p.ficha_mesclada;
  get diagnostics n = row_count; tabela := 'apolo_c2x_sync'; linhas_movidas := n; return next;

  update apolo_audit_events t set entity_id = p.ficha_mantida
    from apolo_merge_backup_pares p where t.entity_id = p.ficha_mesclada;
  get diagnostics n = row_count; tabela := 'apolo_audit_events'; linhas_movidas := n; return next;

  update apolo_module_records t set entity_id = p.ficha_mantida
    from apolo_merge_backup_pares p where t.entity_id = p.ficha_mesclada;
  get diagnostics n = row_count; tabela := 'apolo_module_records'; linhas_movidas := n; return next;

  update apolo_service_signals t set entity_id = p.ficha_mantida
    from apolo_merge_backup_pares p where t.entity_id = p.ficha_mesclada;
  get diagnostics n = row_count; tabela := 'apolo_service_signals'; linhas_movidas := n; return next;

  update apolo_commercial_links t set entity_id = p.ficha_mantida
    from apolo_merge_backup_pares p where t.entity_id = p.ficha_mesclada;
  get diagnostics n = row_count; tabela := 'apolo_commercial_links'; linhas_movidas := n; return next;

  update apolo_financial_snapshots t set entity_id = p.ficha_mantida
    from apolo_merge_backup_pares p where t.entity_id = p.ficha_mesclada;
  get diagnostics n = row_count; tabela := 'apolo_financial_snapshots'; linhas_movidas := n; return next;

  -- SEM chave estrangeira: são justamente os que ficariam órfãos sem ninguém perceber, porque o
  -- banco não reclama. Se algum dia entrar tabela nova com entity_id solto, ela entra AQUI.
  update apolo_ocr_reads t set entity_id = p.ficha_mantida
    from apolo_merge_backup_pares p where t.entity_id = p.ficha_mesclada;
  get diagnostics n = row_count; tabela := 'apolo_ocr_reads (sem FK)'; linhas_movidas := n; return next;

  update apolo_disparos t set entity_id = p.ficha_mantida
    from apolo_merge_backup_pares p where t.entity_id = p.ficha_mesclada;
  get diagnostics n = row_count; tabela := 'apolo_disparos (sem FK)'; linhas_movidas := n; return next;

  update apolo_acao_alvos t set entity_id = p.ficha_mantida
    from apolo_merge_backup_pares p where t.entity_id = p.ficha_mesclada;
  get diagnostics n = row_count; tabela := 'apolo_acao_alvos (sem FK)'; linhas_movidas := n; return next;

  update serasa_consultas t set entity_id = p.ficha_mantida
    from apolo_merge_backup_pares p where t.entity_id = p.ficha_mesclada;
  get diagnostics n = row_count; tabela := 'serasa_consultas'; linhas_movidas := n; return next;

  update caredesk_tickets t set source_entity_id = p.ficha_mantida::text
    from apolo_merge_backup_pares p where t.source_entity_id = p.ficha_mesclada::text;
  get diagnostics n = row_count; tabela := 'caredesk_tickets (sem FK)'; linhas_movidas := n; return next;

  -- O credenciado do evento e os vínculos de imobiliária e corretor passam a apontar para a ficha
  -- que ficou. Sem isso, a etiqueta e a fila do próximo evento voltariam a criar duplicata.
  update prometeu_credenciados t set entity_id = p.ficha_mantida
    from apolo_merge_backup_pares p where t.entity_id = p.ficha_mesclada;
  get diagnostics n = row_count; tabela := 'prometeu_credenciados (cliente)'; linhas_movidas := n; return next;

  update prometeu_credenciados t set imobiliaria_entity_id = p.ficha_mantida
    from apolo_merge_backup_pares p where t.imobiliaria_entity_id = p.ficha_mesclada;
  get diagnostics n = row_count; tabela := 'prometeu_credenciados (imobiliaria)'; linhas_movidas := n; return next;

  update prometeu_credenciados t set corretor_entity_id = p.ficha_mantida
    from apolo_merge_backup_pares p where t.corretor_entity_id = p.ficha_mesclada;
  get diagnostics n = row_count; tabela := 'prometeu_credenciados (corretor)'; linhas_movidas := n; return next;

  update apolo_esteira t set imobiliaria_entity_id = p.ficha_mantida
    from apolo_merge_backup_pares p where t.imobiliaria_entity_id = p.ficha_mesclada;
  get diagnostics n = row_count; tabela := 'apolo_esteira (imobiliaria)'; linhas_movidas := n; return next;

  update apolo_esteira t set corretor_entity_id = p.ficha_mantida
    from apolo_merge_backup_pares p where t.corretor_entity_id = p.ficha_mesclada;
  get diagnostics n = row_count; tabela := 'apolo_esteira (corretor)'; linhas_movidas := n; return next;

  update apolo_imobiliaria_match t set entity_id = p.ficha_mantida
    from apolo_merge_backup_pares p where t.entity_id = p.ficha_mesclada;
  get diagnostics n = row_count; tabela := 'apolo_imobiliaria_match'; linhas_movidas := n; return next;

  -- A ficha esvaziada é ARQUIVADA, nunca apagada: sai da operação e o rastro de para onde foi
  -- fica gravado nela mesma.
  update apolo_entities e
     set status = 'archived',
         metadata = coalesce(e.metadata, '{}'::jsonb)
                    || jsonb_build_object('mergedInto', p.ficha_mantida, 'mergedAt', now())
    from apolo_merge_backup_pares p
   where e.id = p.ficha_mesclada;
  get diagnostics n = row_count; tabela := 'apolo_entities (arquivadas)'; linhas_movidas := n; return next;
end;
$$;

-- CONFERÊNCIA (rodar depois; tem que dar zero na primeira coluna):
--   select
--     (select count(*) from apolo_documents d
--        join apolo_merge_backup_pares p on p.ficha_mesclada = d.entity_id) as sobrou_na_ficha_velha,
--     (select count(*) from apolo_documents d
--        join apolo_merge_backup_pares p on p.ficha_mantida = d.entity_id) as agora_na_ficha_boa;

-- COMO DESFAZER (as duas tabelas de backup guardam a origem de cada linha):
--   update apolo_documents d set entity_id = b.entity_id_origem
--     from apolo_merge_backup_linhas b
--    where b.tabela = 'apolo_documents' and b.linha_id = d.id::text;
--   ...e assim por diante, tabela a tabela, depois:
--   update apolo_entities e set status = 'active'
--     from apolo_merge_backup_pares p where e.id = p.ficha_mesclada;
