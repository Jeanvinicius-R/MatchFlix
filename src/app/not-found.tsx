import Link from "next/link";
import { Logo } from "@/components/layout/Logo";
import { buttonStyles } from "@/components/ui/Button";

export default function NotFound() {
  return (
    <main className="bg-background flex min-h-screen flex-col items-center justify-center gap-6 px-4 text-center">
      <Link href="/" aria-label="MatchFlix — página inicial">
        <Logo />
      </Link>
      <h1 className="font-display text-foreground text-3xl font-semibold sm:text-4xl">
        Página não encontrada
      </h1>
      <p className="text-muted-foreground max-w-sm text-sm">
        O endereço que você abriu não existe ou o título foi removido.
      </p>
      <Link href="/" className={buttonStyles("primary")}>
        Voltar ao início
      </Link>
    </main>
  );
}
