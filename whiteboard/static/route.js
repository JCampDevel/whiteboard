"use strict";

// Arrow routing: right-angled connectors that go round boxes instead of through them, as in Visio.
// Pure functions of points and rectangles (no page access), so they can be tested on their own.

const ROUTE = {
  STUB: 18,   // an arrow leaves and enters a box straight, for at least this far
  PAD: 10,    // clear space kept between an arrow and any box it is not connected to
  BEND: 24,   // cost of each corner, in pixels of length: fewer bends is tidier
  REACH: 300, // only boxes this close to the arrow's two ends are considered
};
const DIRS = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }]; // right, down, left, up

// Which way is "out" of a box at an attachment point (fractions [fx, fy] of its width and height):
// the side it sits nearest to, as an index into DIRS.
function sideDir(anchor) {
  const [fx, fy] = anchor;
  const away = [1 - fx, 1 - fy, fx, fy]; // distance to the right, bottom, left and top sides
  return away.indexOf(Math.min(...away));
}

// Route from point S (leaving in direction index sd) to point T (arriving from direction index td),
// avoiding `obstacles` (rectangles {x, y, w, h}) and passing through each of the user's `via` points
// ([x, y] or [x, y, axis], in order), if any. A via point with an axis is where the user dragged a segment:
// the route goes straight through it, horizontally (axis 0) or vertically (axis 1), so that segment stays put. Returns the corner points from S to T inclusive. A point that is one of the
// via points carries `via: its index`, and the points where the straight stubs end carry `stub: true`.
// If no clear route exists it still returns a right-angled one, drawn straight over whatever is in the way.
function routeOrthogonal(S, sd, T, td, obstacles, via = []) {
  const step = (p, d, n) => ({ x: p.x + DIRS[d].x * n, y: p.y + DIRS[d].y * n });
  const P1 = step(S, sd, ROUTE.STUB), P2 = step(T, td, ROUTE.STUB);
  const rects = obstacles.map(o => ({
    x1: o.x - ROUTE.PAD, y1: o.y - ROUTE.PAD, x2: o.x + o.w + ROUTE.PAD, y2: o.y + o.h + ROUTE.PAD,
  }));
  const blocked = (p) => rects.some(r => p.x > r.x1 && p.x < r.x2 && p.y > r.y1 && p.y < r.y2);
  const half = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const stubsClear = !blocked(half(S, P1)) && !blocked(half(T, P2));

  // The route is a chain of legs: stub end -> each via point in turn -> the other stub end.
  const stations = [P1, ...via.map(([x, y, axis]) => ({ x, y, axis })), P2];
  const points = [{ x: S.x, y: S.y }, { x: P1.x, y: P1.y, stub: true }];
  let heading = sd;
  for (let k = 0; k + 1 < stations.length; k++) {
    const A = stations[k], B = stations[k + 1], final = k + 2 === stations.length;
    let leg = null;
    const accept = final ? (d) => d !== td // don't arrive heading back out along the end's own stub
      : B.axis === 0 || B.axis === 1 ? (d) => d % 2 === B.axis : () => true;
    if (stubsClear && !blocked(A) && !blocked(B)) {
      // The last leg must arrive heading straight into the box (the turn onto the stub is a bend too, and
      // would otherwise be free, pushing the bend of a simple Z right up to the box). Fall back if impossible.
      leg = final
        ? searchGrid(A, heading, B, (d) => d === (td + 2) % 4, rects) || searchGrid(A, heading, B, accept, rects)
        : searchGrid(A, heading, B, accept, rects);
    }
    if (!leg) { // boxes too close together, or boxed in: a plain right-angled link
      leg = heading % 2 === 0 ? [A, { x: B.x, y: A.y }, B] : [A, { x: A.x, y: B.y }, B];
    }
    const rest = leg.slice(1).map(p => ({ x: p.x, y: p.y }));
    if (!rest.length) rest.push({ x: B.x, y: B.y });
    if (final) rest[rest.length - 1].stub = true;
    else Object.assign(rest[rest.length - 1], { via: k, axis: B.axis }); // axis: which run a corner pin belongs to
    points.push(...rest);
    heading = headingOf(leg, heading);
  }
  points.push({ x: T.x, y: T.y });
  return tidy(points);
}

// Whether an arrow can leave a box at `point` heading in direction `dir` without its stub running into
// one of `obstacles` (used to pick a free side for an end that follows its box).
function stubClear(point, dir, obstacles) {
  const far = { x: point.x + DIRS[dir].x * ROUTE.STUB, y: point.y + DIRS[dir].y * ROUTE.STUB };
  const mid = { x: (point.x + far.x) / 2, y: (point.y + far.y) / 2 };
  return !obstacles.some(o => [far, mid].some(p =>
    p.x > o.x - ROUTE.PAD && p.x < o.x + o.w + ROUTE.PAD && p.y > o.y - ROUTE.PAD && p.y < o.y + o.h + ROUTE.PAD));
}

// Index into DIRS of the way a path is heading at its end.
function headingOf(path, fallback) {
  for (let i = path.length - 1; i > 0; i--) {
    const dx = path[i].x - path[i - 1].x, dy = path[i].y - path[i - 1].y;
    if (dx > 0) return 0;
    if (dy > 0) return 1;
    if (dx < 0) return 2;
    if (dy < 0) return 3;
  }
  return fallback;
}

