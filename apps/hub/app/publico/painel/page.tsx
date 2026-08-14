import type { Metadata } from "next";
import Link from "next/link";

import { carregarPainelAssinatura } from "@/lib/apolo/painel-assinatura";
import {
  acharEmpreendimento,
  carregarCads,
  carregarImobiliarias,
  listarEmpreendimentos,
} from "@/lib/apolo/painel-coordenador";
import { carregarSinal } from "@/lib/apolo/painel-sinal";
import { AbaAssinatura } from "@/modules/publico/painel/aba-assinatura";
import { AbaCad } from "@/modules/publico/painel/aba-cad";
import { AbaImobiliarias } from "@/modules/publico/painel/aba-imobiliarias";
import { AbaSinal } from "@/modules/publico/painel/aba-sinal";
import { Aviso, C, GOLD } from "@/modules/publico/painel/ui";

// PAINEL DO COORDENADOR — CAD, imobiliárias, assinatura e sinal do empreendimento, num lugar só.
//
// Público por decisão do Lucas (14/08): os coordenadores precisam disso agora e não têm conta no
// hub. O perfil de acesso do time comercial vem depois e substitui este arranjo — quando vier,
// esta página passa a exigir sessão e nada mais muda.
//
// `noindex`: tem nome de cliente e de imobiliária. Link que circula é uma coisa, link que o
// Google indexa é outra bem diferente.
//
// Navegação por LINK (?emp=&aba=), não por estado de cliente: assim cada aba carrega só a fonte
// dela. Quem abre a aba CAD não paga a consulta do C2X, e quem manda o link de uma aba específica
// manda a aba certa. O custo disso é um recarregamento por clique de aba — barato, porque as
// libs cacheiam 5 minutos no servidor.

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Painel do coordenador | Careli",
};

const ABAS = [
  { chave: "cad", label: "CAD" },
  { chave: "imobiliarias", label: "Imobiliárias" },
  { chave: "assinatura", label: "Assinatura" },
  { chave: "sinal", label: "Sinal" },
] as const;

type AbaChave = (typeof ABAS)[number]["chave"];

function ehAba(valor: string | undefined): valor is AbaChave {
  return ABAS.some((aba) => aba.chave === valor);
}

export default async function PainelCoordenadorRoute({
  searchParams,
}: {
  searchParams: Promise<{ aba?: string; emp?: string }>;
}) {
  const { aba: abaParam, emp: empParam } = await searchParams;
  const aba: AbaChave = ehAba(abaParam) ? abaParam : "cad";

  const empreendimentos = await listarEmpreendimentos();
  const empreendimento = await acharEmpreendimento(empParam ?? "");

  const shell = (conteudo: React.ReactNode) => (
    <main
      style={{
        background: C.page,
        color: C.text,
        fontFamily: "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
        minHeight: "100vh",
        padding: "28px 20px 64px",
      }}
    >
      <div style={{ margin: "0 auto", maxWidth: 1040, width: "100%" }}>{conteudo}</div>
    </main>
  );

  if (!empreendimento) {
    return shell(
      <div
        style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 14,
          color: C.sub,
          padding: "40px 24px",
          textAlign: "center",
        }}
      >
        Painel indisponível no momento. Tente novamente em instantes.
      </div>,
    );
  }

  const linkDe = (destino: { aba?: AbaChave; emp?: string }) =>
    `/publico/painel?emp=${encodeURIComponent(destino.emp ?? empreendimento.slug)}&aba=${destino.aba ?? aba}`;

  const cabecalho = (
    <>
      <div style={{ marginBottom: 18 }}>
        <p
          style={{
            color: GOLD,
            fontSize: 12.5,
            fontWeight: 600,
            letterSpacing: 0.4,
            margin: 0,
            textTransform: "uppercase",
          }}
        >
          Careli · Painel do coordenador
        </p>
        <h1 style={{ fontSize: 26, fontWeight: 600, margin: "6px 0 0" }}>{empreendimento.nome}</h1>
        <p style={{ color: C.sub, fontSize: 14, margin: "6px 0 0" }}>
          {empreendimento.cads} {empreendimento.cads === 1 ? "CAD" : "CADs"} ·{" "}
          {empreendimento.imobiliarias}{" "}
          {empreendimento.imobiliarias === 1 ? "imobiliária" : "imobiliárias"} credenciadas
        </p>
      </div>

      {/* Seletor de empreendimento: só os que têm CAD ou imobiliária credenciada — é a definição
          de "onde está acontecendo venda". Empreendimento novo entra sozinho aqui. */}
      {empreendimentos.length > 1 ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 18 }}>
          {empreendimentos.map((item) => {
            const ativo = item.slug === empreendimento.slug;
            return (
              <Link
                href={linkDe({ emp: item.slug })}
                key={item.slug}
                style={{
                  background: ativo ? GOLD : C.card,
                  border: `1px solid ${ativo ? GOLD : C.border}`,
                  borderRadius: 999,
                  color: ativo ? "#FFFFFF" : C.sub,
                  fontSize: 13,
                  fontWeight: ativo ? 600 : 400,
                  padding: "7px 14px",
                  textDecoration: "none",
                }}
              >
                {item.nome}
              </Link>
            );
          })}
        </div>
      ) : null}

      <div
        style={{
          borderBottom: `1px solid ${C.border}`,
          display: "flex",
          gap: 4,
          marginBottom: 22,
          overflowX: "auto",
        }}
      >
        {ABAS.map((item) => {
          const ativo = item.chave === aba;
          return (
            <Link
              href={linkDe({ aba: item.chave })}
              key={item.chave}
              style={{
                borderBottom: `2px solid ${ativo ? GOLD : "transparent"}`,
                color: ativo ? C.text : C.sub,
                fontSize: 14,
                fontWeight: ativo ? 600 : 400,
                padding: "10px 14px",
                textDecoration: "none",
                whiteSpace: "nowrap",
              }}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </>
  );

  const rodape = (
    <p style={{ color: C.muted, fontSize: 12, marginTop: 28, textAlign: "center" }}>
      Careli · dados do Apolo e do C2X · atualiza a cada 5 minutos
    </p>
  );

  if (aba === "cad") {
    const cads = await carregarCads(empreendimento.ids);
    return shell(
      <>
        {cabecalho}
        <AbaCad cads={cads} />
        {rodape}
      </>,
    );
  }

  if (aba === "imobiliarias") {
    const imobiliarias = await carregarImobiliarias(empreendimento.ids);
    return shell(
      <>
        {cabecalho}
        <AbaImobiliarias imobiliarias={imobiliarias} />
        {rodape}
      </>,
    );
  }

  if (aba === "assinatura") {
    const resultado = await carregarPainelAssinatura(empreendimento.ids);
    return shell(
      <>
        {cabecalho}
        {resultado.ok ? (
          <AbaAssinatura dados={resultado.dados} />
        ) : (
          <Aviso tom="vermelho">{resultado.erro}</Aviso>
        )}
        {rodape}
      </>,
    );
  }

  const resultado = await carregarSinal(empreendimento.ids);
  return shell(
    <>
      {cabecalho}
      {resultado.ok ? (
        <AbaSinal resumo={resultado.dados} />
      ) : (
        <Aviso tom="vermelho">{resultado.erro}</Aviso>
      )}
      {rodape}
    </>,
  );
}
