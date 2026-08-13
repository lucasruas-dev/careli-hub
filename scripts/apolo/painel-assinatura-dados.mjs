// Monta o dataset do painel do Vale do Ouro seguindo AS REGRAS DO MODELO DO LUCAS,
// extraídas do .pbit (docs/operations/c2x-painel-assinatura-dax.md):
//   filtro   send_document_signature = true e contract_signature_status_id <> 6
//   Unidade  enterprise_unities.name
//   Perfil   profiles.name, com "cliente" -> "Comprador" e @careli.adm.br -> "Backoffice"
//   Assinado "Sim" / "Não"
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

const [linhas] = await c.query(
  `select
     e.code as emp,
     coalesce(nullif(trim(u.name), ''), concat(e.code, u.block, u.lot)) as unidade,
     u.block as quadra, u.lot as lote, round(u.price) as valor,
     cs.id as id_ass,
     date_format(cs.created_at, '%Y-%m-%d') as envio,
     datediff(now(), cs.created_at) as dias_envio,
     ss.user_name as usuario,
     ss.email,
     pf.name as perfil_c2x,
     ss.signed as assinado,
     date_format(ss.date_signed, '%Y-%m-%d') as data_assinatura,
     ss.after_position as posicao,
     cli.name as cliente_da_proposta
   from contract_signatures cs
   join acquisition_request_contracts arc on arc.id = cs.acquisition_request_contract_id
   join acquisition_requests ar on ar.id = arc.acquisition_request_id
   join enterprise_unities u on u.id = ar.enterprise_unity_id
   join enterprises e on e.id = u.enterprise_id
   join contract_signature_signers ss on ss.contract_signature_id = cs.id
   left join contract_signers csg on csg.id = ss.contract_signer_id
   left join signers sg on sg.id = csg.signer_id
   left join users usr on usr.id = sg.user_id
   left join profiles pf on pf.id = usr.profile_id
   left join users cli on cli.id = ar.client_id
  where u.enterprise_id in (36, 37)
    and cs.send_document_signature = 1
    and cs.contract_signature_status_id <> 6
  order by e.code, u.block, u.lot, ss.after_position, ss.id`);

console.log(`${linhas.length} linhas de assinatura`);

const PRAZO = 7;
const norm = (s) => String(s ?? "").trim().replace(/\s+/g, " ");

const dados = linhas.map((l) => {
  const email = String(l.email ?? "").toLowerCase();
  // A ordem importa e é a do modelo: primeiro traduz cliente->Comprador, depois
  // sobrescreve quem é da casa para Backoffice.
  let perfil = l.perfil_c2x === "Cliente" ? "Comprador" : (l.perfil_c2x ?? "Sem perfil");
  if (email.endsWith("@careli.adm.br")) perfil = "Backoffice";

  const assinado = Number(l.assinado) === 1;
  const dias = assinado
    ? Math.round((new Date(l.data_assinatura) - new Date(l.envio)) / 86400000)
    : l.dias_envio;
  let prazo = null;
  if (perfil === "Comprador") {
    prazo = assinado
      ? (dias <= PRAZO ? "Assinado no prazo" : "Assinado fora do prazo")
      : (dias <= PRAZO ? "Pendente dentro do prazo" : "Pendente e em atraso");
  }
  return {
    emp: l.emp, un: norm(l.unidade), q: l.quadra, lo: l.lote, vl: Number(l.valor) || 0,
    ct: l.id_ass, env: l.envio, du: l.dias_envio,
    us: norm(l.usuario), em: email, pf: perfil,
    as: assinado, da: l.data_assinatura, po: l.posicao ?? 0,
    cli: norm(l.cliente_da_proposta), pz: prazo,
  };
});

const SAIDA = process.argv[2] || ".";
fs.writeFileSync(`${SAIDA}/painel-dados.json`, JSON.stringify(dados), "utf8");

const unidades = new Set(dados.map((d) => d.un));
const perfis = {};
for (const d of dados) {
  perfis[d.pf] ??= { t: 0, ok: 0 };
  perfis[d.pf].t += 1;
  if (d.as) perfis[d.pf].ok += 1;
}
console.log(`unidades: ${unidades.size}  contratos: ${new Set(dados.map((d) => d.ct)).size}`);
console.log("perfis:");
for (const [k, v] of Object.entries(perfis).sort((a, b) => b[1].t - a[1].t)) {
  console.log(`   ${k.padEnd(24)} ${String(v.ok).padStart(4)} de ${String(v.t).padStart(4)}`);
}
const amostra = dados.find((d) => d.pf === "Comprador");
console.log("\namostra:", JSON.stringify(amostra));
console.log(`\ntamanho do JSON: ${(fs.statSync(`${SAIDA}/painel-dados.json`).size / 1024).toFixed(0)} KB`);
await c.end();
