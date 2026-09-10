// PREPARA O ESPELHO PÚBLICO DE UM MASTERPLAN — separa o SVG em arte e geometria, e grava os dois.
//
// Por que existe: o SVG publicado em `hercules_masterplans` vai de 2,8 MB (Garden) a 24,9 MB
// (Veredas do Ouro), e ~97% disso é UMA foto em base64. Mandar isso ao navegador de um cliente no
// 4G, a cada abertura do link, é impraticável. Separado, o espelho viaja em duas peças com ciclos
// de vida diferentes:
//
//     <cod>/v<n>-arte.webp        a foto, imutável — o navegador baixa UMA vez e guarda
//     <cod>/v<n>-geometria.json   os contornos, imutáveis — 16 a 263 KB
//
// e a SITUAÇÃO de cada lote vem à parte, de rota `no-store`, porque é a única coisa que muda.
//
// ⚠️ A CONVERSÃO É AQUI, OFFLINE, E NÃO EM SERVERLESS. O Veredas tem 16000×9000: descomprimido
// são ~576 MB de RGBA, acima do que uma função da Vercel tem de folga, e a conversão leva
// segundos. Isto roda na máquina, quando o masterplan muda — que é raro.
//
// ⚠️ TETO DE 6000px, QUALIDADE 82. Medido em 10/09/2026 contra os oito masterplans reais: sete
// deles já nascem com 3840px ou menos, então o teto não os toca — só o Veredas encolhe. A 4000px
// o número do lote continua legível, mas a textura da planta achata visivelmente no zoom fundo; a
// 6000px ela volta a ficar perto do original, por 2,77 MB em vez de 1,35 MB — ainda 6× menor que
// os 17,6 MB de origem. Subir a qualidade não compensa: q90 custa +40% para recuperar textura de
// grama que ninguém está olhando.
//
// Uso (da RAIZ do monorepo):
//   node scripts/hercules/preparar-espelho.mts --pai VLO
//   node scripts/hercules/preparar-espelho.mts --pai VLO --gravar
//   node scripts/hercules/preparar-espelho.mts --todos --gravar
//
// ⚠️ SÓ GRAVA COM `--gravar`, como o importador irmão. Sem a flag é ensaio: mede e mostra.
//
// ⚠️ E RODE UM POR VEZ, COM RETRY, NA MÁQUINA DO LUCAS. `--todos` cai com SIGSEGV (exit 139) em
// pontos diferentes a cada execução — uma vez depois do quinto arquivo, outra depois do primeiro,
// e sempre em arquivo que passou sozinho na tentativa anterior. Inconsistente assim não é bug de
// código, é a instabilidade conhecida do notebook ([[reference_notebook_lucas_predator]]). Um
// processo por masterplan isola a queda, e a segunda tentativa passa:
//
//   for cod in GDN JDG LAB REP RVP VAL VDO VLO; do
//     for t in 1 2 3; do node scripts/hercules/preparar-espelho.mts --pai $cod --gravar && break; done
//   done
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

import { separarEspelho } from "../../apps/hub/lib/apolo/incorporador/espelho-svg.ts";

const requireDoRepo = createRequire(
  path.resolve(process.cwd(), "apps/hub/package.json"),
);
const { createClient } = requireDoRepo("@supabase/supabase-js");
const sharp = requireDoRepo("sharp");

// ⚠️ SEM ISTO O SCRIPT MORRE DE SEGFAULT NO SEXTO MASTERPLAN. O libvips mantém um cache de
// operações e um pool de threads entre chamadas; processando oito arquivos de 3 a 25 MB em
// sequência, a memória nativa acumula até o processo cair com SIGSEGV (exit 139) — e cai num
// arquivo PEQUENO, o que faz parecer defeito do arquivo em vez de acúmulo. Medido em 10/09/2026:
// com cache ligado morre depois do quinto; desligado, os oito passam.
sharp.cache(false);
sharp.concurrency(1);

const env: Record<string, string> = Object.fromEntries(
  fs
    .readFileSync(path.resolve(process.cwd(), "apps/hub/.env.local"), "utf8")
    .split(/\r?\n/)
    .map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l.trim()))
    .filter((m): m is RegExpExecArray => Boolean(m))
    .map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")]),
);

function arg(nome: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const GRAVAR = process.argv.includes("--gravar");
const TODOS = process.argv.includes("--todos");
const PAI = String(arg("pai") ?? "").trim().toUpperCase();
const BUCKET = "apolo-documents";
const PREFIXO = "hercules-masterplans";
const LARGURA_MAXIMA = 6000;
// ⚠️ 92, E NÃO 82. Lucas (10/09/2026), comparando com o espelho do C2X: *"é essa qualidade que
// eu preciso"*. O C2X serve a foto ORIGINAL embutida no SVG, sem recompressão; a 82 o WebP já
// mostrava a diferença nas letras finas de metragem quando ampliado. A 92 a perda deixa de ser
// perceptível e o arquivo continua uma fração do original — no Vale do Ouro, 22,98 MB de SVG
// viram cerca de 2,5 MB.
const QUALIDADE = 92;

if (!PAI && !TODOS) {
  console.error("Uso: --pai <CODIGO> [--gravar]   ou   --todos [--gravar]");
  process.exit(1);
}

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false } },
);

