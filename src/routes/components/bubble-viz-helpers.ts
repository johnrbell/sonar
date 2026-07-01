// Pure helpers for BubbleViz. Pulled out so the component stays under the
// 500-line size budget — these are stateless, well-typed, and can be unit-
// tested in isolation if it ever becomes worthwhile.

import * as d3 from 'd3';
import type { Cluster } from '$lib/schemas';

/**
 * Word-wrap a label into up to `maxLines` lines of at most `maxChars` chars
 * each. Single words longer than maxChars are ellipsized on the last
 * allowed line. Splits on whitespace only — "Publish/Unpublish" stays
 * intact so the slash semantics survive.
 */
export function wrapLabel(label: string, maxChars: number, maxLines: number): string[] {
	const words = label.split(/\s+/).filter(Boolean);
	const lines: string[] = [];
	let cur = '';
	for (const w of words) {
		const next = cur ? `${cur} ${w}` : w;
		if (next.length <= maxChars) {
			cur = next;
			continue;
		}
		if (cur) lines.push(cur);
		if (lines.length >= maxLines) { cur = ''; break; }
		cur = w;
	}
	if (cur && lines.length < maxLines) lines.push(cur);
	if (lines.length === maxLines && lines[maxLines - 1].length > maxChars) {
		lines[maxLines - 1] = lines[maxLines - 1].slice(0, maxChars - 1) + '…';
	}
	return lines;
}

/**
 * Render the drill-parent context onto an SVG: a transparent full-canvas
 * hit area that drills back on click (appended first so bubbles paint on
 * top), a dashed contour ring colored by the parent's primary area, and
 * a small top-center caption ("parent.label · N bugs · click outside to
 * zoom out"). Caller passes the SVG, the parent cluster, viewport dims,
 * theme flag, the drill-back callback, and a color resolver.
 *
 * Order matters: the rect is appended FIRST so it underlies everything.
 * The ring + caption use `pointer-events: none` so clicks fall through to
 * the rect; bubble clicks `stopPropagation()` to keep their handlers
 * authoritative.
 */
export function renderParentContext(
	svg: d3.Selection<SVGSVGElement, unknown, null, undefined>,
	parent: Cluster,
	width: number,
	height: number,
	isDark: boolean,
	onDrillBack: () => void,
	colorFor: (area: string) => string
): void {
	svg.append('rect')
		.attr('class', 'sonar-drillback')
		.attr('x', 0).attr('y', 0)
		.attr('width', width).attr('height', height)
		.attr('fill', 'transparent')
		.style('cursor', 'zoom-out')
		.on('click', () => onDrillBack());

	const parentColor = colorFor(parent.primaryArea);
	const ringR = Math.max(80, Math.min(width, height) / 2 - 20);
	svg.append('circle')
		.attr('class', 'sonar-parent-ring')
		.attr('cx', width / 2).attr('cy', height / 2)
		.attr('r', ringR)
		.attr('fill', 'none')
		.attr('stroke', parentColor)
		.attr('stroke-width', 1.5)
		.attr('stroke-dasharray', '6 6')
		.attr('stroke-opacity', 0.55)
		.attr('pointer-events', 'none');

	const captionFill = isDark ? 'rgba(232, 232, 238, 0.92)' : 'rgba(21, 21, 26, 0.88)';
	const captionStroke = isDark ? 'rgba(13, 13, 18, 0.7)' : 'rgba(255, 255, 255, 0.85)';
	const caption = svg.append('g').attr('class', 'sonar-parent-caption').attr('pointer-events', 'none');
	caption.append('text')
		.attr('x', width / 2).attr('y', 22)
		.attr('text-anchor', 'middle')
		.attr('font-size', 13).attr('font-weight', 600)
		.attr('stroke', captionStroke).attr('stroke-width', 3).attr('paint-order', 'stroke')
		.attr('fill', parentColor)
		.text(parent.label);
	caption.append('text')
		.attr('x', width / 2).attr('y', 38)
		.attr('text-anchor', 'middle')
		.attr('font-size', 10)
		.attr('stroke', captionStroke).attr('stroke-width', 3).attr('paint-order', 'stroke')
		.attr('fill', captionFill)
		.text(`${parent.bugIds.length} bug${parent.bugIds.length === 1 ? '' : 's'} · click outside to zoom out`);
}

