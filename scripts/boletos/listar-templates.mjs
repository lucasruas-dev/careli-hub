// OS TEMPLATES QUE EXISTEM NA WABA — leitura pura, para não criar um que já está lá.
//
// ⚠️ SÓ LEITURA. Criar template é operação que a Meta enfileira para revisão humana e que não se
// desfaz sem apagar; e nome duplicado é rejeitado com erro que não diz que o nome já existe.
//
// Uso: node scripts/boletos/listar-templates.mjs [filtro]
import fs from "node:fs";
import path from "node:path";

const raiz = process.cwd();
const env = Object.fromEntries(
  fs
    .readFileSync(path.resolve(raiz, "apps/hub/.env.local"), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

const token = env.META_WHATSAPP_ACCESS_TOKEN;
const waba = env.META_WHATSAPP_BUSINESS_ACCOUNT_ID;
const versao = env.META_WHATSAPP_GRAPH_VERSION || "v21.0";
const filtro = (process.argv[2] ?? "").toLowerCase();

if (!token || !waba) {
  console.error("Faltam META_WHATSAPP_ACCESS_TOKEN ou META_WHATSAPP_BUSINESS_ACCOUNT_ID.");
  process.exit(1);
}

const todos = [];
let url = `https://graph.facebook.com/${versao}/${waba}/message_templates?limit=100`;

// ⚠️ PAGINA ATÉ O FIM. A WABA já passa de 100 templates; parar na primeira página faria o script
// dizer "não existe" sobre um template que existe, e o resultado seria um duplicado.
for (let pagina = 0; pagina < 20 && url; pagina += 1) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const j = await r.json();
  if (!r.ok) {
    console.error(`Meta ${r.status}: ${j?.error?.message ?? JSON.stringify(j).slice(0, 300)}`);
    process.exit(1);
  }
  todos.push(...(j.data ?? []));
  url = j.paging?.next ?? null;
}

console.log(`${todos.length} templates na WABA\n`);

const porStatus = {};
for (const t of todos) porStatus[t.status] = (porStatus[t.status] ?? 0) + 1;
console.log(
  Object.entries(porStatus)
    .map(([s, n]) => `${s}: ${n}`)
    .join(" · "),
);

const alvo = filtro
  ? todos.filter(
      (t) =>
        t.name.toLowerCase().includes(filtro) ||
        JSON.stringify(t.components ?? []).toLowerCase().includes(filtro),
    )
  : todos;

console.log(`\n${alvo.length} ${filtro ? `casam com "${filtro}"` : "no total"}:\n`);

for (const t of alvo.sort((a, b) => a.name.localeCompare(b.name))) {
  const header = (t.components ?? []).find((c) => c.type === "HEADER");
  const body = (t.components ?? []).find((c) => c.type === "BODY");
  const botoes = (t.components ?? []).find((c) => c.type === "BUTTONS");
  const params = [...String(body?.text ?? "").matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1]);

  console.log(`── ${t.name}  [${t.status}] ${t.category} ${t.language}`);
  if (header) {
    console.log(`   header: ${header.format}${header.text ? ` "${header.text.slice(0, 60)}"` : ""}`);
  }
  if (botoes) {
    console.log(
      `   botões: ${(botoes.buttons ?? []).map((b) => `${b.type}:${b.text}`).join(" | ")}`,
    );
  }
  console.log(`   params no corpo: ${params.length ? params.join(", ") : "nenhum"}`);
  if (filtro && body?.text) {
    console.log(
      String(body.text)
        .split("\n")
        .map((l) => `   | ${l}`)
        .join("\n"),
    );
  }
  console.log();
}
