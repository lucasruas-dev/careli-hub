"use client";

import { Hammer, Loader2, LogOut } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
  fetchOperadorEu,
  logoutOperador,
  sairDaMesaRemoto,
} from "../../data/prometeu-operations";
import { AtendenteView } from "../atendente/atendente-view";
import { CheckinView } from "../checkin/checkin-view";
import { GestaoMobile } from "../gestao/gestao-mobile";
import { LoginOperador } from "./login-operador";
import {
  PROMETEU_PAPEIS,
  PROMETEU_ZONAS,
  type PrometeuOperadorEu,
} from "@/lib/prometeu/types";

// O operador logado (nunca null aqui dentro do posto).
type OperadorLogado = NonNullable<PrometeuOperadorEu>;

function papelLabel(perfil: OperadorLogado["perfil"]): string {
  return PROMETEU_PAPEIS.find((p) => p.id === perfil)?.label ?? perfil;
}

function zonaLabel(zona: OperadorLogado["zona"]): string {
  return PROMETEU_ZONAS.find((z) => z.id === zona)?.label ?? zona;
}

// RAIZ da área do evento. No mount pergunta "quem sou eu" (cookie de sessão do operador):
//   - carregando  -> spinner;
//   - sem sessão  -> tela de login do operador;
//   - com sessão  -> header escuro (nome + posto + Sair) e a tela do posto conforme o perfil.
// Organizador cai no CheckinView (câmera + fila). Atendente/Gestor veem um placeholder — essas
// telas são a próxima fase.
export function EventoApp() {
  const [carregando, setCarregando] = useState(true);
  const [eu, setEu] = useState<OperadorLogado | null>(null);
  const [saindo, setSaindo] = useState(false);

  const recarregar = useCallback(async () => {
    setCarregando(true);
    const { data } = await fetchOperadorEu();
    setEu(data ?? null);
    setCarregando(false);
  }, []);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  const sair = useCallback(async () => {
    if (saindo) return;
    setSaindo(true);

    // SOLTA A MESA AO SAIR. O atendente guarda a mesa no navegador pra não reescolher a cada
    // recarga — mas no dia o aparelho roda entre pessoas (troca de turno, alguém cobre o intervalo).
    // Sem limpar, o próximo a logar caía direto na mesa do anterior, e a mesa continuava marcada
    // como ocupada no Mapa do salão mesmo sem ninguém sentado nela.
    try {
      const mesaGuardada = window.localStorage.getItem("prometeu:mesa-do-atendente");
      if (mesaGuardada) {
        await sairDaMesaRemoto({ mesaId: mesaGuardada });
        window.localStorage.removeItem("prometeu:mesa-do-atendente");
      }
      window.localStorage.removeItem("prometeu:inicio-do-atendimento");
    } catch {
      /* best-effort: sair do sistema é o que não pode falhar */
    }

    await logoutOperador();
    setSaindo(false);
    await recarregar();
  }, [recarregar, saindo]);

  if (carregando) {
    return (
      <div className="grid h-[100dvh] w-full place-items-center bg-[#0b1017] text-white">
        <Loader2 aria-hidden="true" className="size-6 animate-spin text-white/70" />
      </div>
    );
  }

  if (!eu) {
    return <LoginOperador aoEntrar={() => void recarregar()} />;
  }

  return (
    <div className="flex h-[100dvh] w-full flex-col bg-[#0b1017] text-white">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="min-w-0">
          <p className="m-0 truncate text-sm font-bold">{eu.nome}</p>
          <p className="m-0 truncate text-[11px] text-white/60">
            {/* Gestor não tem posto: acompanha a operação inteira. Mostrar uma zona aqui só
                confundiria quem lê o header ("por que o gestor está na recepção?"). */}
            {papelLabel(eu.perfil)}
            {eu.perfil === "gestor" ? "" : ` · ${zonaLabel(eu.zona)}`}
          </p>
        </div>
        <button
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-white/15 px-3 text-[13px] font-semibold text-white/80 transition disabled:opacity-50"
          disabled={saindo}
          onClick={() => void sair()}
          type="button"
        >
          {saindo ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <LogOut aria-hidden="true" className="size-4" />
          )}
          Sair
        </button>
      </header>

      {/* A TELA DO POSTO, pelo perfil. As três já existiam prontas dentro do hub; aqui elas
          passam a abrir também para quem entra com o login PRÓPRIO do evento (o freela não tem
          conta do hub). As três se viram sozinhas: leem o operador do cookie e descobrem o
          evento ativo. O atendente escolhe a mesa na primeira tela dele. */}
      <div className="min-h-0 flex-1 overflow-auto">
        {eu.perfil === "organizador" ? (
          // O POSTO vem da ZONA do operador. Sem isto, todo organizador caía no modo RECEPÇÃO
          // (o default da tela), mesmo cadastrado no salão ou na secretaria — foi o que jogou o
          // organizador do salão na tela de check-in no dia do evento (Lucas, 01/08).
          <CheckinView
            posto={
              eu.zona === "salao" || eu.zona === "secretaria" ? eu.zona : "recepcao"
            }
          />
        ) : eu.perfil === "atendente" ? (
          <AtendenteView />
        ) : eu.perfil === "gestor" ? (
          // A Gestão nasceu para o celular (é a mesma do /m). No PC, sem um teto de largura, os
          // cards esticam pela tela inteira e a leitura se perde — então centralizamos numa coluna
          // confortável. No celular o max-w não tem efeito.
          <div className="mx-auto h-full w-full max-w-2xl">
            <GestaoMobile />
          </div>
        ) : (
          <PostoEmConstrucao
            nome={eu.nome}
            perfil={papelLabel(eu.perfil)}
            zona={zonaLabel(eu.zona)}
          />
        )}
      </div>
    </div>
  );
}

// Placeholder para atendente/gestor: o posto já existe no cadastro, a tela de operação chega
// depois. Mostra o nome e o posto para confirmar que o login caiu no lugar certo.
function PostoEmConstrucao({
  nome,
  perfil,
  zona,
}: {
  nome: string;
  perfil: string;
  zona: string;
}) {
  return (
    <div className="grid h-full place-items-center px-6 text-center">
      <div className="max-w-xs">
        <div className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-white/10">
          <Hammer aria-hidden="true" className="size-5 text-white/70" />
        </div>
        <p className="m-0 text-base font-bold text-white">
          Tela do {perfil.toLowerCase()} em construção
        </p>
        <p className="m-0 mt-1 text-sm text-white/60">
          {nome} · {perfil} · {zona}
        </p>
        <p className="m-0 mt-3 text-xs text-white/40">
          Seu posto já está configurado. A tela de operação chega na próxima fase.
        </p>
      </div>
    </div>
  );
}