// Cheapest right-angled path from A (heading hd) to B over a grid whose lines run along the padded edges
// of the nearby boxes and through the two points. Cost is length plus a penalty per corner. It must arrive
// at B heading in a direction `accept(d)` allows. Returns null if there is no path.
function searchGrid(A, hd, B, accept, rects) {
  const near = {
    x1: Math.min(A.x, B.x) - ROUTE.REACH, x2: Math.max(A.x, B.x) + ROUTE.REACH,
    y1: Math.min(A.y, B.y) - ROUTE.REACH, y2: Math.max(A.y, B.y) + ROUTE.REACH,
  };
  const xs = new Set([A.x, B.x, (A.x + B.x) / 2]), ys = new Set([A.y, B.y, (A.y + B.y) / 2]);
  const considered = rects.filter(r => r.x2 > near.x1 && r.x1 < near.x2 && r.y2 > near.y1 && r.y1 < near.y2);
  for (const r of considered) { xs.add(r.x1); xs.add(r.x2); ys.add(r.y1); ys.add(r.y2); }
  const X = [...xs].sort((a, b) => a - b), Y = [...ys].sort((a, b) => a - b);
  const nx = X.length, ny = Y.length;
  const xi = new Map(X.map((v, i) => [v, i])), yi = new Map(Y.map((v, i) => [v, i]));
  const isBlocked = (p) => considered.some(r => p.x > r.x1 && p.x < r.x2 && p.y > r.y1 && p.y < r.y2);
  // Whether each grid point, and each step from a point in each direction, is blocked: worked out once each.
  const pointBlocked = new Int8Array(nx * ny).fill(-1), stepBlocked = new Int8Array(nx * ny * 4).fill(-1);
  const pointFree = (i, j) => {
    const k = i * ny + j;
    if (pointBlocked[k] < 0) pointBlocked[k] = isBlocked({ x: X[i], y: Y[j] }) ? 1 : 0;
    return pointBlocked[k] === 0;
  };
  const stepFree = (i, j, nd, ni, nj) => {
    const k = (i * ny + j) * 4 + nd;
    if (stepBlocked[k] < 0) stepBlocked[k] = isBlocked({ x: (X[i] + X[ni]) / 2, y: (Y[j] + Y[nj]) / 2 }) ? 1 : 0;
    return stepBlocked[k] === 0;
  };

  const id = (i, j, d) => (i * ny + j) * 4 + d;
  const dist = new Float64Array(nx * ny * 4).fill(Infinity);
  const prev = new Int32Array(nx * ny * 4).fill(-1);
  const goalI = xi.get(B.x), goalJ = yi.get(B.y);
  const h = (i, j) => Math.abs(X[i] - B.x) + Math.abs(Y[j] - B.y);

  const heap = []; // binary min-heap of [priority, state]
  const push = (item) => {
    heap.push(item);
    for (let k = heap.length - 1; k > 0;) {
      const up = (k - 1) >> 1;
      if (heap[up][0] <= heap[k][0]) break;
      [heap[up], heap[k]] = [heap[k], heap[up]];
      k = up;
    }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      for (let k = 0; ;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return top;
  };

  const start = id(xi.get(A.x), yi.get(A.y), hd);
  dist[start] = 0;
  push([h(xi.get(A.x), yi.get(A.y)), start]);

  while (heap.length) {
    const [f, s] = pop();
    const d = s % 4, cell = (s - d) / 4, j = cell % ny, i = (cell - j) / ny;
    if (f > dist[s] + h(i, j) + 1e-9) continue; // a stale entry: this state was reached more cheaply since
    if (i === goalI && j === goalJ && accept(d)) { // arrived, heading a permitted way
      const pts = [];
      for (let k = s; k !== -1; k = prev[k]) {
        const kd = k % 4, kc = (k - kd) / 4, kj = kc % ny, ki = (kc - kj) / ny;
        pts.push({ x: X[ki], y: Y[kj] });
      }
      return pts.reverse();
    }
    for (let nd = 0; nd < 4; nd++) {
      if (nd === (d + 2) % 4) continue; // no U-turns
      const ni = i + DIRS[nd].x, nj = j + DIRS[nd].y;
      if (ni < 0 || nj < 0 || ni >= nx || nj >= ny) continue;
      if (!pointFree(ni, nj) || !stepFree(i, j, nd, ni, nj)) continue;
      const to = { x: X[ni], y: Y[nj] };
      const cost = dist[s] + Math.abs(to.x - X[i]) + Math.abs(to.y - Y[j]) + (nd !== d ? ROUTE.BEND : 0);
      const t = id(ni, nj, nd);
      if (cost < dist[t]) {
        dist[t] = cost;
        prev[t] = s;
        push([cost + h(ni, nj), t]);
      }
    }
  }
  return null;
}

// Drop repeated points and points in the middle of a straight run (but never a via point).
function tidy(points) {
  const out = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && last.x === p.x && last.y === p.y && !(last.via !== undefined && p.via !== undefined)) {
      // Same place: keep one point with both tags. (Two pins in one place are both kept, so each still
      // has a handle and can be moved or released.)
      if (p.via !== undefined) Object.assign(last, { via: p.via, axis: p.axis });
      if (p.stub) last.stub = true;
      continue;
    }
    const before = out[out.length - 2];
    if (before && last.via === undefined && ((before.x === last.x && last.x === p.x) || (before.y === last.y && last.y === p.y))) out.pop();
    out.push(p);
  }
  return out;
}

// The point half way along a path, where its label goes.
function pathMiddle(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  let left = total / 2;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], len = Math.hypot(b.x - a.x, b.y - a.y);
    if (left <= len && len > 0) return { x: a.x + ((b.x - a.x) * left) / len, y: a.y + ((b.y - a.y) * left) / len };
    left -= len;
  }
  return points[points.length - 1];
}
