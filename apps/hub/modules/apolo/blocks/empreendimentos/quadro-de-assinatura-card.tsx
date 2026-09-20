"use client";

import { FileSignature, Loader2, Lock, Plus, Trash2, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type {
  AssinanteDoQuadro,
  PapelDoQuadro,
} from "@/app/api/temis/assinantes/route";
import { useApiDaTemis } from "@/modules/temis/api-da-temis";

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
//
// ⚠️ A PORTA É A DA TÊMIS (`useApiDaTemis`, revisão da onda 3, achado 21). No hub, sem provedor, as
// chamadas saem como sempre: `/api/temis/assinantes` com o Bearer do hub. Dentro do
// `ApiDaTemisProvider` do portal que confecciona (a aba Minutas do produto), saem por
// `/api/incorporador/temis/assinantes` com o cookie do portal, e a rota de lá recorta pelo escopo e
// pelo produto que o portal opera.

type Bloco = { ajuda: string; papel: PapelDoQuadro; titulo: string };

const BLOCOS: Bloco[] = [
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

// ⚠️ SEPARADO DOS TRÊS DE CIMA, E NÃO UM QUARTO ITEM DA LISTA. Os três primeiros assinam o CONTRATO
// de venda: o nome deles sai impresso na qualificação e o jurídico confere contra a procuração.
// Este assina os TERMOS que a Careli emite sobre a carteira (hoje o termo de acordo do Hades) e não
// entra em contrato nenhum. Enfileirá-lo no mesmo `map` faria a tela apresentar as duas coisas como
// se fossem a mesma, que é justamente a confusão que o papel novo existe para desfazer.
const BLOCO_DOS_TERMOS: Bloco = {
  ajuda:
    "Quem a incorporadora aponta para assinar os termos da carteira pela vendedora. Não precisa ser o representante legal: pode ser alguém do jurídico, um analista, quem ela indicar.",
  papel: "termos_vendedora",
  titulo: "Assinatura de termos (vendedora)",
};

const RASCUNHO = { cpf: "", email: "", nome: "", ordemAssinatura: "", posicao: "" };

/** De onde veio a pessoa que a caixa dos termos mostra. Ver `filaDosTermos`. */
type OrigemDosTermos = "apontado" | "cadastro" | "ninguem" | "vendedora";

/**
 * QUEM ASSINA OS TERMOS HOJE, na MESMA ordem que o envio usa — e é por isso que ela existe.
 *
 * O envio do termo de acordo (`lib/hades/acordo/envio-db.ts`) escolhe assim:
 *
 *     apontado para TERMOS  →  quem está no bloco Vendedora  →  o representante legal da empresa
 *
 * ⚠️ A CAIXA DESCREVIA OUTRA QUEDA, E ISSO É CARO (revisão de 20/09/2026). Ela dizia que sem ninguém
 * apontado o termo *"tenta o representante legal cadastrado na empresa e, se ela não tiver um, o
 * envio fica bloqueado"*, e mostrava a linha herdada do cadastro da PJ como quem assina. As duas
 * coisas viram mentira no instante em que alguém preenche o bloco Vendedora, que é o que aquele
 * bloco pede: quem recebe o convite passa a ser a pessoa do CONTRATO, e não a que a tela mostrou.
 * Medido em produção (20/09/2026): 35 das 40 configurações têm vendedora e ZERO das 23
 * incorporadoras tem representante legal cadastrado, ou seja, o caso do meio é o caso NORMAL.
 * Envelope é pago, não se apaga e chega na caixa do cliente: o nome lido antes de clicar tem de ser
 * o nome que assina.
 *
 * ⚠️ E A LINHA HERDADA DOS TERMOS SÓ APARECE QUANDO É ELA MESMA. O servidor devolve o representante
 * legal como linha sem id no papel dos termos (`lerQuadroDeAssinatura`); ele só assina de verdade
 * quando ninguém ocupou o papel `vendedora`, que é a regra de `assinantesDoQuadro`. Com vendedora
 * digitada, a herdada é descartada aqui.
 */
function filaDosTermos(lista: AssinanteDoQuadro[]): {
  linhas: AssinanteDoQuadro[];
  origem: OrigemDosTermos;
} {
  const porPosicao = (a: AssinanteDoQuadro, b: AssinanteDoQuadro) => a.posicao - b.posicao;
  const dosTermos = lista.filter((a) => a.papel === "termos_vendedora").sort(porPosicao);

  const apontados = dosTermos.filter((a) => a.id);
  if (apontados.length > 0) return { linhas: apontados, origem: "apontado" };

  const doBlocoVendedora = lista.filter((a) => a.papel === "vendedora").sort(porPosicao)[0];
  if (doBlocoVendedora) return { linhas: [doBlocoVendedora], origem: "vendedora" };

  const herdada = dosTermos[0];
  if (herdada) return { linhas: [herdada], origem: "cadastro" };

  return { linhas: [], origem: "ninguem" };
}

export function QuadroDeAssinaturaCard({
  comAssinantesDeTermos = false,
  enterpriseId,
}: {
  /**
   * Mostra o campo de quem assina os TERMOS pela vendedora.
   *
   * ⚠️ NASCE DESLIGADO, E ISSO É O PORTAL. Lucas (20/09/2026) pediu o campo em *"essa tela"* — a do
   * empreendimento no Apolo, onde a Careli monta o quadro. Este mesmo cartão é a tela de minutas do
   * portal da Cecílio, e o termo de acordo é instrumento da COBRANÇA da Careli: ligá-lo lá poria,
   * numa tela sobre confecção de contrato, um campo sobre um documento que aquela equipe não emite.
   *
   * ⚠️ E ESCONDER NÃO É FECHAR: QUEM FECHA É O SERVIDOR. As duas portas do quadro chamam as MESMAS
   * `incluirAssinante` e `removerAssinante`, então esta propriedade só governa o que se VÊ. A recusa
   * do papel `termos_vendedora` para o ator do portal mora em `PAPEL_SO_DA_CARELI`
   * (`lib/temis/estrutura-servico.ts`); ligar o campo lá um dia é mudar as duas coisas, não uma.
   */
  comAssinantesDeTermos?: boolean;
  enterpriseId: string;
}) {
  const [lista, setLista] = useState<AssinanteDoQuadro[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState<null | PapelDoQuadro>(null);
  const [erro, setErro] = useState<null | string>(null);
  /**
   * De qual bloco é a frase de erro, ou `null` quando ela é do cartão inteiro (falha de leitura).
   *
   * ⚠️ ERRO SEM ENDEREÇO É ERRO QUE NINGUÉM LÊ. São quatro blocos empilhados e uma frase só no topo:
   * quem clicou Incluir na caixa dos termos, que é a última, não via a recusa do servidor.
   */
  const [papelDoErro, setPapelDoErro] = useState<null | PapelDoQuadro>(null);
  const [rascunhos, setRascunhos] = useState<Record<string, typeof RASCUNHO>>({});
  const [recarregar, setRecarregar] = useState(0);
  const { temisFetch } = useApiDaTemis();

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const r = await temisFetch(`/assinantes?enterpriseId=${encodeURIComponent(enterpriseId)}`, {
        cache: "no-store",
      });
      const corpo = (await r.json()) as { assinantes?: AssinanteDoQuadro[]; error?: string };
      if (!r.ok) throw new Error(corpo.error ?? "Falha ao ler o quadro.");
      setLista(corpo.assinantes ?? []);
      setErro(null);
      setPapelDoErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao ler o quadro.");
      setPapelDoErro(null);
    } finally {
      setCarregando(false);
    }
  }, [enterpriseId, temisFetch]);

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
    setPapelDoErro(null);
    try {
      const r = await temisFetch("/assinantes", {
        body: JSON.stringify({
          cpf: atual.cpf,
          email: atual.email,
          enterpriseId,
          nome: atual.nome,
          ordemAssinatura: atual.ordemAssinatura,
          papel,
          posicao: atual.posicao || String(proximaPosicao(doPapel(papel))),
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const corpo = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(corpo.error ?? "Falha ao gravar.");
      setRascunhos((x) => ({ ...x, [papel]: RASCUNHO }));
      setRecarregar((n) => n + 1);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao gravar.");
      setPapelDoErro(papel);
    } finally {
      setSalvando(null);
    }
  }

  async function remover(id: string, papel: PapelDoQuadro) {
    setErro(null);
    setPapelDoErro(null);
    try {
      const r = await temisFetch(`/assinantes?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!r.ok) {
        const corpo = (await r.json()) as { error?: string };
        throw new Error(corpo.error ?? "Falha ao remover.");
      }
      setRecarregar((n) => n + 1);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao remover.");
      setPapelDoErro(papel);
    }
  }

  /**
   * Uma seção do quadro: a lista de quem já está lá, e a linha para incluir mais um.
   *
   * ⚠️ UMA FUNÇÃO, E NÃO O CORPO DO `map`, porque a seção dos TERMOS usa exatamente os mesmos campos
   * dos três papéis do contrato. Lucas pediu *"mais um campo"* nesta tela, e um campo novo com outra
   * cara é um campo que o operador aprende de novo. Copiar este JSX faria a cópia envelhecer calada
   * no primeiro ajuste.
   *
   * ⚠️ E O QUE MUDA NOS TERMOS É SÓ O QUE SERIA MENTIRA. "Linha" é qual linha do CONTRATO é da
   * pessoa e "Assina em" é a ordem dentro do papel: o termo de acordo não tem linhas de
   * qualificação e tem fila fixa (comprador, incorporador, Careli). Oferecer os dois campos ali
   * prometeria um controle que o envio ignora.
   */
  function secaoDoBloco(bloco: Bloco) {
    const gente = doPapel(bloco.papel);
    const r = rascunho(bloco.papel);
    const doContrato = bloco.papel !== "termos_vendedora";
    // ⚠️ O QUE A CAIXA MOSTRA NÃO É O QUE ESTÁ GRAVADO NAQUELE PAPEL, e só nos TERMOS. Ver
    // `filaDosTermos`: ali a tela tem de mostrar quem o ENVIO usaria, que pode ser a pessoa do bloco
    // Vendedora. O `gente` continua sendo a lista do papel, porque é ela que numera a próxima linha.
    const dosTermos = filaDosTermos(lista);
    const fila = doContrato ? gente : dosTermos.linhas;
    const origem: OrigemDosTermos = doContrato ? "apontado" : dosTermos.origem;
    // A linha emprestada de outro bloco (ou herdada do cadastro) não se apaga por aqui.
    const emprestada = !doContrato && origem !== "apontado";
    return (
      <section key={bloco.papel}>
        <p className="m-0 font-semibold text-ink text-sm">{bloco.titulo}</p>
        <p className="m-0 mb-1.5 text-ink-muted text-xs">{bloco.ajuda}</p>

        {/* ⚠️ A QUEDA INTEIRA, NA ORDEM DE VERDADE, sempre que ninguém foi apontado. Ver
            `filaDosTermos`: a frase antiga citava dois degraus e o envio tem três. */}
        {doContrato ? null : origem === "apontado" ? null : (
          <p className="m-0 mb-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900 text-xs dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            {origem === "vendedora" ? (
              <>
                Ninguém apontado. Como ninguém foi apontado aqui, quem assina o termo é a pessoa
                cadastrada como vendedora no quadro, mostrada abaixo. Aponte alguém para que o termo
                deixe de ir para quem assina a compra e venda.
              </>
            ) : origem === "cadastro" ? (
              <>
                Ninguém apontado. Como não há ninguém aqui nem no bloco Vendedora, quem assina o
                termo é o representante legal cadastrado na empresa, mostrado abaixo.
              </>
            ) : (
              <>
                Ninguém apontado. Sem ninguém aqui, o termo tenta quem estiver cadastrado como
                vendedora no quadro e, depois, o representante legal da empresa. Como não há nenhum
                dos dois, o envio fica bloqueado.
              </>
            )}
          </p>
        )}

        {fila.length === 0 ? (
          doContrato ? (
            <p className="m-0 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900 text-xs dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
              Ninguém aqui. O contrato vai para assinatura sem este papel, e a linha dele sai vazia
              no papel impresso.
            </p>
          ) : null
        ) : (
          <div className="grid gap-1.5">
            {fila.map((a, indice) => (
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
                {/* ⚠️ "ASSINA OS TERMOS" VALE PARA UMA PESSOA SÓ, E É A PRIMEIRA. O envio leva a de
                    menor posição (`assinanteDeTermosDaVendedora`, `order("posicao").limit(1)`); a
                    caixa não tem campo Linha, então quem quer TROCAR de pessoa inclui a nova e deixa
                    a antiga — e era a antiga que continuava assinando, com as duas etiquetadas
                    igual. */}
                <span className="shrink-0 rounded-md bg-subtle px-1.5 py-0.5 text-[10px] text-ink-muted">
                  {doContrato
                    ? a.ordemAssinatura
                      ? `assina em ${a.ordemAssinatura}`
                      : "segue o papel"
                    : indice === 0
                      ? "assina os termos"
                      : "não assina, remova ou reordene"}
                </span>
                {/* ⚠️ A LINHA HERDADA NÃO SE APAGA AQUI. Ela vem do cadastro da empresa, e
                    um botão de lixeira prometeria desfazer algo que esta tela não decide. */}
                {a.id && !emprestada ? (
                  <button
                    aria-label={`Remover ${a.nome}`}
                    className="rounded-md border border-line p-1 text-ink-muted transition-colors hover:bg-subtle"
                    onClick={() => void remover(a.id as string, bloco.papel)}
                    type="button"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                ) : (
                  <span
                    className="inline-flex items-center gap-1 rounded-md bg-subtle px-1.5 py-1 text-[10px] text-ink-muted"
                    title={
                      origem === "vendedora"
                        ? "Vem do bloco Vendedora deste quadro. Aponte alguém aqui para trocar."
                        : "Vem do representante legal cadastrado na empresa. Para trocar, mude no cadastro dela."
                    }
                  >
                    <Lock className="size-3" />
                    {origem === "vendedora" ? "do bloco Vendedora" : "do cadastro"}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ⚠️ A RECUSA APARECE AO LADO DO BOTÃO QUE FOI CLICADO (revisão de 20/09/2026). A caixa dos
            termos é a ÚLTIMA do cartão, e a frase do servidor ("Informe o e-mail…") era renderizada
            lá em cima: quem clicou Incluir aqui embaixo não via o motivo e clicava de novo. */}
        {erro && papelDoErro === bloco.papel ? (
          <p className="m-0 mt-1.5 font-medium text-rose-600 text-xs dark:text-rose-300">{erro}</p>
        ) : null}

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
          {doContrato ? (
            <>
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
            </>
          ) : null}
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
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="m-0 flex items-center gap-2 font-semibold text-[11px] text-ink-muted uppercase tracking-wide">
        <Users className="size-3.5" />
        {/* ⚠️ "DO EMPREENDIMENTO", E NÃO MAIS "DO CONTRATO" (20/09/2026). O cartão passou a guardar
            também quem assina os TERMOS da carteira, que não é contrato — e a frase de impedimento
            do termo de acordo manda o operador ao "Quadro de assinatura do empreendimento" desde que
            nasceu. Os dois nomes divergindo era o operador procurando uma tela com outro nome. */}
        Quadro de assinatura do empreendimento
      </p>
      <p className="m-0 mt-1 text-ink-muted text-xs">
        Quem assina além do comprador. O comprador e o cônjuge saem da proposta e não se digitam
        aqui.
      </p>

      {/* A frase de um bloco sai DENTRO dele; esta aqui é a do cartão inteiro (falha de leitura). */}
      {erro && papelDoErro === null ? (
        <p className="m-0 mt-2 font-medium text-rose-600 text-xs dark:text-rose-300">{erro}</p>
      ) : null}

      {carregando ? (
        <p className="m-0 mt-3 text-ink-muted text-sm">Lendo…</p>
      ) : (
        <>
          <div className="mt-3 grid gap-4">{BLOCOS.map(secaoDoBloco)}</div>

          {/* ⚠️ CAIXA PRÓPRIA, COM A FRONTEIRA DITA EM PORTUGUÊS. Os três de cima assinam o CONTRATO
              de venda; esta pessoa assina os TERMOS da carteira. Quem mistura as duas coisas põe um
              analista na qualificação de uma compra e venda. */}
          {comAssinantesDeTermos ? (
            <div className="mt-4 rounded-lg border border-line border-dashed bg-subtle/30 p-3">
              <p className="m-0 flex items-center gap-2 font-semibold text-[11px] text-ink-muted uppercase tracking-wide">
                <FileSignature className="size-3.5" />
                Termos da carteira
              </p>
              <p className="m-0 mt-1 mb-2 text-ink-muted text-xs">
                Vale para o termo de acordo e para os próximos termos que a Careli emitir sobre esta
                carteira. <strong>Não entra no contrato de venda</strong>, nem na ordem de assinatura
                dele.
              </p>
              {secaoDoBloco(BLOCO_DOS_TERMOS)}
            </div>
          ) : null}
        </>
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