/**
 * Zoom-in animation. Scales the clicked bubble up + translates it to the
 * canvas center while every other bubble (and the area-overlap link lines,
 * dashed parent ring, parent caption) fade out. Does NOT touch the force
 * simulation or the data — the page commits the actual drill ~420ms later
 * by mutating clusters/parent, which triggers a fresh render via the
 * structural effect. This function just paints the transition.
 *
 * Selects the target by `g.sonar-bubble[data-id="<id>"]`, which is the
 * attribute the BubbleViz render() applies to each bubble group.
 */
export function runBubbleZoomIn(
	svgEl: SVGSVGElement,
	id: string,
	durationMs: number
): void {
	const svg = d3.select(svgEl);
	const target = svg.select<SVGGElement>(`g.sonar-bubble[data-id="${CSS.escape(id)}"]`);
	if (target.empty()) return;
	const d = target.datum() as { id: string; r: number; x?: number; y?: number };
	if (typeof d.x !== 'number' || typeof d.y !== 'number') return;

	const width = svgEl.clientWidth;
	const height = svgEl.clientHeight || 540;
	// Scale to roughly fill the smaller viewport dimension; 0.85 so the
	// bubble doesn't bump the radar edges as it grows.
	const scale = (Math.min(width, height) / 2 / d.r) * 0.85;
	const cx = width / 2;
	const cy = height / 2;
	const tx = cx - d.x;
	const ty = cy - d.y;

	// Fade everything that isn't the clicked bubble — siblings, link lines,
	// parent ring, drill-back rect, caption.
	svg.selectAll<SVGGElement, { id: string }>('g.sonar-bubble')
		.filter((n) => n.id !== id)
		.transition().duration(durationMs).ease(d3.easeCubicIn)
		.attr('opacity', 0);
	svg.selectAll('line')
		.transition().duration(durationMs).ease(d3.easeCubicIn)
		.attr('opacity', 0);
	svg.selectAll('circle.sonar-parent-ring, g.sonar-parent-caption')
		.transition().duration(durationMs).ease(d3.easeCubicIn)
		.attr('opacity', 0);

	// Grow the clicked bubble.
	target.transition().duration(durationMs).ease(d3.easeCubicInOut)
		.attr('transform', `translate(${d.x + tx}, ${d.y + ty}) scale(${scale})`);
	// And soften its fill as it grows so the next render's force-sim layout
	// feels like it's "appearing inside" rather than slamming on.
	target.select('circle').transition().duration(durationMs).ease(d3.easeCubicInOut)
		.attr('fill-opacity', 0.45);
}

/**
 * Reverse-zoom on drill-back. Called AFTER the higher-level view has
 * been re-rendered (so the bubble we drilled into already exists in the
 * DOM at its natural position). Cross-fades the new view in around the
 * target — target stays at full opacity at its natural position so it
 * serves as the visual anchor for "you're back to this bubble"; the
 * surrounding bubbles + links fade in. Parent ring + caption stay at
 * full opacity (their natural state from render()).
 *
 * Cluster ids are deterministic (`c${idx}` from cluster-text.ts), so the
 * id we drilled INTO resolves to the same bubble in the re-rendered
 * higher-level view. If it doesn't (shouldn't happen, but graceful),
 * the filter excludes nothing and everything cross-fades together.
 *
 * Why this is NOT a beat-for-beat reverse of runBubbleZoomIn:
 *   We tried the strict reverse (target starts huge centered, shrinks
 *   to natural). It was inconsistent across drill-backs because the
 *   zoom-in scale formula targets a fixed visual radius (~radar-
 *   filling), so the multiplier explodes for small bubbles — a 40-px
 *   bubble gets 6×, a 20-px bubble gets ~11× — while a very large
 *   one only gets 2.8×. At the high multipliers the bubble's children
 *   (label, count text, preview pips, hot halo) all become huge SVG
 *   nodes that blow the browser's per-frame render budget at the start
 *   of the shrink — reads as a stutter. Capping the scale helped but
 *   didn't fully fix it, because destination render cost also varies
 *   between drill-backs (force-sim settle, peekDrill recursion, etc.).
 *   The cross-fade has uniform cost regardless of which bubble or how
 *   deep, so it feels the same every time.
 */
export function runBubbleZoomOut(
	svgEl: SVGSVGElement,
	id: string,
	durationMs: number
): void {
	const svg = d3.select(svgEl);
	const others = svg.selectAll<SVGGElement, { id: string }>('g.sonar-bubble').filter((n) => n.id !== id);
	others.attr('opacity', 0);
	const links = svg.selectAll<SVGLineElement, unknown>('line');
	links.attr('opacity', 0);
	others.transition().duration(durationMs).ease(d3.easeCubicInOut).attr('opacity', 1);
	links.transition().duration(durationMs).ease(d3.easeCubicInOut).attr('opacity', 1);
}

