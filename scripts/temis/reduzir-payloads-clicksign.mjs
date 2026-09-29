// REDUZ OS PAYLOADS E OS CABEÇALHOS ANTIGOS DO WEBHOOK DA CLICKSIGN: sai CPF, nascimento,
// geolocalização e IP do corpo, e os tokens que a Vercel injeta nos cabeçalhos.
//
// F1 do plano da fonte única (docs/assinatura/fonte-unica-do-contrato.md, bug 8.8). Medido em
// 28/09/2026: 201 de 226 eventos guardados em `temis_assinatura_eventos` traziam `documentation` (CPF)
// e `birthday`, e 39 traziam latitude/longitude. Desde a F1 o webhook guarda o payload reduzido; este
// script troca o das linhas ANTIGAS pelo mesmo recorte.
//
// ⚠️ E OS CABEÇALHOS (revisão da F1, medido em 28/09/2026 só com contagens): as 230 linhas guardavam
// `x-vercel-oidc-token` (um JWT), `x-vercel-sc-headers` (com `Authorization: Bearer`) e
// `x-vercel-proxy-signature`, mais IP e geolocalização de quem chamou. O webhook agora guarda por uma
// lista do que guardar (`cabecalhosParaGuardar`); este script passa a mesma lista nas linhas antigas.
//
//   node scripts/temis/reduzir-payloads-clicksign.mjs            ENSAIO: conta, não grava
//   node scripts/temis/reduzir-payloads-clicksign.mjs --gravar   reescreve o payload das linhas
//
// ⚠️ RODE DA RAIZ DO MONOREPO. `--gravar` SÓ COM OK DO LUCAS, e SÓ DEPOIS de
// `reprocessar-eventos-clicksign.mjs --gravar`: o reprocessamento lê as marcas destes payloads, e o
// recorte guarda tudo o que ele lê (provado em `apps/hub/lib/assinatura/marcas.test.ts`), mas a ordem
// segura é tirar a informação antes de reduzir o lugar onde ela estava. Não há volta: o cheio some.
//
// ⚠️ O RECORTE NÃO MORA AQUI: é `payloadReduzidoDaClicksign` (conferido), `esqueletoDoPayload`
// (não conferido) e `cabecalhosParaGuardar` (os dois), de `apps/hub/lib/assinatura/marcas.ts`, os
// mesmos que o webhook usa.
//
// ⚠️ IDEMPOTENTE: linha que já está no recorte (payload e cabeçalhos) não é regravada.
// ⚠️ SEM DADO PESSOAL NA SAÍDA: só ids e contagens.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const req = createRequire(path.resolve(process.cwd(), "apps/hub/package.json"));
const { createClient } = req("@supabase/supabase-js");
const { createJiti } = req("jiti");

const jiti = createJiti(import.meta.url);
const { cabecalhosParaGuardar, esqueletoDoPayload, payloadReduzidoDaClicksign } = await jiti.import(
  path.resolve(process.cwd(), "apps/hub/lib/assinatura/marcas.ts"),
);

const gravar = process.argv.includes("--gravar");

const ENV_LOCAL = [
  path.resolve(process.cwd(), "apps/hub/.env.local"),
  path.resolve(process.cwd(), "../../careli-hub/apps/hub/.env.local"),
].find((p) => fs.existsSync(p));
if (!ENV_LOCAL) throw new Error("não achei apps/hub/.env.local");

const env = Object.fromEntries(
  fs
    .readFileSync(ENV_LOCAL, "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function semDado(erro) {
  return `${erro?.code ?? ""} ${erro?.message ?? ""}`.trim();
}

/** As chaves que não podem ficar guardadas (a mesma lista do teste do recorte). */
const SENSIVEIS = /"(documentation|birthday|latitude|longitude|address|ip|user_agent|phone_number)"\s*:/;
/** Os cabeçalhos que carregam credencial da Vercel (a prova (d) do plano confere o mesmo). */
const CREDENCIAIS = /oidc-token|sc-headers|proxy-signature/i;

// ⚠️ PostgREST corta em 1.000 linhas SEM ERRO, e paginar SEM ORDEM perde linha com o total batendo.
const linhas = [];
for (let de = 0; ; de += 500) {
  const { data, error } = await supabase
    .from("temis_assinatura_eventos")
    .select("id, assinatura_conferida, headers, payload")
    .eq("provedor", "clicksign")
    .order("id")
    .range(de, de + 499);
  if (error) throw new Error(semDado(error));
  linhas.push(...(data ?? []));
  if (!data || data.length < 500) break;
}
if (new Set(linhas.map((l) => l.id)).size !== linhas.length) {
  throw new Error("leitura instável (ids repetidos), abortado");
}

let sensiveisAntes = 0;
let sensiveisDepois = 0;
let credenciaisAntes = 0;
let credenciaisDepois = 0;
let aTrocar = 0;
let trocadas = 0;
let falhas = 0;

for (const linha of linhas) {
  const antes = JSON.stringify(linha.payload ?? null);
  if (SENSIVEIS.test(antes)) sensiveisAntes += 1;

  const jaEsqueleto = linha.payload && typeof linha.payload === "object" && linha.payload.__esqueleto === true;
  const novo = jaEsqueleto
    ? linha.payload
    : linha.assinatura_conferida
      ? payloadReduzidoDaClicksign(linha.payload)
      : esqueletoDoPayload(linha.payload, antes.length);
  const depois = JSON.stringify(novo ?? null);
  if (SENSIVEIS.test(depois)) sensiveisDepois += 1;

  const cabecalhosAntes = JSON.stringify(linha.headers ?? null);
  if (CREDENCIAIS.test(cabecalhosAntes)) credenciaisAntes += 1;
  const cabecalhosNovos = cabecalhosParaGuardar(linha.headers ?? {}, linha.assinatura_conferida === true);
  const cabecalhosDepois = JSON.stringify(cabecalhosNovos);
  if (CREDENCIAIS.test(cabecalhosDepois)) credenciaisDepois += 1;

  const trocaPayload = depois !== antes;
  const trocaCabecalhos = cabecalhosDepois !== cabecalhosAntes;
  if (!trocaPayload && !trocaCabecalhos) continue;
  aTrocar += 1;

  if (!gravar) continue;
  const { error } = await supabase
    .from("temis_assinatura_eventos")
    .update({
      ...(trocaPayload ? { payload: novo } : {}),
      ...(trocaCabecalhos ? { headers: cabecalhosNovos } : {}),
    })
    .eq("id", linha.id);
  if (error) {
    falhas += 1;
    console.log(`${linha.id} · FALHOU: ${semDado(error)}`);
  } else {
    trocadas += 1;
  }
}

console.log(`${gravar ? "GRAVANDO" : "ENSAIO"} · ${linhas.length} evento(s) da Clicksign`);
console.log(`com campo sensível antes: ${sensiveisAntes} · depois do recorte: ${sensiveisDepois}`);
console.log(`com credencial nos cabeçalhos antes: ${credenciaisAntes} · depois do recorte: ${credenciaisDepois}`);
console.log(
  gravar
    ? `trocadas: ${trocadas} de ${aTrocar} · falhas: ${falhas}`
    : `a trocar: ${aTrocar}. Nada foi gravado (ensaio).`,
);
