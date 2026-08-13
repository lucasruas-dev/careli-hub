// AUDITORIA v2 — amarrada ao CONTRATO, nao a unidade.
//
// A v1 partia da unidade e pegava TODAS as propostas dela, inclusive canceladas: uma unidade
// revendida acusava "cliente sem assinar" que era de uma proposta morta. Aqui cada verificacao
// anda pelo contrato que esta na planilha -> a proposta DELE -> os clientes DELA.
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
const c = await mysql.createConnection({
  database: env.GUARDIAN_DB_NAME, host: env.GUARDIAN_DB_HOST, password: env.GUARDIAN_DB_PASSWORD,
  port: +(env.GUARDIAN_DB_PORT || 3306), user: env.GUARDIAN_DB_USER,
});
const diz = (t) => console.log(t);
async function b(t, sql) {
  diz("\n### " + t);
  const [r] = await c.query(sql);
  if (!r.length) diz("  (vazio — nenhum caso)");
  for (const x of r) diz("  " + JSON.stringify(x));
  return r;
}

// Os ENVIOS da planilha: contrato enviado, nao cancelado, e com todo perfil Cliente assinado.
const ENVIOS_OK = `
  select cs.id as envio_id, arc.id as contrato_id, ar.id as proposta_id, u.id as unidade_id
    from contract_signatures cs
    join acquisition_request_contracts arc on arc.id = cs.acquisition_request_contract_id
    join acquisition_requests ar on ar.id = arc.acquisition_request_id
    join enterprise_unities u on u.id = ar.enterprise_unity_id
   where u.enterprise_id in (36,37)
     and cs.send_document_signature = 1
     and cs.contract_signature_status_id <> 6
     and exists (select 1 from contract_signature_signers x
                   join contract_signers cx on cx.id = x.contract_signer_id
                   join signers sx on sx.id = cx.signer_id
                   join users ux on ux.id = sx.user_id
                   join profiles px on px.id = ux.profile_id and px.name = 'Cliente'
                  where x.contract_signature_id = cs.id)
     and not exists (select 1 from contract_signature_signers x
                       join contract_signers cx on cx.id = x.contract_signer_id
                       join signers sx on sx.id = cx.signer_id
                       join users ux on ux.id = sx.user_id
                       join profiles px on px.id = ux.profile_id and px.name = 'Cliente'
                      where x.contract_signature_id = cs.id and coalesce(x.signed,0) <> 1)`;

await b("quantos envios/unidades a regra devolve AGORA",
  `select count(*) as envios, count(distinct unidade_id) as unidades from (${ENVIOS_OK}) t`);

await b("FURO 1 — algum signatario Cliente pendente nesses envios (tem que ser vazio)",
  `select count(*) as casos
     from (${ENVIOS_OK}) t
     join contract_signature_signers ss on ss.contract_signature_id = t.envio_id
     join contract_signers csg on csg.id = ss.contract_signer_id
     join signers sg on sg.id = csg.signer_id
     join users usr on usr.id = sg.user_id
     join profiles pf on pf.id = usr.profile_id and pf.name = 'Cliente'
    where coalesce(ss.signed,0) <> 1`);

await b("FURO 2 — cliente DA PROPOSTA DESSE CONTRATO que nao aparece entre os signatarios",
  `select e.code, u.name as unidade, cli.name as cliente, cli.cpf,
          case when ar.client_id = cli.id then 'titular' else 'co-titular' end as papel
     from (${ENVIOS_OK}) t
     join acquisition_requests ar on ar.id = t.proposta_id
     join enterprise_unities u on u.id = t.unidade_id
     join enterprises e on e.id = u.enterprise_id
     join users cli on cli.id in (ar.client_id, ar.client_2_id, ar.client_3_id, ar.client_4_id, ar.client_5_id)
    where not exists (
      select 1 from contract_signature_signers ss
        left join contract_signers csg on csg.id = ss.contract_signer_id
        left join signers sg on sg.id = csg.signer_id
       where ss.contract_signature_id = t.envio_id
         and (sg.user_id = cli.id
              or replace(replace(replace(coalesce(ss.user_document,''),'.',''),'-',''),'/','')
                 = replace(replace(replace(coalesce(cli.cpf,''),'.',''),'-',''),'/','')))`);

await b("FURO 3 — unidade da lista que tem OUTRO envio ativo com Cliente pendente",
  `select e.code, u.name as unidade, count(*) as signatarios_cliente_pendentes
     from (select distinct unidade_id from (${ENVIOS_OK}) x) alvo
     join enterprise_unities u on u.id = alvo.unidade_id
     join enterprises e on e.id = u.enterprise_id
     join acquisition_requests ar on ar.enterprise_unity_id = u.id
     join acquisition_request_contracts arc on arc.acquisition_request_id = ar.id
     join contract_signatures cs on cs.acquisition_request_contract_id = arc.id
      and cs.send_document_signature = 1 and cs.contract_signature_status_id <> 6
     join contract_signature_signers ss on ss.contract_signature_id = cs.id
     join contract_signers csg on csg.id = ss.contract_signer_id
     join signers sg on sg.id = csg.signer_id
     join users usr on usr.id = sg.user_id
     join profiles pf on pf.id = usr.profile_id and pf.name = 'Cliente'
    where coalesce(ss.signed,0) <> 1
    group by e.code, u.name`);

await c.end();
