"use client";

// Bandeira do país do telefone como SVG (não emoji). Motivo: o Windows não desenha o emoji
// de bandeira (🇧🇷 vira "BR" num quadradinho); SVG renderiza igual em todo SO/navegador.
// País derivado do E.164 pelo iso2ForE164. País desconhecido -> globo. Ver
// [[project-iris-foreign-phone]].
import {
  AE,
  AR,
  AU,
  BE,
  BR,
  CH,
  CL,
  CN,
  CO,
  DE,
  ES,
  FR,
  GB,
  IE,
  IL,
  IN,
  IT,
  JP,
  LU,
  MX,
  NL,
  PE,
  PT,
  PY,
  US,
  UY,
  VE,
  ZA,
} from "country-flag-icons/react/3x2";
import { Globe } from "lucide-react";

import { iso2ForE164 } from "@/lib/iris/phone-country";

// Componentes de bandeira compartilham a mesma assinatura (FlagComponent da lib) -> `typeof BR`.
const FLAG_BY_ISO2: Record<string, typeof BR> = {
  AE,
  AR,
  AU,
  BE,
  BR,
  CH,
  CL,
  CN,
  CO,
  DE,
  ES,
  FR,
  GB,
  IE,
  IL,
  IN,
  IT,
  JP,
  LU,
  MX,
  NL,
  PE,
  PT,
  PY,
  US,
  UY,
  VE,
  ZA,
};

export function PhoneFlag({
  phone,
  className,
}: {
  phone: string | null | undefined;
  className?: string;
}) {
  const iso2 = iso2ForE164(phone);
  const Flag = iso2 ? FLAG_BY_ISO2[iso2] : undefined;
  const extra = className ? ` ${className}` : "";

  if (!Flag) {
    return (
      <Globe
        aria-label="País desconhecido"
        className={`inline-block size-3.5 shrink-0 align-[-2px] text-slate-400${extra}`}
      />
    );
  }

  return (
    <Flag
      aria-label={iso2 ?? undefined}
      title={iso2 ?? undefined}
      className={`inline-block h-3.5 w-auto shrink-0 rounded-[2px] align-[-2px] ring-1 ring-black/10${extra}`}
    />
  );
}
