/** Canvas and DOM legend share the same domain colors, independent of theme.
 * Ownership also has a diamond; selection has a dashed outline. */
export const MAP_PLOT_MARKERS = {
  owned: { color: "#1d4ed8", tint: "rgba(29, 78, 216, 0.24)", symbol: "◆" },
  selected: { color: "#b45309", dash: [5, 3] },
} as const;

export function drawMapPlotMarkers(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  owned: boolean,
  selected: boolean,
) {
  if (!owned && !selected) return;
  ctx.save();
  if (owned) {
    ctx.fillStyle = MAP_PLOT_MARKERS.owned.tint;
    ctx.fillRect(x - size / 2, y - size / 2, size, size);
    ctx.strokeStyle = MAP_PLOT_MARKERS.owned.color;
    ctx.lineWidth = Math.min(2, size / 6);
    ctx.strokeRect(x - size / 2, y - size / 2, size, size);
    const radius = Math.max(1.5, Math.min(6, size * 0.15));
    ctx.beginPath();
    ctx.moveTo(x, y - radius);
    ctx.lineTo(x + radius, y);
    ctx.lineTo(x, y + radius);
    ctx.lineTo(x - radius, y);
    ctx.closePath();
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.strokeStyle = MAP_PLOT_MARKERS.owned.color;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  if (selected) {
    // A white backing keeps the dashed selection legible over any sprite.
    const inset = Math.min(3, size / 5);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = Math.min(5, size / 3);
    ctx.strokeRect(
      x - size / 2 + inset,
      y - size / 2 + inset,
      size - inset * 2,
      size - inset * 2,
    );
    ctx.strokeStyle = MAP_PLOT_MARKERS.selected.color;
    ctx.lineWidth = Math.min(3, size / 5);
    ctx.setLineDash([...MAP_PLOT_MARKERS.selected.dash]);
    ctx.strokeRect(
      x - size / 2 + inset,
      y - size / 2 + inset,
      size - inset * 2,
      size - inset * 2,
    );
  }
  ctx.restore();
}
