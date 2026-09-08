import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // O Chromium que imprime o contrato NÃO PODE SER EMPACOTADO. O `@sparticuz/chromium` acha o
  // próprio `bin/chromium.br` por caminho calculado a partir de `import.meta.url`; se o bundler
  // move o módulo para dentro de `.next/`, esse caminho passa a apontar para uma pasta que não
  // existe e a geração morre com "The input directory ... does not exist" — o próprio pacote pede
  // para ser externalizado. O `puppeteer-core` vai junto porque carrega arquivos e binários por
  // caminho relativo pelo mesmo motivo.
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
  // As telas do masterplan interno vivem FORA de public/ de propósito (public/ é servido como
  // estático, sem passar por gate nenhum, e essas telas carregam preço e nome de comprador). Como
  // a rota as lê do disco, o rastreador precisa ser avisado — senão o arquivo não sobe no bundle
  // da função e a tela some em produção, funcionando só na máquina de quem desenvolveu.
  outputFileTracingIncludes: {
    "/api/incorporador/masterplan": ["./masterplans-internos/**"],
    // A proposta em PDF carimba a marca do C2X no rodape, lida do disco. `public/` e servido pelo
    // CDN e NAO vai sozinho para o filesystem da funcao: sem esta linha o arquivo existe no
    // ambiente de quem desenvolveu e some em producao, e a folha sai sem a marca.
    "/api/incorporador/venda/proposta": ["./public/c2x-logo.png"],
    // O Chromium do contrato. Os `.br` (chromium, fontes, swiftshader, libs do Amazon Linux) são
    // abertos por caminho montado em tempo de execução, então o rastreador não os enxerga: ele
    // segue import, não `join(dirname(...), "..", "bin")`. Sem esta linha a função sobe com o
    // código do pacote e SEM o binário — e a única evidência é um erro em produção numa rota que
    // funciona perfeitamente na máquina de quem desenvolveu, porque lá o Chrome é o do sistema.
    // ⚠️ OS QUATRO ARQUIVOS, UM A UM, e não `bin/**`. Os três primeiros são descompactados em TODA
    // geração (`build/index.js` do pacote inflaciona chromium, fontes e swiftshader sem olhar o
    // `setGraphicsMode`) e o `al2023` entra quando o runtime é Amazon Linux 2023 — que é o caso da
    // Vercel. Ou seja: nenhum é opcional. Listar em vez de usar glob deixa explícito o que o
    // contrato depende, e uma versão nova do pacote que acrescente arquivo falha alto na primeira
    // geração em vez de entrar em silêncio.
    // ⚠️ O CAMINHO SOBE DOIS NÍVEIS porque o npm workspace içou o pacote para o `node_modules` da
    // RAIZ do monorepo, não para `apps/hub/node_modules`.
    // Medido: com estas quatro linhas a função fecha em 71,1 MB (teto da Vercel: 250 MB).
    "/api/temis/pdf": [
      "../../node_modules/@sparticuz/chromium/bin/chromium.br",
      "../../node_modules/@sparticuz/chromium/bin/fonts.tar.br",
      "../../node_modules/@sparticuz/chromium/bin/swiftshader.tar.br",
      "../../node_modules/@sparticuz/chromium/bin/al2023.tar.br",
    ],
  },
  async headers() {
    return [
      // Plantas do masterplan (JPG de 2 MB + JSON dos poligonos). Sao arquivos gerados uma vez
      // e commitados, entao cada abertura da aba Mapa pagava uma revalidacao HTTP a toa. O Next
      // so aplica cache longo em /_next/static; o que esta em public/ nao entra nessa regra.
      // Prazo de 1 dia (e nao "immutable" de 1 ano) de proposito: se a planta for regerada com
      // o MESMO nome de arquivo, o navegador se corrige sozinho no dia seguinte.
      {
        source: "/masterplan/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, stale-while-revalidate=604800",
          },
        ],
      },
    ];
  },
  async rewrites() {
    return [
      // Apresentacao institucional do processo de lancamento (rota publica,
      // sem dado do hub): site estatico hospedado em projeto Vercel proprio
      // (careli-processo-lancamento), servido aqui sob /apresentacao. O HTML
      // e autossuficiente (logos em base64), entao so a raiz precisa resolver;
      // /:path* cobre assets futuros.
      {
        source: "/apresentacao",
        destination: "https://careli-processo-lancamento.vercel.app/",
      },
      {
        source: "/apresentacao/:path*",
        destination: "https://careli-processo-lancamento.vercel.app/:path*",
      },
    ];
  },
};

export default nextConfig;
