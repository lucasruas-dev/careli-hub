import { createApoloAdminClient } from "@/lib/apolo/server";

// LOG DE ERROS DO CADASTRO PÚBLICO.
//
// Pedido do Lucas (17/08/2026): "queria registrar os erros de input de CAD. Uma imobiliária tentou
// subir a CAD e deu erro, teria como ter essa visão? Tinha que pegar desde o início, quando informa
// o CPF, imobiliária."
//
// ⚠️ POR QUE ISSO EXISTE: hoje a recusa vira mensagem na tela e ACABA ALI. O corretor tenta de
// novo, desiste ou liga para a central, e do nosso lado não sobra rastro — só o log da Vercel, que
// expira e ninguém consulta. Quem tentou e não conseguiu é lead perdido que ninguém sabe que
// existiu. E foi assim que três fluxos de disparo à imobiliária ficaram 100% quebrados por semanas
// sem ninguém notar.
//
// ONDE ENTRA: no `responder()` de rotas.ts, por onde passam TODAS as 14 rotas públicas —
// checar-cpf, corretor, creci, sessao, imobiliaria, empreendimentos, ocr, upload-url, salvar,
// assistente e as de credenciamento. Um ponto só, em vez dos 85 `return erro(...)` espalhados.
//
// ⚠️ SÓ ERRO, NUNCA SUCESSO. O sucesso já está registrado: é a própria CAD que aparece na fila de
// Validação do Board (observação do Lucas). Duplicar isso seria tabela crescendo à toa.
//
// ⚠️ NÃO GUARDA DADO DO CLIENTE. Guarda quem TENTOU (corretor e imobiliária, que são parceiros
// nossos) e o que barrou. O CPF entra mascarado: serve para achar quem travou sem virar uma base
// de CPF paralela.

/** O que a rota sabe sobre quem estava tentando. Tudo opcional: nas primeiras telas não sabemos. */
export type ContextoDaTentativa = {
  corretorCpf?: null | string;
  corretorNome?: null | string;
  empreendimentoId?: null | string;
  empreendimentoNome?: null | string;
  imobiliariaCnpj?: null | string;
  imobiliariaEntityId?: null | string;
  imobiliariaNome?: null | string;
  /**
   * Motivo CANÔNICO para o log, quando a mensagem devolvida ao público NÃO pode ser gravada.
   *
   * ⚠️ EXISTE POR CAUSA DE UM VAZAMENTO REAL. Algumas recusas montam a mensagem com dado de
   * TERCEIRO: o conflito de núcleo familiar diz "o CPF do cônjuge do JOÃO DA SILVA já possui CAD
   * para o Vale do Ouro", e o conflito de vínculo diz em que imobiliária o corretor já está. Gravar
   * essa frase colocaria nome de cliente e carteira de concorrente numa tabela que foi especificada
   * como "sem dado do cliente" — e ainda por cima no card "o que mais barrou", que agrupa pela
   * string inteira e viraria uma lista de nomes de compradores.
   *
   * Quando a mensagem vem de uma CAMADA DE NEGÓCIO (variável, não literal no arquivo da rota),
   * passe o motivo aqui. O público continua vendo o texto completo; o log guarda só a categoria.
   */
  motivo?: null | string;
};

// ---------------------------------------------------------------------------
// Quem estava tentando: anotado UMA VEZ por requisição, lido no `responder()`
// ---------------------------------------------------------------------------
//
// ⚠️ POR QUE UM MAPA E NÃO UM PARÂMETRO EM CADA CHAMADA: são 85 `return responder(...)` nas 14
// rotas. Passar o contexto em cada um é 85 pontos onde dá para esquecer — e o que fica esquecido é
// justamente a linha que responde a pergunta do Lucas ("QUEM travou"). Pior: o esquecimento é
// silencioso, a tela mostra "—" e ninguém sabe se é falta de dado ou falta de código.
//
// Aqui a rota anota assim que DESCOBRE quem é (a sessão no topo, o CPF depois de ler o corpo), e
// toda saída ≥400 daquela requisição já sai carimbada. Anotar de novo ACUMULA, não substitui: o
// que se sabia antes não se perde quando o passo seguinte falha.
//
// WeakMap com o próprio Request como chave: a entrada morre junto com a requisição, sem estado
// global vazando entre uma chamada e outra (o erro clássico de guardar isso num módulo).
const contextos = new WeakMap<Request, ContextoDaTentativa>();

/** Acumula o que a rota já sabe sobre quem está tentando. Campos vazios não apagam o que havia. */
export function anotarContexto(request: Request, novo: ContextoDaTentativa): void {
  const atual = contextos.get(request) ?? {};
  const juntos: ContextoDaTentativa = { ...atual };

  for (const [chave, valor] of Object.entries(novo) as [keyof ContextoDaTentativa, unknown][]) {
    // `|| ` e não `??`: string vazia é "não sei", igual a ausente. Um `?? ` deixaria o "" do passo
    // seguinte apagar o nome que o passo anterior já tinha descoberto.
    const limpo = String(valor ?? "").trim();
    if (limpo) juntos[chave] = limpo;
  }

  contextos.set(request, juntos);
}

