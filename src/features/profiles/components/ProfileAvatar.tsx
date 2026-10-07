import { cn } from "@/lib/utils";
import { getAvatarGradientClass, getInitial } from "@/utils/avatar.utils";

interface ProfileAvatarProps {
  name: string;
  isKids?: boolean;
  /** Uploaded avatar; falls back to the initial on a gradient. */
  imageUrl?: string | null;
  size?: "md" | "lg";
}

const SIZE_CLASSES: Record<NonNullable<ProfileAvatarProps["size"]>, string> = {
  md: "h-9 w-9 text-sm",
  lg: "h-24 w-24 text-3xl sm:h-28 sm:w-28",
};

export function ProfileAvatar({
  name,
  isKids = false,
  imageUrl = null,
  size = "lg",
}: ProfileAvatarProps) {
  return (
    <div
      className={cn(
        "font-display ring-tint/10 relative flex items-center justify-center rounded-full bg-gradient-to-br font-semibold text-white ring-1",
        getAvatarGradientClass(name),
        SIZE_CLASSES[size],
      )}
    >
      {imageUrl ? (
        // Served by /api/media (LOCAL storage) — not worth next/image config for an avatar.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt="" className="h-full w-full rounded-full object-cover" />
      ) : (
        getInitial(name)
      )}
      {isKids && (
        <span className="bg-accent text-accent-foreground absolute -bottom-2 rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap">
          Infantil
        </span>
      )}
    </div>
  );
}
