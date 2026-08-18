// MEDIÇÃO read-only: o custo do catálogo COMO O CÓDIGO FAZ (pg1 sozinha, resto com concorrência 6).
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
  const arr = Array.isArray(j) ? j : [];
  return { cab: arr[0], docs: arr.filter((x) => x && x.uuidDoc) };
};
const relogio = async (r, fn) => { const t = Date.now(); const x = await fn(); console.log("  " + r.padEnd(48) + String(Date.now() - t).padStart(7) + " ms"); return x; };

console.log("### CATÁLOGO como o código faz hoje");
const t0 = Date.now();
const primeira = await relogio("  pg 1 (sozinha, para saber quantas são)", () => pagina(1));
const total = Number(primeira.cab?.total_pages) || 0;
console.log("  -> total_pages = " + total);
await relogio("  páginas 2..N com concorrência 6", async () => {
  const restantes = Array.from({ length: Math.max(0, total - 1) }, (_, i) => i + 2);
  let prox = 0;
  await Promise.all(Array.from({ length: Math.min(6, restantes.length) }, async () => {
    for (;;) { const pg = restantes[prox]; prox += 1; if (pg === undefined) return; await pagina(pg); }
  }));
});
console.log("  CATÁLOGO INTEIRO (frio) ".padEnd(50) + String(Date.now() - t0).padStart(7) + " ms");
