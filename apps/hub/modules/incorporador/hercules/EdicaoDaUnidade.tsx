"use client";

import { LoaderCircle, Pencil } from "lucide-react";
import { type FormEvent, useId, useState } from "react";

import type { ApoloEnterpriseUnit } from "@/lib/apolo/empreendimentos";

import { T } from "../tema";
import {
  type CamposDaEdicao,
  camposDaEdicao,
  lerRespostaDaAtualizacao,
  mudancasDaEdicao,
} from "./cadastro-na-tela";
import { chamarCadastroDeUnidades, ROTA_DO_CADASTRO_DE_UNIDADES } from "./CadastroDeUnidades";
import { CampoDoCadastro, JanelaDoCadastro } from "./janela-do-cadastro";

// CORRIGIR UMA UNIDADE: preço, área e matrícula, pela linha da aba Unidades.
//
// Decisão D2 do Lucas (16/09/2026): as unidades do produto que o portal opera (o Garden da Cecílio,
// inclusive as que vieram do C2X) passam a ser corrigidas pelo próprio time do incorporador. A rota
// é a MESMA do cadastro (`/api/incorporador/produto/unidades/cadastrar`, ação `atualizar`), e a regra
// inteira mora nela: quem pode, a trava da venda andando, a situação e a identificação intocáveis.
// Esta tela só junta os três campos e mostra o que a rota respondeu.
//
// ⚠️ SITUAÇÃO NÃO ESTÁ AQUI, E NÃO É ESQUECIMENTO. Disponível, reservada, vendida e bloqueada são
// consequência do fluxo de venda, que tem tela e trava próprias (Venda). Um campo de situação neste
// formulário desfaria todas elas.
//
// ⚠️ SÓ O QUE MUDOU VAI NO CORPO (`mudancasDaEdicao`): mandar o preço de sempre junto com a matrícula
// travaria a matrícula de um lote reservado com "preço e área ficam travados".

const CSS_DO_BOTAO = `
  .inc-und-editar {
    align-items: center; background: transparent; border: 1px solid ${T.border}; border-radius: 8px;
    color: ${T.sub}; cursor: pointer; display: inline-flex; height: 28px; justify-content: center;
    padding: 0; width: 28px;
  }
  .inc-und-editar:hover { background: ${T.soft}; color: ${T.text}; }
  .inc-und-editar:focus-visible { outline: 2px solid ${T.gold}; outline-offset: 1px; }
`;

type Props = {
  /** Chamado depois que a rota confirmou a correção: é o `recarregar` da tabela. */
  aoSalvar: () => void;
  /** O produto como a rota do cadastro entende ("39", "100001" ou "pai:<uuid>"). */
  emp: string;
  /** Padrão: a porta do portal. No hub, a rota interna do cadastro de unidades. */
  endpoint?: string;
  /** `false` = porta do hub (Bearer do Apolo). Padrão: portal, pelo cookie da sessão. */
  semToken?: boolean;
  unidade: ApoloEnterpriseUnit;
};

const ROTULOS: Record<keyof CamposDaEdicao, { dica: null | string; rotulo: string; teclado: "decimal" | "text" }> = {
  area: { dica: null, rotulo: "Área (m²)", teclado: "decimal" },
  matricula: { dica: "A matrícula pode ser corrigida mesmo com a venda andando.", rotulo: "Matrícula", teclado: "text" },
  preco: { dica: "Preço e área não mudam com reserva ou proposta em andamento.", rotulo: "Valor (R$)", teclado: "decimal" },
};

const ORDEM: readonly (keyof CamposDaEdicao)[] = ["preco", "area", "matricula"];

