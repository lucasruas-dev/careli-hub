import type { Metadata, Viewport } from "next";
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
const chronosRecordingEgressSignalScript = `
(() => {
  if (window.location.pathname !== "/chronos/recording-view") {
    return;
  }

  if (window.__chronosRecordingStartSignalBooted) {
    return;
  }

  window.__chronosRecordingStartSignalBooted = true;

  const emitStartSignal = () => {
    window.__chronosRecordingStartLogged = true;
    console.log("START_RECORDING");
  };

  window.__chronosRecordingEmitStartSignal = emitStartSignal;

  const scheduleStartSignals = () => {
    [
      0,
      250,
      750,
      1500,
      3000,
      5000,
      8000,
      12000,
      20000,
      30000,
      45000,
      60000,
      90000,
      110000,
    ].forEach((delay) => {
      window.setTimeout(emitStartSignal, delay);
    });
  };

  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", scheduleStartSignals, {
      once: true,
    });
  } else {
    scheduleStartSignals();
  }

  window.addEventListener("load", emitStartSignal, { once: true });
  window.addEventListener("pageshow", emitStartSignal, { once: true });

  window.addEventListener(
    "pagehide",
    () => {
      if (window.__chronosRecordingEndLogged) {
        return;
      }

      window.__chronosRecordingEndLogged = true;
      console.log("END_RECORDING");
    },
    { once: true },
  );
})();
`;

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
    "msapplication-TileColor": "#101820",
  },
};

export const viewport: Viewport = {
  colorScheme: "light",
  initialScale: 1,
  themeColor: "#101820",
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
        <script
          dangerouslySetInnerHTML={{
            __html: chronosRecordingEgressSignalScript,
          }}
        />
        <PanteonPwaRuntime />
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
