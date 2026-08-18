// DIVERGÊNCIAS C2X × D4SIGN — o registro de toda vez que o legado discordou da fonte.
//
// Por que isto existe mesmo sem tela: o `contract_signatures` do C2X tem 1.470 linhas "Em aberto"
// e `create_webhook = 0` em 100% delas — ou seja, a D4Sign avisa e ninguém escuta. Trocar a
// leitura para a D4Sign resolve a TELA e esconde o problema do BANCO: o C2X continua errado, e
// todo mundo para de perceber. Este registro é o que dá ao time o número para cobrar o webhook:
// "hoje a tela corrigiu N assinaturas que o C2X não sabia que existiam".
//
// ⚠️ NADA DE PESSOA AQUI. A divergência guarda o `csId` (chave do envio no C2X), o uuid do
// documento, o degrau e o perfil — o suficiente para achar a linha no banco. Nome, e-mail e CPF
// NÃO entram: quem for cobrar o webhook precisa do contrato, não do cidadão. A referência de
// assinante, quando precisa existir, é a `key_signer` da D4Sign, que é um id opaco.
export type TipoDeDivergencia =
  /** O C2X diz que a pessoa não assinou e a D4Sign diz que assinou. É O BURACO DO WEBHOOK. */
  | "assinatura-nao-registrada"
  /** O C2X diz que assinou e a D4Sign diz que não. Raro e grave: o legado inventou assinatura. */
  | "assinatura-fantasma"
  /** As duas dizem que assinou, em datas diferentes. */
  | "data-divergente"
  /** O uuid está no C2X e a D4Sign não conhece o documento. */
  | "documento-ausente-no-d4sign"
  /**
   * O casamento do assinante foi ADIVINHADO por posição (sobrou exatamente um de cada lado, e o
   * e-mail e o nome não bateram). É um palpite bem fundamentado, não um fato: registrar torna o
   * palpite CONTÁVEL — sem isso, um pareamento errado diria "Fulano assinou" sobre quem não
   * assinou, em silêncio absoluto.
   */
  | "pareado-por-posicao"
  /** Assinante que só o C2X conhece: a D4Sign não tem ninguém que case com ele. */
  | "signatario-so-no-c2x"
  /** Assinante que só a D4Sign conhece. */
  | "signatario-so-no-d4sign"
  /** O status do documento difere: ex. D4Sign "Finalizado" (4) × C2X "Em aberto" (7). */
  | "status-do-documento";

export type Divergencia = {
  /** `contract_signatures.id` — por onde o time acha a linha no legado. */
  csId: number;
  /** O que o C2X afirma, já em texto curto. Nulo quando o C2X não afirma nada. */
  c2x: null | string;
  /** O que a D4Sign afirma. Nulo quando ela não afirma nada. */
  d4sign: null | string;
  /** Degrau (`after_position`) da linha, quando a divergência é de uma linha específica. */
  degrau: null | number;
  /** Perfil traduzido da linha (Comprador, Imobiliária…). Rótulo de grupo, não identifica pessoa. */
  perfil: null | string;
  /** `key_signer` da D4Sign: id opaco, referência sem expor pessoa. */
  referencia: null | string;
  tipo: TipoDeDivergencia;
  uuidDoc: null | string;
};

/** Quantas divergências o processo guarda. Anel: a mais nova empurra a mais velha para fora. */
const TETO_DO_ANEL = 500;

const anel: (Divergencia & { em: string })[] = [];
const contagem = new Map<TipoDeDivergencia, number>();
let total = 0;
let desde = new Date().toISOString();

/**
 * Registra as divergências de uma carga.
 *
 * Guarda em memória do processo (some no deploy, e tudo bem: o número que interessa é de ordem de
 * grandeza, não contábil) e loga uma linha AGREGADA por carga, não uma por divergência — uma tela
 * do Vale do Ouro pode achar centenas, e 400 linhas de log por carga é ruído que ninguém lê.
 */
export function registrarDivergencias(divergencias: Divergencia[]): void {
  if (divergencias.length === 0) return;

  const porTipo = new Map<TipoDeDivergencia, number>();
  for (const divergencia of divergencias) {
    total += 1;
    contagem.set(divergencia.tipo, (contagem.get(divergencia.tipo) ?? 0) + 1);
    porTipo.set(divergencia.tipo, (porTipo.get(divergencia.tipo) ?? 0) + 1);
    anel.push({ ...divergencia, em: new Date().toISOString() });
  }

  while (anel.length > TETO_DO_ANEL) anel.shift();

  console.warn(
    "[apolo][d4sign][divergencia] o C2X discordou da D4Sign nesta carga:",
    JSON.stringify(Object.fromEntries(porTipo)),
  );
}

export type ResumoDeDivergencias = {
  /** As últimas divergências, da mais nova para a mais velha. Sem dado de pessoa. */
  amostra: (Divergencia & { em: string })[];
  /** Desde quando o processo está contando (ele zera a cada deploy). */
  contandoDesde: string;
  porTipo: Record<string, number>;
  total: number;
};

/** O que a rota de diagnóstico devolve. */
export function lerDivergencias(limiteDaAmostra = 50): ResumoDeDivergencias {
  return {
    amostra: anel.slice(-limiteDaAmostra).reverse(),
    contandoDesde: desde,
    porTipo: Object.fromEntries(contagem),
    total,
  };
}

/** Zera o registro. Existe para os testes. */
export function limparDivergencias(): void {
  anel.length = 0;
  contagem.clear();
  total = 0;
  desde = new Date().toISOString();
}
