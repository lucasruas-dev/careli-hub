// DISPARO EM LOTE do aviso de etapa para o COORDENADOR de um empreendimento.
//
// Pedido do Lucas (21/08/2026): *"quando subir, dispara por favor todas as mensagens do villa
// paris para o coordenador"*. Ele escolheu, depois de eu levantar o risco, mandar **todas, uma a
// uma** — e não um resumo agrupado.
//
//   npx tsx --tsconfig apps/hub/tsconfig.json apps/hub/scripts/apolo/avisar-coordenador-empreendimento.ts 38
//   npx tsx ... 38 --gravar        <- só então envia de verdade
//
// ⚠️ SEM `--gravar` NÃO MANDA NADA. Este script escreve no WhatsApp de uma pessoa real: o padrão
// é ensaiar e imprimir o que sairia, porque um lote disparado por engano não tem desfazer.
//
// ⚠️ ENVIAR DE VERDADE É PELA ROTA, NÃO POR AQUI: `POST /api/apolo/esteira/avisar-lote`.
// As credenciais do gateway do Relacionamento (`EVOLUTION_API_*`) só existem no ambiente da
// Vercel — rodando `--gravar` de uma máquina de desenvolvimento, TODA mensagem falha com
// "Gateway Evolution nao configurado" (medido em 21/08, com uma mensagem, antes de soltar o
// lote inteiro). Este script continua útil para o ENSAIO: ele lê a esteira e mostra quantas CADs
// sairiam, em que ordem e em que etapa, sem depender do gateway.
//
// ⚠️ REUSA `avisarEtapa`, não reescreve as mensagens. Um script com texto próprio divergiria do
// produto na primeira alteração, e aí o coordenador receberia do backfill uma frase que o sistema
// nunca manda.
//
// ⚠️ INTERVALO ENTRE ENVIOS. São dezenas de mensagens para o MESMO número, pelo celular do
// Relacionamento (Evolution, não a API oficial). Em rajada isso é o padrão que marca conta como
// spam — e o número é o mesmo que fala com corretor e imobiliária o dia inteiro.
import fs from "node:fs";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

import { avisarEtapa, etapaTemAviso } from "@/lib/apolo/esteira-avisos";

const PAUSA_MS = 4000;

// Ordem de envio: o que está PARADO primeiro. Quem lê 44 mensagens seguidas lê as primeiras com
// atenção e as últimas na diagonal — então as que pedem ação chegam antes das que são histórico.
const PRIORIDADE: Record<string, number> = {
  correcao: 0,
  revisao: 1,
  validacao: 2,
  credito: 3,
  prevenda: 4,
  credenciado: 5,
  indeferido: 6,
};

function carregarEnv(): void {
  const arquivo = path.join(process.cwd(), "apps", "hub", ".env.local");
  const alternativo = path.join(process.cwd(), ".env.local");
  const caminho = fs.existsSync(arquivo) ? arquivo : alternativo;

  for (const linha of fs.readFileSync(caminho, "utf8").split(/\r?\n/)) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(linha.trim());
    if (m && process.env[m[1]!] === undefined) {
      process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
    }
  }
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  carregarEnv();

  const enterpriseId = process.argv[2];
  const gravar = process.argv.includes("--gravar");
  // `--limite N` manda só as N primeiras. Serve para PROVAR o caminho com uma mensagem antes de
  // soltar o lote inteiro: se o coordenador não recebe a primeira, as outras 43 também não vão
  // chegar, e aí é melhor descobrir com uma.
  const limiteArg = process.argv.find((a) => a.startsWith("--limite="));
  const limite = limiteArg ? Number(limiteArg.split("=")[1]) : null;
  // `--pular=N` retoma o lote de onde parou, sem repetir quem já recebeu. É o par do `--limite`:
  // manda-se uma para provar o caminho e depois o resto, sem mandar a primeira duas vezes.
  const pularArg = process.argv.find((a) => a.startsWith("--pular="));
  const pular = pularArg ? Number(pularArg.split("=")[1]) : 0;

  if (!enterpriseId || !/^\d+$/.test(enterpriseId)) {
    console.error("Uso: ... avisar-coordenador-empreendimento.ts <enterpriseId> [--gravar]");
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }

  const client = createClient(url, key, { auth: { persistSession: false } });

  const { data, error } = await client
    .from("apolo_esteira")
    .select("entity_id, etapa, empreendimento, corretor, imobiliaria")
    .eq("enterprise_id", enterpriseId);

  if (error) {
    console.error("Falha ao ler a esteira:", error.message);
    process.exit(1);
  }

  const linhas = (data ?? []) as {
    corretor: null | string;
    empreendimento: null | string;
    entity_id: string;
    etapa: string;
    imobiliaria: null | string;
  }[];

  const ordenadas = linhas
    .filter((l) => etapaTemAviso(l.etapa))
    .sort(
      (a, b) =>
        (PRIORIDADE[a.etapa] ?? 9) - (PRIORIDADE[b.etapa] ?? 9) ||
        a.entity_id.localeCompare(b.entity_id),
    );
  const inicio = Number.isFinite(pular) && pular > 0 ? pular : 0;
  const restantes = ordenadas.slice(inicio);
  const alvo =
    limite && Number.isFinite(limite) && limite > 0 ? restantes.slice(0, limite) : restantes;

  const porEtapa = alvo.reduce<Record<string, number>>((acc, l) => {
    acc[l.etapa] = (acc[l.etapa] ?? 0) + 1;
    return acc;
  }, {});

  console.log(
    `Empreendimento ${enterpriseId} — ${alvo.length} CADs com aviso de etapa` +
      (alvo.length !== ordenadas.length ? ` (de ${ordenadas.length}, cortado por --limite)` : ""),
  );
  console.log(porEtapa);
  console.log(
    gravar
      ? `ENVIANDO de verdade, com ${PAUSA_MS / 1000}s entre mensagens (~${Math.ceil((alvo.length * PAUSA_MS) / 60000)} min).`
      : "ENSAIO (sem --gravar): nada será enviado.",
  );

  if (!gravar) {
    for (const l of alvo) console.log(`  [${l.etapa}] ${l.entity_id}`);
    return;
  }

  let enviados = 0;
  let falhas = 0;

  for (const [i, l] of alvo.entries()) {
    const r = await avisarEtapa(client as never, {
      // Só o coordenador: o corretor recebe pelo fluxo normal, daqui para a frente. Este lote é
      // para pôr o coordenador em dia com o que já estava na esteira.
      apenas: "coordenador",
      enterpriseId,
      entityId: l.entity_id,
      etapa: l.etapa,
      // A etapa não mudou agora — é justamente um backfill do que já está gravado.
      forcar: true,
      origem: "board",
    });

    const ok = r?.coordenador.ok ?? false;
    if (ok) enviados += 1;
    else falhas += 1;

    console.log(
      `${i + 1}/${alvo.length} [${l.etapa}] ${ok ? "enviado" : `FALHOU: ${r?.coordenador.erro ?? "sem retorno"}`}`,
    );

    if (i < alvo.length - 1) await dormir(PAUSA_MS);
  }

  console.log(`\nFim: ${enviados} enviados, ${falhas} falhas.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
