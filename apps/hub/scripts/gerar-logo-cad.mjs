// Gera os assets web da logo do C2X + o modulo base64 que a CAD (PDF) embute.
//
// POR QUE BASE64 NUM MODULO EM VEZ DE readFileSync("public/..."):
// `public/` NAO vai garantido para o filesystem da lambda na Vercel. Ler dali funcionaria em
// dev e falharia SO em producao, no momento de gerar a CAD do corretor. Constante embutida
// nao tem esse modo de falha.
//
// POR QUE NAO SERVIR O ORIGINAL: `apresentacoes/processo-lancamento/c2x_claro.png` tem
// 6000x3375 e 753 KB. O corretor esta em 4G; 753 KB no topo de um formulario mobile e
// desperdicio grosseiro de banda.
//
// COMO REGERAR:  node scripts/gerar-logo-cad.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const aqui = dirname(fileURLToPath(import.meta.url));
const hub = join(aqui, "..");
// ⚠️ Versao para FUNDO CLARO. A `c2x_escuro` so serve para fundo escuro e renderiza X
// duplicado quando invertida.
const ORIGEM = join(hub, "..", "..", "..", "apresentacoes", "processo-lancamento", "c2x_claro.png");

const alvos = [
  // Topo das telas publicas. Renderizada a ~140px, entao 560 cobre telas 3x sem serrilhar.
  { largura: 560, saida: join(hub, "public", "c2x-logo.png") },
  // Fonte de impressao (a CAD ocupa ~70pt no papel; 600px da ~215dpi impresso).
  { largura: 600, saida: join(hub, "public", "c2x-logo-pdf.png") },
];

const original = readFileSync(ORIGEM);

for (const alvo of alvos) {
  // Lanczos3 + PNG paletizado, alfa preservado. Sem `trim`: o logo ja preenche a arte e o
  // recorte comeria o antialias das bordas.
  const bytes = await sharp(original)
    .resize({ kernel: "lanczos3", width: alvo.largura })
    // 128 cores: a arte é o X dourado + colchetes + wordmark, poucos tons. Acima disso a
    // paleta só engorda o arquivo sem diferença visível.
    .png({ colours: 128, compressionLevel: 9, effort: 10, palette: true })
    .toBuffer();
  writeFileSync(alvo.saida, bytes);
  console.log(`${alvo.saida} -> ${(bytes.byteLength / 1024).toFixed(1)} KB`);
}

// Modulo base64 consumido por cad-pdf.ts.
const pdfBytes = readFileSync(alvos[1].saida);
const modulo = `// GERADO por scripts/gerar-logo-cad.mjs -- NAO EDITAR A MAO.
//
// Logo do C2X (fundo claro) embutida em base64 para o gerador da CAD. Ver o cabecalho do
// script para o porque de nao ler de public/ em runtime.
export const C2X_LOGO_PNG_BASE64 =
  "${pdfBytes.toString("base64")}";
`;
writeFileSync(join(hub, "modules", "apolo", "blocks", "cadastro", "cad-logo.ts"), modulo);
console.log(`cad-logo.ts -> ${(modulo.length / 1024).toFixed(1)} KB de string`);
