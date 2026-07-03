import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
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
