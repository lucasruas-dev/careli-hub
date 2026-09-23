import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// O ESPELHO PÚBLICO TEM DUAS PORTAS DE ENTRADA, E A ABA ARQUIVOS PRECISA EXISTIR NAS DUAS.
//
//   `/e/garden-ksewinpw`            → app/e/[link]/page.tsx        (o link curto do WhatsApp)
//   `/publico/espelho?e=<token>`    → app/publico/espelho/page.tsx (o endereço longo, de antes)
//
// As duas montam o MESMO componente e repetem o mesmo bloco de primeira carga. Foi por isso que
// este arquivo existe: [[reference_camada_nova_exige_varrer_leitores]] — camada nova exige varrer
// os leitores, e aqui "esquecer um" significa o corretor mandar o link curto e a aba não aparecer,
// sem nenhum erro em lugar nenhum.
//
// ⚠️ É VARREDURA DE TEXTO DE PROPÓSITO. As duas páginas são Server Components `async` que falam com
// o Supabase na primeira linha; montá-las num teste exigiria dublar o cliente inteiro para provar
// uma ligação de fiação. O que não pode faltar é a CHAMADA e a PROP.

const RAIZ = path.resolve(__dirname, "../../..");

const PAGINAS = [
  path.join(RAIZ, "app", "e", "[link]", "page.tsx"),
  path.join(RAIZ, "app", "publico", "espelho", "page.tsx"),
];

describe("a aba Arquivos nasce nas duas páginas do espelho", () => {
  for (const pagina of PAGINAS) {
    const nome = path.relative(RAIZ, pagina).replace(/\\/g, "/");

    it(`${nome} lê os arquivos e os entrega à tela`, () => {
      const fonte = readFileSync(pagina, "utf8");

      expect(fonte).toContain("arquivosPublicosDoEspelho");
      expect(fonte).toContain("arquivos={arquivos}");
    });

    it(`${nome} lê os arquivos junto com o resto, e não em série`, () => {
      const fonte = readFileSync(pagina, "utf8");

      // ⚠️ DENTRO DO `Promise.all`. O link é aberto no 4G, na frente do cliente: uma quarta ida ao
      // banco em série somaria o tempo dela ao da primeira pintura do mapa.
      const promessa = fonte.slice(fonte.indexOf("Promise.all"), fonte.indexOf("]);"));
      expect(promessa).toContain("arquivosPublicosDoEspelho");
    });
  }
});
