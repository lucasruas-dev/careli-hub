"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Building2, Check, Loader2, Search, ShieldCheck } from "lucide-react";

import { toTitleCase } from "@/lib/format/name-case";
import { CadastroFlow } from "@/modules/apolo/blocks/cadastro/cadastro-flow";

import { getApoloAccessToken } from "../../data/apolo-operations";

// Portal de credenciamento de imobiliárias (Lucas 18/jul): o formulário que a Careli ENVIA pras
// imobiliárias que querem trabalhar nossos empreendimentos. É uma triagem antes do cadastro:
//   1) quais empreendimentos quer habilitar (só os que estão "na ativa");
//   2) já é cadastrada? -> CNPJ -> consulta;
//   3) achou  -> mostra só os que ela AINDA NÃO trabalha, pra pedir habilitação;
//      não achou -> abre o cadastro de imobiliária completo.
// Identidade visual: fundo claro, destaques em PRETO grafite (preferência do Lucas) e o dourado
// #A07C3B da marca, que é a cor do "X" na logo do C2X.

type Empreendimento = {
  code: string;
  id: string;
  logoUrl: string | null;
  name: string;
};

type Consulta = {
  encontrada: boolean;
  entityId: string | null;
  jaTrabalha: string[];
  nome: string | null;
};

type Etapa = "empreendimentos" | "identificacao" | "habilitacao" | "cadastro" | "enviado";

// Por que caiu no cadastro completo: ela DECLAROU que não tem cadastro, ou consultamos o CNPJ e
// não achamos. Muda a mensagem — quem já disse que é nova não pode receber "não encontramos".
type MotivoCadastro = "declarou_novo" | "nao_encontrado";

const DOURADO = "#A07C3B";

