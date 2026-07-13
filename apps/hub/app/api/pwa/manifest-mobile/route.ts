import type { NextRequest } from "next/server";

// Manifest DEDICADO do app mobile (/m). Igual ao manifest principal, mas com
// start_url/scope/id em "/m" — assim, instalado na tela de início, abre direto
// na fila do Iris em modo standalone (sem barra de URL), como um app separado
// do PWA desktop (id distinto).

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
  const icon = (purpose: string) => ({
    purpose,
    sizes: "512x512",
    src: appIconUrl,
    type: "image/png",
  });
  const manifest = {
    background_color: "#101211",
    categories: ["business", "productivity"],
    description: "Panteon Careli C2X",
    display: "standalone",
    icons: [icon("any"), icon("maskable")],
    id: "/m",
    lang: "pt-BR",
    name: appName,
    orientation: "portrait",
    scope: "/m",
    short_name: appName,
    shortcuts: [
      {
        icons: [icon("any")],
        name: "Iris",
        short_name: "Iris",
        url: "/m/iris",
      },
      {
        icons: [icon("any")],
        name: "Hermes",
        short_name: "Hermes",
        url: "/m/hermes",
      },
      {
        icons: [icon("any")],
        name: "Notificações",
        short_name: "Alertas",
        url: "/m/notificacoes",
      },
    ],
    start_url: "/m",
    theme_color: "#101211",
  };

  return new Response(JSON.stringify(manifest), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/manifest+json; charset=utf-8",
    },
  });
}
