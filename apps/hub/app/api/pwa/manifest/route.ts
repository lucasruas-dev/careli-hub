import type { NextRequest } from "next/server";

const appEnvironment =
  process.env.NEXT_PUBLIC_CARELI_APP_ENV?.toLowerCase() ?? "";
const vercelEnvironment = process.env.VERCEL_ENV?.toLowerCase() ?? "";
const appUrl = (
  process.env.NEXT_PUBLIC_CARELI_APP_URL ??
  process.env.NEXT_PUBLIC_APP_URL ??
  ""
).toLowerCase();
const gitBranch = process.env.VERCEL_GIT_COMMIT_REF?.toLowerCase() ?? "";
const isExplicitProductionEnvironment =
  vercelEnvironment === "production" ||
  appEnvironment.includes("prod") ||
  (appUrl.includes("c2x.app.br") &&
    !appUrl.includes("homo.c2x.app.br") &&
    !appUrl.includes("homolog.c2x.app.br"));
const isConfiguredHomologationEnvironment =
  !isExplicitProductionEnvironment &&
  (appEnvironment.includes("homolog") ||
    appEnvironment.includes("homo") ||
    appUrl.includes("homo.c2x.app.br") ||
    appUrl.includes("homolog.c2x.app.br") ||
    gitBranch === "homolog");

export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const requestHost = request.headers.get("host")?.toLowerCase() ?? "";
  const isHomologationEnvironment =
    isConfiguredHomologationEnvironment ||
    requestHost.includes("homo.c2x.app.br") ||
    requestHost.includes("homolog.c2x.app.br");
  const appName = isHomologationEnvironment ? "Homo Panteon" : "Panteon";
  const appIconUrl = isHomologationEnvironment
    ? "/panteon-mark-homolog.png"
    : "/panteon-mark.png";
  const manifest = {
    background_color: "#101211",
    categories: ["business", "productivity"],
    description: "Panteon Careli C2X",
    display: "standalone",
    icons: [
      {
        purpose: "any",
        sizes: "512x512",
        src: appIconUrl,
        type: "image/png",
      },
      {
        purpose: "maskable",
        sizes: "512x512",
        src: appIconUrl,
        type: "image/png",
      },
    ],
    id: "/",
    lang: "pt-BR",
    name: appName,
    orientation: "any",
    scope: "/",
    short_name: appName,
    shortcuts: [
      {
        icons: [{ sizes: "512x512", src: appIconUrl, type: "image/png" }],
        name: "Panteon",
        short_name: "Home",
        url: "/",
      },
      {
        icons: [{ sizes: "512x512", src: appIconUrl, type: "image/png" }],
        name: "Zeus",
        short_name: "Zeus",
        url: "/zeus",
      },
      {
        icons: [{ sizes: "512x512", src: appIconUrl, type: "image/png" }],
        name: "Hades",
        short_name: "Hades",
        url: "/hades",
      },
      {
        icons: [{ sizes: "512x512", src: appIconUrl, type: "image/png" }],
        name: "Hermes",
        short_name: "Hermes",
        url: "/hermes",
      },
      {
        icons: [{ sizes: "512x512", src: appIconUrl, type: "image/png" }],
        name: "Iris",
        short_name: "Iris",
        url: "/iris",
      },
    ],
    start_url: "/",
    theme_color: "#101211",
  };

  return new Response(JSON.stringify(manifest), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/manifest+json; charset=utf-8",
    },
  });
}
