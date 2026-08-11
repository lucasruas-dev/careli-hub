import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // As telas do masterplan interno vivem FORA de public/ de propósito (public/ é servido como
  // estático, sem passar por gate nenhum, e essas telas carregam preço e nome de comprador). Como
  // a rota as lê do disco, o rastreador precisa ser avisado — senão o arquivo não sobe no bundle
  // da função e a tela some em produção, funcionando só na máquina de quem desenvolveu.
  outputFileTracingIncludes: {
    "/api/incorporador/masterplan": ["./masterplans-internos/**"],
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
