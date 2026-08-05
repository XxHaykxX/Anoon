import { redirect } from "next/navigation";

// Лендинг = очередь жалоб (решение ревью: модератор сразу в triage, не на дашборд).
export default function Home() {
  redirect("/reports");
}