export function contextoDoRequest(request: Request): ContextoDaTentativa | undefined {
  return contextos.get(request);
}

/**
 * Mascara documento preservando o suficiente para RECONHECER quem é, sem guardar o número.
 * "12345678901" -> "123.***.***-**"
 *
 * ⚠️ OS DÍGITOS VERIFICADORES SAEM. A máscara anterior guardava o 9º dígito e os dois DVs
 * ("123.***.**9-01"), e isso torna o CPF RECONSTRUÍVEL: sobram 5 dígitos desconhecidos, e os DVs
 * são calculados dos 9 primeiros — então validar os candidatos derruba o espaço de 100 mil para
 * um punhado. Guardar isso numa tabela seria manter uma base de CPF disfarçada de máscara.
 *
 * Os 3 primeiros bastam para o uso real: o operador cruza com o CPF que a imobiliária informou
 * por telefone e confirma que é a mesma pessoa. Para "esta origem tentou 5 vezes" já existe o
 * `origem_hash`.
 */
function mascarar(documento: null | string | undefined): null | string {
  const digitos = String(documento ?? "").replace(/\D/g, "");
  if (digitos.length < 8) return null;

  return digitos.length === 14
    ? `${digitos.slice(0, 2)}.${digitos.slice(2, 5)}.***/****-**`
    : `${digitos.slice(0, 3)}.***.***-**`;
}

/**
 * `imobiliaria_entity_id` é uma coluna `uuid`.
 *
 * ⚠️ UM ID FORA DE FORMATO DERRUBA A LINHA INTEIRA, não só o campo: o Postgres recusa o insert, o
 * `catch` engole, e a tentativa desaparece do log — justo a que tinha mais contexto. Melhor gravar
 * a linha sem o id do que perder o registro por causa dele.
 */
function comoUuid(v: null | string | undefined): null | string {
  const limpo = String(v ?? "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(limpo)
    ? limpo
    : null;
}

/** Corta texto longo: `user_agent` e mensagem de erro não podem inchar a linha. */
function curto(v: null | string | undefined, max: number): null | string {
  const limpo = String(v ?? "").trim();
  if (!limpo) return null;
  return limpo.length > max ? `${limpo.slice(0, max)}…` : limpo;
}

/**
 * Registra UMA tentativa recusada.
 *
 * ⚠️ NUNCA DERRUBA A REQUISIÇÃO. É observabilidade: se o log falhar, o corretor não pode receber um
 * erro a mais por causa disso. Toda falha aqui é engolida de propósito — o oposto da regra que vale
 * para escrita de negócio.
 */
export async function registrarErroPublico(input: {
  contexto?: ContextoDaTentativa;
  duracaoMs?: null | number;
  mensagem?: null | string;
  origemHash?: null | string;
  request: Request;
  status: number;
}): Promise<void> {
  try {
    const adminClient = createApoloAdminClient();
    if (!adminClient) return;

    const url = new URL(input.request.url);
    const ctx = input.contexto ?? {};

    const { error } = await adminClient.from("apolo_cad_log_erros").insert({
      corretor_cpf_mascarado: mascarar(ctx.corretorCpf),
      corretor_nome: curto(ctx.corretorNome, 160),
      duracao_ms: input.duracaoMs ?? null,
      enterprise_id: curto(ctx.empreendimentoId, 60),
      enterprise_nome: curto(ctx.empreendimentoNome, 160),
      imobiliaria_cnpj_mascarado: mascarar(ctx.imobiliariaCnpj),
      imobiliaria_entity_id: comoUuid(ctx.imobiliariaEntityId),
      imobiliaria_nome: curto(ctx.imobiliariaNome, 160),
      mensagem: curto(input.mensagem, 400),
      metodo: input.request.method ?? "POST",
      origem_hash: curto(input.origemHash, 80),
      // `pathname` e não a URL inteira: a query pode levar dado do formulário para o log.
      rota: url.pathname,
      status: input.status,
      user_agent: curto(input.request.headers.get("user-agent"), 300),
    });

    // ⚠️ ENGOLIR SEM RASTRO SERIA O PIOR DOS DOIS MUNDOS. A requisição do corretor não pode cair
    // por causa do log — isso continua valendo —, mas uma tabela que parou de aceitar linha ficaria
    // INDISTINGUÍVEL de "não houve recusa nenhuma": a tela mostraria zero e alguém concluiria que o
    // cadastro público está saudável. O console vai para o log da Vercel, onde dá para investigar.
    if (error) {
      console.error("[publico][log-erros] insert recusado", {
        code: error.code,
        message: error.message,
        rota: url.pathname,
      });
    }
  } catch (e) {
    console.error("[publico][log-erros] falha ao registrar", e);
  }
}
