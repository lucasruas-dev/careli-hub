// PAINEL DE ASSINATURA — leitura do C2X (read-only) com as regras do modelo do Power BI.
//
// As regras não são invenção nossa: saíram do `Careli - Dashboard Vista Alegre.pbit`, e estão
// documentadas em docs/operations/c2x-painel-assinatura-dax.md. Seguir as MESMAS regras é o que
// faz este painel bater com o que a Careli já usa:
//
//   • só contrato enviado para assinar e não cancelado (`send_document_signature` = 1, status ≠ 6)
//   • "Comprador" é o perfil `Cliente` do C2X, renomeado
//   • quem tem e-mail @careli.adm.br vira "Backoffice", qualquer que seja o perfil real
//   • o prazo do comprador é de 7 dias
//
// ⚠️ CACHE DE 5 MINUTOS, e ele é o ponto todo. Medido em 13/08/2026: chegam ~7 assinaturas por
// hora nas horas úteis, então cada ciclo de 5 min traz meia assinatura nova — atualizar mais
// rápido só gasta. E o cache é por SERVIDOR, não por aba: sem ele, dez pessoas com o painel
// aberto viram 120 consultas/hora no legado, que tem pool de 5 conexões. Com ele são 12,
// independente de quantos estejam olhando. Ver [[project_hermes_cost]], que é o incidente de
// fatura que essa regra evita.
import type { RowDataPacket } from "mysql2";

import { getHadesDbPool } from "@/lib/guardian/db";

/** Vale do Ouro: VOL (Lino) e VOC (Cecílio). O VLO (35) fica fora: é masterplan, não carteira. */
export const VALE_DO_OURO = [36, 37];

/** Dias que o painel do Lucas usa para dizer que o comprador está atrasado. */
const PRAZO_COMPRADOR = 7;

const TTL_MS = 5 * 60 * 1000;

export type LinhaAssinatura = {
  /** "VOC" | "VOL" */
  emp: string;
  /** Código da unidade, como no C2X (`enterprise_unities.name`). */
  un: string;
  quadra: string;
  lote: string;
  valor: number;
  /** Id do envio para a D4Sign. Uma unidade pode ter mais de um. */
  contrato: number;
  /** Data em que o contrato saiu para assinatura (ISO curto). */
  envio: string;
  diasDesdeEnvio: number;
  usuario: string;
  email: string;
  /** Perfil já traduzido: Comprador, Backoffice, Incorporador, Imobiliária, Corretor… */
  perfil: string;
  assinou: boolean;
  assinadoEm: null | string;
  /** Posição na fila de assinatura (`after_position`). O degrau segura os seguintes. */
  degrau: number;
  /** Só para o Comprador: no prazo, fora do prazo, pendente, pendente e em atraso. */
  prazo: null | string;
};

export type PainelAssinatura = {
  atualizadoEm: string;
  linhas: LinhaAssinatura[];
};

type Bruta = RowDataPacket & {
  assinado: null | number;
  block: null | string;
  data_assinatura: null | string;
  dias_envio: number;
  email: null | string;
  emp: string;
  envio: string;
  id_ass: number;
  lot: null | string;
  perfil_c2x: null | string;
  posicao: null | number;
  price: null | number;
  unidade: null | string;
  usuario: null | string;
};

const CONSULTA = `
  select
    e.code as emp,
    coalesce(nullif(trim(u.name), ''), concat(e.code, u.block, u.lot)) as unidade,
    u.block, u.lot, u.price,
    cs.id as id_ass,
    date_format(cs.created_at, '%Y-%m-%d') as envio,
    datediff(now(), cs.created_at) as dias_envio,
    ss.user_name as usuario,
    ss.email,
    pf.name as perfil_c2x,
    ss.signed as assinado,
    date_format(ss.date_signed, '%Y-%m-%d') as data_assinatura,
    ss.after_position as posicao
  from contract_signatures cs
  join acquisition_request_contracts arc on arc.id = cs.acquisition_request_contract_id
  join acquisition_requests ar on ar.id = arc.acquisition_request_id
  join enterprise_unities u on u.id = ar.enterprise_unity_id
  join enterprises e on e.id = u.enterprise_id
  join contract_signature_signers ss on ss.contract_signature_id = cs.id
  left join contract_signers csg on csg.id = ss.contract_signer_id
  left join signers sg on sg.id = csg.signer_id
  left join users usr on usr.id = sg.user_id
  left join profiles pf on pf.id = usr.profile_id
  where u.enterprise_id in (?)
    and cs.send_document_signature = 1
    and cs.contract_signature_status_id <> 6
  order by e.code, u.block, u.lot, ss.after_position, ss.id`;

