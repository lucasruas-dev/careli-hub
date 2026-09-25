# 2026-09-23 · Imobiliária Cecílio Rocha habilitada no Garden

Pedido do Lucas: *"por favor cadastrada a imobiliaria Cecilio Rocha para o time conseguir fazer reserva, proposta e tal"*.

## O que estava errado

O Garden (c2x 39, operado pelo portal `cecilio-rocha` desde a v1.348.0) tinha **zero** imobiliárias
habilitadas. A reserva (`lib/hercules/quem-pode-vender.ts`) e o cadastro do CRM do portal
(`lib/apolo/incorporador/cadastro-do-portal.ts`) só aceitam imobiliária com papel `imobiliaria` e
vínculo `empreendimento` no produto. Por isso o time da Cecílio não conseguia reservar nem subir CAD.
Não existia ficha da Cecílio Rocha no Apolo.

## O que foi gravado (direto no banco, com o OK do Lucas)

Dados do Cartão CNPJ enviado pelo Lucas (emitido em 23/09/2026):

- Razão social **C E R CONSTRUTORA LTDA** · fantasia **CER EMPREENDIMENTOS** · CNPJ **21.744.440/0001-23**
- R Tenente-Coronel Roberto, 29, sala 416, Centro, Pará de Minas/MG, 35660-011
- E-mail rafaelteixeira10@yahoo.com.br · telefone (37) 3236-0910

| tabela | linha |
|---|---|
| `apolo_entities` | `b3c0b461-5e4f-461a-b6c5-4269752b5e24`, `display_name = CECÍLIO ROCHA`, `status = active`, `document_hash = sha256("apolo-identifier:cnpj:21744440000123")` |
| `apolo_entity_profiles` | `imobiliaria` e `pessoa_juridica`, os dois `active` |
| `apolo_contacts` | e-mail e telefone do cartão |
| `apolo_addresses` | endereço do cartão |
| `apolo_relationships` | `empreendimento`, `enterpriseId = "39"`, `status = verified` |

Antes de criar, o CNPJ foi procurado por `document_hash`, por `apolo_entity_identifiers` e por nome.
Não havia ficha nenhuma. O formato copia o das imobiliárias do Recanto do Vale.

Rastreio: `metadata.origem` da entidade e `metadata.source` do vínculo = `setup-portal-cecilio-2026-09-23`.

## Atenção

- Desde a v1.363.0 a imobiliária da venda **sai no contrato** (item VIII) e **é convidada a assinar**. O
  e-mail usado é o do cartão da Receita. Se quem assina pela Cecílio usa outro e-mail, é preciso trocar.
- Corretor ligado (pedido do Lucas, mesmo dia): **VITOR CECÍLIO**, e-mail vitorcecilio@hotmail.com.
  Ficha PF `0b828540-309d-424b-9485-5334011881f5`, papel `corretor` ativo, vínculo `corretor` da
  imobiliária para ele (`related_entity_id`), `verified`. Sem CPF e sem telefone: o Lucas passou só
  o nome e o e-mail. Se o CPF entrar depois, confira antes se ele já não tem ficha como cliente
  (dedup por `document_hash`).
- Só o Garden foi habilitado. VOC (37) e VOR (41) seguem só como consulta no portal.

## Como desfazer

```sql
-- primeiro os vínculos (o da imobiliária aponta para o corretor)
delete from apolo_relationships where entity_id = 'b3c0b461-5e4f-461a-b6c5-4269752b5e24';
-- corretor: 0b828540-309d-424b-9485-5334011881f5
delete from apolo_contacts        where entity_id = '0b828540-309d-424b-9485-5334011881f5';
delete from apolo_entity_profiles where entity_id = '0b828540-309d-424b-9485-5334011881f5';
delete from apolo_entities        where id = '0b828540-309d-424b-9485-5334011881f5';
-- imobiliária (apaga também o vínculo com o corretor): b3c0b461-5e4f-461a-b6c5-4269752b5e24
delete from apolo_relationships where entity_id = 'b3c0b461-5e4f-461a-b6c5-4269752b5e24';
delete from apolo_contacts      where entity_id = 'b3c0b461-5e4f-461a-b6c5-4269752b5e24';
delete from apolo_addresses     where entity_id = 'b3c0b461-5e4f-461a-b6c5-4269752b5e24';
delete from apolo_entity_profiles where entity_id = 'b3c0b461-5e4f-461a-b6c5-4269752b5e24';
delete from apolo_entities      where id = 'b3c0b461-5e4f-461a-b6c5-4269752b5e24';
```

Só desfaça se nenhuma reserva ou CAD tiver sido feita com ela.
