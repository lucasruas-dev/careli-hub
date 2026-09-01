// Gera o asset de impressao da marca CARELI + o modulo base64 que o extrato do cliente (PDF)
// embute.
//
// POR QUE BASE64 NUM MODULO EM VEZ DE readFileSync("public/..."):
// `public/` NAO vai garantido para o filesystem da lambda na Vercel. Ler dali funcionaria em
// dev e falharia SO em producao, na hora de emitir o extrato para o cliente. Constante
// embutida nao tem esse modo de falha. Mesmo racional do `gerar-logo-cad.mjs`.
//
// POR QUE `careli-invite-logo.png` E NAO `careli-email-logo.png`:
// as duas sao a mesma arte (o C dourado + a wordmark CARELI), mas a do e-mail tem 256x328 --
// ampliar isso para impressao serrilha. A do convite tem 2083x2083 com folga transparente em
// volta; o `trim` tira a folga e sobra 1211x1553 de arte real, que reduzido para 480px de
// largura da ~175dpi no tamanho que o timbrado usa (~46pt).
//
// COMO REGERAR:  node scripts/gerar-logo-careli.mjs   (a partir de apps/hub)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const aqui = dirname(fileURLToPath(import.meta.url));
const hub = join(aqui, "..");

const ORIGEM = join(hub, "public", "careli-invite-logo.png");
const SAIDA_PNG = join(hub, "public", "careli-logo-pdf.png");
const SAIDA_TS = join(hub, "lib", "apolo", "careli-logo.ts");

// `trim` com threshold baixo: a folga em volta e alfa puro, entao qualquer limiar acima de 0
// recorta ate a arte sem comer o antialias das bordas douradas.
const arte = await sharp(readFileSync(ORIGEM))
  .trim({ threshold: 1 })
  .toBuffer();

// 64 cores: a arte tem UM dourado e o branco do miolo. Paleta maior so engorda o arquivo.
const bytes = await sharp(arte)
  .resize({ kernel: "lanczos3", width: 480 })
  .png({ colours: 64, compressionLevel: 9, effort: 10, palette: true })
  .toBuffer();

writeFileSync(SAIDA_PNG, bytes);
console.log(`${SAIDA_PNG} -> ${(bytes.byteLength / 1024).toFixed(1)} KB`);

const modulo = `// GERADO por scripts/gerar-logo-careli.mjs -- NAO EDITAR A MAO.
//
// Marca CARELI (fundo claro) embutida em base64 para o timbrado do extrato do cliente.
// Ver o cabecalho do script para o porque de nao ler de public/ em runtime.
export const CARELI_LOGO_PNG_BASE64 =
  "${bytes.toString("base64")}";
`;
writeFileSync(SAIDA_TS, modulo);
console.log(`careli-logo.ts -> ${(modulo.length / 1024).toFixed(1)} KB de string`);
