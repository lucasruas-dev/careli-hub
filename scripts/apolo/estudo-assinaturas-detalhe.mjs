// ESTUDO parte 4 — as três dúvidas que decidem o painel (leitura pura).
//
//   (a) quem são os 12-13 signatários de um contrato do Vale do Ouro?
//   (b) o que é o envio com contract_type NULL e ZERO signatários?
//   (c) como um contrato que DEU CERTO se parece (fora do Vale do Ouro, que ainda não fechou um)?
//
//   node scripts/apolo/estudo-assinaturas-detalhe.mjs <pasta-de-saida>
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const requireDoRepo = createRequire(path.resolve(process.cwd(), "apps/hub/package.json"));
const mysql = requireDoRepo("mysql2/promise");

const env = Object.fromEntries(
  fs.readFileSync(path.resolve(process.cwd(), "apps/hub/.env.local"), "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);

const saida = process.argv[2];
fs.mkdirSync(saida, { recursive: true });

const c = await mysql.createConnection({
  database: env.GUARDIAN_DB_NAME, host: env.GUARDIAN_DB_HOST, password: env.GUARDIAN_DB_PASSWORD,
  port: +(env.GUARDIAN_DB_PORT || 3306), user: env.GUARDIAN_DB_USER,
});

const linhas = [];
const diz = (t) => { linhas.push(t); console.log(t); };

async function bloco(titulo, sql, params = []) {
  diz(`\n### ${titulo}`);
  try {
    const [rows] = await c.query(sql, params);
    if (!rows.length) { diz("  (vazio)"); return []; }
    for (const r of rows) diz(`  ${JSON.stringify(r)}`);
    return rows;
  } catch (e) {
    diz(`  ERRO: ${e.message}`);
    return [];
  }
}

diz("## (a) QUEM ASSINA UM CONTRATO DO VALE DO OURO\n");

await bloco(
  "a1. um contrato inteiro, signatário por signatário (o mais recente do VOC)",
  `select ss.after_position as ordem, t.name as papel, ss.user_name, ss.user_document,
          ss.email, ss.signed, ss.date_signed
     from contract_signature_signers ss
     left join contract_signature_types t on t.id = ss.contract_signature_type_id
    where ss.contract_signature_id = (
      select cs.id from contract_signatures cs
        join acquisition_request_contracts arc on arc.id = cs.acquisition_request_contract_id
        join acquisition_requests ar on ar.id = arc.acquisition_request_id
        join enterprise_unities u on u.id = ar.enterprise_unity_id
       where u.enterprise_id = 37 and cs.contract_type = 'default'
       order by cs.created_at desc limit 1)
    order by ss.after_position, ss.id`,
);

await bloco(
  "a2. os nomes que MAIS aparecem (quem é fixo da casa e quem é cliente)",
  `select ss.user_name, ss.user_document, t.name as papel,
          count(*) as em_contratos, sum(ss.signed = 1) as assinou
     from contract_signature_signers ss
     join contract_signatures cs on cs.id = ss.contract_signature_id
     join acquisition_request_contracts arc on arc.id = cs.acquisition_request_contract_id
     join acquisition_requests ar on ar.id = arc.acquisition_request_id
     join enterprise_unities u on u.id = ar.enterprise_unity_id
     left join contract_signature_types t on t.id = ss.contract_signature_type_id
    where u.enterprise_id in (36, 37)
    group by ss.user_name, ss.user_document, t.name
   having em_contratos > 5
    order by em_contratos desc limit 25`,
);

await bloco(
  "a3. quantos signatários por envio, distribuição",
  `select signatarios, count(*) as envios from (
     select cs.id, count(ss.id) as signatarios
       from contract_signatures cs
       join acquisition_request_contracts arc on arc.id = cs.acquisition_request_contract_id
       join acquisition_requests ar on ar.id = arc.acquisition_request_id
       join enterprise_unities u on u.id = ar.enterprise_unity_id
       left join contract_signature_signers ss on ss.contract_signature_id = cs.id
      where u.enterprise_id in (36, 37)
      group by cs.id
   ) t group by signatarios order by signatarios`,
);

diz("\n\n## (b) O ENVIO FANTASMA (contract_type NULL)\n");

await bloco(
  "b1. o envio NULL sempre acompanha um 'default'?",
  `select tem_default, tem_null, count(*) as contratos from (
     select arc.id,
            sum(cs.contract_type = 'default') as tem_default,
            sum(cs.contract_type is null) as tem_null
       from acquisition_request_contracts arc
       join contract_signatures cs on cs.acquisition_request_contract_id = arc.id
       join acquisition_requests ar on ar.id = arc.acquisition_request_id
       join enterprise_unities u on u.id = ar.enterprise_unity_id
      where u.enterprise_id in (36, 37)
      group by arc.id
   ) t group by tem_default, tem_null order by contratos desc`,
);

await bloco(
  "b2. o envio NULL tem algum sinal de vida? (uuid, passos da D4Sign)",
  `select cs.contract_type, count(*) as n,
          sum(cs.uuidDoc is not null) as com_uuid_doc,
          sum(cs.uuidFolder is not null) as com_uuid_pasta,
          sum(cs.upload_document = 1) as subiu_doc,
          sum(cs.send_document_signature = 1) as enviou_assinatura,
          sum(cs.create_webhook = 1) as criou_webhook,
          sum(cs.get_safe_error_message is not null) as com_erro_cofre
     from contract_signatures cs
     join acquisition_request_contracts arc on arc.id = cs.acquisition_request_contract_id
     join acquisition_requests ar on ar.id = arc.acquisition_request_id
     join enterprise_unities u on u.id = ar.enterprise_unity_id
    where u.enterprise_id in (36, 37)
    group by cs.contract_type`,
);

await bloco(
  "b3. o mesmo padrão vale na base inteira? (default x null por status)",
  `select contract_type, contract_signature_status_id as status_id, count(*) as n,
          sum(link_pdf_signed_file is not null and link_pdf_signed_file <> '') as com_pdf
     from contract_signatures group by contract_type, contract_signature_status_id
    order by n desc`,
);

diz("\n\n## (c) COMO SE PARECE UM CONTRATO QUE FECHOU (outros empreendimentos)\n");

await bloco(
  "c1. finalizados por empreendimento",
  `select e.code, e.name, count(*) as finalizados,
          round(avg(datediff(cs.updated_at, cs.created_at)), 1) as dias_medio
     from contract_signatures cs
     join acquisition_request_contracts arc on arc.id = cs.acquisition_request_contract_id
     join acquisition_requests ar on ar.id = arc.acquisition_request_id
     join enterprise_unities u on u.id = ar.enterprise_unity_id
     join enterprises e on e.id = u.enterprise_id
    where cs.contract_signature_status_id = 4
    group by e.code, e.name order by finalizados desc limit 15`,
);

await bloco(
  "c2. num finalizado, TODOS os signatários assinaram?",
  `select faltando, count(*) as envios from (
     select cs.id, sum(coalesce(ss.signed, 0) = 0) as faltando
       from contract_signatures cs
       join contract_signature_signers ss on ss.contract_signature_id = cs.id
      where cs.contract_signature_status_id = 4
      group by cs.id
   ) t group by faltando order by envios desc limit 10`,
);

await bloco(
  "c3. o estágio da proposta acompanha o estado do envio?",
  `select st.name as estagio, s.name as estado_envio, count(distinct ar.id) as propostas
     from acquisition_requests ar
     join enterprise_unities u on u.id = ar.enterprise_unity_id
     left join acquisition_request_stages st on st.id = ar.acquisition_request_stage_id
     join acquisition_request_contracts arc on arc.acquisition_request_id = ar.id
     join contract_signatures cs on cs.acquisition_request_contract_id = arc.id
       and cs.contract_type = 'default'
     left join contract_signature_statuses s on s.id = cs.contract_signature_status_id
    where u.enterprise_id in (36, 37)
    group by st.name, s.name order by propostas desc`,
);

await bloco(
  "c4. os estágios de proposta que existem",
  `select id, name from acquisition_request_stages order by id`,
);

await bloco(
  "c5. contratos do VDO SEM nenhum envio (o buraco entre gerar e mandar assinar)",
  `select e.code, count(distinct arc.id) as contratos_sem_envio
     from acquisition_request_contracts arc
     join acquisition_requests ar on ar.id = arc.acquisition_request_id
     join enterprise_unities u on u.id = ar.enterprise_unity_id
     join enterprises e on e.id = u.enterprise_id
     left join contract_signatures cs on cs.acquisition_request_contract_id = arc.id
    where e.id in (35, 36, 37) and cs.id is null
    group by e.code`,
);

await c.end();
fs.writeFileSync(path.join(saida, "04-detalhe.md"), linhas.join("\n"), "utf8");
console.log(`\nescrito em ${path.join(saida, "04-detalhe.md")}`);
