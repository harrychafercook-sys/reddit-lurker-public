// Accumulate travel in one direction so small adjustments do not toggle the bars.
export function getNavScrollChange(previousY, currentY, distance = 0) {
    if (currentY <= 100) return { distance: 0, visible: true };
    const delta = currentY - previousY;
    if (!delta) return { distance, visible: null };
    distance = Math.sign(delta) === Math.sign(distance) ? distance + delta : delta;
    if (distance <= -48) return { distance: 0, visible: true };
    if (distance >= 24) return { distance: 0, visible: false };
    return { distance, visible: null };
}
