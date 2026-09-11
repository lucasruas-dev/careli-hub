"use client";

// O FESTO — o robô que atende no suporte do Panteon.
//
// Lucas (11/09/2026) desenhou este boneco comigo, escolha por escolha: robô em vez de ícone, com
// sorriso, sem o círculo de fundo, animado — *"da um pouco de vida para ele"*.
//
// ⚠️ É SVG, E NÃO UMA IMAGEM. Um PNG de 56px fica borrado em tela retina e precisaria de três
// tamanhos; o desenho vetorial escala sozinho, troca de cor com o tema e não pesa no carregamento.
// O custo é que ele não é foto-realista — e foi o acordo: em 56 pixels, nitidez ganha de textura.
//
// ⚠️ O CASCO TROCA COM O TEMA, e isso não é enfeite: sem o círculo escuro por trás, o robô perde a
// garantia de contraste que o botão dava. Grafite sobre a tela clara, claro sobre a tela escura —
// é o mesmo mecanismo de tokens que o resto do hub usa, e é o que o mantém visível nos dois.
//
// ⚠️ E TUDO PARA COM `prefers-reduced-motion`. Movimento periférico contínuo causa enjoo em parte
// das pessoas, e um robô saltitante no canto da tela o dia inteiro é o caso clássico. Quem tem a
// preferência ligada vê o Festos parado — e ele continua funcionando igual.

import { type TrajeDoFesto, trajeDaData } from "@/components/hub-support/festo-traje";

export type EstadoDoFesto =
  /** Respira e pisca. O padrão. */
  | "repouso"
  /** Um pulo só: alguém chegou perto. */
  | "pulando"
  /** Pula sem parar: tem resposta esperando. */
  | "chamando"
  /** Dá tchauzinho. Para quando ele aparece só cumprimentando, sem nada a resolver. */
  | "acenando";

