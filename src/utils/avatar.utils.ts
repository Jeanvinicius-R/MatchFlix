const AVATAR_GRADIENTS = [
  "from-amber-700 via-amber-900 to-black",
  "from-teal-700 via-teal-900 to-black",
  "from-rose-700 via-rose-900 to-black",
  "from-indigo-700 via-indigo-900 to-black",
  "from-emerald-700 via-emerald-900 to-black",
] as const;

export function getAvatarGradientClass(seed: string): string {
  const hash = Array.from(seed).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return AVATAR_GRADIENTS[hash % AVATAR_GRADIENTS.length];
}

export function getInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}
