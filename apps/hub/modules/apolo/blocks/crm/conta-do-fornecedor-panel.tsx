import { useEffect, useState } from "react";

import type { ContaDoFornecedor } from "@/lib/apolo/conta-do-fornecedor";
import { rotuloDoTipoDeChave, rotuloDoTipoDeConta } from "@/lib/apolo/dados-bancarios";
import { getApoloAccessToken } from "../../data/apolo-operations";
import { PanelTitle, ReadonlyLine } from "../shared/apolo-ui";

// A CONTA E O PIX DO FORNECEDOR na aba Cadastro da ficha (02/10/2026).
//
// Lê por rota própria (/api/apolo/cadastro/[entityId]/dados-bancarios), que só responde para quem
// grava no Apolo: conta e chave PIX não viajam com a ficha, que todo leitor recebe. Uma leitura quando
// a seção abre, sem polling.
export function ContaDoFornecedorPanel({ entityId }: { entityId: string }) {
  const [contas, setContas] = useState<ContaDoFornecedor[] | null>(null);
  const [aviso, setAviso] = useState<null | string>(null);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const token = await getApoloAccessToken();
        const resp = await fetch(`/api/apolo/cadastro/${entityId}/dados-bancarios`, {
          cache: "no-store",
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = (await resp.json().catch(() => null)) as {
          data?: ContaDoFornecedor[];
          error?: string;
        } | null;
        if (!vivo) return;
        if (resp.status === 401 || resp.status === 403) {
          setAviso("Os dados bancários ficam visíveis só para quem opera o Apolo.");
        } else if (!resp.ok || !json?.data) {
          setAviso(json?.error ?? "Não consegui ler os dados bancários agora.");
        } else {
          setContas(json.data);
        }
      } catch {
        if (vivo) setAviso("Não consegui ler os dados bancários agora.");
      }
    })();
    return () => {
      vivo = false;
    };
  }, [entityId]);

  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <PanelTitle eyebrow="Fornecedor" title="Dados bancários e PIX" />
      {aviso ? (
        <p className="mt-4 text-sm text-ink-muted">{aviso}</p>
      ) : contas === null ? (
        <p className="mt-4 text-sm text-ink-muted">Carregando…</p>
      ) : contas.length === 0 ? (
        <p className="mt-4 text-sm text-ink-muted">Nenhuma conta ou chave PIX cadastrada.</p>
      ) : (
        contas.map((conta) => (
          <div key={conta.id} className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {conta.conta ? (
              <>
                <ReadonlyLine
                  label="Banco"
                  value={[conta.bancoCodigo, conta.bancoNome].filter(Boolean).join(" - ") || "-"}
                />
                <ReadonlyLine
                  label="Tipo de conta"
                  value={rotuloDoTipoDeConta(conta.tipoConta) || "-"}
                />
                <ReadonlyLine
                  label="Agência e conta"
                  value={`${conta.agencia ?? "-"} / ${conta.conta}`}
                />
              </>
            ) : null}
            {conta.pixChave ? (
              <ReadonlyLine
                label={`PIX (${rotuloDoTipoDeChave(conta.pixTipo) || "chave"})`}
                value={conta.pixChave}
              />
            ) : null}
            {conta.titular || conta.documentoTitular ? (
              <ReadonlyLine
                label="Titular"
                value={[conta.titular, conta.documentoTitular].filter(Boolean).join(" · ")}
              />
            ) : null}
          </div>
        ))
      )}
    </section>
  );
}