export function FestoRobo({
  className = "",
  estado = "repouso",
  traje,
}: {
  className?: string;
  estado?: EstadoDoFesto;
  /**
   * O adereco da data. Omitido, ele descobre sozinho pelo calendario de `festo-traje.ts`.
   *
   * ⚠️ A PROP EXISTE PARA PODER FORCAR, e isso importa em dois momentos: testar o desenho fora da
   * data, e desligar o adereco numa tela onde ele nao caiba. Sem ela, so dava para ver a bandeira
   * mexendo no relogio da maquina.
   */
  traje?: TrajeDoFesto;
}) {
  const vestido = traje ?? trajeDaData(new Date());

  return (
    <svg
      aria-hidden="true"
      className={`festo-robo festo-${estado} ${className}`}
      viewBox="0 0 100 100"
    >
      <defs>
        {/*
          ⚠️ OS IDs SÃO FIXOS, E ISSO SÓ FUNCIONA PORQUE AS DEFINIÇÕES SÃO IDÊNTICAS. O Festos aparece
          no botão E no cabeçalho do painel ao mesmo tempo; com ids repetidos, o navegador resolve
          todas as referências na primeira definição da página. Como a cor de cada parada vem do CSS
          (`.festo-casco-1` e companhia), as duas instâncias pintam igual e ninguém percebe.
          ⚠️ No dia em que uma instância precisar de cor PRÓPRIA — um Festos cinza numa tela, colorido
          em outra —, isto quebra em silêncio: a segunda herda a primeira. Aí os ids têm que passar a
          ser únicos por montagem (via `useId`), e não antes.
        */}
        <linearGradient id="festoCasco" x1="0" y1="0" x2="0" y2="1">
          <stop className="festo-casco-1" offset="0" />
          <stop className="festo-casco-2" offset=".5" />
          <stop className="festo-casco-3" offset="1" />
        </linearGradient>
        <linearGradient id="festoLateral" x1="0" y1="0" x2="1" y2="0">
          <stop className="festo-lat-1" offset="0" />
          <stop className="festo-lat-2" offset="1" />
        </linearGradient>
        <radialGradient id="festoOlho" cx=".5" cy=".4" r=".6">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset=".55" stopColor="#7dd3fc" />
          <stop offset="1" stopColor="#0ea5e9" />
        </radialGradient>
      </defs>

      <g className="festo-corpo">
        <g className="festo-antena">
          <rect x="46.6" y="9" width="6.8" height="13" rx="3.4" fill="url(#festoLateral)" />
          <circle cx="50" cy="8" r="5.6" fill="url(#festoCasco)" />
          <circle cx="48.2" cy="6.4" r="1.7" fill="#7dd3fc" opacity=".85" />
        </g>

        <rect x="13" y="30" width="11" height="27" rx="5.5" fill="url(#festoLateral)" />
        <rect x="76" y="30" width="11" height="27" rx="5.5" fill="url(#festoLateral)" />
        <rect x="19" y="20" width="62" height="59" rx="20" fill="url(#festoCasco)" />

        {/* O visor é sempre escuro, nos dois temas: é o que faz os olhos e o sorriso acenderem. */}
        <rect x="27" y="31" width="46" height="33" rx="16" fill="#0b1018" />
        <circle className="festo-olho" cx="39.5" cy="44" r="6.4" fill="url(#festoOlho)" />
        <circle className="festo-olho" cx="60.5" cy="44" r="6.4" fill="url(#festoOlho)" />
        <circle cx="37.6" cy="41.6" r="2" fill="#fff" />
        <circle cx="58.6" cy="41.6" r="2" fill="#fff" />
        <path
          d="M40 54.5a12 12 0 0 0 20 0"
          fill="none"
          stroke="#7dd3fc"
          strokeLinecap="round"
          strokeWidth="3.4"
        />

        <path
          d="M25 25h50a18 18 0 0 1 4 6c-10-4-48-4-58 0a18 18 0 0 1 4-6z"
          className="festo-brilho"
        />

        {/*
          ⚠️ O ADERECO VEM DEPOIS DO ROSTO, e a ordem e a regra: nada que ele veste pode cobrir os
          olhos nem o sorriso. E o rosto que faz as pessoas lerem o Festos como alguem; um chapeu por
          cima dele troca personagem por fantasia.
        */}
        {vestido === "bandeira-brasil" ? (
          <g className="festo-bandeira">
            {/* ⚠️ TUDO DENTRO DO viewBox 0-100: a primeira versão ia até x=111 e a bandeira aparecia
                cortada pela metade, porque SVG não estoura a caixa, ele corta. */}
            <rect x="78" y="12" width="2.4" height="34" rx="1.2" fill="#8b6b45" />
            <g className="festo-bandeira-pano">
              <rect x="80.4" y="13" width="19" height="13" rx="1.4" fill="#009c3b" />
              <path d="M89.9 14.8 97.4 19.5l-7.5 4.7-7.5-4.7z" fill="#ffdf00" />
              <circle cx="89.9" cy="19.5" r="2.6" fill="#002776" />
            </g>
          </g>
        ) : null}

        {/*
          ⚠️ A MÃO SÓ EXISTE QUANDO ELE ACENA. O Festos não tem braços, e dar um par permanente a ele
          mudaria o boneco inteiro — ele deixaria de ser uma cabeça flutuante e passaria a precisar
          de corpo, ombros e proporção. Uma mão que aparece só no cumprimento resolve o gesto sem
          redesenhar o personagem.
        */}
        {estado === "acenando" ? (
          <g className="festo-mao">
            <circle cx="88" cy="52" r="7.6" fill="url(#festoCasco)" />
            <rect x="85.4" y="41" width="2.6" height="7" rx="1.3" fill="url(#festoLateral)" />
            <rect x="89" y="41.6" width="2.6" height="6.4" rx="1.3" fill="url(#festoLateral)" />
            <rect x="92.4" y="43.4" width="2.6" height="5.4" rx="1.3" fill="url(#festoLateral)" />
          </g>
        ) : null}

        {vestido === "gorro-natal" ? (
          <g>
            <path d="M22 22c6-13 22-19 32-15 10 4 13 10 14 15-14-6-32-6-46 0z" fill="#c24135" />
            <rect x="20" y="19" width="60" height="7" rx="3.5" fill="#fff" />
            <circle cx="72" cy="9" r="5" fill="#fff" />
          </g>
        ) : null}
      </g>
    </svg>
  );
}
