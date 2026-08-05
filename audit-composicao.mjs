// Composição do universo: quem são as 437 criadas em 01/08+? Duplicam as sincadas?
import fs from "node:fs";
import path from "node:path";

const env = Object.fromEntries(
  fs.readFileSync(path.resolve(process.cwd(), "apps/hub/.env.local"), "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
const ler = async (t, q) => {
  const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${t}?${q}`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
  });
  if (!r.ok) throw new Error(`${t}: ${r.status} ${await r.text()}`);
  return r.json();
};
const digitos = (v) => String(v ?? "").replace(/\D/g, "");

const sel = "select=id,display_name,entity_kind,document_masked,created_at,source:metadata->>source,c2xSynced:metadata->>c2xSynced,c2xUserId:metadata->>c2xUserId,papeis:metadata->>papeis";
const sincadas = await ler("apolo_entities", `${sel}&metadata->>c2xSynced=eq.true&limit=2000`);
const criadas = await ler("apolo_entities", `${sel}&created_at=gte.2026-08-01&limit=2000`);

const idsSinc = new Set(sincadas.map((e) => e.id));
const so0108 = criadas.filter((e) => !idsSinc.has(e.id));
console.log(`Sincadas: ${sincadas.length} | criadas 01/08+: ${criadas.length} | só 01/08 (não sincadas): ${so0108.length}`);

const resumo = (lista, rotulo) => {
  const comCpf = lista.filter((e) => digitos(e.document_masked).length === 11);
  const semDoc = lista.filter((e) => !digitos(e.document_masked));
  const porSource = {};
  for (const e of lista) porSource[e.source ?? "(null)"] = (porSource[e.source ?? "(null)"] ?? 0) + 1;
  const porKind = {};
  for (const e of lista) porKind[e.entity_kind] = (porKind[e.entity_kind] ?? 0) + 1;
  console.log(`\n${rotulo}: ${lista.length} | com CPF 11d: ${comCpf.length} | sem doc: ${semDoc.length}`);
  console.log("  kind:", JSON.stringify(porKind), "| source:", JSON.stringify(porSource));
  const comSync = lista.filter((e) => e.c2xSynced === "true").length;
  const comUserId = lista.filter((e) => e.c2xUserId).length;
  console.log(`  c2xSynced=true: ${comSync} | com c2xUserId: ${comUserId}`);
};
resumo(sincadas, "SINCADAS");
resumo(so0108, "SÓ 01/08 (não sincadas)");

// CPFs das só-01/08 que coincidem com CPFs das sincadas (duplicata da mesma pessoa?)
const cpfsSinc = new Set(sincadas.map((e) => digitos(e.document_masked)).filter((d) => d.length === 11));
const dup = so0108.filter((e) => cpfsSinc.has(digitos(e.document_masked)));
console.log(`\nSó-01/08 com CPF IGUAL a uma sincada (duplicata Apolo): ${dup.length}`);
console.log(JSON.stringify(dup.slice(0, 8).map((e) => ({ nome: e.display_name, cpf: digitos(e.document_masked), created: e.created_at })), null, 1));

// amostra das só-01/08 sem CPF
const semCpf = so0108.filter((e) => digitos(e.document_masked).length !== 11);
console.log(`\nSó-01/08 SEM CPF válido: ${semCpf.length}; amostra:`);
console.log(JSON.stringify(semCpf.slice(0, 8).map((e) => ({ nome: e.display_name, doc: e.document_masked, kind: e.entity_kind, source: e.source, created: e.created_at })), null, 1));
