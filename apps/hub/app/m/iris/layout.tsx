import type { ReactNode } from "react";

import { IrisMobileProvider } from "@/modules/mobile/components/iris-mobile-provider";

export default function MobileIrisLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return <IrisMobileProvider>{children}</IrisMobileProvider>;
}
