import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { AppProviders } from "@/providers/app-providers";
import { PanteonPwaRuntime } from "@/components/panteon-pwa-runtime";
import "@repo/uix/styles.css";
import "@/styles/globals.css";

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
const isHomologationEnvironment =
  !isExplicitProductionEnvironment &&
  (appEnvironment.includes("homolog") ||
    appEnvironment.includes("homo") ||
    appUrl.includes("homo.c2x.app.br") ||
    appUrl.includes("homolog.c2x.app.br") ||
    gitBranch === "homolog");
const appTitle = isHomologationEnvironment ? "Homo Panteon" : "Panteon";
const appIconUrl = isHomologationEnvironment
  ? "/panteon-mark-homolog.png?v=1"
  : "/panteon-mark.png?v=1";

export const metadata: Metadata = {
  applicationName: appTitle,
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: appTitle,
  },
  title: {
    default: appTitle,
    template: `%s | ${appTitle}`,
  },
  description: appTitle,
  formatDetection: {
    telephone: false,
  },
  icons: {
    apple: [{ url: appIconUrl, type: "image/png" }],
    icon: [{ url: appIconUrl, type: "image/png" }],
    shortcut: [{ url: appIconUrl, type: "image/png" }],
  },
  manifest: "/api/pwa/manifest",
  other: {
    "mobile-web-app-capable": "yes",
    "msapplication-TileColor": "#101211",
  },
};

export const viewport: Viewport = {
  colorScheme: "light",
  initialScale: 1,
  themeColor: "#101211",
  width: "device-width",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body>
        {/* ⚠️ POR `src`, E NÃO INLINE. Este script já morou aqui como <script
            dangerouslySetInnerHTML>, e o React 19 passou a acusar no console ("Encountered a script
            tag while rendering React component"). Trocar por <Script> com conteúdo inline NÃO
            resolve: o next/script continua renderizando a tag, e o aviso vem dele. Com `src`, não
            existe tag inline para o React reclamar — o corpo está em
            `public/chronos-recording-signal.js`, que não guarda segredo nenhum.

            ⚠️ `afterInteractive`, e não `beforeInteractive`: este só sinaliza pelo console para o
            gravador, e o `beforeInteractive` fazia o Next pré-carregar o arquivo em TODA página do
            hub — inclusive nas que nunca vão gravar nada —, rendendo um aviso de preload não usado
            em cada carga. O script já se protege sozinho (roda na hora se o DOM estiver pronto,
            senão espera o DOMContentLoaded) e repete o sinal por 110 segundos. */}
        <Script src="/chronos-recording-signal.js" strategy="afterInteractive" />
        <PanteonPwaRuntime />
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