const limpo = (v: unknown) => String(v ?? "").trim().replace(/\s+/g, " ");

/** O perfil como o painel mostra, na MESMA ordem do modelo: traduz e depois sobrescreve. */
function perfilDeTela(perfilC2x: null | string, email: string): string {
  const base = perfilC2x === "Cliente" ? "Comprador" : (perfilC2x ?? "Sem perfil");
  return email.endsWith("@careli.adm.br") ? "Backoffice" : base;
}

function prazoDoComprador(perfil: string, assinou: boolean, dias: number): null | string {
  if (perfil !== "Comprador") return null;
  if (assinou) return dias <= PRAZO_COMPRADOR ? "Assinado no prazo" : "Assinado fora do prazo";
  return dias <= PRAZO_COMPRADOR ? "Pendente dentro do prazo" : "Pendente e em atraso";
}

const cache = new Map<string, { em: number; dados: PainelAssinatura }>();

export type ResultadoPainel =
  | { dados: PainelAssinatura; ok: true }
  | { erro: string; ok: false };

/**
 * Devolve o painel, do cache quando ele ainda vale.
 *
 * Falha FECHADA de propósito: se o C2X estiver fora e houver cache velho, devolve o velho com o
 * carimbo antigo, e a tela mostra "atualizado às …". Painel que some é pior que painel de cinco
 * minutos atrás — e o carimbo impede que alguém confunda um com o outro.
 */
export async function carregarPainelAssinatura(
  enterpriseIds: number[] = VALE_DO_OURO,
): Promise<ResultadoPainel> {
  const chave = [...enterpriseIds].sort((a, b) => a - b).join(",");
  const guardado = cache.get(chave);
  if (guardado && Date.now() - guardado.em < TTL_MS) {
    return { dados: guardado.dados, ok: true };
  }

  const pool = getHadesDbPool();
  if (!pool.ok) {
    if (guardado) return { dados: guardado.dados, ok: true };
    return { erro: `Configuração do C2X ausente: ${pool.missing.join(", ")}.`, ok: false };
  }

  try {
    const [linhasBrutas] = await pool.pool.query<Bruta[]>(CONSULTA, [enterpriseIds]);

    const linhas: LinhaAssinatura[] = linhasBrutas.map((l) => {
      const email = String(l.email ?? "").trim().toLowerCase();
      const perfil = perfilDeTela(l.perfil_c2x, email);
      const assinou = Number(l.assinado) === 1;
      // Para o prazo: quem assinou conta os dias até assinar; quem não, os dias desde o envio.
      const dias = assinou && l.data_assinatura
        ? Math.max(0, Math.round(
            (new Date(l.data_assinatura).getTime() - new Date(l.envio).getTime()) / 86_400_000))
        : Number(l.dias_envio ?? 0);

      return {
        assinadoEm: l.data_assinatura,
        assinou,
        contrato: Number(l.id_ass),
        degrau: Number(l.posicao ?? 0),
        diasDesdeEnvio: Number(l.dias_envio ?? 0),
        email,
        emp: String(l.emp ?? ""),
        envio: String(l.envio ?? ""),
        lote: limpo(l.lot),
        perfil,
        prazo: prazoDoComprador(perfil, assinou, dias),
        quadra: limpo(l.block),
        un: limpo(l.unidade),
        usuario: limpo(l.usuario),
        valor: Math.round(Number(l.price ?? 0)),
      };
    });

    const dados: PainelAssinatura = { atualizadoEm: new Date().toISOString(), linhas };
    cache.set(chave, { dados, em: Date.now() });
    return { dados, ok: true };
  } catch (error) {
    console.error("[apolo][painel-assinatura] falha ao ler o C2X", error);
    if (guardado) return { dados: guardado.dados, ok: true };
    return { erro: "Não foi possível ler o C2X agora.", ok: false };
  }
}
