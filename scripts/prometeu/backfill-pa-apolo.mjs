// BACKFILL DAS PAs → documentos do cadastro (pedido do Lucas, 03/08).
// As 118 PAs fotografadas no bip da secretaria viviam só no Prometeu. Aqui cada uma vira uma
// linha em `apolo_documents` apontando para o MESMO arquivo (não duplica bytes).
// Idempotente: rodar de novo não cria repetido.
//
//   node scripts/prometeu/backfill-pa-apolo.mjs            (ensaio)
//   node scripts/prometeu/backfill-pa-apolo.mjs --aplicar
import fs from "node:fs";
import path from "node:path";

const env = Object.fromEntries(
  fs.readFileSync(path.resolve(process.cwd(), "apps/hub/.env.local"), "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
const S = env.NEXT_PUBLIC_SUPABASE_URL;
const K = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY;
const H = { apikey: K, Authorization: `Bearer ${K}`, "Content-Type": "application/json" };
const aplicar = process.argv.includes("--aplicar");

const titulo = (s) => s.trim().toLocaleLowerCase("pt-BR").replace(/(^|\s|')\p{L}/gu, (m) => m.toLocaleUpperCase("pt-BR"));

const credenciados = await (await fetch(
  `${S}/rest/v1/prometeu_credenciados?select=id,nome,entity_id,metadata&metadata->pa->>path=not.is.null&limit=2000`,
  { headers: H },
)).json();

const comPa = credenciados.filter((c) => c.metadata?.pa?.path);
const semFicha = comPa.filter((c) => !c.entity_id);
const alvos = comPa.filter((c) => c.entity_id);

// O que já está no cadastro (para não duplicar).
const existentes = await (await fetch(
  `${S}/rest/v1/apolo_documents?select=entity_id,storage_path&storage_bucket=eq.prometeu-pa&limit=2000`,
  { headers: H },
)).json();
const jaTem = new Set(existentes.map((d) => `${d.entity_id}|${d.storage_path}`));

const novos = [];
for (const c of alvos) {
  const pa = c.metadata.pa;
  if (jaTem.has(`${c.entity_id}|${pa.path}`)) continue;
  const quando = pa.registradaEm ? new Date(pa.registradaEm) : new Date();
  const data = quando.toLocaleString("pt-BR", { day: "2-digit", hour: "2-digit", minute: "2-digit", month: "2-digit", year: "numeric" });
  novos.push({
    document_type: "pa",
    entity_id: c.entity_id,
    label: "PA (Proposta de Aquisição)",
    metadata: {
      fileName: `PA - ${titulo(c.nome)} - ${data}.jpg`,
      origem: "prometeu-bip-secretaria",
      registradaEm: pa.registradaEm ?? null,
      source: "prometeu",
      uploadedByName: pa.registradaPor || "Secretaria do lançamento",
    },
    status: "ready",
    storage_bucket: "prometeu-pa",
    storage_path: pa.path,
  });
}

console.log(`PAs fotografadas ............ ${comPa.length}`);
console.log(`  sem ficha no Apolo ........ ${semFicha.length}${semFicha.length ? " (" + semFicha.slice(0,3).map((c)=>c.nome).join(", ") + ")" : ""}`);
console.log(`  já no cadastro ............ ${alvos.length - novos.length}`);
console.log(`  A CRIAR ................... ${novos.length}`);
if (novos.length) console.log(`\nExemplo: ${novos[0].metadata.fileName}`);

if (!aplicar) {
  console.log("\nENSAIO — nada gravado. Use --aplicar.");
} else if (novos.length) {
  for (let i = 0; i < novos.length; i += 50) {
    const lote = novos.slice(i, i + 50);
    const r = await fetch(`${S}/rest/v1/apolo_documents`, {
      body: JSON.stringify(lote), headers: { ...H, Prefer: "return=minimal" }, method: "POST",
    });
    if (!r.ok) { console.error(`ERRO no lote ${i}: ${r.status} ${(await r.text()).slice(0, 200)}`); process.exit(1); }
    console.log(`  gravados ${Math.min(i + 50, novos.length)}/${novos.length}`);
  }
  console.log(`\nAPLICADO: ${novos.length} PAs agora aparecem no cadastro do cliente.`);
}