export function CredenciamentoFlow() {
  const [etapa, setEtapa] = useState<Etapa>("empreendimentos");
  const [empreendimentos, setEmpreendimentos] = useState<Empreendimento[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [desejados, setDesejados] = useState<string[]>([]);
  const [cnpj, setCnpj] = useState("");
  const [consultando, setConsultando] = useState(false);
  const [consulta, setConsulta] = useState<Consulta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [habilitar, setHabilitar] = useState<string[]>([]);
  const [motivoCadastro, setMotivoCadastro] = useState<MotivoCadastro>("declarou_novo");
  // CNPJ não encontrado NÃO joga direto pro cadastro: pode ser erro de digitação. Deixa tentar;
  // a partir da 3ª tentativa sugerimos o cadastro e destacamos o botão.
  const [tentativas, setTentativas] = useState(0);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const accessToken = await getApoloAccessToken();
        const response = await fetch("/api/apolo/credenciamento", {
          cache: "no-store",
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const payload = (await response.json()) as {
          data?: { empreendimentos?: Empreendimento[] };
        };
        if (alive) setEmpreendimentos(payload.data?.empreendimentos ?? []);
      } catch {
        // sem lista: a tela mostra o vazio
      } finally {
        if (alive) setCarregando(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function consultarCnpj() {
    setErro(null);
    setConsultando(true);
    try {
      const accessToken = await getApoloAccessToken();
      const response = await fetch("/api/apolo/credenciamento", {
        body: JSON.stringify({ cnpj }),
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const payload = (await response.json()) as {
        data?: { consulta?: Consulta };
        error?: string;
      };
      if (!response.ok || !payload.data?.consulta) {
        setErro(payload.error ?? "Não foi possível consultar o CNPJ.");
        return;
      }
      const resultado = payload.data.consulta;
      setConsulta(resultado);
      if (resultado.encontrada) {
        // Só faz sentido pedir o que ela ainda não trabalha.
        const faltantes = desejados.filter((id) => !resultado.jaTrabalha.includes(id));
        setHabilitar(faltantes);
        setEtapa("habilitacao");
        return;
      }
      // Não encontrado: fica na tela pra ele conferir/tentar de novo (pode ser digitação).
      setTentativas((n) => n + 1);
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Falha na consulta.");
    } finally {
      setConsultando(false);
    }
  }

  const alternar = (lista: string[], set: (v: string[]) => void, id: string) =>
    set(lista.includes(id) ? lista.filter((item) => item !== id) : [...lista, id]);

  // O cadastro completo assume a tela inteira. O wizard já tem o próprio scroll, então aqui NÃO
  // pode haver outro por fora (era o que quebrava a página): faixa fixa + wizard rolando.
  if (etapa === "cadastro") {
    return (
      // O aviso vai DENTRO do wizard (prop `aviso`), que só o mostra na 1ª etapa — antes ele
      // ficava fixo por fora e acompanhava o usuário por todas as páginas.
      <CadastroFlow
        aviso={
          <>
            <p className="m-0 text-sm font-semibold text-[#7a5e2c] dark:text-[#d9b877]">
              {motivoCadastro === "declarou_novo"
                ? "Vamos fazer seu credenciamento."
                : "Não encontramos esse CNPJ na nossa base."}
            </p>
            <p className="m-0 mt-0.5 text-xs text-[#7a5e2c]/80 dark:text-[#d9b877]/80">
              Preencha os dados abaixo e nossa equipe valida em seguida.
            </p>
          </>
        }
        empreendimentosIniciais={desejados}
        tipo="imobiliaria"
      />
    );
  }

  return (
    <Moldura>
      <Cabecalho />

      {etapa === "empreendimentos" ? (
        <Secao
          titulo="Quais empreendimentos você quer trabalhar?"
          descricao="Selecione um ou mais."
          passo={1}
        >
          {carregando ? (
            <Carregando />
          ) : empreendimentos.length === 0 ? (
            <Vazio />
          ) : (
            <>
              <GradeEmpreendimentos
                empreendimentos={empreendimentos}
                onToggle={(id) => alternar(desejados, setDesejados, id)}
                selecionados={desejados}
              />
              <Rodape>
                <BotaoPrimario
                  disabled={desejados.length === 0}
                  onClick={() => setEtapa("identificacao")}
                >
                  Continuar
                </BotaoPrimario>
              </Rodape>
            </>
          )}
        </Secao>
      ) : null}

      {etapa === "identificacao" ? (
        <Secao
          titulo="Sua imobiliária já trabalha com a Careli?"
          descricao="Informe o CNPJ. Se já tivermos seu cadastro, o processo fica muito mais rápido."
          passo={2}
        >
          <div className="mx-auto w-full max-w-md">
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              CNPJ da imobiliária
            </label>
            <input
              className="mt-1.5 w-full rounded-xl border border-line bg-surface px-4 py-3 text-lg font-medium tracking-wide text-ink outline-none transition-colors focus:border-ink placeholder:text-ink-muted"
              inputMode="numeric"
              onChange={(event) => setCnpj(event.target.value)}
              placeholder="00.000.000/0000-00"
              value={cnpj}
            />
            {erro ? (
              <p className="m-0 mt-2 text-xs font-medium text-rose-600 dark:text-rose-300">
                {erro}
              </p>
            ) : null}

            {/* Não achou: primeiro pede pra conferir; da 3ª em diante, sugere o cadastro. */}
            {tentativas > 0 ? (
              <div
                className={`mt-3 rounded-lg border px-3 py-2 ${
                  tentativas >= 3
                    ? "border-[#A07C3B]/30 bg-[#A07C3B]/10"
                    : "border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10"
                }`}
              >
                <p
                  className={`m-0 text-xs font-medium ${
                    tentativas >= 3
                      ? "text-[#7a5e2c] dark:text-[#d9b877]"
                      : "text-amber-700 dark:text-amber-300"
                  }`}
                >
                  {tentativas >= 3
                    ? "Não localizamos esse CNPJ. Faça seu cadastro para começar."
                    : "Não encontramos esse CNPJ. Confira os números e tente de novo."}
                </p>
              </div>
            ) : null}

            <BotaoPrimario
              className="mt-4 w-full"
              disabled={cnpj.replace(/\D/g, "").length !== 14 || consultando}
              onClick={() => void consultarCnpj()}
            >
              {consultando ? (
                <>
                  <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                  Consultando…
                </>
              ) : (
                <>
                  <Search aria-hidden="true" className="size-4" />
                  Consultar CNPJ
                </>
              )}
            </BotaoPrimario>

            {/* Vira botão de verdade depois de 3 tentativas; antes fica discreto. */}
            {tentativas >= 3 ? (
              <button
                className="mt-3 inline-flex h-11 w-full items-center justify-center rounded-xl border-2 border-ink bg-surface px-6 text-sm font-semibold text-ink transition-colors hover:bg-subtle"
                onClick={() => {
                  setMotivoCadastro("nao_encontrado");
                  setEtapa("cadastro");
                }}
                type="button"
              >
                Fazer meu cadastro
              </button>
            ) : (
              <button
                className="mt-3 w-full text-center text-xs font-medium text-ink-muted underline-offset-4 transition-colors hover:text-ink hover:underline"
                onClick={() => {
                  setMotivoCadastro("declarou_novo");
                  setEtapa("cadastro");
                }}
                type="button"
              >
                Ainda não sou cadastrada na Careli
              </button>
            )}
          </div>

          <Rodape>
            <BotaoVoltar onClick={() => setEtapa("empreendimentos")} />
          </Rodape>
        </Secao>
      ) : null}

      {etapa === "habilitacao" && consulta ? (
        <Secao
          titulo={`Bem-vinda de volta, ${consulta.nome ?? "parceira"}!`}
          descricao="Encontramos seu cadastro. Selecione os empreendimentos que deseja habilitar."
          passo={3}
        >
          {(() => {
            const disponiveis = empreendimentos.filter(
              (item) => !consulta.jaTrabalha.includes(item.id),
            );
            const jaTrabalha = empreendimentos.filter((item) =>
              consulta.jaTrabalha.includes(item.id),
            );

            return (
              <>
                {disponiveis.length === 0 ? (
                  <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
                    Você já está habilitada em todos os empreendimentos com credenciamento aberto.
                  </p>
                ) : (
                  <GradeEmpreendimentos
                    empreendimentos={disponiveis}
                    onToggle={(id) => alternar(habilitar, setHabilitar, id)}
                    selecionados={habilitar}
                  />
                )}

                {jaTrabalha.length ? (
                  <div className="mt-6">
                    <p className="m-0 mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                      Você já trabalha aqui
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {jaTrabalha.map((item) => (
                        <span
                          className="inline-flex items-center gap-1.5 rounded-full border border-line bg-subtle px-3 py-1 text-xs font-medium text-ink-soft"
                          key={item.id}
                        >
                          <Check aria-hidden="true" className="size-3 text-emerald-500" />
                          {item.name}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}

                <Rodape>
                  <BotaoVoltar onClick={() => setEtapa("identificacao")} />
                  <BotaoPrimario
                    disabled={habilitar.length === 0}
                    onClick={() => setEtapa("enviado")}
                  >
                    Solicitar habilitação
                  </BotaoPrimario>
                </Rodape>
              </>
            );
          })()}
        </Secao>
      ) : null}

      {etapa === "enviado" ? (
        <div className="mx-auto max-w-lg py-10 text-center">
          <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-emerald-50 dark:bg-emerald-500/10">
            <Check aria-hidden="true" className="size-7 text-emerald-600 dark:text-emerald-400" />
          </span>
          <h2 className="mt-4 text-xl font-semibold tracking-tight text-ink">
            Solicitação enviada
          </h2>
          <p className="mt-1.5 text-sm text-ink-soft">
            Nossa equipe vai analisar o pedido de habilitação e retornar em breve. Você receberá a
            confirmação pelos contatos do seu cadastro.
          </p>
        </div>
      ) : null}
    </Moldura>
  );
}

// --- moldura e blocos visuais -----------------------------------------------------------

// h-full + min-h-0 + overflow-y-auto: é o padrão de rolagem do hub (o mesmo do wizard). Com
// `min-h-full` o container estourava o pai e a página ficava sem barra de rolagem.
function Moldura({ children }: { children: React.ReactNode }) {
  return (
    <section className="h-full min-h-0 overflow-y-auto bg-canvas">
      <div className="mx-auto w-full max-w-4xl px-5 py-8">{children}</div>
    </section>
  );
}

function Cabecalho() {
  return (
    <header className="mb-8 flex flex-col items-center text-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img alt="C2X" className="h-9 w-auto" src="/prometeu/c2x-logo.png" />
      <p className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
        <ShieldCheck aria-hidden="true" className="size-3.5 text-emerald-500" />
        Credenciamento de imobiliárias
      </p>
      <p className="mt-3 max-w-xl text-sm text-ink-soft">
        Habilite sua imobiliária para vender nossos loteamentos. O processo leva poucos minutos.
      </p>
    </header>
  );
}

function Secao({
  children,
  descricao,
  passo,
  titulo,
}: {
  children: React.ReactNode;
  descricao: string;
  passo: number;
  titulo: string;
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-8">
      <div className="mb-6 flex items-start gap-3">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-inverse text-xs font-bold text-brand-ink">
          {passo}
        </span>
        <div className="min-w-0">
          <h2 className="m-0 text-lg font-semibold tracking-tight text-ink">{titulo}</h2>
          <p className="m-0 mt-1 text-sm text-ink-soft">{descricao}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

function GradeEmpreendimentos({
  empreendimentos,
  onToggle,
  selecionados,
}: {
  empreendimentos: Empreendimento[];
  onToggle: (id: string) => void;
  selecionados: string[];
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {empreendimentos.map((item) => {
        const on = selecionados.includes(item.id);
        return (
          <button
            aria-pressed={on}
            className={`group relative flex flex-col items-center gap-3 rounded-xl border p-4 text-center transition-all ${
              on
                ? "border-ink bg-subtle/60 shadow-[0_0_0_1px_var(--color-ink,#111)]"
                : "border-line bg-surface hover:border-line-strong hover:shadow-sm"
            }`}
            key={item.id}
            onClick={() => onToggle(item.id)}
            type="button"
          >
            <span
              className={`absolute right-2.5 top-2.5 flex size-5 items-center justify-center rounded-full border transition-colors ${
                on ? "border-ink bg-inverse" : "border-line-strong bg-surface"
              }`}
            >
              {on ? (
                <Check aria-hidden="true" className="size-3 text-brand-ink" />
              ) : null}
            </span>

            <span className="flex h-16 w-full items-center justify-center">
              {item.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt={item.name}
                  className="max-h-16 max-w-full object-contain"
                  src={item.logoUrl}
                />
              ) : (
                <span
                  className="flex size-12 items-center justify-center rounded-xl text-sm font-bold text-white"
                  style={{ backgroundColor: DOURADO }}
                >
                  {item.code.slice(0, 3) || <Building2 className="size-5" />}
                </span>
              )}
            </span>

            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-ink">
                {toTitleCase(item.name)}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Rodape({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-7 flex items-center justify-between gap-3">
      {children}
      <span className="sr-only" />
    </div>
  );
}

function BotaoPrimario({
  children,
  className = "",
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`ml-auto inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-inverse px-6 text-sm font-semibold text-brand-ink transition-all hover:bg-inverse/90 disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function BotaoVoltar({ onClick }: { onClick: () => void }) {
  return (
    <button
      className="inline-flex h-11 items-center gap-1.5 rounded-xl border border-line px-4 text-sm font-medium text-ink-soft transition-colors hover:bg-subtle"
      onClick={onClick}
      type="button"
    >
      <ArrowLeft aria-hidden="true" className="size-4" />
      Voltar
    </button>
  );
}

function Carregando() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <div className="h-36 animate-pulse rounded-xl border border-line bg-subtle" key={i} />
      ))}
    </div>
  );
}

function Vazio() {
  return (
    <p className="rounded-xl border border-line bg-subtle px-4 py-6 text-center text-sm text-ink-muted">
      Nenhum empreendimento com credenciamento aberto no momento.
    </p>
  );
}
