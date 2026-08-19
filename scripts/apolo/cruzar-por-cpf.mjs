// CRUZAMENTO read-only POR CPF — recupera quem o cruzamento anterior perdeu.
//
// Por que existe: o primeiro cruzamento casava a pessoa pela tabela `apolo_c2x_sync`, e quem não
// tem linha lá ficava de fora mesmo existindo no C2X. Foi o caso que o Lucas pegou no olho
// (LIDIA MACHADO MARINHO, VOL0411): PIX pago em 23/07, Ato de R$ 1.000 atrasado, e nenhum
// registro de sync. O CPF é a chave que não depende de o Panteon ter sincronizado ninguém.
//
// ⚠️ READ-ONLY nos dois bancos. ⚠️ Credenciais do .env.local, nunca impressas.
// ⚠️ CPF NÃO vai para a saída: só unidade, payment_id e a data do PIX.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const req = createRequire(path.resolve(process.cwd(), "apps/hub/package.json"));
const mysql = req("mysql2/promise");
const env = Object.fromEntries(
  fs
    .readFileSync(path.resolve(process.cwd(), "apps/hub/.env.local"), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

const rest = async (caminho) => {
  const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${caminho}`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}`);
  return r.json();
};

const soDigitos = (v) => String(v ?? "").replace(/\D/g, "");

// 1. Os CADs do Vale do Ouro com PIX pago, agora com o CPF da entidade.
const esteira = await rest(
  "apolo_esteira?empreendimento=eq.VALE%20DO%20OURO&pago_em=not.is.null" +
    "&select=entity_id,pago_em,pagamento_ref&limit=1000",
);
// ⚠️ PAGINADO. São 5.293 entidades e o PostgREST devolve no máximo o que o `limit` pedir: um
// `limit=5000` cortava 293 e, com elas, parte dos CADs pagos — foi assim que a LIDIA (VOL0411)
// escapou da primeira rodada. Página a página, ninguém fica de fora por acidente de paginação.
const entidades = [];
for (let inicio = 0; ; inicio += 1000) {
  const pagina = await rest(
    `apolo_entities?select=id,document_masked&order=id&offset=${inicio}&limit=1000`,
  );
  entidades.push(...pagina);
  if (pagina.length < 1000) break;
}
const cpfPorEntity = new Map(entidades.map((e) => [e.id, soDigitos(e.document_masked)]));

const pagos = esteira
  .map((e) => ({
    cpf: cpfPorEntity.get(e.entity_id) ?? "",
    pagoEm: e.pago_em?.slice(0, 10),
    ref: e.pagamento_ref,
  }))
  .filter((p) => p.cpf.length === 11);

console.log("CADs com PIX pago .......: " + esteira.length);
console.log("com CPF utilizável ......: " + pagos.length);

// 2. No C2X, o Ato de R$ 1.000 de cada um desses CPFs.
const c = await mysql.createConnection({
  database: env.GUARDIAN_DB_NAME,
  host: env.GUARDIAN_DB_HOST,
  password: env.GUARDIAN_DB_PASSWORD,
  port: Number(env.GUARDIAN_DB_PORT || 3306),
  user: env.GUARDIAN_DB_USER,
});

const [linhas] = await c.query(
  `select replace(replace(replace(usr.cpf,'.',''),'-',''),' ','') cpf,
          p.id payment_id, u.id unit_id, concat(e.code, u.block, u.lot) unidade,
          ps.name situacao, date_format(p.payment_date,'%Y-%m-%d') pago_em
     from payments p
     join acquisition_requests ar on ar.id = p.acquisition_request_id
     join users usr on usr.id = ar.client_id
     join enterprise_unities u on u.id = ar.enterprise_unity_id
     join enterprises e on e.id = u.enterprise_id
     left join parcel_types pt on pt.id = p.parcel_type_id
     left join payment_statuses ps on ps.id = p.payment_status_id
    where e.code in ('VOC','VOL','VLO','VOR') and pt.name like '%to%' and p.initial_value = 1000
      and replace(replace(replace(usr.cpf,'.',''),'-',''),' ','') in (?)`,
  [pagos.map((p) => p.cpf)],
);
await c.end();

const porCpf = new Map();
for (const l of linhas) {
  const lista = porCpf.get(l.cpf) ?? [];
  lista.push(l);
  porCpf.set(l.cpf, lista);
}

const emAberto = [];
for (const p of pagos) {
  for (const l of porCpf.get(p.cpf) ?? []) {
    if (!l.pago_em) emAberto.push({ ...l, dataDoPix: p.pagoEm, ref: p.ref });
  }
}

// ⚠️ MESMA REGRA DE SEMPRE: 1 PIX de R$ 1.000 = 1 baixa. Onde o mesmo PIX cobre vários lotes, a
// escolha é do dono.
const porRef = new Map();
for (const l of emAberto) {
  const lista = porRef.get(l.ref) ?? [];
  lista.push(l);
  porRef.set(l.ref, lista);
}
const conferidas = [...porRef.values()].filter((i) => i.length === 1).flat();
const compartilhadas = [...porRef.values()].filter((i) => i.length > 1);

console.log("");
console.log("### AINDA EM ABERTO, com PIX pago (casando por CPF)");
console.log("  conferidas (1 PIX = 1 unidade) : " + conferidas.length);
console.log("  PIX compartilhado              : " + compartilhadas.flat().length +
  " em " + compartilhadas.length + " PIX");
console.log("");
for (const l of conferidas) {
  console.log("  " + l.unidade.padEnd(10) + " unit " + String(l.unit_id).padEnd(6) +
    " pay " + String(l.payment_id).padEnd(8) + " PIX " + l.dataDoPix);
}

fs.writeFileSync(
  path.resolve(process.cwd(), "scripts/apolo/baixa-rodada2-conferidas.json"),
  JSON.stringify(
    conferidas.map((l) => ({
      dataDoPix: l.dataDoPix,
      paymentId: Number(l.payment_id),
      unidade: l.unidade,
      unitId: Number(l.unit_id),
    })),
    null,
    2,
  ),
);
