import type { Metadata } from "next";
import { AppProviders } from "@/providers/app-providers";
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
const appTitle = isHomologationEnvironment ? "Homo C2X" : "C2X";

export const metadata: Metadata = {
  applicationName: appTitle,
  title: {
    default: appTitle,
    template: `%s | ${appTitle}`,
  },
  description: appTitle,
  icons: {
    apple: [{ url: "/logo-careli-c2x.png?v=2", type: "image/png" }],
    icon: [{ url: "/logo-careli-c2x.png?v=2", type: "image/png" }],
    shortcut: [{ url: "/logo-careli-c2x.png?v=2", type: "image/png" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
