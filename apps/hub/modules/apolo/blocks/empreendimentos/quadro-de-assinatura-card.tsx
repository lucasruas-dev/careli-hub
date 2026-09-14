"use client";

import { Loader2, Lock, Plus, Trash2, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type {
  AssinanteDoQuadro,
  PapelDoQuadro,
} from "@/app/api/temis/assinantes/route";
import { getApoloAccessToken } from "@/modules/apolo/data/apolo-operations";

// O QUADRO DE ASSINATURA DO EMPREENDIMENTO — quem assina, além do comprador.
//
// Lucas (13/09/2026): *"a vendedora eu posso ter mais de um assinante (...) Testemunha a mesma
// coisa, e coordenador de vendas a mesma coisa, eu posso ter mais de um como coordenador"*.
//
// ⚠️ FORA DO CARD DE ORDEM, e isso foi pedido: *"mesmo desligado, eu tenho que cadastrar as
// testemunha"*. O card "Assinam em ordem" apaga a lista inteira quando está desligado — que é como
// os contratos saem hoje. O cadastro lá dentro sumiria justamente na configuração em uso.
//
// ⚠️ "COORDENADOR DE VENDAS" É A PESSOA; a EMPRESA é a "Coordenação de Vendas", e ela não mora
// aqui — vem do cadastro do empreendimento e sai no texto do contrato com CNPJ e endereço. Trocar
// essas duas palavras já custou caro uma vez: o Panteon tinha pendurado como representante da
// coordenação o CAPTADOR, que é outro campo e outra pessoa.

const BLOCOS: { ajuda: string; papel: PapelDoQuadro; titulo: string }[] = [
  {
    ajuda:
      "O representante legal cadastrado na empresa já vem preenchido. Acrescente quem mais assina por ela.",
    papel: "vendedora",
    titulo: "Vendedora",
  },
  {
    ajuda:
      "Quem coordena a venda deste empreendimento. Pode ser mais de um, e todos assinam.",
    papel: "coordenador",
    titulo: "Coordenador de Vendas",
  },
  {
    ajuda: "Testemunham um documento já assinado pelas partes — por isso costumam assinar por último.",
    papel: "testemunha",
    titulo: "Testemunhas",
  },
];

const RASCUNHO = { cpf: "", email: "", nome: "", ordemAssinatura: "", posicao: "" };

export function QuadroDeAssinaturaCard({ enterpriseId }: { enterpriseId: string }) {
  const [lista, setLista] = useState<AssinanteDoQuadro[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState<null | PapelDoQuadro>(null);
  const [erro, setErro] = useState<null | string>(null);
  const [rascunhos, setRascunhos] = useState<Record<string, typeof RASCUNHO>>({});
  const [recarregar, setRecarregar] = useState(0);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const token = await getApoloAccessToken();
      const r = await fetch(
        `/api/temis/assinantes?enterpriseId=${encodeURIComponent(enterpriseId)}`,
        { cache: "no-store", headers: { Authorization: `Bearer ${token}` } },
      );
      const corpo = (await r.json()) as { assinantes?: AssinanteDoQuadro[]; error?: string };
      if (!r.ok) throw new Error(corpo.error ?? "Falha ao ler o quadro.");
      setLista(corpo.assinantes ?? []);
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao ler o quadro.");
    } finally {
      setCarregando(false);
    }
  }, [enterpriseId]);

  useEffect(() => {
    void carregar();
  }, [carregar, recarregar]);

  const doPapel = (papel: PapelDoQuadro) => lista.filter((a) => a.papel === papel);

  const rascunho = (papel: PapelDoQuadro) => rascunhos[papel] ?? RASCUNHO;

  function mexer(papel: PapelDoQuadro, campo: keyof typeof RASCUNHO, valor: string) {
    setRascunhos((r) => ({ ...r, [papel]: { ...rascunho(papel), [campo]: valor } }));
  }

  async function adicionar(papel: PapelDoQuadro) {
    const atual = rascunho(papel);
    setSalvando(papel);
    setErro(null);
    try {
      const token = await getApoloAccessToken();
      const r = await fetch("/api/temis/assinantes", {
        body: JSON.stringify({
          cpf: atual.cpf,
          email: atual.email,
          enterpriseId,
          nome: atual.nome,
          ordemAssinatura: atual.ordemAssinatura,
          papel,
          posicao: atual.posicao || String(proximaPosicao(doPapel(papel))),
        }),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        method: "POST",
      });
      const corpo = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(corpo.error ?? "Falha ao gravar.");
      setRascunhos((x) => ({ ...x, [papel]: RASCUNHO }));
      setRecarregar((n) => n + 1);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao gravar.");
    } finally {
      setSalvando(null);
    }
  }

  async function remover(id: string) {
    try {
      const token = await getApoloAccessToken();
      const r = await fetch(`/api/temis/assinantes?id=${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${token}` },
        method: "DELETE",
      });
      if (!r.ok) {
        const corpo = (await r.json()) as { error?: string };
        throw new Error(corpo.error ?? "Falha ao remover.");
      }
      setRecarregar((n) => n + 1);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao remover.");
    }
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="m-0 flex items-center gap-2 font-semibold text-[11px] text-ink-muted uppercase tracking-wide">
        <Users className="size-3.5" />
        Quadro de assinatura do contrato
      </p>
      <p className="m-0 mt-1 text-ink-muted text-xs">
        Quem assina além do comprador. O comprador e o cônjuge saem da proposta e não se digitam
        aqui.
      </p>

      {erro ? (
        <p className="m-0 mt-2 font-medium text-rose-600 text-xs dark:text-rose-300">{erro}</p>
      ) : null}

      {carregando ? (
        <p className="m-0 mt-3 text-ink-muted text-sm">Lendo…</p>
      ) : (
        <div className="mt-3 grid gap-4">
          {BLOCOS.map((bloco) => {
            const gente = doPapel(bloco.papel);
            const r = rascunho(bloco.papel);
            return (
              <section key={bloco.papel}>
                <p className="m-0 font-semibold text-ink text-sm">{bloco.titulo}</p>
                <p className="m-0 mb-1.5 text-ink-muted text-xs">{bloco.ajuda}</p>

                {gente.length === 0 ? (
                  <p className="m-0 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900 text-xs dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                    Ninguém aqui. O contrato vai para assinatura sem este papel, e a linha dele sai
                    vazia no papel impresso.
                  </p>
                ) : (
                  <div className="grid gap-1.5">
                    {gente.map((a) => (
                      <div
                        className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-subtle/40 px-3 py-2"
                        key={a.id ?? `herdado-${a.papel}-${a.posicao}`}
                      >
                        <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-inverse font-semibold text-[11px] text-white">
                          {a.posicao}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="m-0 truncate font-medium text-ink text-sm">{a.nome}</p>
                          <p className="m-0 truncate text-ink-muted text-xs">
                            {a.cpf ?? "sem CPF"} · {a.email ?? "sem e-mail"}
                          </p>
                        </div>
                        <span className="shrink-0 rounded-md bg-subtle px-1.5 py-0.5 text-[10px] text-ink-muted">
                          {a.ordemAssinatura ? `assina em ${a.ordemAssinatura}` : "segue o papel"}
                        </span>
                        {/* ⚠️ A LINHA HERDADA NÃO SE APAGA AQUI. Ela vem do cadastro da empresa, e
                            um botão de lixeira prometeria desfazer algo que esta tela não decide. */}
                        {a.id ? (
                          <button
                            aria-label={`Remover ${a.nome}`}
                            className="rounded-md border border-line p-1 text-ink-muted transition-colors hover:bg-subtle"
                            onClick={() => void remover(a.id as string)}
                            type="button"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        ) : (
                          <span
                            className="inline-flex items-center gap-1 rounded-md bg-subtle px-1.5 py-1 text-[10px] text-ink-muted"
                            title="Vem do representante legal cadastrado na empresa. Para trocar, mude no cadastro dela."
                          >
                            <Lock className="size-3" />
                            do cadastro
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <div className="mt-1.5 flex flex-wrap items-end gap-2">
                  <label className="flex min-w-[160px] flex-1 flex-col gap-1">
                    <span className="font-medium text-[11px] text-ink-muted">Nome completo</span>
                    <input
                      className="h-8 rounded-lg border border-line bg-surface px-2 text-ink text-sm"
                      onChange={(e) => mexer(bloco.papel, "nome", e.target.value)}
                      value={r.nome}
                    />
                  </label>
                  <label className="flex w-32 flex-col gap-1">
                    <span className="font-medium text-[11px] text-ink-muted">CPF</span>
                    <input
                      className="h-8 rounded-lg border border-line bg-surface px-2 text-ink text-sm"
                      onChange={(e) => mexer(bloco.papel, "cpf", e.target.value)}
                      value={r.cpf}
                    />
                  </label>
                  <label className="flex min-w-[160px] flex-1 flex-col gap-1">
                    <span className="font-medium text-[11px] text-ink-muted">E-mail</span>
                    <input
                      className="h-8 rounded-lg border border-line bg-surface px-2 text-ink text-sm"
                      onChange={(e) => mexer(bloco.papel, "email", e.target.value)}
                      value={r.email}
                    />
                  </label>
                  <label className="flex w-14 flex-col gap-1">
                    <span
                      className="font-medium text-[11px] text-ink-muted"
                      title="Qual linha do contrato é dela"
                    >
                      Linha
                    </span>
                    <input
                      className="h-8 rounded-lg border border-line bg-surface px-2 text-center text-ink text-sm"
                      inputMode="numeric"
                      onChange={(e) => mexer(bloco.papel, "posicao", e.target.value)}
                      placeholder={String(proximaPosicao(gente))}
                      value={r.posicao}
                    />
                  </label>
                  <label className="flex w-20 flex-col gap-1">
                    <span
                      className="font-medium text-[11px] text-ink-muted"
                      title="Quando ela assina. Em branco, segue a ordem do papel."
                    >
                      Assina em
                    </span>
                    <input
                      className="h-8 rounded-lg border border-line bg-surface px-2 text-center text-ink text-sm"
                      inputMode="numeric"
                      onChange={(e) => mexer(bloco.papel, "ordemAssinatura", e.target.value)}
                      placeholder="—"
                      value={r.ordemAssinatura}
                    />
                  </label>
                  <button
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-inverse px-3 font-semibold text-brand-ink text-xs disabled:opacity-60"
                    disabled={salvando === bloco.papel}
                    onClick={() => void adicionar(bloco.papel)}
                    type="button"
                  >
                    {salvando === bloco.papel ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Plus className="size-3.5" />
                    )}
                    Incluir
                  </button>
                </div>
              </section>
            );
          })}
        </div>
      )}

      <p className="m-0 mt-3 border-line border-t pt-2 text-ink-muted text-xs">
        <strong>Linha</strong> é qual linha do contrato é da pessoa. <strong>Assina em</strong> é
        quando ela recebe o convite — em branco, segue a ordem cadastrada para o papel. As duas são
        independentes: quem assina primeiro pode ser quem aparece embaixo no papel.
      </p>
    </div>
  );
}

/** A próxima linha livre DENTRO do papel: vendedora 1 e testemunha 1 convivem. */
function proximaPosicao(gente: AssinanteDoQuadro[]): number {
  const usadas = new Set(gente.map((a) => a.posicao));
  for (let n = 1; n <= 9; n += 1) if (!usadas.has(n)) return n;
  return 9;
}
