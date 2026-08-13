// ESTUDO parte 5 — A FILA DE ASSINATURA: de quem cada contrato está esperando (leitura pura).
//
// A amostra do VOC mostrou `after_position` 1..8 com papéis distintos (corretor, comprador,
// testemunha da imobiliária, vendedor, sócios, Careli). Se a assinatura é sequencial, dizer
// "673 faltam assinar" não ajuda ninguém: o que resolve é "87 contratos parados no comprador".
//
//   node scripts/apolo/estudo-assinaturas-fila.mjs <pasta-de-saida>
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

diz("## A FILA DE ASSINATURA\n");

await bloco(
  "1. a assinatura em ordem está LIGADA nesses contratos?",
  `select e.code, arc.is_to_use_position_to_sign as em_ordem, count(*) as contratos
     from acquisition_request_contracts arc
     join acquisition_requests ar on ar.id = arc.acquisition_request_id
     join enterprise_unities u on u.id = ar.enterprise_unity_id
     join enterprises e on e.id = u.enterprise_id
    where e.id in (35, 36, 37)
    group by e.code, arc.is_to_use_position_to_sign order by e.code`,
);

await bloco(
  "1b. e na base inteira, por empreendimento que já fechou contrato",
  `select arc.is_to_use_position_to_sign as em_ordem, count(*) as contratos
     from acquisition_request_contracts arc group by arc.is_to_use_position_to_sign`,
);

await bloco(
  "2. quantos assinaram em cada degrau da fila (VOL+VOC)",
  `select ss.after_position as degrau, count(*) as signatarios,
          sum(ss.signed = 1) as assinaram,
          round(100 * sum(ss.signed = 1) / count(*)) as pct
     from contract_signature_signers ss
     join contract_signatures cs on cs.id = ss.contract_signature_id and cs.contract_type = 'default'
     join acquisition_request_contracts arc on arc.id = cs.acquisition_request_contract_id
     join acquisition_requests ar on ar.id = arc.acquisition_request_id
     join enterprise_unities u on u.id = ar.enterprise_unity_id
    where u.enterprise_id in (36, 37)
    group by ss.after_position order by degrau`,
);

// O DEGRAU ONDE PAROU: o menor `after_position` que ainda tem gente sem assinar.
const FILA = `
  select cs.id as envio, u.enterprise_id, min(ss.after_position) as degrau_parado
    from contract_signature_signers ss
    join contract_signatures cs on cs.id = ss.contract_signature_id and cs.contract_type = 'default'
    join acquisition_request_contracts arc on arc.id = cs.acquisition_request_contract_id
    join acquisition_requests ar on ar.id = arc.acquisition_request_id
    join enterprise_unities u on u.id = ar.enterprise_unity_id
   where u.enterprise_id in (36, 37) and coalesce(ss.signed, 0) = 0
   group by cs.id, u.enterprise_id`;

await bloco(
  "3. EM QUE DEGRAU cada contrato parou",
  `select e.code, f.degrau_parado, count(*) as contratos
     from (${FILA}) f
     join enterprises e on e.id = f.enterprise_id
    group by e.code, f.degrau_parado order by e.code, f.degrau_parado`,
);

await bloco(
  "4. DE QUEM estamos esperando agora (o nome de quem trava a fila)",
  `select ss.user_name, t.name as papel, count(*) as contratos_parados
     from (${FILA}) f
     join contract_signature_signers ss
       on ss.contract_signature_id = f.envio and ss.after_position = f.degrau_parado
      and coalesce(ss.signed, 0) = 0
     left join contract_signature_types t on t.id = ss.contract_signature_type_id
    group by ss.user_name, t.name order by contratos_parados desc limit 20`,
);

await bloco(
  "5. quem já assinou x quem falta, por posição na fila e por empreendimento",
  `select e.code,
          count(*) as envios,
          sum(f.degrau_parado = 1) as parados_no_1,
          sum(f.degrau_parado = 2) as parados_no_2,
          sum(f.degrau_parado >= 3) as parados_do_3_pra_frente
     from (${FILA}) f join enterprises e on e.id = f.enterprise_id
    group by e.code`,
);

await bloco(
  "6. o cliente da proposta está entre os signatários? (amostra de 10)",
  `select ar.id as proposta, cli.name as cliente_da_proposta, cli.cpf as cpf_cliente,
          (select count(*) from contract_signature_signers ss
             join contract_signatures cs2 on cs2.id = ss.contract_signature_id
            where cs2.acquisition_request_contract_id = arc.id
              and replace(replace(replace(ss.user_document, '.', ''), '-', ''), '/', '')
                = replace(replace(replace(coalesce(cli.cpf, ''), '.', ''), '-', ''), '/', '')
          ) as bate_por_cpf
     from acquisition_requests ar
     join enterprise_unities u on u.id = ar.enterprise_unity_id
     join acquisition_request_contracts arc on arc.acquisition_request_id = ar.id
     left join users cli on cli.id = ar.client_id
    where u.enterprise_id in (36, 37)
    order by ar.id desc limit 10`,
);

await bloco(
  "7. a lista operacional que o painel precisa mostrar (amostra de 12)",
  `select e.code, u.block as quadra, u.lot as lote, ar.code as proposta,
          cli.name as cliente, cs.created_at as enviado_em,
          datediff(now(), cs.created_at) as dias,
          (select count(*) from contract_signature_signers x where x.contract_signature_id = cs.id) as total,
          (select count(*) from contract_signature_signers x where x.contract_signature_id = cs.id and x.signed = 1) as assinaram,
          (select group_concat(distinct x.user_name separator ' | ')
             from contract_signature_signers x
            where x.contract_signature_id = cs.id and coalesce(x.signed, 0) = 0
              and x.after_position = (select min(y.after_position) from contract_signature_signers y
                                       where y.contract_signature_id = cs.id and coalesce(y.signed, 0) = 0)
          ) as esperando
     from acquisition_requests ar
     join enterprise_unities u on u.id = ar.enterprise_unity_id
     join enterprises e on e.id = u.enterprise_id
     join acquisition_request_contracts arc on arc.acquisition_request_id = ar.id
     join contract_signatures cs on cs.acquisition_request_contract_id = arc.id
       and cs.contract_type = 'default'
     left join users cli on cli.id = ar.client_id
    where e.id in (36, 37) and cs.contract_signature_status_id = 3
    order by cs.created_at limit 12`,
);

await bloco(
  "8. o envio mais antigo ainda aberto, por empreendimento",
  `select e.code, min(cs.created_at) as mais_antigo, max(cs.created_at) as mais_novo, count(*) as envios
     from contract_signatures cs
     join acquisition_request_contracts arc on arc.id = cs.acquisition_request_contract_id
     join acquisition_requests ar on ar.id = arc.acquisition_request_id
     join enterprise_unities u on u.id = ar.enterprise_unity_id
     join enterprises e on e.id = u.enterprise_id
    where e.id in (35, 36, 37) and cs.contract_type = 'default'
      and cs.contract_signature_status_id in (3, 7)
    group by e.code`,
);

await c.end();
fs.writeFileSync(path.join(saida, "05-fila.md"), linhas.join("\n"), "utf8");
console.log(`\nescrito em ${path.join(saida, "05-fila.md")}`);
