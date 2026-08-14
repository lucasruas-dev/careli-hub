"use client";

import { Building2, ExternalLink, Loader2, Search, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type { IdentidadeDoContato } from "@/lib/iris/apolo/identidade-contato";

import { linkDoApolo } from "./iris-identidade-apolo";
// De `vinculos.ts`, NUNCA de `escrita-contato.ts`: aquele arquivo puxa o client do Apolo e o
// driver MySQL, que não podem entrar no bundle do navegador.
import {
  VINCULOS_CONTATO,
  VINCULOS_TRABALHO,
  type TipoDeVinculo,
} from "@/lib/iris/apolo/vinculos";

// CORRIGIR E VINCULAR pelo cockpit, sem sair do atendimento.
//
// ⚠️ NÃO CRIA FICHA. Criar entidade é no Apolo (decisão do Lucas, 14/08): ficha nasce com papel,
// empreendimento, documentos e uma trilha de validação que o wizard conduz. Um formulário de
// quatro campos no meio do atendimento produziria meia-ficha, e meia-ficha é o que vira duplicata
// depois. Quando não há cadastro, o cockpit manda o operador para o Apolo com o que já sabe.
//
// TAMBÉM NÃO EDITA os campos pessoais da ficha (nascimento, estado civil, nome da mãe): a ficha
// do Apolo tem duas camadas e a tela do CRM grava na que PERDE. Melhor não oferecer do que
// oferecer mentindo.

export type ModoCadastro = {
  identidade: IdentidadeDoContato | null;
  modo: "editar" | "vincular";
  nome: null | string;
  telefone: string;
};

type Resultado = {
  displayName: string;
  documentMasked: null | string;
  id: string;
  phone: string;
  profiles: string[];
};

const soDigitos = (valor: string) => valor.replace(/\D/g, "");

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
  onSalvo: () => void;
}) {
  const identidade = contexto.identidade;
  const ehEntidade = identidade?.estado === "entidade";
  const entidadeId = ehEntidade ? identidade.entidadeId : null;

  const [nome, setNome] = useState(ehEntidade ? identidade.nome : (contexto.nome ?? ""));
  const [documento, setDocumento] = useState(
    ehEntidade ? (identidade.documentoMascarado ?? "") : "",
  );
  const [telefone, setTelefone] = useState("");
  const [email, setEmail] = useState("");
  const [motivo, setMotivo] = useState("");

  const [familia, setFamilia] = useState<"contato" | "trabalho">("trabalho");
  const [tipoVinculo, setTipoVinculo] = useState<null | TipoDeVinculo>(null);
  const [busca, setBusca] = useState("");
  const [resultados, setResultados] = useState<Resultado[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [escolhida, setEscolhida] = useState<null | Resultado>(null);

  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<null | string>(null);

  const chamar = useCallback(
    async (corpo: Record<string, unknown>) => {
      const token = await getAccessToken();
      const resposta = await fetch("/api/iris/apolo/contato", {
        body: JSON.stringify(corpo),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = (await resposta.json().catch(() => null)) as { error?: string } | null;
      return { ok: resposta.ok, payload };
    },
    [getAccessToken],
  );

  useEffect(() => {
    if (busca.trim().length < 3) {
      setResultados([]);
      return;
    }

    // Espera o operador parar de digitar: cada tecla batendo no banco não ajuda ninguém, e a
    // busca do Apolo lê várias tabelas.
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
  }, [busca, getAccessToken]);

  const salvar = async () => {
    setErro(null);
    setSalvando(true);

    try {
      if (contexto.modo === "editar") {
        if (!entidadeId) {
          setErro("Esta ficha não pode ser corrigida por aqui.");
          setSalvando(false);
          return;
        }

        const mudouIdentidade =
          nome.trim() !== (ehEntidade ? identidade.nome : "").trim() ||
          soDigitos(documento) !== soDigitos(ehEntidade ? (identidade.documentoMascarado ?? "") : "");

        if (mudouIdentidade) {
          if (!motivo.trim()) {
            setErro("Diga o motivo da correção — ele fica no histórico da ficha.");
            setSalvando(false);
            return;
          }

          const { ok, payload } = await chamar({
            acao: "corrigir",
            documento,
            entidadeId,
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
            entidadeId,
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
        if (!entidadeId) {
          setErro(
            "Este contato ainda não tem ficha no Apolo. Cadastre lá primeiro e depois volte para vincular.",
          );
          setSalvando(false);
          return;
        }
        if (!escolhida || !tipoVinculo) {
          setErro("Escolha a pessoa ou empresa e o tipo de vínculo.");
          setSalvando(false);
          return;
        }

        const { ok, payload } = await chamar({
          acao: "vincular",
          entidadeId,
          kind: tipoVinculo.kind,
          relacionadaId: escolhida.id,
          tipo: tipoVinculo.rotulo,
        });

        if (!ok) {
          setErro(payload?.error ?? "Não foi possível gravar o vínculo.");
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

  const campo = "h-10 w-full rounded-lg border border-line bg-canvas px-3 text-sm text-ink";
  const rotulo = "mb-1 block text-[11px] font-bold uppercase tracking-wide text-ink-soft";
  const tipos = familia === "trabalho" ? VINCULOS_TRABALHO : VINCULOS_CONTATO;

  // Perfil, papel e vínculo agora vivem NO PAINEL (campos Perfil/Papel/Vínculo), onde o operador
  // lê sem abrir nada — pedido do Lucas, 14/08. Aqui fica só a lista completa de vínculos quando
  // há mais de um, porque o painel mostra o principal e some com o resto.
  const papel =
    (ehEntidade || identidade?.estado === "vinculo") && identidade.vinculos.length > 1 ? (
      <div className="mb-4 rounded-xl border border-line bg-subtle/50 px-3 py-2.5">
        <p className="m-0 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-soft">
          <Building2 aria-hidden="true" className="size-3.5" />
          Vínculos
        </p>
        <div className="mt-1 space-y-0.5">
          {identidade.vinculos.slice(0, 6).map((item, indice) => (
            <p
              className="m-0 text-[11.5px] text-ink-soft"
              key={`${item.tipo}-${item.entidadeId ?? indice}`}
            >
              {item.tipo}
              {item.entidade ? ` de ${item.entidade}` : ""}
            </p>
          ))}
        </div>
      </div>
    ) : null;

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
          <h2 className="m-0 text-base font-bold text-ink">
            {contexto.modo === "editar" ? "Editar cadastro" : "Vincular contato"}
          </h2>
          <button aria-label="Fechar" onClick={onFechar} type="button">
            <X aria-hidden="true" className="size-4 text-ink-soft" />
          </button>
        </div>

        {papel}

        {contexto.modo === "editar" ? (
          <div className="space-y-3">
            <div>
              <span className={rotulo}>Nome completo</span>
              <input
                className={campo}
                onChange={(evento) => setNome(evento.target.value)}
                value={nome}
              />
            </div>
            <div>
              <span className={rotulo}>CPF ou CNPJ</span>
              <input
                className={campo}
                inputMode="numeric"
                onChange={(evento) => setDocumento(mascararDocumento(evento.target.value))}
                value={documento}
              />
            </div>
            <div>
              <span className={rotulo}>Telefone</span>
              <input
                className={campo}
                inputMode="numeric"
                onChange={(evento) => setTelefone(evento.target.value)}
                placeholder="deixe em branco para manter"
                value={telefone}
              />
            </div>
            <div>
              <span className={rotulo}>E-mail</span>
              <input
                className={campo}
                onChange={(evento) => setEmail(evento.target.value)}
                placeholder="deixe em branco para manter"
                type="email"
                value={email}
              />
            </div>
            <div>
              <span className={rotulo}>Motivo da correção</span>
              <input
                className={campo}
                onChange={(evento) => setMotivo(evento.target.value)}
                placeholder="ex.: cliente informou o CPF correto"
                value={motivo}
              />
              <p className="m-0 mt-1 text-[11px] leading-snug text-ink-soft">
                Obrigatório só ao mudar nome ou documento. Fica no histórico da ficha.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Trabalho ou contato: é a mesma divisão do CRM, então o vínculo criado aqui aparece
                lá no lugar certo. */}
            <div>
              <span className={rotulo}>Que tipo de vínculo?</span>
              <div className="flex gap-2">
                {(["trabalho", "contato"] as const).map((opcao) => (
                  <button
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold capitalize transition-colors ${
                      familia === opcao
                        ? "border-[#A07C3B] bg-[#A07C3B]/10 text-ink"
                        : "border-line text-ink-soft hover:bg-subtle"
                    }`}
                    key={opcao}
                    onClick={() => {
                      setFamilia(opcao);
                      setTipoVinculo(null);
                    }}
                    type="button"
                  >
                    {opcao}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <span className={rotulo}>Este contato é o quê?</span>
              <div className="flex flex-wrap gap-1.5">
                {tipos.map((tipo) => (
                  <button
                    className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors ${
                      tipoVinculo?.rotulo === tipo.rotulo
                        ? "border-[#A07C3B] bg-[#A07C3B] text-white"
                        : "border-line text-ink-soft hover:bg-subtle"
                    }`}
                    key={tipo.rotulo}
                    onClick={() => setTipoVinculo(tipo)}
                    type="button"
                  >
                    {tipo.rotulo}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <span className={rotulo}>De quem?</span>
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
              <div className="max-h-48 space-y-1 overflow-auto">
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
          </div>
        )}

        {erro ? (
          <p className="m-0 mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
            {erro}
          </p>
        ) : null}

        <div className="mt-5 flex items-center justify-between gap-2">
          <a
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-soft hover:text-ink"
            // Leva o id E o documento: o id escolhe a ficha, o documento garante que ela esteja
            // no resultado da busca do CRM (a lista de lá é busca, não a base inteira).
            href={linkDoApolo({
              documento: ehEntidade ? identidade.documentoMascarado : null,
              entidadeId,
              telefone: contexto.telefone,
            })}
            rel="noreferrer"
            target="_blank"
          >
            <ExternalLink aria-hidden="true" className="size-3.5" />
            Abrir no Apolo
          </a>
          <div className="flex items-center gap-2">
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
        </div>

        <p className="m-0 mt-3 text-[11px] leading-snug text-ink-soft">
          Endereço, estado civil e os demais campos da ficha continuam no Apolo.
        </p>
      </div>
    </div>
  );
}
