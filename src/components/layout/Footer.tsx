import Link from "next/link";

/**
 * General site footer. The TMDB attribution itself lives on /about —
 * the TMDB API Terms of Use require it inside an "About"/"Credits" type
 * section, not just anywhere "prominent" — this only links there.
 */
export function Footer() {
  return (
    <footer className="border-border/60 mt-auto border-t px-4 py-6 sm:px-8">
      <div className="text-muted-foreground mx-auto flex max-w-[1600px] justify-center text-center text-xs">
        <Link href="/about" className="hover:text-foreground transition-colors">
          Sobre / Créditos
        </Link>
      </div>
    </footer>
  );
}