export function BotaoDeEditarUnidade({
  aoSalvar,
  emp,
  endpoint = ROTA_DO_CADASTRO_DE_UNIDADES,
  semToken = true,
  unidade,
}: Props) {
  const idDoFormulario = useId();
  const [aberto, setAberto] = useState(false);
  const [inicial, setInicial] = useState<CamposDaEdicao>(() => camposDaEdicao(unidade));
  const [campos, setCampos] = useState<CamposDaEdicao>(inicial);
  const [gravando, setGravando] = useState(false);
  const [mensagem, setMensagem] = useState<null | string>(null);
  const [erros, setErros] = useState<Partial<Record<keyof CamposDaEdicao, string>>>({});

  const abrir = () => {
    // Os valores de AGORA da linha: a tabela pode ter recarregado desde a última abertura.
    const atuais = camposDaEdicao(unidade);
    setInicial(atuais);
    setCampos(atuais);
    setMensagem(null);
    setErros({});
    setAberto(true);
  };

  const mudar = (campo: keyof CamposDaEdicao, valor: string) => {
    setCampos((atual) => ({ ...atual, [campo]: valor }));
    setMensagem(null);
    setErros((atual) => {
      if (!atual[campo]) return atual;
      const proximo = { ...atual };
      delete proximo[campo];
      return proximo;
    });
  };

  const mudancas = mudancasDaEdicao(inicial, campos);
  const semMudanca = Object.keys(mudancas).length === 0;

  const salvar = async (evento: FormEvent<HTMLFormElement>) => {
    evento.preventDefault();
    if (gravando) return;
    if (semMudanca) {
      setAberto(false);
      return;
    }

    setGravando(true);
    setMensagem(null);
    try {
      const { corpo, status } = await chamarCadastroDeUnidades(endpoint, semToken, emp, {
        acao: "atualizar",
        campos: mudancas,
        unidadeId: unidade.id,
      });
      const resposta = lerRespostaDaAtualizacao(status, corpo);
      if (resposta.ok) {
        setAberto(false);
        aoSalvar();
        return;
      }
      setErros(resposta.erros);
      setMensagem(resposta.mensagem);
    } catch {
      setMensagem("Não foi possível corrigir a unidade agora. Confira a conexão e tente de novo.");
    } finally {
      setGravando(false);
    }
  };

  return (
    <>
      {/* Um <style> só para a tabela inteira: o React 19 junta os que têm o mesmo `href`. */}
      <style href="inc-und-editar" precedence="medium">
        {CSS_DO_BOTAO}
      </style>
      <button
        aria-label={`Corrigir a unidade ${unidade.code}`}
        className="inc-und-editar"
        onClick={abrir}
        title="Corrigir preço, área e matrícula"
        type="button"
      >
        <Pencil aria-hidden="true" size={14} />
      </button>

      {aberto ? (
        <JanelaDoCadastro
          aoFechar={() => setAberto(false)}
          bloqueada={gravando}
          descricao={unidade.code}
          rodape={
            <>
              <button
                className="inc-botao inc-botao--discreto"
                disabled={gravando}
                onClick={() => setAberto(false)}
                type="button"
              >
                Cancelar
              </button>
              <button className="inc-botao" disabled={gravando || semMudanca} form={idDoFormulario} type="submit">
                {gravando ? <LoaderCircle aria-hidden="true" className="inc-cad-girando" size={14} /> : null}
                {gravando ? "Salvando" : "Salvar"}
              </button>
            </>
          }
          titulo="Corrigir unidade"
        >
          <form
            aria-busy={gravando}
            id={idDoFormulario}
            noValidate
            onSubmit={(evento) => void salvar(evento)}
            style={{ display: "grid", gap: 12 }}
          >
            <p className="inc-form-dica" style={{ margin: 0 }}>
              A situação da unidade (disponível, reservada, vendida, bloqueada) muda pela tela Venda.
            </p>
            <div className="inc-form-grade">
              {ORDEM.map((campo) => (
                <CampoDoCadastro
                  classe={campo === "matricula" ? "inc-form-inteira" : undefined}
                  controle={(atributos) => (
                    <input
                      {...atributos}
                      autoComplete="off"
                      className="inc-form-campo"
                      data-campo={campo}
                      disabled={gravando}
                      inputMode={ROTULOS[campo].teclado}
                      onChange={(e) => mudar(campo, e.target.value)}
                      value={campos[campo]}
                    />
                  )}
                  dica={ROTULOS[campo].dica}
                  erro={erros[campo] ?? null}
                  key={campo}
                  rotulo={ROTULOS[campo].rotulo}
                />
              ))}
            </div>
            {mensagem ? (
              <p className="inc-recado inc-recado--erro" role="alert">
                {mensagem}
              </p>
            ) : null}
          </form>
        </JanelaDoCadastro>
      ) : null}
    </>
  );
}
