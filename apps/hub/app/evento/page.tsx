import { EventoApp } from "@/modules/prometeu/blocks/evento/evento-app";

// Entrada da área do operador do evento. Toda a lógica (login do operador, posto, logout) vive no
// EventoApp (client), que decide entre a tela de login e o posto conforme a sessão do operador.
export const dynamic = "force-dynamic";

export default function EventoPage() {
  return <EventoApp />;
}
