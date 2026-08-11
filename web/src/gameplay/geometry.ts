export type ExactPoint = Readonly<{ x: bigint; y: bigint }>;

/** Exact intersection for the half-open motion interval `(start, end]`. */
export function sweptSegmentIntersectsCircle(
  start: ExactPoint,
  end: ExactPoint,
  center: ExactPoint,
  radius: bigint,
): boolean {
  if (radius < 0n) throw new RangeError("circle radius must be non-negative");
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const px = start.x - center.x;
  const py = start.y - center.y;
  const radiusSquared = radius * radius;
  const startDistanceSquared = px * px + py * py;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0n) return startDistanceSquared <= radiusSquared;

  const projection = -(px * dx + py * dy);
  if (projection <= 0n) {
    // The closed segment is closest at t=0. The half-open interval intersects
    // only when the start is strictly inside; a sole start-point touch is out.
    return startDistanceSquared < radiusSquared;
  }
  if (projection >= lengthSquared) {
    const endX = end.x - center.x;
    const endY = end.y - center.y;
    return endX * endX + endY * endY <= radiusSquared;
  }
  const cross = px * dy - py * dx;
  return cross * cross <= radiusSquared * lengthSquared;
}

export type SweptCircleCandidate = Readonly<{ id: string; center: ExactPoint; radius: bigint }>;

export function selectIntersectingCircleByStableId<T extends SweptCircleCandidate>(
  start: ExactPoint,
  end: ExactPoint,
  candidates: readonly T[],
  compareIds: (left: string, right: string) => number,
): T | null {
  let selected: T | null = null;
  for (const candidate of candidates) {
    if (!sweptSegmentIntersectsCircle(start, end, candidate.center, candidate.radius)) continue;
    if (selected === null || compareIds(candidate.id, selected.id) < 0) selected = candidate;
  }
  return selected;
}
