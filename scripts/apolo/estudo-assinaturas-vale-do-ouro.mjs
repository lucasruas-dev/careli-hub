// ESTUDO parte 3 — o funil de assinatura DO VALE DO OURO, ponta a ponta (leitura pura).
//
// VLO 35 = masterplan comercial; VOL 36 (Lino) e VOC 37 (Cecílio) = as carteiras financeiras.
// A proposta chega no empreendimento por enterprise_unities.enterprise_id.
//
//   node scripts/apolo/estudo-assinaturas-vale-do-ouro.mjs <pasta-de-saida>
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

// A junção que o painel inteiro vai usar. Deixo escrita uma vez aqui para virar a base do código.
const DE_PROPOSTA_A_EMPREENDIMENTO = `
  from acquisition_requests ar
  join enterprise_unities u on u.id = ar.enterprise_unity_id
  join enterprises e on e.id = u.enterprise_id`;

diz("## O FUNIL DO VALE DO OURO\n");

await bloco(
  "1. propostas por empreendimento e estágio",
  `select e.code, ar.acquisition_request_stage_id as estagio, st.name as estagio_nome,
          ar.open as aberta, count(*) as n
     ${DE_PROPOSTA_A_EMPREENDIMENTO}
     left join acquisition_request_stages st on st.id = ar.acquisition_request_stage_id
    where e.id in (35, 36, 37)
    group by e.code, ar.acquisition_request_stage_id, st.name, ar.open
    order by e.code, n desc`,
);

await bloco(
  "2. propostas COM e SEM contrato gerado",
  `select e.code,
          count(distinct ar.id) as propostas,
          count(distinct arc.id) as contratos,
          count(distinct case when arc.id is null then ar.id end) as sem_contrato
     ${DE_PROPOSTA_A_EMPREENDIMENTO}
     left join acquisition_request_contracts arc on arc.acquisition_request_id = ar.id
    where e.id in (35, 36, 37)
    group by e.code order by e.code`,
);

await bloco(
  "3. o estado do ENVIO de assinatura (a fonte boa: contract_signature_status_id)",
  `select e.code, s.name as estado, count(*) as envios,
          count(distinct arc.id) as contratos,
          sum(cs.link_pdf_signed_file is not null and cs.link_pdf_signed_file <> '') as com_pdf
     ${DE_PROPOSTA_A_EMPREENDIMENTO}
     join acquisition_request_contracts arc on arc.acquisition_request_id = ar.id
     join contract_signatures cs on cs.acquisition_request_contract_id = arc.id
     left join contract_signature_statuses s on s.id = cs.contract_signature_status_id
    where e.id in (35, 36, 37)
    group by e.code, s.name order by e.code, envios desc`,
);

await bloco(
  "4. contract_type: o que separa os dois envios do mesmo contrato",
  `select cs.contract_type, s.name as estado, count(*) as n
     ${DE_PROPOSTA_A_EMPREENDIMENTO}
     join acquisition_request_contracts arc on arc.acquisition_request_id = ar.id
     join contract_signatures cs on cs.acquisition_request_contract_id = arc.id
     left join contract_signature_statuses s on s.id = cs.contract_signature_status_id
    where e.id in (35, 36, 37)
    group by cs.contract_type, s.name order by n desc`,
);

await bloco(
  "5. quem são os signatários e quantos faltam assinar",
  `select e.code, t.name as papel,
          count(*) as signatarios,
          sum(ss.signed = 1) as assinaram,
          sum(coalesce(ss.signed, 0) = 0) as faltam
     ${DE_PROPOSTA_A_EMPREENDIMENTO}
     join acquisition_request_contracts arc on arc.acquisition_request_id = ar.id
     join contract_signatures cs on cs.acquisition_request_contract_id = arc.id
     join contract_signature_signers ss on ss.contract_signature_id = cs.id
     left join contract_signature_types t on t.id = ss.contract_signature_type_id
    where e.id in (35, 36, 37)
    group by e.code, t.name order by e.code, signatarios desc`,
);

