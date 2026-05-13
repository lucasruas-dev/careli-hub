import type { Metadata } from "next";
import { AppProviders } from "@/providers/app-providers";
import "@repo/uix/styles.css";
import "@/styles/globals.css";

export const metadata: Metadata = {
  applicationName: "C2X",
  title: {
    default: "C2X",
    template: "%s | C2X",
  },
  description: "C2X",
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
