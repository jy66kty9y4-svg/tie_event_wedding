const EPSILON = 1e-9;

const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const dimensions = data => ({ width: Math.max(0, number(data?.widthM)), height: Math.max(0, number(data?.heightM)) });
const signedArea = points => points.reduce((sum, point, index) => {
  const next = points[(index + 1) % points.length];
  return sum + point.x * next.y - next.x * point.y;
}, 0) / 2;
const orientation = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const onSegment = (a, b, point) => Math.min(a.x, b.x) - EPSILON <= point.x && point.x <= Math.max(a.x, b.x) + EPSILON && Math.min(a.y, b.y) - EPSILON <= point.y && point.y <= Math.max(a.y, b.y) + EPSILON;
const intersects = (a, b, c, d) => {
  const abC = orientation(a, b, c), abD = orientation(a, b, d), cdA = orientation(c, d, a), cdB = orientation(c, d, b);
  if ((abC > EPSILON && abD < -EPSILON || abC < -EPSILON && abD > EPSILON) && (cdA > EPSILON && cdB < -EPSILON || cdA < -EPSILON && cdB > EPSILON)) return true;
  return (Math.abs(abC) <= EPSILON && onSegment(a, b, c)) || (Math.abs(abD) <= EPSILON && onSegment(a, b, d)) || (Math.abs(cdA) <= EPSILON && onSegment(c, d, a)) || (Math.abs(cdB) <= EPSILON && onSegment(c, d, b));
};

/** Returns a defensively copied normalized custom outline, or null for non-custom/invalid data. */
export function tableOutline(data) {
  if (!['custom','snakeQuarter'].includes(data?.shape) || !Array.isArray(data.points) || data.points.length < 3 || data.points.length > 64) return null;
  const points = data.points.map(point => ({ x: Number(point?.x), y: Number(point?.y) }));
  if (points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1)) return null;
  if (points.some((point, index) => Math.hypot(point.x - points[(index + 1) % points.length].x, point.y - points[(index + 1) % points.length].y) <= EPSILON)) return null;
  if (Math.abs(signedArea(points)) <= EPSILON) return null;
  for (let index = 0; index < points.length; index += 1) {
    const next = (index + 1) % points.length;
    for (let other = index + 1; other < points.length; other += 1) {
      const otherNext = (other + 1) % points.length;
      if (index === other || next === other || otherNext === index) continue;
      if (intersects(points[index], points[next], points[other], points[otherNext])) return null;
    }
  }
  return points;
}

const perimeterPoint = (points, distance) => {
  const lengths = points.map((point, index) => Math.hypot(points[(index + 1) % points.length].x - point.x, points[(index + 1) % points.length].y - point.y));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  let remaining = ((distance % total) + total) % total;
  for (let index = 0; index < points.length; index += 1) {
    if (remaining <= lengths[index] || index === points.length - 1) {
      const from = points[index], to = points[(index + 1) % points.length], ratio = lengths[index] ? remaining / lengths[index] : 0;
      return { x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio, dx: to.x - from.x, dy: to.y - from.y };
    }
    remaining -= lengths[index];
  }
  return points[0];
};

/** Seat centers in local metres, before table rotation. Empty tables deliberately have no positions. */
export function seatPositions(data) {
  const capacity = Number.isInteger(Number(data?.capacity)) ? Number(data.capacity) : 0;
  if (capacity <= 0) return [];
  const { width, height } = dimensions(data);
  if (!width || !height) return [];
  const offset = Math.min(width, height) * 0.12;
  if (['round','round150','oval'].includes(data?.shape)) {
    return Array.from({ length: capacity }, (_, index) => {
      const angle = Math.PI * 2 * index / capacity - Math.PI / 2;
      return { x: width / 2 + Math.cos(angle) * (width / 2 + offset), y: height / 2 + Math.sin(angle) * (height / 2 + offset) };
    });
  }
  const outline = tableOutline(data);
  if (outline) {
    const polygon = outline.map(point => ({ x: point.x * width, y: point.y * height }));
    const total = polygon.reduce((sum, point, index) => sum + Math.hypot(polygon[(index + 1) % polygon.length].x - point.x, polygon[(index + 1) % polygon.length].y - point.y), 0);
    const outward = Math.sign(signedArea(polygon)) || 1;
    return Array.from({ length: capacity }, (_, index) => {
      const point = perimeterPoint(polygon, (index + .5) * total / capacity);
      const length = Math.hypot(point.dx, point.dy) || 1;
      return { x: point.x + outward * point.dy / length * offset, y: point.y - outward * point.dx / length * offset };
    });
  }
  const perimeter = 2 * (width + height);
  return Array.from({ length: capacity }, (_, index) => {
    let distance = (index + .5) * perimeter / capacity;
    if (distance < width) return { x: distance, y: -offset };
    distance -= width;
    if (distance < height) return { x: width + offset, y: distance };
    distance -= height;
    if (distance < width) return { x: width - distance, y: height + offset };
    distance -= width;
    return { x: -offset, y: height - distance };
  });
}

/** Axis-aligned extents of the visual table body after its rotation, in metres. */
export function rotatedExtents(data) {
  const { width, height } = dimensions(data);
  const angle = number(data?.rotationDeg) * Math.PI / 180, cos = Math.abs(Math.cos(angle)), sin = Math.abs(Math.sin(angle));
  if (['round','round150','oval'].includes(data?.shape)) {
    return { width: Math.hypot(width * cos, height * sin), height: Math.hypot(width * sin, height * cos) };
  }
  // A custom outline can be asymmetric or concave. Its exact rotated box is not
  // necessarily centered on the table rectangle, so use the enclosing rectangle
  // here: clampPosition and the server boundary guard then remain safely centered.
  return { width: width * cos + height * sin, height: width * sin + height * cos };
}

/** Clamps an unrotated top-left position so the rotated table body stays within the plan. */
export function clampPosition(data, planData, x, y) {
  const plan = planData?.data || planData || {}, { width, height } = dimensions(data), extents = rotatedExtents(data);
  const planWidth = Math.max(0, number(plan.widthM)), planHeight = Math.max(0, number(plan.heightM));
  const centerX = Math.min(Math.max(number(x) + width / 2, extents.width / 2), Math.max(extents.width / 2, planWidth - extents.width / 2));
  const centerY = Math.min(Math.max(number(y) + height / 2, extents.height / 2), Math.max(extents.height / 2, planHeight - extents.height / 2));
  return { x: Math.max(0, centerX - width / 2), y: Math.max(0, centerY - height / 2) };
}
