"use client";

import { Loader2, Search, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

// De `vinculos.ts`, NUNCA de `escrita-contato.ts`: aquele arquivo puxa o client do Apolo e o
// driver MySQL, que não podem entrar no bundle do navegador.
import { VINCULOS_DO_COCKPIT } from "@/lib/iris/apolo/vinculos";

// CADASTRAR / CORRIGIR / VINCULAR pelo cockpit, sem sair do atendimento.
//
// Três modos no mesmo modal porque são a mesma conversa do operador: "quem é essa pessoa no nosso
// cadastro?". Separar em três telas faria ele fechar o atendimento para resolver cadastro.
//
// O QUE ESTE FORMULÁRIO NÃO EDITA: nascimento, estado civil, nome da mãe, naturalidade e os
// demais campos pessoais da ficha. Não é esquecimento — a ficha do Apolo tem duas camadas e a
// tela do CRM grava na que PERDE (ver lib/iris/apolo/escrita-contato.ts). Enquanto isso não for
// resolvido, um campo desses digitado aqui sumiria em silêncio, e é melhor não oferecer do que
// oferecer mentindo.

export type ModoCadastro =
  | { entidadeId: string; documento: null | string; modo: "editar"; nome: string }
  | { modo: "criar"; nome: null | string; telefone: string }
  | { entidadeId: null | string; modo: "vincular"; nome: null | string; telefone: string };

type Resultado = {
  displayName: string;
  documentMasked: null | string;
  id: string;
  phone: string;
  profiles: string[];
};

const soDigitos = (valor: string) => valor.replace(/\D/g, "");

/** Máscara de CPF/CNPJ enquanto digita. Só visual: o servidor recebe e valida os dígitos. */
function mascararDocumento(valor: string): string {
  const d = soDigitos(valor).slice(0, 14);
  if (d.length <= 11) {
    return d
      .replace(/^(\d{3})(\d)/, "$1.$2")
      .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/\.(\d{3})(\d{1,2})$/, ".$1-$2");
  }
  return d
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d{1,2})$/, "$1-$2");
}

