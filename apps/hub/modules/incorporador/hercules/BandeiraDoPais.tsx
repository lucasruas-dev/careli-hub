"use client";

import {
  AD,
  AE,
  AO,
  AR,
  AT,
  AU,
  BE,
  BO,
  BR,
  CA,
  CH,
  CL,
  CN,
  CO,
  CR,
  CY,
  CZ,
  DE,
  DK,
  EC,
  ES,
  FI,
  FR,
  GB,
  GR,
  GT,
  GY,
  HK,
  HU,
  IE,
  IL,
  IN,
  IS,
  IT,
  JP,
  KR,
  LU,
  MC,
  MX,
  MY,
  MZ,
  NL,
  NO,
  NZ,
  PA,
  PE,
  PL,
  PT,
  PY,
  QA,
  RO,
  RU,
  SE,
  SG,
  TH,
  US,
  UY,
  VE,
  ZA,
} from "country-flag-icons/react/3x2";
import { Globe } from "lucide-react";

// A BANDEIRA DO PAÍS — SVG, NUNCA EMOJI.
//
// Lucas (04/09/2026), com o print do seletor mostrando "BR", "ZA", "DE" no lugar das bandeiras:
// *"tem como vir a bandeira não?"*.
//
// ⚠️ O WINDOWS NÃO DESENHA EMOJI DE BANDEIRA, e é nele que a casa inteira trabalha. 🇧🇷 é o par de
// "regional indicator symbols" B+R; onde não existe glifo de bandeira, o navegador desenha as duas
// LETRAS — que é exatamente o "BR" do print. Não é fonte faltando nem bug do componente: a Segoe UI
// Emoji não traz bandeiras de país, de propósito, e nenhuma configuração de CSS resolve.
//
// ⚠️ A IRIS JÁ TINHA PASSADO POR ISSO (`modules/caredesk/components/phone-flag.tsx`, mesmo motivo
// no comentário) e o pacote `country-flag-icons` já está instalado. O que não se repete aqui é a
// lista: aquela é indexada por E.164 ("de que país é este número que chegou?") e cobre 28 países;
// esta é o mapa do SELETOR, e precisa dos 60 que a lista de `lib/hercules/paises.ts` oferece.
//
// ⚠️ IMPORT NOMEADO, e não `import * as Flags`. O curinga arrasta os 272 SVGs do pacote para o
// bundle da tela Venda; nomeado, entra só o que o seletor mostra.

// Todos compartilham a assinatura de FlagComponent da lib — daí o `typeof BR`.
const POR_ISO2: Record<string, typeof BR> = {
  AD,
  AE,
  AO,
  AR,
  AT,
  AU,
  BE,
  BO,
  BR,
  CA,
  CH,
  CL,
  CN,
  CO,
  CR,
  CY,
  CZ,
  DE,
  DK,
  EC,
  ES,
  FI,
  FR,
  GB,
  GR,
  GT,
  GY,
  HK,
  HU,
  IE,
  IL,
  IN,
  IS,
  IT,
  JP,
  KR,
  LU,
  MC,
  MX,
  MY,
  MZ,
  NL,
  NO,
  NZ,
  PA,
  PE,
  PL,
  PT,
  PY,
  QA,
  RO,
  RU,
  SE,
  SG,
  TH,
  US,
  UY,
  VE,
  ZA,
};

/**
 * A bandeira do país, pelo ISO2.
 *
 * País fora do mapa cai no globo: um espaço vazio no lugar da bandeira faria a linha da lista
 * parecer quebrada, e o nome do país está logo ao lado de qualquer jeito.
 */
export function BandeiraDoPais({
  altura = 12,
  iso2,
  nome,
}: {
  altura?: number;
  iso2: string;
  nome?: string;
}) {
  const Flag =
    POR_ISO2[
      String(iso2 ?? "")
        .trim()
        .toUpperCase()
    ];

  if (!Flag) {
    return (
      <Globe
        aria-label={nome ?? "País"}
        style={{ flexShrink: 0, height: altura + 2, width: altura + 2 }}
      />
    );
  }

  return (
    <Flag
      aria-label={nome ?? iso2}
      style={{
        borderRadius: 2,
        boxShadow: "0 0 0 1px rgb(0 0 0 / .12)",
        flexShrink: 0,
        height: altura,
        width: "auto",
      }}
      title={nome ?? iso2}
    />
  );
}
