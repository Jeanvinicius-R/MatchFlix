import Link from "next/link";
import { buttonStyles } from "@/components/ui/Button";

interface MissingVideoNoticeProps {
  noun: "filme" | "série";
  /** Where an admin can link a video; undefined for regular viewers. */
  adminEditHref?: string;
}

/** Shown in place of the player when a title has no video linked yet. */
export function MissingVideoNotice({ noun, adminEditHref }: MissingVideoNoticeProps) {
  return (
    <div className="border-border flex aspect-video w-full flex-col items-center justify-center gap-4 rounded-lg border px-4 text-center">
      <p className="text-foreground text-base font-medium">
        {noun === "filme" ? "Este filme" : "Esta série"} ainda não está disponível para
        assistir.
      </p>
      {adminEditHref ? (
        <>
          <p className="text-muted-foreground max-w-md text-sm">
            Nenhum vídeo foi vinculado. Escolha um arquivo do Internet Archive ou da
            Wikimedia Commons no painel.
          </p>
          <Link href={adminEditHref} className={buttonStyles("primary")}>
            Vincular vídeo
          </Link>
        </>
      ) : (
        <p className="text-muted-foreground text-sm">Volte em breve.</p>
      )}
    </div>
  );
}