/**
 * Paint the "hot" treatment on each cluster bubble: two pulsing radar-ping
 * rings + a static red edge halo + a numeric badge in the top-right corner.
 * The badge number is the count of unresolved high-severity bugs in the
 * cluster. Caller passes the d3 selection of cluster nodes (each <g> already
 * translated to its bubble center) and the hot-count map.
 *
 * The pulse animation itself is CSS — see `.sonar-hot-pulse` in sonar.css.
 * This helper just appends the right SVG primitives and lets CSS take over.
 */
export function renderHotIndicators<N extends { id: string; r: number }>(
	nodeG: d3.Selection<SVGGElement, N, SVGGElement, unknown>,
	hotCounts: Map<string, number>
): void {
	const hotCount = (id: string) => hotCounts.get(id) ?? 0;
	const isHot = (id: string) => hotCount(id) > 0;
	const hotNodes = nodeG.filter((d) => isHot(d.id));
	// Two pulse rings (delayed sibling staggers the radar-ping cadence).
	for (const cls of ['sonar-hot-pulse', 'sonar-hot-pulse sonar-hot-pulse-delayed']) {
		hotNodes.append('circle')
			.attr('class', cls)
			.attr('r', (d) => d.r + 2)
			.attr('fill', 'none')
			.attr('stroke', '#ef4444')
			.attr('stroke-width', 2);
	}
	// Static edge glow — visible even mid-fade of the pulse rings.
	hotNodes.append('circle')
		.attr('r', (d) => d.r + 1)
		.attr('fill', 'none')
		.attr('stroke', '#ef4444')
		.attr('stroke-width', 3)
		.attr('stroke-opacity', 0.55);
}

/**
 * Append the numeric hot-count badge to each hot bubble. Separate from
 * `renderHotIndicators` because the badge needs to render AFTER the labels
 * and pips so it stays on top in z-order. Position: top-right corner of
 * the bubble, sized to stay legible regardless of radius.
 */
export function renderHotBadges<N extends { id: string; r: number }>(
	nodeG: d3.Selection<SVGGElement, N, SVGGElement, unknown>,
	hotCounts: Map<string, number>
): void {
	const hotCount = (id: string) => hotCounts.get(id) ?? 0;
	const isHot = (id: string) => hotCount(id) > 0;
	nodeG.filter((d) => isHot(d.id)).each(function (d) {
		const n = hotCount(d.id);
		const twoDigit = n >= 10;
		const badgeR = Math.max(9, Math.min(13, d.r * 0.35)) + (twoDigit ? 1.5 : 0);
		const off = d.r * 0.72;
		const badge = d3.select(this).append('g')
			.attr('class', 'sonar-hot-badge')
			.attr('transform', `translate(${off}, ${-off})`)
			.attr('pointer-events', 'none');
		badge.append('circle')
			.attr('r', badgeR)
			.attr('fill', '#dc2626')
			.attr('stroke', 'white')
			.attr('stroke-width', 1.5);
		badge.append('text')
			.attr('text-anchor', 'middle')
			.attr('dominant-baseline', 'central')
			.attr('font-size', twoDigit ? 10 : 11)
			.attr('font-weight', 700)
			.attr('fill', 'white')
			.text(n);
	});
}

/**
 * Apply hover-highlight dimming. Bubbles in `highlightedIds` stay at full
 * opacity; everything else (other bubbles, the link layer) fades to a
 * low value so the eye snaps to the highlighted set. Passing an empty
 * (or undefined) set restores every bubble to opacity 1.
 *
 * Called both from a $effect that watches `highlightedIds` and from the
 * tail of render() so structural rebuilds don't reset the dim state.
 */
export function applyHighlight(
	svgEl: SVGSVGElement,
	highlightedIds: Set<string> | undefined
): void {
	const svg = d3.select(svgEl);
	const dim = !!highlightedIds && highlightedIds.size > 0;
	svg.selectAll<SVGGElement, { id: string }>('g.sonar-bubble')
		.attr('opacity', (d) => (!dim || highlightedIds!.has(d.id) ? 1 : 0.18));
	svg.selectAll<SVGLineElement, unknown>('line').attr('opacity', dim ? 0.05 : 0.65);
}
