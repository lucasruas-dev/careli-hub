"use client";

import { Plus, RotateCcw, Trash2 } from "lucide-react";

import { TEXTOS_PADRAO_DA_PA } from "@/lib/prometeu/pa-textos";

// A ÁREA DE EDIÇÃO DA PROPOSTA DE AQUISIÇÃO (Lucas, 29/08/2026: *"temos que criar a area para
// editar a PA"*). Mora no Setup do lançamento porque o texto jurídico é DO EVENTO — cada
// lançamento pode ter incorporadora, prazos e comissão próprios — e o Setup é onde a operação
// já configura tudo o mais.
//
// ⚠️ O QUE É EDITÁVEL AQUI É SÓ O TEXTO. Os planos e os números da folha vêm do C2X (planos
// comerciais do empreendimento) e não têm campo aqui de propósito: texto digitado não pode
// contradizer número calculado.
//
// ⚠️ A FOLHA É UMA PÁGINA SÓ, com o tamanho da fonte MEDIDO para o texto padrão. Aumentar muito
// as declarações empurra o rodapé para uma segunda página — o aviso no rodapé desta seção
// existe por isso.

export type PaTextosDoForm = {
  clausulaPersonalizado: string;
  clausulaSinal: string;
  declaracoes: string[];
};

export function paTextosDoConfig(config: {
  paTextos?: {
    clausulaPersonalizado?: string;
    clausulaSinal?: string;
    declaracoes?: string[];
  };
}): PaTextosDoForm {
  // O formulário mostra o texto EFETIVO (gravado ou padrão): o operador edita o que vai sair
  // no papel, nunca um campo vazio que esconde o padrão por trás.
  return {
    clausulaPersonalizado:
      config.paTextos?.clausulaPersonalizado?.trim() ||
      TEXTOS_PADRAO_DA_PA.clausulaPersonalizado,
    clausulaSinal:
      config.paTextos?.clausulaSinal?.trim() || TEXTOS_PADRAO_DA_PA.clausulaSinal,
    declaracoes: config.paTextos?.declaracoes?.length
      ? config.paTextos.declaracoes
      : [...TEXTOS_PADRAO_DA_PA.declaracoes],
  };
}

const ROTULO = "mb-1.5 block text-[0.7rem] font-semibold uppercase tracking-wide text-ink-muted";
const CAMPO =
  "w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink leading-relaxed";

export function PaEditor({
  aoMudar,
  incorporadora,
  aoMudarIncorporadora,
  valor,
}: {
  aoMudar: (novo: PaTextosDoForm) => void;
  aoMudarIncorporadora: (nova: string) => void;
  incorporadora: string;
  valor: PaTextosDoForm;
}) {
  const muda = (parcial: Partial<PaTextosDoForm>) => aoMudar({ ...valor, ...parcial });

  return (
    <details className="rounded-xl border border-line bg-surface">
      <summary className="cursor-pointer select-none px-4 py-3 text-sm font-bold text-ink">
        Proposta de Aquisição — textos da folha
        <span className="ml-2 font-normal text-ink-muted">
          cláusulas e declarações que saem no papel
        </span>
      </summary>
      <div className="flex flex-col gap-4 border-t border-line px-4 py-4">
        <label className="block">
          <span className={ROTULO}>Empreendedora (quem assina a folha)</span>
          <input
            className={CAMPO}
            onChange={(e) => aoMudarIncorporadora(e.target.value)}
            placeholder="Nome da incorporadora como sai na PA; vazio = o nome do lançamento"
            value={incorporadora}
          />
        </label>

        <label className="block">
          <span className={ROTULO}>Cláusula A — pagamento do sinal</span>
          <textarea
            className={CAMPO}
            onChange={(e) => muda({ clausulaSinal: e.target.value })}
            rows={2}
            value={valor.clausulaSinal}
          />
        </label>

        <label className="block">
          <span className={ROTULO}>Cláusula do plano personalizado</span>
          <textarea
            className={CAMPO}
            onChange={(e) => muda({ clausulaPersonalizado: e.target.value })}
            rows={2}
            value={valor.clausulaPersonalizado}
          />
        </label>

        <div>
          <span className={ROTULO}>Declarações do proponente</span>
          <div className="flex flex-col gap-2">
            {valor.declaracoes.map((texto, i) => (
              <div className="flex items-start gap-2" key={i}>
                <span className="mt-2 w-6 shrink-0 text-right text-xs font-bold text-ink-muted">
                  {i + 1}.
                </span>
                <textarea
                  className={CAMPO}
                  onChange={(e) => {
                    const lista = [...valor.declaracoes];
                    lista[i] = e.target.value;
                    muda({ declaracoes: lista });
                  }}
                  rows={Math.min(6, Math.max(2, Math.ceil(texto.length / 110)))}
                  value={texto}
                />
                <button
                  className="mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line text-ink-muted transition hover:border-red-400 hover:text-red-600"
                  onClick={() =>
                    muda({ declaracoes: valor.declaracoes.filter((_, j) => j !== i) })
                  }
                  title="Remover declaração"
                  type="button"
                >
                  <Trash2 aria-hidden="true" size={14} />
                </button>
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <button
              className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink-soft transition hover:text-ink"
              onClick={() => muda({ declaracoes: [...valor.declaracoes, ""] })}
              type="button"
            >
              <Plus aria-hidden="true" size={13} /> Adicionar declaração
            </button>
            <button
              className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink-soft transition hover:text-ink"
              onClick={() =>
                aoMudar({
                  clausulaPersonalizado: TEXTOS_PADRAO_DA_PA.clausulaPersonalizado,
                  clausulaSinal: TEXTOS_PADRAO_DA_PA.clausulaSinal,
                  declaracoes: [...TEXTOS_PADRAO_DA_PA.declaracoes],
                })
              }
              title="Volta cláusulas e declarações para o texto padrão da casa"
              type="button"
            >
              <RotateCcw aria-hidden="true" size={13} /> Restaurar padrão
            </button>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-ink-muted">
            <b>*negrito*</b> como no WhatsApp: *8% (oito por cento)* sai em negrito na folha.
            Sub-itens: comece a linha com <b>a)</b>, <b>b)</b>... e viram a lista alfabética.
            A folha é <b>uma página só</b>: texto muito maior que o padrão pode empurrar as
            assinaturas para uma segunda página — imprima um teste depois de mexer.
          </p>
        </div>
      </div>
    </details>
  );
}
