/** Keyboard geometry shared by radios and tabs without coupling their roles. */
export function getRovingIndex(key: string, index: number, count: number, orientation: "horizontal" | "vertical"): number | null {
  if (!count) return null;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === (orientation === "horizontal" ? "ArrowLeft" : "ArrowUp")) return (index - 1 + count) % count;
  if (key === (orientation === "horizontal" ? "ArrowRight" : "ArrowDown")) return (index + 1) % count;
  return null;
}