export function IrisCadastroModal({
  contexto,
  getAccessToken,
  onFechar,
  onSalvo,
}: {
  contexto: ModoCadastro;
  getAccessToken: () => Promise<string>;
  onFechar: () => void;
  /** Avisa o cockpit para reconsultar a identidade: o bloco tem que refletir o que acabou de mudar. */
  onSalvo: () => void;
}) {
  const [nome, setNome] = useState(contexto.nome ?? "");
  const [documento, setDocumento] = useState(
    contexto.modo === "editar" ? (contexto.documento ?? "") : "",
  );
  const [telefone, setTelefone] = useState(
    contexto.modo === "criar" || contexto.modo === "vincular" ? contexto.telefone : "",
  );
  const [email, setEmail] = useState("");
  const [motivo, setMotivo] = useState("");

  const [busca, setBusca] = useState("");
  const [resultados, setResultados] = useState<Resultado[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [escolhida, setEscolhida] = useState<null | Resultado>(null);
  const [tipoVinculo, setTipoVinculo] = useState<string>(VINCULOS_DO_COCKPIT[0].valor);

  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<null | string>(null);
  const [aviso, setAviso] = useState<null | string>(null);

  const chamar = useCallback(
    async (corpo: Record<string, unknown>) => {
      const token = await getAccessToken();
      const resposta = await fetch("/api/iris/apolo/contato", {
        body: JSON.stringify(corpo),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = (await resposta.json().catch(() => null)) as {
        data?: { entidadeId: string };
        entidadeIdExistente?: string;
        error?: string;
      } | null;

      return { ok: resposta.ok, payload, status: resposta.status };
    },
    [getAccessToken],
  );

  // Busca de entidade para vincular. Espera o operador parar de digitar: cada tecla batendo no
  // banco não ajuda ninguém e a busca do Apolo lê várias tabelas.
  useEffect(() => {
    if (contexto.modo !== "vincular" || busca.trim().length < 3) {
      setResultados([]);
      return;
    }

    const timer = setTimeout(async () => {
      setBuscando(true);
      try {
        const token = await getAccessToken();
        const resposta = await fetch(
          `/api/iris/apolo/search?q=${encodeURIComponent(busca.trim())}&limit=8`,
          { cache: "no-store", headers: { Authorization: `Bearer ${token}` } },
        );
        const payload = (await resposta.json().catch(() => null)) as {
          data?: { results?: Resultado[] };
        } | null;
        setResultados(payload?.data?.results ?? []);
      } catch {
        setResultados([]);
      }
      setBuscando(false);
    }, 400);

    return () => clearTimeout(timer);
  }, [busca, contexto.modo, getAccessToken]);

  const salvar = async () => {
    setErro(null);
    setAviso(null);
    setSalvando(true);

    try {
      if (contexto.modo === "criar") {
        const { ok, payload, status } = await chamar({
          acao: "criar",
          documento,
          email,
          nome,
          telefone,
        });

        if (!ok) {
          // 409 = documento já tem ficha. Não é erro do operador: é o dedup fazendo o trabalho.
          setErro(
            status === 409
              ? "Este CPF/CNPJ já tem ficha no Apolo. Feche e recarregue: o cadastro existente vai aparecer aqui."
              : (payload?.error ?? "Não foi possível cadastrar."),
          );
          setSalvando(false);
          return;
        }
      }

      if (contexto.modo === "editar") {
        // Identidade e contato são caminhos diferentes no servidor (um audita e valida documento,
        // o outro mexe em telefone/e-mail). O operador não precisa saber disso: preenche o que
        // quer corrigir e o modal chama o que for necessário.
        const mudouIdentidade =
          nome.trim() !== contexto.nome.trim() ||
          soDigitos(documento) !== soDigitos(contexto.documento ?? "");

        if (mudouIdentidade) {
          if (!motivo.trim()) {
            setErro("Diga o motivo da correção — ele fica no histórico da ficha.");
            setSalvando(false);
            return;
          }

          const { ok, payload } = await chamar({
            acao: "corrigir",
            documento,
            entidadeId: contexto.entidadeId,
            motivo,
            nome,
          });

          if (!ok) {
            setErro(payload?.error ?? "Não foi possível corrigir a identidade.");
            setSalvando(false);
            return;
          }
        }

        if (telefone.trim() || email.trim()) {
          const { ok, payload } = await chamar({
            acao: "contato",
            email,
            entidadeId: contexto.entidadeId,
            telefone,
          });

          if (!ok) {
            setErro(payload?.error ?? "Não foi possível gravar o contato.");
            setSalvando(false);
            return;
          }
        }
      }

      if (contexto.modo === "vincular") {
        if (!escolhida) {
          setErro("Escolha a pessoa ou empresa a quem este contato pertence.");
          setSalvando(false);
          return;
        }
        if (!contexto.entidadeId) {
          setErro(
            "Este contato ainda não tem ficha. Cadastre primeiro e depois faça o vínculo.",
          );
          setSalvando(false);
          return;
        }

        const { ok, payload } = await chamar({
          acao: "vincular",
          entidadeId: contexto.entidadeId,
          relacionadaId: escolhida.id,
          tipo: tipoVinculo,
        });

        if (!ok) {
          setErro(payload?.error ?? "Não foi possível criar o vínculo.");
          setSalvando(false);
          return;
        }
      }

      onSalvo();
      onFechar();
    } catch {
      setErro("Falha de conexão. Tente de novo.");
    }
    setSalvando(false);
  };

  const titulo =
    contexto.modo === "criar"
      ? "Cadastrar no Apolo"
      : contexto.modo === "editar"
        ? "Editar cadastro"
        : "Vincular a alguém";

  const campo = "h-10 w-full rounded-lg border border-line bg-canvas px-3 text-sm text-ink";
  const rotulo = "mb-1 block text-[11px] font-bold uppercase tracking-wide text-ink-soft";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4"
      onClick={onFechar}
    >
      <div
        className="max-h-[86vh] w-full max-w-md overflow-auto rounded-2xl border border-line bg-surface p-5"
        onClick={(evento) => evento.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="m-0 text-base font-bold text-ink">{titulo}</h2>
          <button aria-label="Fechar" onClick={onFechar} type="button">
            <X aria-hidden="true" className="size-4 text-ink-soft" />
          </button>
        </div>

        {contexto.modo !== "vincular" ? (
          <div className="space-y-3">
            <div>
              <span className={rotulo}>Nome completo</span>
              <input
                className={campo}
                onChange={(evento) => setNome(evento.target.value)}
                placeholder="Como está no documento"
                value={nome}
              />
            </div>

            <div>
              <span className={rotulo}>
                CPF ou CNPJ <span className="text-red-600">*</span>
              </span>
              <input
                className={campo}
                inputMode="numeric"
                onChange={(evento) => setDocumento(mascararDocumento(evento.target.value))}
                placeholder="000.000.000-00"
                value={documento}
              />
              {contexto.modo === "criar" ? (
                <p className="m-0 mt-1 text-[11px] leading-snug text-ink-soft">
                  Pergunte ao cliente. É o documento que liga a ficha ao sistema de vendas e o que
                  impede a mesma pessoa virar dois cadastros.
                </p>
              ) : null}
            </div>

            <div>
              <span className={rotulo}>Telefone</span>
              <input
                className={campo}
                inputMode="numeric"
                onChange={(evento) => setTelefone(evento.target.value)}
                placeholder="(31) 99999-9999"
                value={telefone}
              />
            </div>

            <div>
              <span className={rotulo}>E-mail</span>
              <input
                className={campo}
                onChange={(evento) => setEmail(evento.target.value)}
                placeholder="cliente@email.com"
                type="email"
                value={email}
              />
            </div>

            {contexto.modo === "editar" ? (
              <div>
                <span className={rotulo}>Motivo da correção</span>
                <input
                  className={campo}
                  onChange={(evento) => setMotivo(evento.target.value)}
                  placeholder="ex.: cliente informou o CPF correto"
                  value={motivo}
                />
                <p className="m-0 mt-1 text-[11px] leading-snug text-ink-soft">
                  Obrigatório só quando mudar nome ou documento. Fica no histórico da ficha.
                </p>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <span className={rotulo}>De quem este contato é?</span>
              <div className="relative">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-3 size-4 text-ink-soft"
                />
                <input
                  className={`${campo} pl-9`}
                  onChange={(evento) => setBusca(evento.target.value)}
                  placeholder="Nome, CPF/CNPJ ou telefone"
                  value={busca}
                />
              </div>
            </div>

            {buscando ? (
              <p className="m-0 flex items-center gap-2 text-sm text-ink-soft">
                <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
                Procurando…
              </p>
            ) : null}

            {resultados.length ? (
              <div className="max-h-52 space-y-1 overflow-auto">
                {resultados.map((resultado) => (
                  <button
                    className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                      escolhida?.id === resultado.id
                        ? "border-[#A07C3B] bg-[#A07C3B]/10"
                        : "border-line hover:bg-subtle"
                    }`}
                    key={resultado.id}
                    onClick={() => setEscolhida(resultado)}
                    type="button"
                  >
                    <span className="block truncate text-sm font-semibold text-ink">
                      {resultado.displayName}
                    </span>
                    <span className="block truncate text-[11px] text-ink-soft">
                      {resultado.documentMasked ?? "sem documento"}
                      {resultado.profiles.length ? ` · ${resultado.profiles.join(", ")}` : ""}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}

            <div>
              <span className={rotulo}>Este contato é o quê dessa pessoa?</span>
              <select
                className={campo}
                onChange={(evento) => setTipoVinculo(evento.target.value)}
                value={tipoVinculo}
              >
                {VINCULOS_DO_COCKPIT.map((vinculo) => (
                  <option key={vinculo.valor} value={vinculo.valor}>
                    {vinculo.rotulo}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {erro ? (
          <p className="m-0 mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
            {erro}
          </p>
        ) : null}
        {aviso ? (
          <p className="m-0 mt-3 text-sm text-ink-soft">{aviso}</p>
        ) : null}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            className="rounded-lg border border-line px-3 py-2 text-sm text-ink-soft hover:bg-subtle"
            onClick={onFechar}
            type="button"
          >
            Cancelar
          </button>
          <button
            className="inline-flex items-center gap-2 rounded-lg bg-[#A07C3B] px-4 py-2 text-sm font-semibold text-white hover:bg-[#8d6c33] disabled:opacity-50"
            disabled={salvando}
            onClick={() => void salvar()}
            type="button"
          >
            {salvando ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
            Salvar
          </button>
        </div>

        {contexto.modo !== "vincular" ? (
          <p className="m-0 mt-3 text-[11px] leading-snug text-ink-soft">
            Endereço, estado civil e os demais campos da ficha continuam no Apolo.
          </p>
        ) : null}
      </div>
    </div>
  );
}
