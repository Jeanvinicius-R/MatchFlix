const AVATAR_GRADIENTS = [
  "from-green-600 via-green-900 to-black",
  "from-emerald-600 via-emerald-900 to-black",
  "from-lime-600 via-lime-900 to-black",
  "from-teal-600 via-teal-900 to-black",
  "from-neutral-600 via-neutral-800 to-black",
] as const;

export function getAvatarGradientClass(seed: string): string {
  const hash = Array.from(seed).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return AVATAR_GRADIENTS[hash % AVATAR_GRADIENTS.length];
}

export function getInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}
