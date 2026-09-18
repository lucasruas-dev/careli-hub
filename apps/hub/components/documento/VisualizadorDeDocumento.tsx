"use client";

import { Download, FileWarning, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

// O VISUALIZADOR DE DOCUMENTO — o PDF (ou a imagem) numa janela sobre a tela, com botão de baixar.
//
// Lucas (18/09/2026), depois de a prévia da proposta abrir numa aba em branco com o download no
// canto: *"acho que os documentos não precisam abrir em uma nova tela para ser visto, pode abrir
// em pop up e ter um botão de baixar"*.
//
// ⚠️ É O IRMÃO DO `VisualizadorDeMidia` (a aba Arquivos), e segue as mesmas decisões:
//   • PORTAL NO <body>: a modal da proposta e a ficha da venda vivem dentro de contêineres com
//     `overflow: hidden`; um `position: fixed` lá dentro fica preso na caixa do pai.
//   • CORES FIXAS, e não os tokens do portal: a peça serve ao hub e ao portal, e documento é lido
//     sobre fundo escuro nos dois temas, como em qualquer visualizador.
//
// ⚠️ O ARQUIVO VIRA `blob:` DESTE DOCUMENTO, SEMPRE. Mesmo quando a origem é uma URL assinada do
// storage, ela é baixada primeiro: o `<iframe>` de outra origem depende do cabeçalho de quem serve
// (e o download por atributo `download` só funciona na mesma origem). Com o blob, abrir e baixar
// funcionam do mesmo jeito para os três lugares que usam esta peça.
//
// ⚠️ O ENDEREÇO É LIBERADO AO FECHAR. Um `blob:` segura o PDF inteiro na memória da aba enquanto
// existir; sem o `revokeObjectURL`, cada prévia conferida ficaria lá até a pessoa recarregar.

export type DocumentoParaVer = {
  /** Busca o arquivo. Um `Error` com frase de gente vira o recado dentro da janela. */
  carregar: () => Promise<{ blob: Blob; nome?: null | string }>;
  /** O nome sugerido ao baixar, quando `carregar` não trouxer um melhor. */
  nomeDoArquivo: string;
  titulo: string;
};

type Estado =
  | { erro: string; tipo: "erro" }
  | { nome: string; tipo: "pronto"; tipoDoArquivo: string; url: string }
  | { tipo: "carregando" };

export function VisualizadorDeDocumento({
  aoFechar,
  documento,
}: {
  aoFechar: () => void;
  documento: DocumentoParaVer | null;
}) {
  const [estado, setEstado] = useState<Estado>({ tipo: "carregando" });

  // Carrega a cada documento novo; o `vivo` descarta a resposta de um documento que já foi fechado.
  useEffect(() => {
    if (!documento) return;
    let vivo = true;
    let endereco: null | string = null;
    setEstado({ tipo: "carregando" });

    documento
      .carregar()
      .then(({ blob, nome }) => {
        if (!vivo) return;
        endereco = URL.createObjectURL(blob);
        setEstado({
          nome: nome?.trim() || documento.nomeDoArquivo,
          tipo: "pronto",
          tipoDoArquivo: blob.type,
          url: endereco,
        });
      })
      .catch((erro: unknown) => {
        if (!vivo) return;
        setEstado({
          erro: erro instanceof Error ? erro.message : "Não foi possível abrir o documento.",
          tipo: "erro",
        });
      });

    return () => {
      vivo = false;
      if (endereco) URL.revokeObjectURL(endereco);
    };
  }, [documento]);

  // Esc fecha, e a página de baixo não rola enquanto o documento está aberto.
  //
  // ⚠️ NA CAPTURA, E PARANDO O EVENTO. Esta janela abre POR CIMA de modais que também fecham com
  // Esc (a da proposta escuta no `window`, na fase de subida). Escutando na mesma fase, um Esc
  // fecharia o documento E a proposta com tudo o que foi digitado nela.
  useEffect(() => {
    if (!documento) return;
    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key !== "Escape") return;
      evento.stopPropagation();
      aoFechar();
    };
    const overflowAntes = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", aoTeclar, true);
    return () => {
      document.body.style.overflow = overflowAntes;
      window.removeEventListener("keydown", aoTeclar, true);
    };
  }, [aoFechar, documento]);

  if (!documento || typeof document === "undefined") return null;

  const pronto = estado.tipo === "pronto" ? estado : null;
  const ehPdf = pronto?.tipoDoArquivo === "application/pdf" || /\.pdf$/i.test(pronto?.nome ?? "");
  const ehImagem = pronto?.tipoDoArquivo.startsWith("image/") ?? false;

  const botao: React.CSSProperties = {
    alignItems: "center",
    background: "transparent",
    border: "1px solid rgba(255,255,255,.22)",
    borderRadius: 8,
    color: "#F2F4F7",
    cursor: "pointer",
    display: "inline-flex",
    fontSize: 13.5,
    fontWeight: 600,
    gap: 6,
    padding: "7px 12px",
    textDecoration: "none",
  };

  return createPortal(
    <div
      aria-label={documento.titulo}
      aria-modal="true"
      // ⚠️ O CLIQUE PARA AQUI. O React sobe o evento pela árvore dos COMPONENTES, não pela do DOM:
      // mesmo no portal, o clique no fundo chegaria ao fundo da modal da proposta e a fecharia.
      onClick={(evento) => {
        evento.stopPropagation();
        aoFechar();
      }}
      role="dialog"
      style={{
        alignItems: "center",
        background: "rgba(10, 12, 16, 0.78)",
        display: "flex",
        inset: 0,
        justifyContent: "center",
        padding: 16,
        position: "fixed",
        zIndex: 1000,
      }}
    >
      <div
        // O clique dentro da janela não fecha; só o fundo, o X e o Esc.
        onClick={(evento) => evento.stopPropagation()}
        style={{
          background: "#1B1E23",
          borderRadius: 12,
          boxShadow: "0 20px 60px rgba(0,0,0,.45)",
          display: "flex",
          flexDirection: "column",
          height: "min(92vh, 1100px)",
          maxWidth: "100%",
          overflow: "hidden",
          width: "min(1100px, 96vw)",
        }}
      >
        <div
          style={{
            alignItems: "center",
            borderBottom: "1px solid rgba(255,255,255,.1)",
            display: "flex",
            gap: 10,
            padding: "10px 12px 10px 16px",
          }}
        >
          <strong
            style={{
              color: "#F2F4F7",
              flex: 1,
              fontSize: 14,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {documento.titulo}
          </strong>

          {pronto ? (
            <a download={pronto.nome} href={pronto.url} style={botao}>
              <Download size={15} />
              Baixar
            </a>
          ) : null}

          <button aria-label="Fechar" onClick={aoFechar} style={botao} type="button">
            <X size={15} />
          </button>
        </div>

        <div
          style={{
            alignItems: "center",
            background: ehPdf ? "#52565E" : "#1B1E23",
            display: "flex",
            flex: 1,
            justifyContent: "center",
            minHeight: 0,
          }}
        >
          {estado.tipo === "carregando" ? (
            <span style={{ alignItems: "center", color: "#C9CED6", display: "inline-flex", gap: 8 }}>
              <Loader2 className="inc-girando" size={18} />
              Abrindo o documento…
            </span>
          ) : estado.tipo === "erro" ? (
            <span
              style={{
                alignItems: "center",
                color: "#F2B8B5",
                display: "inline-flex",
                gap: 8,
                maxWidth: 520,
                padding: 24,
                textAlign: "center",
              }}
            >
              <FileWarning size={18} />
              {estado.erro}
            </span>
          ) : ehPdf ? (
            <iframe
              src={estado.url}
              style={{ border: 0, height: "100%", width: "100%" }}
              title={documento.titulo}
            />
          ) : ehImagem ? (
            // eslint-disable-next-line @next/next/no-img-element -- blob local, sem otimização possível
            <img
              alt={documento.titulo}
              src={estado.url}
              style={{ maxHeight: "100%", maxWidth: "100%", objectFit: "contain" }}
            />
          ) : (
            <span style={{ color: "#C9CED6", padding: 24, textAlign: "center" }}>
              Este tipo de arquivo não tem pré-visualização. Use o botão Baixar.
            </span>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
