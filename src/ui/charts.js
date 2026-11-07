/**
 * Dependency-free responsive SVG charts. Values arrive as integer centavos;
 * they are converted to screen coordinates here only (display geometry,
 * never fed back into financial totals).
 */
import { h, svg } from './dom.js';
import { formatCompact, formatMoney } from '../domain/money.js';

const W = 340;

/** Round an axis maximum up to 1, 2, 2.5 or 5 × 10^k (in centavos). */
function niceMax(value) {
  if (value <= 0) return 100_000; // ₱1,000 default scale
  const exponent = Math.floor(Math.log10(value));
  const base = 10 ** exponent;
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (value <= step * base) return Math.round(step * base);
  }
  return Math.round(10 * base);
}

function chartFrame(ariaLabel, height, children) {
  return svg('svg', {
    viewBox: `0 0 ${W} ${height}`,
    class: 'chart',
    role: 'img',
    'aria-label': ariaLabel,
    preserveAspectRatio: 'xMidYMid meet',
  }, ...children);
}

function yAxis({ max, min = 0, height, padL, padR, padT, padB, ticks = 4 }) {
  const nodes = [];
  const plotH = height - padT - padB;
  for (let i = 0; i <= ticks; i += 1) {
    const value = Math.round(min + ((max - min) * i) / ticks);
    const y = padT + plotH - (plotH * i) / ticks;
    nodes.push(svg('line', { x1: padL, x2: W - padR, y1: y, y2: y, class: 'grid-line' }));
    nodes.push(svg('text', { x: padL - 6, y: y + 3, class: 'axis-label', 'text-anchor': 'end' }, formatCompact(value)));
  }
  return nodes;
}

/**
 * Grouped bar chart.
 * @param {{labels: string[], series: {name: string, values: number[], tone: string}[], ariaLabel: string, height?: number}} cfg
 */
export function barChart({ labels, series, ariaLabel, height = 190 }) {
  const padL = 44; const padR = 8; const padT = 10; const padB = 24;
  const plotW = W - padL - padR;
  const plotH = height - padT - padB;
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
  const groupW = plotW / labels.length;
  const gap = 3;
  const barW = Math.min(16, (groupW * 0.66 - gap * (series.length - 1)) / series.length);
  const nodes = [...yAxis({ max, height, padL, padR, padT, padB })];

  labels.forEach((label, i) => {
    const groupX = padL + i * groupW + (groupW - (barW * series.length + gap * (series.length - 1))) / 2;
    series.forEach((s, j) => {
      const value = Math.max(0, s.values[i]);
      const barH = value === 0 ? 0 : Math.max(2, (value / max) * plotH);
      nodes.push(svg('rect', {
        x: groupX + j * (barW + gap), y: padT + plotH - barH, width: barW, height: barH, rx: 3,
        class: `bar tone-${s.tone}`,
      }, svg('title', {}, `${s.name} · ${label}: ${formatMoney(s.values[i])}`)));
    });
    nodes.push(svg('text', { x: padL + i * groupW + groupW / 2, y: height - 7, class: 'axis-label', 'text-anchor': 'middle' }, label));
  });
  return chartFrame(ariaLabel, height, nodes);
}

/** Line/area chart; supports negative values (e.g. negative net worth). */
export function lineChart({ labels, values, ariaLabel, tone = 'primary', height = 180 }) {
  const padL = 44; const padR = 12; const padT = 12; const padB = 24;
  const plotW = W - padL - padR;
  const plotH = height - padT - padB;
  const rawMax = Math.max(0, ...values);
  const rawMin = Math.min(0, ...values);
  const max = niceMax(rawMax);
  const min = rawMin < 0 ? -niceMax(-rawMin) : 0;
  const x = (i) => padL + (labels.length === 1 ? plotW / 2 : (plotW * i) / (labels.length - 1));
  const y = (v) => padT + plotH - ((v - min) / (max - min)) * plotH;
  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const zeroY = y(0);
  const nodes = [...yAxis({ max, min, height, padL, padR, padT, padB })];
  nodes.push(svg('path', { d: `M${x(0)},${zeroY} L${points.join(' L')} L${x(values.length - 1)},${zeroY} Z`, class: `area tone-${tone}` }));
  nodes.push(svg('polyline', { points: points.join(' '), class: `line tone-${tone}` }));
  values.forEach((v, i) => {
    nodes.push(svg('circle', { cx: x(i), cy: y(v), r: 3.5, class: `dot tone-${tone}` },
      svg('title', {}, `${labels[i]}: ${formatMoney(v)}`)));
    nodes.push(svg('text', { x: x(i), y: height - 7, class: 'axis-label', 'text-anchor': 'middle' }, labels[i]));
  });
  return chartFrame(ariaLabel, height, nodes);
}

