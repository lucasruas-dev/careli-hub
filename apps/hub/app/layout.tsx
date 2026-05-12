import type { Metadata } from "next";
import { AppProviders } from "@/providers/app-providers";
import "@repo/uix/styles.css";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: "Careli Hub",
  description: "Hub Central do ecossistema Careli.",
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
