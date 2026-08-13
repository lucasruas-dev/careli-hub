// Dados do Excel: unidades do Vale do Ouro cujos COMPRADORES já assinaram.
//
// Mesmo recorte do painel (send_document_signature = 1, status <> 6) e mesma definição de
// comprador (perfil Cliente do C2X). A imobiliária vem de `users.vinculed_by_id` do cliente:
// `acquisition_requests.corretor_id` está nulo em todas estas propostas, medido em 13/08.
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
     coalesce(nullif(trim(imo.fantasy_name), ''), nullif(trim(imo.social_name), ''),
              nullif(trim(imo.name), ''), 'sem imobiliária') as imobiliaria,
     ss.user_name as pessoa, ss.user_document as documento, ss.email,
     cli.cellphone as celular_titular, cli.name as titular_da_proposta,
     ss.signed as assinou,
     date_format(ss.date_signed, '%Y-%m-%d') as assinou_em,
     date_format(cs.created_at, '%Y-%m-%d') as enviado_em,
     u.id as unidade_id
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
   left join users imo on imo.id = cli.vinculed_by_id
  where u.enterprise_id in (36, 37)
    and cs.send_document_signature = 1
    and cs.contract_signature_status_id <> 6
    and pf.name = 'Cliente'
  order by e.code, u.block, u.lot, ss.after_position`);

const limpo = (v) => String(v ?? "").trim().replace(/\s+/g, " ");
const cpf = (d) => {
  const n = String(d ?? "").replace(/\D/g, "");
  return n.length === 11 ? `${n.slice(0, 3)}.${n.slice(3, 6)}.${n.slice(6, 9)}-${n.slice(9)}` : limpo(d);
};

// Agrupa por unidade e fica só com as que têm TODOS os compradores assinados.
const porUnidade = new Map();
for (const l of linhas) {
  if (!porUnidade.has(l.unidade_id)) porUnidade.set(l.unidade_id, []);
  porUnidade.get(l.unidade_id).push(l);
}

const saida = [];
for (const ls of porUnidade.values()) {
  if (!ls.every((x) => Number(x.assinou) === 1)) continue;
  for (const l of ls) {
    saida.push({
      empreendimento: l.emp === "VOC" ? "VOC · Cecílio" : "VOL · Lino",
      unidade: limpo(l.unidade),
      quadra: limpo(l.quadra),
      lote: limpo(l.lote),
      comprador: limpo(l.pessoa),
      cpf: cpf(l.documento),
      papel: limpo(l.pessoa) === limpo(l.titular_da_proposta) ? "Titular" : "Cônjuge ou 2º titular",
      email: limpo(l.email).toLowerCase(),
      celular: limpo(l.celular_titular),
      imobiliaria: limpo(l.imobiliaria),
      valorUnidade: Number(l.valor) || 0,
      enviadoEm: l.enviado_em,
      assinouEm: l.assinou_em,
      diasAteAssinar:
        l.assinou_em && l.enviado_em
          ? Math.max(0, Math.round((new Date(l.assinou_em) - new Date(l.enviado_em)) / 86_400_000))
          : null,
    });
  }
}

saida.sort(
  (a, b) =>
    (b.assinouEm ?? "").localeCompare(a.assinouEm ?? "") ||
    a.unidade.localeCompare(b.unidade) ||
    a.papel.localeCompare(b.papel),
);

const SAIDA = process.argv[2] || ".";
fs.writeFileSync(`${SAIDA}/excel-compradores.json`, JSON.stringify(saida, null, 1), "utf8");

const unidades = new Set(saida.map((s) => s.unidade));
const imobs = new Map();
for (const s of saida) imobs.set(s.imobiliaria, (imobs.get(s.imobiliaria) ?? 0) + 1);
console.log(`${saida.length} compradores em ${unidades.size} unidades`);
console.log(`valor somado das unidades: R$ ${[...unidades].reduce((t, un) => t + (saida.find((s) => s.unidade === un)?.valorUnidade ?? 0), 0).toLocaleString("pt-BR")}`);
console.log("\npor imobiliária:");
for (const [k, v] of [...imobs.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(k).slice(0, 44).padEnd(46)} ${v}`);
}
console.log("\namostra:", JSON.stringify(saida[0]));
await c.end();
