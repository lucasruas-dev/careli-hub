"use client";

import { X } from "lucide-react";
import { useEffect } from "react";

// O DOCUMENTO, POR CIMA DA TELA DE TRABALHO.
//
// Lucas (11/09/2026): *"ao clicar nos documentos está abrindo uma pagina no navegador em branco e
// abre no hub o documento, mas eu quero que abra na tela de trabalho que está, um pop up"*.
//
// ⚠️ POR CIMA, E NÃO NO LUGAR. Quem abre um documento na Têmis está CONFERINDO: o contrato contra o
// RG, o valor contra o comprovante, a versão 2 contra a 1. Mandar a pessoa para outra aba quebra a
// comparação no meio — ela perde de vista justamente o que estava conferindo.
//
// ⚠️ E A ABA EM BRANCO TINHA CAUSA, não era lentidão: os três lugares que abriam documento na Têmis
// chamavam `window.open("", "_blank", "noopener,noreferrer")`, e com `noopener` nas features o
// navegador devolve `null` por especificação. O código caía no `else` e mandava a ABA DE TRABALHO
// para o PDF, deixando a aba nova vazia. Eram dois defeitos num: a aba órfã e a tela perdida.
//
// ⚠️ A URL PRECISA SER ASSINADA SEM `download`. Com ele, o Storage responde
// `Content-Disposition: attachment`, e attachment dentro de um `<iframe>` não desenha: baixa. É por
// isso que a rota do contrato ganhou `?modo=ver` — a da aba Documentos já assinava sem.

export type DocumentoNaTela = {
  nome: string;
  /** Vazia enquanto a URL assinada está sendo buscada. */
  url: string;
};

export function VisorDeDocumento({
  aoFechar,
  documento,
}: {
  aoFechar: () => void;
  documento: DocumentoNaTela;
}) {
  // Esc fecha: é o primeiro gesto de quem abre um documento por cima de outra coisa.
  useEffect(() => {
    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") aoFechar();
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [aoFechar]);

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/55 p-4"
      onClick={aoFechar}
    >
      <section
        className="flex h-[88vh] w-[min(64rem,96vw)] flex-col overflow-hidden rounded-xl bg-surface shadow-[0_24px_80px_rgba(15,23,42,0.3)]"
        // Clique dentro não fecha; só o clique no fundo.
        onClick={(evento) => evento.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <p className="m-0 truncate text-sm font-semibold text-ink">{documento.nome}</p>
          <div className="flex items-center gap-1.5">
            {/* ⚠️ A SAÍDA PARA A ABA CONTINUA EXISTINDO, agora como escolha de quem olha: navegador
                que bloqueia iframe, PDF que o visor nativo não desenha, ou a pessoa que quer a tela
                inteira. Sem ela, um documento que não renderizasse aqui ficaria sem caminho. */}
            {documento.url ? (
              <a
                className="rounded-lg px-2 py-1 text-xs font-semibold text-ink-soft transition-colors hover:bg-subtle"
                href={documento.url}
                rel="noreferrer"
                target="_blank"
              >
                Abrir em outra aba
              </a>
            ) : null}
            <button
              aria-label="Fechar o documento"
              className="grid size-8 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-subtle hover:text-ink"
              onClick={aoFechar}
              type="button"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          </div>
        </header>

        {documento.url ? (
          <iframe className="h-full w-full flex-1" src={documento.url} title={documento.nome} />
        ) : (
          <p className="m-0 grid flex-1 place-items-center text-sm text-ink-muted">Abrindo…</p>
        )}
      </section>
    </div>
  );
}
