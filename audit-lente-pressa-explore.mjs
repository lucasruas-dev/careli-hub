// EXPLORAÇÃO (leitura apenas): universo da lente "cadastros de 01/08 na pressa"
import fs from "node:fs";
import path from "node:path";

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

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY;

const ler = async (tabela, query) => {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${tabela}?${query}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!resp.ok) throw new Error(`${tabela}: ${resp.status} ${await resp.text()}`);
  return resp.json();
};

// 1. Criadas em 01/08 (fuso -03:00) com source apolo
const inicio = "2026-08-01T03:00:00Z"; // 01/08 00:00 BRT
const fim = "2026-08-02T03:00:00Z"; // 02/08 00:00 BRT
const criadasOntem = await ler(
  "apolo_entities",
  `select=id,display_name,entity_kind,created_at,metadata&created_at=gte.${inicio}&created_at=lt.${fim}&metadata->>source=eq.apolo&limit=2000`,
);
console.log("criadas em 01/08 (source=apolo):", criadasOntem.length);

// 2. As que subiram (c2xSynced=true)
const syncadas = await ler(
  "apolo_entities",
  `select=id,display_name,entity_kind,created_at&metadata->>c2xSynced=eq.true&limit=3000`,
);
console.log("c2xSynced=true (total):", syncadas.length);

// 3. Estrutura de metadata.cadastro — amostra de 2 criadas ontem
for (const e of criadasOntem.slice(0, 2)) {
  const cad = e.metadata?.cadastro;
  console.log("---", e.id, e.entity_kind, e.created_at);
  console.log("chaves metadata:", Object.keys(e.metadata || {}).join(", "));
  if (cad) console.log("chaves cadastro:", Object.keys(cad).join(", "));
}

// 4. Estrutura da ficha da esteira — amostra
const ids = criadasOntem.slice(0, 50).map((e) => e.id);
if (ids.length) {
  const est = await ler(
    "apolo_esteira",
    `select=entity_id,etapa,ficha&entity_id=in.(${ids.join(",")})&limit=50`,
  );
  console.log("esteira rows p/ amostra:", est.length);
  const comFicha = est.find((r) => r.ficha && Object.keys(r.ficha).length);
  if (comFicha) console.log("chaves ficha:", Object.keys(comFicha.ficha).join(", "));
}
