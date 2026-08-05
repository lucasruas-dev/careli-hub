// EXPLORAÇÃO 2 (leitura apenas): colunas de apolo_entities, ficha da esteira, campos do cadastro
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

// colunas de uma entidade (linha inteira, mas mascarando valores longos)
const [uma] = await ler("apolo_entities", "select=*&limit=1&metadata->>c2xSynced=eq.true");
console.log("colunas apolo_entities:", Object.keys(uma).join(", "));
console.log("document_masked exemplo:", uma.document_masked);

// ficha da esteira: pegar uma com ficha não-nula
const fichas = await ler("apolo_esteira", "select=entity_id,etapa,ficha&ficha=not.is.null&limit=5");
for (const f of fichas) {
  const keys = f.ficha ? Object.keys(f.ficha) : [];
  console.log("esteira", f.etapa, "chaves ficha:", keys.join(", "));
}

// valores do cadastro de uma entidade PF criada ontem (sem imprimir doc)
const inicio = "2026-08-01T03:00:00Z";
const fim = "2026-08-02T03:00:00Z";
const pfOntem = await ler(
  "apolo_entities",
  `select=id,display_name,metadata&created_at=gte.${inicio}&created_at=lt.${fim}&metadata->>source=eq.apolo&entity_kind=eq.pf&limit=3`,
);
for (const e of pfOntem) {
  console.log("--- PF ontem:", e.display_name);
  console.log(JSON.stringify(e.metadata?.cadastro, null, 1));
  console.log("contatos no metadata? chaves:", Object.keys(e.metadata || {}));
}

// tem tabela de contatos do apolo? tentar apolo_contacts
try {
  const c = await ler("apolo_contacts", "select=*&limit=1");
  console.log("apolo_contacts existe, colunas:", c[0] ? Object.keys(c[0]).join(", ") : "(vazia)");
} catch (e) {
  console.log("apolo_contacts:", String(e.message).slice(0, 120));
}
