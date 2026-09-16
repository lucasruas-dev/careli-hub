"use client";

import { Building2, LandPlot, LoaderCircle } from "lucide-react";
import {
  type FormEvent,
  type KeyboardEvent as KeyboardEventDoReact,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { buscarCidades, type Cidade, UFS } from "@/lib/apolo/cidades";
import { codigoDoProduto, type TipoProduto, validarProdutoNovo } from "@/lib/hercules/produto-novo";

import { T } from "../tema";
import {
  codigoEnquantoDigita,
  type ErrosDaTelaDoProduto,
  exemploDeCodigoDaUnidade,
  lerRespostaDoProdutoNovo,
  OPCOES_DE_TIPO_DE_PRODUTO,
  sugerirCodigoDoProduto,
} from "./cadastro-na-tela";
import { type AtributosDoControle, CampoDoCadastro, cabecalhosDaChamada, JanelaDoCadastro } from "./janela-do-cadastro";

// NOVO PRODUTO: o prédio ou o loteamento que nasce no Panteon.
//
// Decisão do Lucas (16/09/2026): o portal da Cecílio Rocha vira uma réplica do Hércules operada
// pelo time do cliente, no MESMO banco, e cada produto marca quem o opera. Ed. Jade, Ed. Rubi, Ed.
// Cristal, Ed. Esmeralda, On Sky, Guaimbê, Giant Towers e Vale do Sol ainda não existem no sistema;
// nascem aqui, com id a partir de 100000 (sequence da 0170), e o C2X legado não recebe nada.
//
// ⚠️ O TIPO VEM PRIMEIRO E SEM ESCOLHA PRONTA. Ele decide como TODA unidade do produto se escreve
// no WhatsApp, na proposta e no contrato ("Quadra 01 · Lote 07" ou "Torre A · Apto 304"). Um
// loteamento marcado por padrão passaria calado para um prédio de quem só clicou em "Criar", e
// apartamento nunca pode virar quadra e lote.
//
// ⚠️ A TELA CONFERE COM A MESMA RÉGUA DA ROTA (`validarProdutoNovo`), e as mensagens são as mesmas
// palavra por palavra. A tela é conveniência; a rota confere de novo e responde 422 por campo, e
// é por isso que o erro do servidor aparece no mesmo lugar do erro da tela. O código repetido que
// a tela não enxerga (produto de outro incorporador) só a rota pega.

export const ROTA_DO_PRODUTO_NOVO = "/api/incorporador/produtos/novo";

/** Onde a tela relê a sessão do portal depois de criar (o escopo mora no cookie). */
export const ROTA_DA_SESSAO_DO_PORTAL = "/api/incorporador/sessao";

export type ProdutoCriado = {
  codigo: string;
  enterpriseId: string;
  /**
   * Só no portal. `true` = a sessão foi relida e o produto novo já está no escopo do cookie; `false` =
   * a releitura falhou, e quem chama deve recarregar a página antes de abrir o produto (senão as
   * rotas do portal respondem 404 para ele). Ausente = a rota não pediu (porta do hub).
   */
  sessaoRecarregada?: boolean;
};

/** Um empreendimento que pode receber o produto novo como etapa (raiz do cadastro do Panteon). */
export type PaiPossivel = { codigo: string; nome: string };

/** Um portal que pode operar o produto (só na porta do hub): o slug vai para a rota, que confere no banco. */
export type OperadorPossivel = { nome: string; slug: string };

type Props = {
  aberto: boolean;
  aoCriar: (r: ProdutoCriado) => void;
  aoFechar: () => void;
  /**
   * Códigos que a tela já conhece (array ou Set), para acusar o repetido antes do envio. A rota
   * confere contra o C2X e o Panteon inteiros; isto só antecipa o que dá para ver daqui.
   */
  codigosExistentes?: Iterable<string>;
  endpoint?: string;
  /**
   * Só no HUB: os portais que podem operar o produto. Com a lista, aparece o seletor "Quem opera"
   * (em branco = a Careli), e o slug vai no corpo como `operadoPorIncorporadorSlug`. No portal o
   * operador é o da sessão, e a lista não é passada.
   */
  operadores?: readonly OperadorPossivel[];
  /** Quem pode ser pai. Com a lista, o campo vira seletor; sem ela, código digitado. */
  pais?: readonly PaiPossivel[];
  /** `false` = porta do hub (Bearer do Apolo). Padrão: portal, pelo cookie da sessão. */
  semToken?: boolean;
};

const CSS_DO_PRODUTO = `
  .inc-tipo-grade { display: grid; gap: 10px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .inc-tipo {
    align-items: flex-start; background: ${T.card}; border: 1.5px solid ${T.border}; border-radius: 12px;
    color: ${T.text}; cursor: pointer; display: flex; flex-direction: column; font: inherit; gap: 6px;
    padding: 14px; text-align: left;
  }
  .inc-tipo[aria-checked="true"] { background: ${T.soft}; border-color: ${T.gold}; box-shadow: inset 0 0 0 1px ${T.gold}; }
  .inc-tipo:disabled { cursor: default; opacity: .6; }
  .inc-tipo-grade[aria-invalid="true"] .inc-tipo { border-color: ${T.danger}; }
  .inc-tipo-icone {
    align-items: center; background: ${T.soft}; border-radius: 9px; color: ${T.sub}; display: inline-flex;
    height: 34px; justify-content: center; width: 34px;
  }
  .inc-tipo[aria-checked="true"] .inc-tipo-icone { background: ${T.btnBg}; color: ${T.btnFg}; }
  .inc-tipo-titulo { font-size: 14px; font-weight: 650; }
  .inc-tipo-detalhe { color: ${T.muted}; font-size: 11.5px; }
  .inc-codigo { font-variant-numeric: tabular-nums; letter-spacing: .08em; text-transform: uppercase; }
  .inc-cidade-uf { display: grid; gap: 10px 12px; grid-template-columns: minmax(0, 1fr) 104px; }
  .inc-sugestoes {
    background: ${T.card}; border: 1px solid ${T.border}; border-radius: 10px; box-shadow: ${T.sombra};
    left: 0; list-style: none; margin: 4px 0 0; max-height: 224px; overflow: auto; padding: 4px;
    position: absolute; right: 0; top: 100%; z-index: 5;
  }
  .inc-sugestao {
    align-items: center; border-radius: 7px; cursor: pointer; display: flex; font-size: 13px; gap: 8px;
    justify-content: space-between; padding: 7px 9px;
  }
  .inc-sugestao[aria-selected="true"], .inc-sugestao:hover { background: ${T.soft}; }
  .inc-link {
    background: none; border: none; color: ${T.sub}; cursor: pointer; font: inherit; font-size: 12.5px;
    font-weight: 600; justify-self: start; padding: 2px 0; text-decoration: underline;
    text-underline-offset: 3px;
  }
  .inc-sugerido {
    align-self: start; background: ${T.soft}; border: 1px dashed ${T.border}; border-radius: 999px;
    color: ${T.sub}; cursor: pointer; font: inherit; font-size: 11.5px; font-weight: 600;
    justify-self: start; padding: 3px 10px;
  }
  @media (max-width: 640px) { .inc-cidade-uf { grid-template-columns: minmax(0, 1fr) 92px; } }
`;

type CampoDaTela = keyof ErrosDaTelaDoProduto;

/** A ordem em que o foco procura o primeiro campo errado: a ordem da tela. */
const ORDEM_DOS_CAMPOS: readonly CampoDaTela[] = [
  "tipoProduto",
  "nome",
  "codigo",
  "cidade",
  "uf",
  "operadoPorIncorporadorSlug",
  "paiCodigo",
];

/**
 * A janela de cadastro de produto. Fechada, não monta nada: cada abertura começa do zero, sem o
 * rascunho de quem desistiu da última vez.
 */
export function NovoProduto(props: Props) {
  if (!props.aberto) return null;
  return <FormularioDoProdutoNovo {...props} />;
}

function FormularioDoProdutoNovo({
  aoCriar,
  aoFechar,
  codigosExistentes,
  endpoint = ROTA_DO_PRODUTO_NOVO,
  operadores,
  pais,
  semToken = true,
}: Props) {
  const [tipo, setTipo] = useState<"" | TipoProduto>("");
  const [nome, setNome] = useState("");
  const [codigo, setCodigo] = useState("");
  const [cidade, setCidade] = useState("");
  const [uf, setUf] = useState("");
  const [temPai, setTemPai] = useState(false);
  const [paiCodigo, setPaiCodigo] = useState("");
  // O slug do portal que vai operar (só no hub). Vazio = a Careli.
  const [operador, setOperador] = useState("");
  const [tentou, setTentou] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [errosDoServidor, setErrosDoServidor] = useState<ErrosDaTelaDoProduto>({});
  const [mensagem, setMensagem] = useState<null | string>(null);

  const formulario = useRef<HTMLFormElement | null>(null);
  const botaoCriar = useRef<HTMLButtonElement | null>(null);
  // ⚠️ O FOCO DEPOIS DA RESPOSTA ESPERA OS CAMPOS VOLTAREM: enquanto envia, tudo está desabilitado,
  // `.focus()` não pega, e o foco cairia no <body>, fora da janela (Esc e Tab parariam de
  // funcionar). "botao" = sem campo errado, o foco volta para o Criar.
  const focoPendente = useRef<"botao" | CampoDaTela | null>(null);
  const idFormulario = useId();
  const idRotuloTipo = useId();
  const idNotaTipo = useId();
  const idPai = useId();

  // ⚠️ DEPENDE DO CONTEÚDO, NÃO DA IDENTIDADE: quem chama costuma montar `new Set(...)` no render, e
  // a régua recalcularia a cada tecla por nada.
  const chaveDosExistentes = [...(codigosExistentes ?? [])].map(codigoDoProduto).sort().join("|");
  const existentes = useMemo(
    () => new Set(chaveDosExistentes ? chaveDosExistentes.split("|") : []),
    [chaveDosExistentes],
  );
  const paisPossiveis = useMemo(() => (pais ? new Set(pais.map((p) => codigoDoProduto(p.codigo))) : undefined), [pais]);

  const entrada = {
    cidade,
    codigo,
    nome,
    paiCodigo: temPai ? paiCodigo : null,
    tipoProduto: tipo,
    uf,
  };
  const validacao = validarProdutoNovo(entrada, { codigosExistentes: existentes, paisPossiveis });
  const errosDaTela: ErrosDaTelaDoProduto = tentou && !validacao.ok ? validacao.erros : {};
  const erroDe = (campo: CampoDaTela): null | string => errosDoServidor[campo] ?? errosDaTela[campo] ?? null;
  const temErro = ORDEM_DOS_CAMPOS.some((campo) => erroDe(campo));

  /** O erro do servidor num campo some quando a pessoa mexe nele: o motivo pode não valer mais. */
  const esquecerDoServidor = (campo: CampoDaTela) =>
    setErrosDoServidor((atual) => {
      if (!(campo in atual)) return atual;
      const copia = { ...atual };
      delete copia[campo];
      return copia;
    });

  const focarCampo = (campo: CampoDaTela) =>
    formulario.current?.querySelector<HTMLElement>(`[data-campo="${campo}"]`)?.focus();

  useEffect(() => {
    if (enviando || !focoPendente.current) return;
    const alvo = focoPendente.current;
    focoPendente.current = null;
    if (alvo === "botao") botaoCriar.current?.focus();
    else formulario.current?.querySelector<HTMLElement>(`[data-campo="${alvo}"]`)?.focus();
  }, [enviando]);

  const sugestao = codigo ? "" : sugerirCodigoDoProduto(nome, existentes);
  const sigla = codigo.length >= 2 ? codigo : "JAD";
  const exemplo = tipo
    ? exemploDeCodigoDaUnidade(sigla, tipo)
    : `${exemploDeCodigoDaUnidade(sigla, "vertical")} ou ${exemploDeCodigoDaUnidade(sigla, "loteamento")}`;

  async function criar(evento?: FormEvent) {
    evento?.preventDefault();
    if (enviando) return;
    setTentou(true);
    setMensagem(null);

    if (!validacao.ok) {
      const erros: ErrosDaTelaDoProduto = validacao.erros;
      const campo = ORDEM_DOS_CAMPOS.find((c) => erros[c]);
      if (campo) focarCampo(campo);
      return;
    }

    setEnviando(true);
    try {
      const resposta = await fetch(endpoint, {
        body: JSON.stringify({
          ...validacao.produto,
          ...(operadores && operador ? { operadoPorIncorporadorSlug: operador } : {}),
        }),
        headers: await cabecalhosDaChamada(semToken),
        method: "POST",
      });
      const corpo: unknown = await resposta.json().catch(() => null);
      const lida = lerRespostaDoProdutoNovo(resposta.status, corpo);

      if (lida.ok) {
        const criado: ProdutoCriado = { codigo: lida.codigo || validacao.produto.codigo, enterpriseId: lida.enterpriseId };
        // ⚠️ A SESSÃO É RELIDA ANTES DE AVISAR QUEM CHAMOU. O escopo do portal mora no cookie, e só o
        // GET da sessão o reemite com o produto novo; recarregar a lista antes disso não o mostraria,
        // e abrir o produto daria 404 até alguém apertar F5.
        if (lida.recarregarSessao && semToken) {
          criado.sessaoRecarregada = await fetch(ROTA_DA_SESSAO_DO_PORTAL, { cache: "no-store" })
            .then((r) => r.ok)
            .catch(() => false);
        }
        aoCriar(criado);
        return;
      }

      setErrosDoServidor(lida.erros);
      setMensagem(lida.mensagem);
      focoPendente.current = ORDEM_DOS_CAMPOS.find((c) => lida.erros[c]) ?? "botao";
    } catch {
      setMensagem("Sem resposta do servidor. Confira a conexão e tente de novo.");
      focoPendente.current = "botao";
    } finally {
      setEnviando(false);
    }
  }

  const escolherTipo = (proximo: TipoProduto) => {
    setTipo(proximo);
    esquecerDoServidor("tipoProduto");
  };

  // Rádio de verdade: as setas trocam E escolhem, e o foco anda junto (padrão WAI-ARIA do radiogroup).
  const aoTeclarNoTipo = (evento: KeyboardEventDoReact<HTMLButtonElement>, indice: number) => {
    const passo =
      evento.key === "ArrowRight" || evento.key === "ArrowDown" ? 1 : evento.key === "ArrowLeft" || evento.key === "ArrowUp" ? -1 : 0;
    if (!passo) return;
    evento.preventDefault();
    const total = OPCOES_DE_TIPO_DE_PRODUTO.length;
    const proximo = (indice + passo + total) % total;
    const opcao = OPCOES_DE_TIPO_DE_PRODUTO[proximo];
    if (!opcao) return;
    escolherTipo(opcao.chave);
    const botoes = evento.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    botoes?.[proximo]?.focus();
  };

  const erroDoTipo = erroDe("tipoProduto");

  return (
    <JanelaDoCadastro
      aoFechar={aoFechar}
      bloqueada={enviando}
      descricao="O produto nasce no Panteon. Depois dele, as unidades."
      largura={560}
      rodape={
        <>
          {enviando ? (
            <span style={{ color: T.muted, fontSize: 11.5, marginRight: "auto" }}>Não feche esta janela.</span>
          ) : null}
          <button className="inc-botao inc-botao--discreto inc-foco" disabled={enviando} onClick={aoFechar} type="button">
            Cancelar
          </button>
          <button className="inc-botao inc-foco" disabled={enviando} form={idFormulario} ref={botaoCriar} type="submit">
            {enviando ? <LoaderCircle aria-hidden="true" className="inc-cad-girando" size={15} /> : null}
            {enviando ? "Criando…" : "Criar produto"}
          </button>
        </>
      }
      titulo="Novo produto"
    >
      <style>{CSS_DO_PRODUTO}</style>
      <form
        aria-busy={enviando}
        id={idFormulario}
        noValidate
        onSubmit={(e) => void criar(e)}
        ref={formulario}
        style={{ alignContent: "start", display: "grid", gap: 14 }}
      >
        {mensagem ? (
          <p className="inc-recado inc-recado--erro" role="alert">
            {mensagem}
          </p>
        ) : tentou && temErro ? (
          <p className="inc-recado inc-recado--erro" role="alert">
            Confira os campos marcados.
          </p>
        ) : null}

        {/* ── O TIPO, em destaque ─────────────────────────────────────────── */}
        <div style={{ display: "grid", gap: 8 }}>
          <span className="inc-form-rotulo" id={idRotuloTipo}>
            Tipo do produto <span aria-hidden="true">*</span>
          </span>
          <div
            aria-describedby={idNotaTipo}
            aria-invalid={erroDoTipo ? true : undefined}
            aria-labelledby={idRotuloTipo}
            aria-required="true"
            className="inc-tipo-grade"
            role="radiogroup"
          >
            {OPCOES_DE_TIPO_DE_PRODUTO.map((opcao, indice) => {
              const marcado = tipo === opcao.chave;
              const Icone = opcao.chave === "vertical" ? Building2 : LandPlot;
              return (
                <button
                  aria-checked={marcado}
                  className="inc-tipo inc-foco"
                  data-campo={marcado || (tipo === "" && indice === 0) ? "tipoProduto" : undefined}
                  disabled={enviando}
                  key={opcao.chave}
                  onClick={() => escolherTipo(opcao.chave)}
                  onKeyDown={(e) => aoTeclarNoTipo(e, indice)}
                  role="radio"
                  tabIndex={marcado || (tipo === "" && indice === 0) ? 0 : -1}
                  type="button"
                >
                  <span aria-hidden="true" className="inc-tipo-icone">
                    <Icone size={18} />
                  </span>
                  <span className="inc-tipo-titulo">{opcao.titulo}</span>
                  <span className="inc-tipo-detalhe">{opcao.detalhe}</span>
                </button>
              );
            })}
          </div>
          <p className={erroDoTipo ? "inc-form-erro" : "inc-form-dica"} id={idNotaTipo}>
            {erroDoTipo ??
              "O tipo decide como cada unidade aparece no WhatsApp, na proposta e no contrato: Quadra e Lote, ou Torre e Apto."}
          </p>
        </div>

        <div className="inc-form-grade">
          <CampoDoCadastro
            classe="inc-form-inteira"
            controle={(a) => (
              <input
                {...a}
                autoComplete="off"
                className="inc-form-campo"
                data-campo="nome"
                disabled={enviando}
                maxLength={120}
                onChange={(e) => {
                  setNome(e.target.value);
                  esquecerDoServidor("nome");
                }}
                placeholder="Ed. Jade"
                value={nome}
              />
            )}
            erro={erroDe("nome")}
            obrigatorio
            rotulo="Nome"
          />

          <div className="inc-form-item">
            <CampoDoCadastro
              controle={(a) => (
                <input
                  {...a}
                  autoCapitalize="characters"
                  autoComplete="off"
                  className="inc-form-campo inc-codigo"
                  data-campo="codigo"
                  disabled={enviando}
                  maxLength={6}
                  onChange={(e) => {
                    setCodigo(codigoEnquantoDigita(e.target.value));
                    esquecerDoServidor("codigo");
                  }}
                  placeholder="JAD"
                  spellCheck={false}
                  value={codigo}
                />
              )}
              dica={`2 a 6 letras ou números, começando por letra. Cada unidade nasce com ele: ${exemplo}.`}
              erro={erroDe("codigo")}
              obrigatorio
              rotulo="Código"
            />
            {sugestao ? (
              <button
                aria-label={`Usar o código sugerido ${sugestao}`}
                className="inc-sugerido inc-foco"
                disabled={enviando}
                onClick={() => {
                  setCodigo(sugestao);
                  esquecerDoServidor("codigo");
                }}
                type="button"
              >
                Usar {sugestao}
              </button>
            ) : null}
          </div>

          <div className="inc-cidade-uf inc-form-inteira">
            <CampoDoCadastro
              controle={(a) => (
                <CampoDeCidade
                  aoEscolher={(escolhida) => {
                    setCidade(escolhida.nome);
                    setUf(escolhida.uf);
                    esquecerDoServidor("cidade");
                    esquecerDoServidor("uf");
                  }}
                  aoMudar={(valor) => {
                    setCidade(valor);
                    esquecerDoServidor("cidade");
                  }}
                  atributos={a}
                  desabilitado={enviando}
                  valor={cidade}
                />
              )}
              erro={erroDe("cidade")}
              obrigatorio
              rotulo="Cidade"
            />
            <CampoDoCadastro
              controle={(a) => (
                <select
                  {...a}
                  className="inc-form-campo"
                  data-campo="uf"
                  disabled={enviando}
                  onChange={(e) => {
                    setUf(e.target.value);
                    esquecerDoServidor("uf");
                  }}
                  value={uf}
                >
                  <option value="">UF</option>
                  {UFS.map((sigla) => (
                    <option key={sigla} value={sigla}>
                      {sigla}
                    </option>
                  ))}
                </select>
              )}
              erro={erroDe("uf")}
              obrigatorio
              rotulo="UF"
            />
          </div>

          {/* QUEM OPERA, SÓ NO HUB. Em branco, a Careli; um portal escolhido recebe o produto no
              recorte dele. O slug é conferido no banco pela rota (portal inexistente ou desligado é
              recusado no campo). */}
          {operadores && operadores.length > 0 ? (
            <CampoDoCadastro
              classe="inc-form-inteira"
              controle={(a) => (
                <select
                  {...a}
                  className="inc-form-campo"
                  data-campo="operadoPorIncorporadorSlug"
                  disabled={enviando}
                  onChange={(e) => {
                    setOperador(e.target.value);
                    esquecerDoServidor("operadoPorIncorporadorSlug");
                  }}
                  value={operador}
                >
                  <option value="">Careli</option>
                  {operadores.map((o) => (
                    <option key={o.slug} value={o.slug}>
                      {o.nome}
                    </option>
                  ))}
                </select>
              )}
              dica="Quem opera a venda e o estoque deste produto."
              erro={erroDe("operadoPorIncorporadorSlug")}
              rotulo="Quem opera"
            />
          ) : null}

          {/* ⚠️ O PAI FICA ESCONDIDO ATÉ A PESSOA PEDIR. Quase todo produto é raiz; um campo de "pai"
              sempre à vista convida a preencher o que não existe e cria uma etapa de mentira. */}
          <div className="inc-form-inteira" style={{ display: "grid", gap: 8 }}>
            <button
              aria-controls={idPai}
              aria-expanded={temPai}
              className="inc-link inc-foco"
              disabled={enviando}
              onClick={() => {
                setTemPai((atual) => !atual);
                esquecerDoServidor("paiCodigo");
              }}
              type="button"
            >
              {temPai ? "Não é etapa de outro empreendimento" : "É etapa de outro empreendimento?"}
            </button>
            {temPai ? (
              <div id={idPai}>
                <CampoDoCadastro
                  controle={(a) =>
                    pais && pais.length > 0 ? (
                      <select
                        {...a}
                        className="inc-form-campo"
                        data-campo="paiCodigo"
                        disabled={enviando}
                        onChange={(e) => {
                          setPaiCodigo(e.target.value);
                          esquecerDoServidor("paiCodigo");
                        }}
                        value={paiCodigo}
                      >
                        <option value="">Escolha o empreendimento</option>
                        {pais.map((p) => (
                          <option key={p.codigo} value={codigoDoProduto(p.codigo)}>
                            {codigoDoProduto(p.codigo)} · {p.nome}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        {...a}
                        autoCapitalize="characters"
                        autoComplete="off"
                        className="inc-form-campo inc-codigo"
                        data-campo="paiCodigo"
                        disabled={enviando}
                        maxLength={6}
                        onChange={(e) => {
                          setPaiCodigo(codigoEnquantoDigita(e.target.value));
                          esquecerDoServidor("paiCodigo");
                        }}
                        placeholder="VLO"
                        spellCheck={false}
                        value={paiCodigo}
                      />
                    )
                  }
                  dica="O produto novo aparece dentro dele na lista, como uma etapa. Em branco, é um produto próprio."
                  erro={erroDe("paiCodigo")}
                  rotulo="Empreendimento principal"
                />
              </div>
            ) : null}
          </div>
        </div>
      </form>
    </JanelaDoCadastro>
  );
}

// ── CIDADE ───────────────────────────────────────────────────────────────────

// A lista de municípios entra por import dinâmico e fica para a sessão inteira (o mesmo cache do
// `CampoCidade` do cadastro do Apolo): são 119KB que quem nunca abre esta janela não paga.
let cidadesEmCache: null | readonly string[] = null;
let cidadesCarregando: null | Promise<readonly string[]> = null;

async function carregarCidades(): Promise<readonly string[]> {
  if (cidadesEmCache) return cidadesEmCache;
  cidadesCarregando ??= import("@/lib/apolo/c2x-cidades").then((m) => {
    cidadesEmCache = m.C2X_CIDADES;
    return cidadesEmCache;
  });
  return cidadesCarregando;
}

/**
 * O campo de cidade com sugestão, e a escolha preenche a UF junto.
 *
 * ⚠️ É O PADRÃO DO LUCAS PARA CIDADE (21/08/2026, *"começo a digitar, ele puxa a cidade correta"*),
 * redesenhado com os tokens do portal: o `CampoCidade` do Apolo fala Tailwind e sairia sem cor aqui.
 * Continua aceitando texto livre, porque a régua do produto só exige cidade preenchida.
 *
 * ⚠️ O ESC FECHA A LISTA, NÃO A JANELA: com a lista aberta, o Esc para aqui (ver `JanelaDoCadastro`).
 */
function CampoDeCidade({
  aoEscolher,
  aoMudar,
  atributos,
  desabilitado,
  valor,
}: {
  aoEscolher: (cidade: Cidade) => void;
  aoMudar: (valor: string) => void;
  atributos: AtributosDoControle;
  desabilitado: boolean;
  valor: string;
}) {
  const [linhas, setLinhas] = useState<null | readonly string[]>(cidadesEmCache);
  const [digitado, setDigitado] = useState<null | string>(null);
  const [aberto, setAberto] = useState(false);
  const [destaque, setDestaque] = useState(-1);
  const idLista = useId();

  const sugestoes = useMemo<Cidade[]>(
    () => (aberto && digitado && linhas ? buscarCidades(digitado, linhas, 8) : []),
    [aberto, digitado, linhas],
  );
  const listaVisivel = sugestoes.length > 0;

  const garantirLista = useCallback(() => {
    if (!cidadesEmCache) void carregarCidades().then(setLinhas);
  }, []);

  const escolher = (cidade: Cidade) => {
    aoEscolher(cidade);
    setDigitado(null);
    setAberto(false);
    setDestaque(-1);
  };

  const aoTeclar = (evento: KeyboardEventDoReact<HTMLInputElement>) => {
    if (!listaVisivel) return;
    if (evento.key === "ArrowDown" || evento.key === "ArrowUp") {
      evento.preventDefault();
      const passo = evento.key === "ArrowDown" ? 1 : -1;
      setDestaque((atual) => (atual + passo + sugestoes.length) % sugestoes.length);
    } else if (evento.key === "Enter" && destaque >= 0) {
      evento.preventDefault();
      const cidade = sugestoes[destaque];
      if (cidade) escolher(cidade);
    } else if (evento.key === "Escape") {
      evento.preventDefault();
      evento.stopPropagation();
      setAberto(false);
      setDestaque(-1);
    }
  };

  return (
    <div style={{ position: "relative" }}>
      <input
        {...atributos}
        aria-activedescendant={listaVisivel && destaque >= 0 ? `${idLista}-${destaque}` : undefined}
        aria-autocomplete="list"
        aria-controls={idLista}
        aria-expanded={listaVisivel}
        autoComplete="off"
        className="inc-form-campo"
        data-campo="cidade"
        disabled={desabilitado}
        onBlur={() => setAberto(false)}
        onChange={(e) => {
          setDigitado(e.target.value);
          setAberto(true);
          setDestaque(-1);
          aoMudar(e.target.value);
          garantirLista();
        }}
        onFocus={garantirLista}
        onKeyDown={aoTeclar}
        placeholder="Belo Horizonte"
        role="combobox"
        type="text"
        value={valor}
      />
      {listaVisivel ? (
        <ul className="inc-sugestoes" id={idLista} role="listbox">
          {sugestoes.map((cidade, indice) => (
            <li
              aria-selected={indice === destaque}
              className="inc-sugestao"
              id={`${idLista}-${indice}`}
              key={`${cidade.nome}|${cidade.uf}`}
              // `onMouseDown` e não `onClick`: o clique tira o foco do campo antes, e o blur
              // fecharia a lista com o clique caindo no vazio.
              onMouseDown={(e) => {
                e.preventDefault();
                escolher(cidade);
              }}
              role="option"
            >
              <span>{cidade.nome}</span>
              <span style={{ color: T.muted, fontSize: 11, fontWeight: 700 }}>{cidade.uf}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
