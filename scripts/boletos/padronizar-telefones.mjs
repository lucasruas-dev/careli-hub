// PADRONIZA OS TELEFONES DE `boletos_documentos`, inserindo o nono dígito onde falta.
//
// Uso:
//   node scripts/boletos/padronizar-telefones.mjs            (ensaio)
//   node scripts/boletos/padronizar-telefones.mjs --gravar
//
// ⚠️ A COLUNA CHEGOU COM CINCO FORMATOS na mesma tela — `62998662052`, `+55 37 9905-3938`,
// `37 9912-3556`, `37 99109-7380`, `31 8822-3571` — e vários SEM o nono dígito, que é o formato
// antigo dos celulares. Mandado assim, a Meta responde 131026 ("undeliverable"): a pessoa não
// recebe nada e o erro parece "esse número não tem WhatsApp".
//
// ⚠️ A REGRA VEM DO CÓDIGO DE PRODUÇÃO (`telefone-padrao.ts`, 8 testes), compilada na hora. Uma
// segunda cópia da regra aqui divergiria da que a tela usa, e a tela mostraria um número e o
// disparo usaria outro.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const raiz = process.cwd();
const req = createRequire(path.resolve(raiz, "apps/hub/package.json"));
const { createClient } = req("@supabase/supabase-js");
const esbuild = req("esbuild");

const gravar = process.argv.includes("--gravar");

const compilado = await esbuild.build({
  bundle: true,
  entryPoints: [path.resolve(raiz, "apps/hub/lib/apolo/boletos/telefone-padrao.ts")],
  format: "esm",
  platform: "node",
  write: false,
});
const { telefonePadrao, telefoneUtilizavel } = await import(
  `data:text/javascript;base64,${Buffer.from(compilado.outputFiles[0].text).toString("base64")}`
);

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
const sb = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SECRET_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const todos = [];
for (let de = 0; ; de += 1000) {
  const { data, error } = await sb
    .from("boletos_documentos")
    .select("id,empreendimento,unidade,nome,contato")
    .eq("workspace_id", "careli")
    .range(de, de + 999);
  if (error) throw error;
  todos.push(...data);
  if (data.length < 1000) break;
}

const mudam = [];
const jaOk = [];
const semTelefone = [];
const naoReconhecidos = [];

for (const d of todos) {
  if (!d.contato || !String(d.contato).trim()) {
    semTelefone.push(d);
    continue;
  }
  const novo = telefonePadrao(d.contato);
  if (novo === d.contato) {
    (telefoneUtilizavel(novo) ? jaOk : naoReconhecidos).push(d);
    continue;
  }
  if (!telefoneUtilizavel(novo) && !/^\(\d{2}\) \d{4}-\d{4}$/.test(novo ?? "")) {
    naoReconhecidos.push({ ...d, novo });
    continue;
  }
  mudam.push({ ...d, novo });
}

const ganhamNono = mudam.filter((m) => {
  const antes = String(m.contato).replace(/\D/g, "").replace(/^55/, "");
  return antes.length === 10;
});

console.log(`${todos.length} cadastros`);
console.log(`  ${mudam.length} mudam de formato`);
console.log(`     dos quais ${ganhamNono.length} GANHAM O NONO DÍGITO (esses não recebiam a mensagem)`);
console.log(`  ${jaOk.length} já estavam no padrão`);
console.log(`  ${semTelefone.length} sem telefone`);
console.log(`  ${naoReconhecidos.length} não reconhecidos (ficam como estão)`);

if (ganhamNono.length) {
  console.log(`\nOS QUE GANHAM O NONO DÍGITO:`);
  for (const m of ganhamNono.slice(0, 40)) {
    console.log(`   ${m.empreendimento.padEnd(14)} ${String(m.unidade).padEnd(10)} ${String(m.contato).padEnd(20)} -> ${m.novo}   ${m.nome}`);
  }
  if (ganhamNono.length > 40) console.log(`   … e mais ${ganhamNono.length - 40}`);
}

if (naoReconhecidos.length) {
  console.log(`\nNÃO RECONHECIDOS (nada muda):`);
  for (const n of naoReconhecidos) {
    console.log(`   ${n.empreendimento.padEnd(14)} ${String(n.unidade).padEnd(10)} ${JSON.stringify(n.contato)}   ${n.nome}`);
  }
}

if (!gravar) {
  console.log("\nENSAIO — nada foi gravado. Rode com --gravar para valer.");
  process.exit(0);
}

let feitos = 0;
for (const m of mudam) {
  const { error } = await sb
    .from("boletos_documentos")
    .update({ atualizado_em: new Date().toISOString(), contato: m.novo })
    .eq("id", m.id);
  if (error) {
    console.error(`❌ ${m.empreendimento} ${m.unidade}: ${error.message}`);
    process.exit(1);
  }
  feitos += 1;
  process.stdout.write(`\r  ${feitos}/${mudam.length}`);
}
console.log(`\n\n✓ ${feitos} telefones padronizados (${ganhamNono.length} ganharam o nono dígito).`);