/** Donut chart with an HTML legend. Items: {label, value, tone} */
export function donutChart({ items, ariaLabel, centerLabel, centerValue }) {
  const total = items.reduce((t, i) => t + i.value, 0);
  const r = 15.9155; // circumference ≈ 100
  const ring = [svg('circle', { cx: 21, cy: 21, r, class: 'donut-track' })];
  let offset = 25; // start at 12 o'clock
  for (const item of items) {
    const pct = total ? (item.value / total) * 100 : 0;
    ring.push(svg('circle', {
      cx: 21, cy: 21, r, class: `donut-seg tone-${item.tone}`,
      'stroke-dasharray': `${pct.toFixed(3)} ${(100 - pct).toFixed(3)}`,
      'stroke-dashoffset': offset.toFixed(3),
    }, svg('title', {}, `${item.label}: ${formatMoney(item.value)}`)));
    offset -= pct;
  }
  ring.push(svg('text', { x: 21, y: 20, class: 'donut-label', 'text-anchor': 'middle' }, centerLabel));
  ring.push(svg('text', { x: 21, y: 25, class: 'donut-value', 'text-anchor': 'middle' }, centerValue));
  const chart = svg('svg', { viewBox: '0 0 42 42', class: 'donut', role: 'img', 'aria-label': ariaLabel }, ...ring);

  const legend = h('ul', { class: 'legend' }, items.map((item) => h('li', {},
    h('span', { class: `swatch tone-${item.tone}` }),
    h('span', { class: 'legend-name' }, item.label),
    h('span', { class: 'legend-value num' }, formatMoney(item.value)),
  )));
  return h('div', { class: 'donut-wrap' }, chart, legend);
}

export function chartLegend(series) {
  return h('div', { class: 'chart-legend' }, series.map((s) => h('span', {},
    h('span', { class: `swatch tone-${s.tone}` }), s.name)));
}

/**
 * Horizontal SVG comparison bar chart for Savings Goals progress (saved vs. target).
 * @param {{items: {name: string, currentAmount: number, targetAmount: number, progressBp: number}[], ariaLabel: string}} cfg
 */
export function savingsChart({ items, ariaLabel }) {
  const rowH = 38;
  const padT = 8;
  const padB = 8;
  const height = padT + items.length * rowH + padB;
  const barX = 4;
  const barW = W - 8;
  const nodes = [];

  items.forEach((g, idx) => {
    const y = padT + idx * rowH;
    const pct = Math.max(0, Math.min(1, (g.progressBp ?? 0) / 10000));
    const fillW = pct === 0 ? 0 : Math.max(4, pct * barW);
    const labelText = g.name.length > 24 ? `${g.name.slice(0, 23)}…` : g.name;
    const pctLabel = `${Math.round((g.progressBp ?? 0) / 100)}%`;

    nodes.push(svg('text', { x: barX, y: y + 12, class: 'axis-label', 'text-anchor': 'start' }, labelText));
    nodes.push(svg('text', { x: barX + barW, y: y + 12, class: 'axis-label', 'text-anchor': 'end' },
      `${formatCompact(g.currentAmount)} / ${formatCompact(g.targetAmount)} (${pctLabel})`));
    nodes.push(svg('rect', {
      x: barX, y: y + 17, width: barW, height: 10, rx: 5, class: 'donut-track',
      style: 'fill: var(--surface-2); stroke: none;',
    }));
    if (fillW > 0) {
      nodes.push(svg('rect', {
        x: barX, y: y + 17, width: fillW, height: 10, rx: 5,
        class: `bar tone-${pct >= 1 ? 'income' : 'primary'}`,
      }, svg('title', {}, `${g.name}: ${formatMoney(g.currentAmount)} of ${formatMoney(g.targetAmount)} (${pctLabel})`)));
    }
  });

  return chartFrame(ariaLabel, height, nodes);
}
