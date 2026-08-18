// MEDIÇÃO read-only: o catálogo do D4Sign em SÉRIE (como está hoje) x em PARALELO.
// ⚠️ READ-ONLY. ⚠️ Credencial do .env.local, nunca impressa.
import fs from "node:fs";
import path from "node:path";

const env = Object.fromEntries(
  fs.readFileSync(path.resolve(process.cwd(), "apps/hub/.env.local"), "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
const base = "https://secure.d4sign.com.br/api/v1";
const cred = "tokenAPI=" + env.D4SIGN_TOKEN_API + "&cryptKey=" + env.D4SIGN_CRYPT_KEY;
const pagina = async (pg) => {
  const r = await fetch(base + "/documents?pg=" + pg + "&" + cred, { cache: "no-store" });
  const j = await r.json().catch(() => []);
  return Array.isArray(j) ? j.filter((x) => x && x.uuidDoc) : [];
};
const relogio = async (rotulo, fn) => {
  const t = Date.now(); const r = await fn();
  console.log("  " + rotulo.padEnd(46) + String(Date.now() - t).padStart(7) + " ms");
  return r;
};

console.log("### CATÁLOGO");
await relogio("hoje: 8 páginas em SÉRIE", async () => {
  let n = 0;
  for (let pg = 1; pg <= 20; pg += 1) { const l = await pagina(pg); if (!l.length) break; n += l.length; }
  return n;
});

const lote = await relogio("proposta: páginas em PARALELO (lotes de 8)", async () => {
  const tudo = [];
  for (let inicio = 1; inicio <= 40; inicio += 8) {
    const paginas = await Promise.all(Array.from({ length: 8 }, (_, i) => pagina(inicio + i)));
    tudo.push(...paginas.flat());
    if (paginas.some((p) => p.length === 0)) break;
  }
  return tudo;
});
console.log("  -> " + lote.length + " documentos");

// O detalhe: hoje até 20 por carga, concorrência 6.
const uuids = lote.slice(0, 20).map((d) => d.uuidDoc);
const detalhe = (uuid) => fetch(base + "/documents/" + uuid + "/list?" + cred).then((r) => r.json()).catch(() => null);
console.log("\n### DETALHE (o teto de 20 por carga)");
await relogio("20 detalhes, concorrência 6 (como está hoje)", async () => {
  const fila = [...uuids];
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (fila.length) { const u = fila.shift(); if (u) await detalhe(u); }
  }));
});
await relogio("20 detalhes, concorrência 12", async () => {
  const fila = [...uuids];
  await Promise.all(Array.from({ length: 12 }, async () => {
    while (fila.length) { const u = fila.shift(); if (u) await detalhe(u); }
  }));
});