await bloco(
  "6. PARADOS: envios aguardando assinatura, por quanto tempo",
  `select e.code, s.name as estado,
          count(*) as envios,
          min(datediff(now(), cs.created_at)) as dias_min,
          round(avg(datediff(now(), cs.created_at))) as dias_medio,
          max(datediff(now(), cs.created_at)) as dias_max
     ${DE_PROPOSTA_A_EMPREENDIMENTO}
     join acquisition_request_contracts arc on arc.acquisition_request_id = ar.id
     join contract_signatures cs on cs.acquisition_request_contract_id = arc.id
     left join contract_signature_statuses s on s.id = cs.contract_signature_status_id
    where e.id in (35, 36, 37) and cs.contract_signature_status_id in (3, 7)
    group by e.code, s.name order by e.code`,
);

await bloco(
  "7. quanto tempo leva do envio até finalizar (quem já fechou)",
  `select e.code, count(*) as envios,
          round(avg(datediff(cs.updated_at, cs.created_at)), 1) as dias_medio,
          max(datediff(cs.updated_at, cs.created_at)) as dias_max
     ${DE_PROPOSTA_A_EMPREENDIMENTO}
     join acquisition_request_contracts arc on arc.acquisition_request_id = ar.id
     join contract_signatures cs on cs.acquisition_request_contract_id = arc.id
    where e.id in (35, 36, 37) and cs.contract_signature_status_id = 4
    group by e.code order by e.code`,
);

await bloco(
  "8. a divergência entre a lista PREVISTA (contract_signers) e a ENVIADA",
  `select e.code,
          count(distinct arc.id) as contratos,
          count(distinct csg.id) as previstos,
          count(distinct ss.id) as enviados
     ${DE_PROPOSTA_A_EMPREENDIMENTO}
     join acquisition_request_contracts arc on arc.acquisition_request_id = ar.id
     left join contract_signers csg on csg.acquisition_request_contract_id = arc.id
     left join contract_signatures cs on cs.acquisition_request_contract_id = arc.id
     left join contract_signature_signers ss on ss.contract_signature_id = cs.id
    where e.id in (35, 36, 37)
    group by e.code order by e.code`,
);

await bloco(
  "9. status da unidade x estado da assinatura (o cruzamento do painel)",
  `select e.code, u.sale_status_id as status_unidade,
          coalesce(s.name, 'sem envio') as estado_assinatura, count(distinct ar.id) as propostas
     ${DE_PROPOSTA_A_EMPREENDIMENTO}
     left join acquisition_request_contracts arc on arc.acquisition_request_id = ar.id
     left join contract_signatures cs on cs.acquisition_request_contract_id = arc.id
     left join contract_signature_statuses s on s.id = cs.contract_signature_status_id
    where e.id in (35, 36, 37)
    group by e.code, u.sale_status_id, s.name order by e.code, propostas desc`,
);

await bloco(
  "10. amostra crua de 6 casos, para conferir a leitura",
  `select e.code, ar.id as proposta, ar.code as codigo, u.block, u.lot,
          arc.id as contrato, arc.signature_date,
          cs.id as envio, cs.contract_type, s.name as estado,
          (select count(*) from contract_signature_signers x where x.contract_signature_id = cs.id) as signatarios,
          (select count(*) from contract_signature_signers x where x.contract_signature_id = cs.id and x.signed = 1) as assinaram
     ${DE_PROPOSTA_A_EMPREENDIMENTO}
     left join acquisition_request_contracts arc on arc.acquisition_request_id = ar.id
     left join contract_signatures cs on cs.acquisition_request_contract_id = arc.id
     left join contract_signature_statuses s on s.id = cs.contract_signature_status_id
    where e.id in (35, 36, 37)
    order by cs.created_at desc limit 6`,
);

await c.end();
fs.writeFileSync(path.join(saida, "03-vale-do-ouro.md"), linhas.join("\n"), "utf8");
console.log(`\nescrito em ${path.join(saida, "03-vale-do-ouro.md")}`);
