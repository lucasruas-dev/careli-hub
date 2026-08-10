"use client";

import { useEffect, useState } from "react";

import { fonte } from "@/modules/publico/ui/tokens";

import { T } from "./tema";

// PRODUTOS: um card por empreendimento, com a logo dele. Pedido do Lucas (10/08): "Produtos (que
// terá um card de cada produto com a logo do empreendimento e quando cliente abrir essa tela o
// masterplan interno)".
//
// A lista vem da rota, que recorta pelo cookie assinado. A tela NUNCA pede empreendimento por
// parâmetro: se pedisse, o recorte deixaria de ser garantia e viraria sugestão.

type Produto = {
  carteiraAdministrada: boolean;
  code: string;
  enterpriseIds: string[];
  id: string;
  logoUrl: string | null;
  nome: string;
};

export function TelaProdutos() {
  const [produtos, setProdutos] = useState<Produto[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;

    (async () => {
      try {
        const resposta = await fetch("/api/incorporador/produtos", { cache: "no-store" });
        const payload = (await resposta.json().catch(() => null)) as
          | { data?: { produtos: Produto[] }; error?: string }
          | null;

        if (!vivo) return;

        if (!resposta.ok || !payload?.data) {
          setErro(payload?.error ?? "Não foi possível carregar os produtos.");
          return;
        }

        setProdutos(payload.data.produtos);
      } catch {
        if (vivo) setErro("Não foi possível carregar os produtos.");
      }
    })();

    return () => {
      vivo = false;
    };
  }, []);

  if (erro) {
    return <Aviso texto={erro} />;
  }

  if (!produtos) {
    return <Aviso texto="Carregando os produtos…" />;
  }

  if (produtos.length === 0) {
    return <Aviso texto="Nenhum produto liberado para este acesso ainda." />;
  }

  return (
    <>
      <h1 style={{ color: T.text, fontSize: 20, fontWeight: 600, margin: "0 0 4px" }}>Produtos</h1>
      <p style={{ color: T.muted, fontSize: 13.5, margin: "0 0 22px" }}>
        {produtos.length === 1 ? "1 empreendimento" : `${produtos.length} empreendimentos`}. Abra
        um para ver o masterplan.
      </p>

      <div
        style={{
          display: "grid",
          gap: 16,
          gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
        }}
      >
        {produtos.map((produto) => (
          <CardProduto key={produto.id} produto={produto} />
        ))}
      </div>
    </>
  );
}

function CardProduto({ produto }: { produto: Produto }) {
  return (
    <article
      style={{
        background: T.card,
        border: `1px solid ${T.border}`,
        borderRadius: 14,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          alignItems: "center",
          background: T.soft,
          display: "flex",
          height: 120,
          justifyContent: "center",
          padding: 18,
        }}
      >
        {produto.logoUrl ? (
          <img
            alt={produto.nome}
            src={produto.logoUrl}
            style={{ maxHeight: "100%", maxWidth: "100%", objectFit: "contain" }}
          />
        ) : (
          // Sem logo o card mostra a sigla, não um vazio: é o mesmo fallback do resto do sistema.
          <span style={{ color: T.muted, fontSize: 26, fontWeight: 700, letterSpacing: 1 }}>
            {produto.code || produto.nome.slice(0, 3).toUpperCase()}
          </span>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 10, padding: 16 }}>
        <div>
          <div style={{ color: T.text, fontSize: 15.5, fontWeight: 600 }}>{produto.nome}</div>
          <div style={{ color: T.muted, fontSize: 12, marginTop: 2 }}>
            {produto.code}
            {produto.carteiraAdministrada ? " · carteira administrada" : ""}
          </div>
        </div>

        <button
          disabled
          style={{
            background: "transparent",
            border: `1px solid ${T.border}`,
            borderRadius: 10,
            color: T.muted,
            cursor: "default",
            fontFamily: fonte,
            fontSize: 13,
            marginTop: "auto",
            padding: "10px 12px",
            width: "100%",
          }}
          title="O masterplan entra na próxima rodada"
          type="button"
        >
          Ver masterplan
        </button>
      </div>
    </article>
  );
}

function Aviso({ texto }: { texto: string }) {
  return (
    <div
      style={{
        background: T.card,
        border: `1px solid ${T.border}`,
        borderRadius: 14,
        color: T.muted,
        fontSize: 14,
        padding: 30,
        textAlign: "center",
      }}
    >
      {texto}
    </div>
  );
}
