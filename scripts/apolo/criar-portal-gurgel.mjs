// CRIA O PORTAL COMERCIAL DA GURGEL — o Hércules dos coordenadores.
//
// Pedido do Lucas (02/09/2026): *"todos terão o mesmo link, final do c2x.app.br/gurgel"* e *"para
// esse perfil da Gurgel, quero que use a logo deles no lugar da logo do Panteon"*.
//
// O que faz, nesta ordem:
//   1. sobe as DUAS artes para o bucket privado `apolo-documents`, no prefixo que a rota pública
//      da logo serve (`incorporador-logos/gurgel/<clara|escura>.png`);
//   2. grava a linha em `apolo_incorporadores` com `tipo = 'comercial'` e as referências
//      `storage:...?v=<epoch>` (o carimbo é o que fura o cache do navegador).
//
// ⚠️ SÓ GRAVA COM `--gravar`. Sem a flag é ensaio: mostra o que faria e não toca em nada.
// ⚠️ EXIGE A MIGRATION 0122 APLICADA (coluna `tipo`). Sem ela o insert falha e nada sobe — o
//    upload vem antes de propósito? Não: a ordem é upload → insert, então em falha do insert o
//    objeto fica no bucket sem linha apontando. Rodar de novo sobrescreve (upsert), sem lixo novo.
//
// Uso (da RAIZ do monorepo):
//   node scripts/apolo/criar-portal-gurgel.mjs            # ensaio
//   node scripts/apolo/criar-portal-gurgel.mjs --gravar   # grava

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const requireDoRepo = createRequire(path.resolve(process.cwd(), "apps/hub/package.json"));
const { createClient } = requireDoRepo("@supabase/supabase-js");

const env = Object.fromEntries(
  fs
    .readFileSync(path.resolve(process.cwd(), "apps/hub/.env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
    }),
);

const GRAVAR = process.argv.includes("--gravar");
const SLUG = "gurgel";
const NOME = "Gurgel";
const BUCKET = "apolo-documents";
const PREFIXO = "incorporador-logos";
const DOWNLOADS = path.join(process.env.USERPROFILE || "", "Downloads");

// Clara = tema claro da tela = a arte com o texto AZUL-MARINHO (TRANSP 2).
// Escura = tema escuro = a arte com o texto BRANCO (TRANSP 1 (1)).
const ARTES = {
  clara: path.join(DOWNLOADS, "LOGO GLI - GURGEL - TRANSP 2.png"),
  escura: path.join(DOWNLOADS, "LOGO GLI - GURGEL - TRANSP 1 (1).png"),
};

for (const [variante, arquivo] of Object.entries(ARTES)) {
  if (!fs.existsSync(arquivo)) {
    console.error(`Arte ${variante} não encontrada: ${arquivo}`);
    process.exit(1);
  }
  const bytes = fs.statSync(arquivo).size;
  if (bytes > 2 * 1024 * 1024) {
    console.error(`Arte ${variante} passa de 2MB (${bytes} bytes) — o Setup recusaria.`);
    process.exit(1);
  }
  console.log(`${variante}: ${path.basename(arquivo)} (${Math.round(bytes / 1024)} KB)`);
}

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const chave = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY;
if (!url || !chave) {
  console.error("Sem NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no apps/hub/.env.local.");
  process.exit(1);
}
const supabase = createClient(url, chave, { auth: { persistSession: false } });

const { data: existente } = await supabase
  .from("apolo_incorporadores")
  .select("id,slug,tipo,logo_path")
  .ilike("slug", SLUG)
  .maybeSingle();

if (existente) {
  console.log(`Já existe o portal /${existente.slug} (id ${existente.id}, tipo ${existente.tipo}).`);
  console.log("Nada a fazer: ajuste pelo Setup, tela Comercial.");
  process.exit(0);
}

const carimbo = Math.floor(Date.now() / 1000);
const referencias = {};

for (const [variante, arquivo] of Object.entries(ARTES)) {
  const objeto = `${PREFIXO}/${SLUG}/${variante}.png`;
  referencias[variante] = `storage:${objeto}?v=${carimbo}`;
  console.log(`${GRAVAR ? "subindo" : "subiria"} ${objeto}`);
  if (!GRAVAR) continue;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(objeto, fs.readFileSync(arquivo), { contentType: "image/png", upsert: true });
  if (error) {
    console.error(`Falha no upload de ${objeto}: ${error.message}`);
    process.exit(1);
  }
}

const linha = {
  ativo: true,
  logo_escura_path: referencias.escura,
  logo_path: referencias.clara,
  nome: NOME,
  slug: SLUG,
  tipo: "comercial",
};
console.log(`${GRAVAR ? "gravando" : "gravaria"} apolo_incorporadores:`, linha);
if (!GRAVAR) {
  console.log("\nEnsaio. Rode com --gravar para valer.");
  process.exit(0);
}

const { data, error } = await supabase
  .from("apolo_incorporadores")
  .insert(linha)
  .select("id")
  .maybeSingle();

// ⚠️ CHECAR `error` SEMPRE: o PostgREST falha calado em NOT NULL / índice único.
if (error || !data?.id) {
  console.error("Falha ao gravar o portal:", error?.message ?? "sem id de volta");
  process.exit(1);
}

console.log(`\nPortal /${SLUG} criado (id ${data.id}).`);
console.log("Próximo passo: Setup → Comercial → criar as contas dos coordenadores e vincular os empreendimentos.");