const mb = (n: number): string => (n / 1024 / 1024).toFixed(2);

type Publicado = {
  codigo: string;
  empreendimentoId: string;
  paiC2xId: null | string;
  svgPath: string;
  versao: number;
};

/** Os masterplans publicados — um por empreendimento (índice único garante). */
async function publicados(): Promise<Publicado[]> {
  const { data, error } = await supabase
    .from("hercules_masterplans")
    .select(
      "empreendimento_id, svg_path, versao, hercules_empreendimentos!inner(codigo, c2x_enterprise_id)",
    )
    .not("publicado_em", "is", null);

  if (error) throw new Error(error.message);

  return (data ?? [])
    .map((m: Record<string, unknown>) => {
      const emp = m.hercules_empreendimentos as {
        c2x_enterprise_id: null | string;
        codigo: string;
      };
      return {
        codigo: emp.codigo,
        empreendimentoId: String(m.empreendimento_id),
        paiC2xId: emp.c2x_enterprise_id,
        svgPath: String(m.svg_path),
        versao: Number(m.versao),
      };
    })
    .filter((m: Publicado) => TODOS || m.codigo === PAI)
    .sort((a: Publicado, b: Publicado) => a.codigo.localeCompare(b.codigo));
}

/**
 * Os códigos que SÃO lote naquele empreendimento.
 *
 * ⚠️ QUEM DECIDE O QUE É LOTE É O CADASTRO, e não uma regex de formato: o arquivo do projetista
 * traz ruas, praças, moldura e legenda como `<path>` também, e pintar uma praça de verde a faria
 * virar lote disponível no mapa do cliente. E os códigos não têm formato único — `GDN0101` mas
 * `RVPA01`, `VALA01`, `REPA01`, com letra no meio.
 */
async function codigosDoCadastro(c2xId: null | string): Promise<Set<string>> {
  if (!c2xId) return new Set();
  const codigos = new Set<string>();

  // Paginado: o PostgREST corta em 1.000 linhas sem erro, e o Lagoa Bonita tem 495.
  for (let pagina = 0; ; pagina += 1) {
    const { data, error } = await supabase
      .from("hercules_unidades")
      .select("codigo")
      .eq("enterprise_id", c2xId)
      .range(pagina * 1000, pagina * 1000 + 999);
    if (error) throw new Error(error.message);
    const linhas = (data ?? []) as { codigo: string }[];
    for (const l of linhas) codigos.add(String(l.codigo).trim().toUpperCase());
    if (linhas.length < 1000) return codigos;
  }
}

console.log(
  `cod | lotes | SVG hoje |  arte  | geometria | dimensoes${GRAVAR ? "" : "   (ENSAIO)"}`,
);
console.log("----|-------|----------|--------|-----------|----------------");

for (const m of await publicados()) {
  const { data: arquivo, error } = await supabase.storage
    .from(BUCKET)
    .download(m.svgPath);
  if (error || !arquivo) {
    console.log(`${m.codigo} | falhou ao baixar: ${error?.message ?? "vazio"}`);
    continue;
  }

  const svg = await arquivo.text();
  const validos = await codigosDoCadastro(m.paiC2xId);
  const separado = separarEspelho(svg, validos);

  if (separado.contornos.length === 0) {
    console.log(`${m.codigo} | ZERO contornos — nao grava (o mapa sairia vazio)`);
    continue;
  }
  if (!separado.arte) {
    console.log(`${m.codigo} | ${separado.contornos.length} lotes | SEM ARTE embutida no SVG`);
    continue;
  }

  const meta = await sharp(separado.arte.bytes).metadata();
  const webp: Buffer = await sharp(separado.arte.bytes)
    .resize({ width: Math.min(LARGURA_MAXIMA, meta.width), withoutEnlargement: true })
    .webp({ quality: QUALIDADE })
    .toBuffer();

  // A geometria carrega o viewBox junto: sem ele os contornos não têm escala, e a tela teria de
  // adivinhar (o fallback existe, mas adivinhar aqui poria os lotes fora do lugar).
  const geometria = Buffer.from(
    JSON.stringify({
      contornos: separado.contornos,
      viewBox: separado.viewBox,
    }),
  );

  console.log(
    `${m.codigo} | ${String(separado.contornos.length).padStart(5)} | ` +
      `${mb(svg.length).padStart(8)} | ${mb(webp.length).padStart(6)} | ` +
      `${mb(geometria.length).padStart(9)} | ${meta.width}x${meta.height}`,
  );

  if (!GRAVAR) continue;

  for (const [nome, corpo, tipo] of [
    [`v${m.versao}-arte.webp`, webp, "image/webp"],
    [`v${m.versao}-geometria.json`, geometria, "application/json"],
  ] as const) {
    const { error: erroUpload } = await supabase.storage
      .from(BUCKET)
      .upload(`${PREFIXO}/${m.codigo}/${nome}`, corpo, {
        contentType: tipo,
        // Sobrescreve: preparar de novo o mesmo masterplan tem de dar o mesmo resultado, e uma
        // versão nova do SVG já ganha número de versão novo no caminho.
        upsert: true,
      });
    if (erroUpload) console.log(`   ⚠️ ${nome}: ${erroUpload.message}`);
  }
}

if (!GRAVAR) console.log("\nEnsaio. Rode com --gravar para valer.");
