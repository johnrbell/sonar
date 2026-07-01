<script lang="ts">
	import { onDestroy, onMount, untrack } from 'svelte';
	import * as d3 from 'd3';
	import type { Cluster } from '$lib/schemas';
	import { FEATURE_AREAS } from '$lib/constants';
	import {
		wrapLabel, runBubbleZoomIn, runBubbleZoomOut, renderParentContext,
		renderHotIndicators, renderHotBadges, applyHighlight
	} from './bubble-viz-helpers';
	import BubbleTooltip from './BubbleTooltip.svelte';
	import ArchivePool from './ArchivePool.svelte';

	// peekDrill annotates clusters with drillability + sub-cluster preview.
	type ClusterAnn = Cluster & { drillable?: boolean; subClusters?: Cluster[] };

	type Props = {
		clusters: ClusterAnn[];
		selectedId: string | null;
		theme: 'light' | 'dark';
		hotCounts?: Map<string, number>;
		highlightedIds?: Set<string>;
		parent: Cluster | null;
		zoomingId: string | null;
		zoomingBackToId: string | null;
		archivedCount?: number;
		archiveActive?: boolean;
		onArchiveBug?: (bugId: string) => void;
		onSelectArchive?: () => void;
		onSelect: (id: string) => void;
		onDrillBack: () => void;
	};
	let {
		clusters, selectedId, theme, hotCounts, highlightedIds, parent,
		zoomingId, zoomingBackToId,
		archivedCount = 0, archiveActive = false, onArchiveBug, onSelectArchive,
		onSelect, onDrillBack
	}: Props = $props();

	type Node = ClusterAnn & d3.SimulationNodeDatum & { r: number; labelHalfWidth?: number };

	const ZOOM_ANIM_MS = 420;

	// Custom hover tooltip — replaces the native SVG <title> (~500ms OS
	// delay). Mounts instantly; flips below for bubbles near the top edge
	// so it doesn't clip out of the viewport. Markup in BubbleTooltip.svelte.
	type TooltipModel = { x: number; y: number; flipped: boolean; cluster: ClusterAnn };
	let tooltip = $state<TooltipModel | null>(null);
	function showTooltip(d: Node) {
		const px = typeof d.x === 'number' ? d.x : 0;
		const py = typeof d.y === 'number' ? d.y : 0;
		const aboveY = py - d.r - 8;
		const flipped = aboveY < 60;
		tooltip = { x: px, y: flipped ? py + d.r + 8 : aboveY, flipped, cluster: d };
	}
	const hideTooltip = () => { tooltip = null; };

	let svgEl: SVGSVGElement;
	let sim: d3.Simulation<Node, undefined> | null = null;
	// Reference to the rendered main-circle selection. Held across re-renders
	// so the cheap selection-update effect can mutate stroke/stroke-width
	// without tearing the SVG down + restarting the force simulation.
	let mainCircleSel: d3.Selection<SVGCircleElement, Node, SVGGElement, unknown> | null = null;
	let currentStrokes = { selected: '', idle: '', hot: '#ef4444' };

	// Brand purple as the primary, then a curated palette that reads well on both
	// light and dark backgrounds. Reds are intentionally absent — red is
	// reserved for the hot indicator (badge + edge glow) so it never
	// collides with a feature-area color.
	const PALETTE = ['#4a1ee3', '#f59e0b', '#a855f7', '#64748b', '#22c55e', '#06b6d4', '#fb923c', '#ec4899', '#eab308', '#10b981', '#6366f1', '#14b8a6'];
	const colorFor = (area: string): string => {
		const i = FEATURE_AREAS.indexOf(area as never);
		return i >= 0 ? PALETTE[i % PALETTE.length] : '#94a3b8';
	};

	function render() {
		if (!svgEl) return;
		const svg = d3.select(svgEl);
		svg.selectAll('*').remove();
		mainCircleSel = null;
		// Hide any lingering tooltip — its `cluster` ref may point at a node
		// that no longer exists after a data swap (drill, filter change, …).
		hideTooltip();
		if (clusters.length === 0) return;

		const width = svgEl.clientWidth;
		const height = svgEl.clientHeight || 540;
		// The CSS sonar radar now has both a dark and a light variant
		// (driven by the .sonar-root[data-theme] attribute). d3 stroke +
		// link colors need to match the radar field they're rendering on:
		//   dark radar (deep navy) → white-ish strokes
		//   light radar (pale cyan) → near-black strokes
		const isDark = theme === 'dark';
		const linkColor = isDark ? 'rgba(255,255,255,0.18)' : 'rgba(15, 23, 42, 0.28)';
		currentStrokes = {
			selected: isDark ? '#ffffff' : '#0f172a',
			idle: isDark ? 'rgba(255,255,255,0.22)' : 'rgba(15, 23, 42, 0.22)',
			hot: '#ef4444'
		};

		// Drill-back hit area + dashed parent ring + caption. See
		// bubble-viz-helpers.ts `renderParentContext()` for the implementation.
		if (parent) renderParentContext(svg, parent, width, height, isDark, onDrillBack, colorFor);

		// Cap radius at ~1/3 of the smaller viewport dim so a single very large
		// cluster (e.g. 140 bugs) can't dominate and catapult the
		// rest of the nodes out of the canvas via collision forces.
		const maxR = Math.max(40, Math.min(width, height) / 3);
		const nodes: Node[] = clusters.map((c) => ({
			...c,
			r: Math.min(maxR, 14 + Math.sqrt(c.bugIds.length) * 7)
		}));

		type Link = { source: string; target: string; shared: number };
		const links: Link[] = [];
		for (let i = 0; i < nodes.length; i++) {
			for (let j = i + 1; j < nodes.length; j++) {
				const shared = nodes[i].areas.filter((a) => nodes[j].areas.includes(a)).length;
				if (shared >= 1 && nodes[i].bugIds.length > 1 && nodes[j].bugIds.length > 1) {
					links.push({ source: nodes[i].id, target: nodes[j].id, shared });
				}
			}
		}

		const linkSel = svg.append('g').selectAll('line').data(links).enter().append('line')
			.attr('stroke', linkColor)
			.attr('stroke-width', 1)
			.attr('stroke-opacity', (d) => Math.min(0.6, 0.25 + 0.15 * d.shared));

		const nodeG = svg.append('g').selectAll('g').data(nodes, (d: any) => d.id).enter().append('g')
			.attr('class', 'sonar-bubble')
			.attr('data-id', (d) => d.id)
			// `zoom-in` cursor on drillable clusters telegraphs the drill
			// affordance; non-drillable (leaf) clusters just select on click.
			.style('cursor', (d) => (d.drillable ? 'zoom-in' : 'pointer'))
			// `function` (not arrow) so `this` is the bubble's <g>. raise()
			// re-appends it last under its parent, so the entire hovered
			// bubble — circle, label, pulse rings, hot badge — paints on
			// top of neighbors instead of being clipped by their labels.
			.on('mouseenter', function (_e, d) { d3.select(this).raise(); showTooltip(d); })
			.on('mouseleave', () => hideTooltip())
			.on('click', (e, d) => {
				// Stop propagation so the underlying drill-back rect
				// (present when `parent` is set) doesn't ALSO fire and
				// immediately undo the drill we're about to perform.
				e.stopPropagation();
				// Hide the tooltip immediately so it doesn't linger during
				// the 420ms drill animation while the bubble scales up.
				hideTooltip();
				onSelect(d.id);
			});

		// Hot treatment — pulsing radar-ping rings + static edge glow drawn
		// beneath the main circle. Numeric badge is rendered AFTER labels
		// below so it stays on top in z-order. See bubble-viz-helpers.ts.
		if (hotCounts && hotCounts.size > 0) renderHotIndicators(nodeG, hotCounts);

		const mainCircles = nodeG.append('circle')
			.attr('r', (d) => d.r)
			.attr('fill', (d) => colorFor(d.primaryArea))
			.attr('fill-opacity', 0.88);
		mainCircleSel = mainCircles;
		// Strokes are applied via updateSelectionVisuals() below so the same
		// code path handles both initial paint and post-click updates.

		// (Hover tooltip moved out of SVG — rendered as a Svelte HTML element
		// in the template below so it mounts/unmounts instantly. See the
		// showTooltip / hideTooltip handlers wired on each bubble's
		// mouseenter / mouseleave above.)

		const externalLabelFill = theme === 'dark' ? 'rgba(232, 232, 238, 0.92)' : 'rgba(21, 21, 26, 0.88)';
		const externalLabelStroke = theme === 'dark' ? 'rgba(13, 13, 18, 0.7)' : 'rgba(255, 255, 255, 0.85)';

		nodeG.each(function (d) {
			const node = d3.select(this);
			const showCount = d.bugIds.length > 1;

			if (d.r >= 60) {
				// Big bubble: full area name + count both rendered INSIDE,
				// wrapped over up to 2 lines. Density wins here.
				const nameFont = d.r >= 80 ? 14 : 13;
				const countFont = nameFont - 2;
				const maxChars = Math.max(8, Math.floor((d.r * 1.7) / (nameFont * 0.58)));
				const lines = wrapLabel(d.primaryArea, maxChars, 2);
				const lineH = nameFont * 1.15;
				const countH = showCount ? countFont * 1.2 : 0;
				const totalH = lines.length * lineH + countH;
				let y = -totalH / 2 + lineH * 0.85;
				for (const line of lines) {
					node.append('text')
						.attr('text-anchor', 'middle')
						.attr('y', y)
						.attr('font-size', nameFont)
						.attr('font-weight', 600)
						.attr('fill', 'white')
						.attr('pointer-events', 'none')
						.text(line);
					y += lineH;
				}
				if (showCount) {
					node.append('text')
						.attr('text-anchor', 'middle')
						.attr('y', y + countH * 0.15)
						.attr('font-size', countFont)
						.attr('fill', 'rgba(255,255,255,0.92)')
						.attr('pointer-events', 'none')
						.text(`${d.bugIds.length} bugs`);
				}
				return;
			}

			// Small / medium bubble: count BIG inside (or empty for
			// singletons), area name as an external label below the bubble.
			// External labels are always readable regardless of bubble size,
			// and use a stroke/halo so they stay legible over the canvas bg.
			if (showCount) {
				const countFont = Math.min(18, Math.max(11, Math.round(d.r * 0.7)));
				node.append('text')
					.attr('text-anchor', 'middle')
					.attr('dy', '0.35em')
					.attr('font-size', countFont)
					.attr('font-weight', 700)
					.attr('fill', 'white')
					.attr('pointer-events', 'none')
					.text(d.bugIds.length);
			}

			const labelFont = 10;
			const labelGap = 5;
			// External label uses d.label (per-cluster discriminating
			// descriptor: "Dashboard · widgets", etc.) instead of
			// d.primaryArea. Truncated to 22 chars — short enough that two
			// adjacent labels are unlikely to fully overlap, full text in
			// tooltip. The collide force below also reserves the label's
			// horizontal extent so small bubbles physically space apart by
			// label width, not just bubble radius.
			const rawLabel = d.label || d.primaryArea;
			// Hard truncate — wider labels = wider collide circles = worse packing.
			const labelText = rawLabel.length > 18 ? rawLabel.slice(0, 17) + '…' : rawLabel;
			// Approximate half-width in pixels — 0.55 is a decent average
			// glyph-width-to-font-size ratio for the system sans stack. Fed
			// to the collide force so the simulation can resolve label
			// overlaps the same way it resolves bubble overlaps.
			(d as Node).labelHalfWidth = (labelText.length * labelFont * 0.55) / 2;
			const label = node.append('text')
				.attr('text-anchor', 'middle')
				.attr('y', d.r + labelGap + labelFont)
				.attr('font-size', labelFont)
				.attr('font-weight', 500)
				.attr('pointer-events', 'none')
				.text(labelText);
			// Halo via paint-order so the text reads cleanly on any bg.
			label
				.attr('stroke', externalLabelStroke)
				.attr('stroke-width', 2.5)
				.attr('paint-order', 'stroke')
				.attr('fill', externalLabelFill);

			// Preview pips inside drillable bubbles. One small colored dot
			// per sub-cluster (up to 5), painted near the bottom of the
			// bubble interior so they read as "there's structure inside
			// here, click to see it." Skipped for big bubbles (the inside
			// is already filled with label + count) and non-drillable
			// leaves (no structure to preview).
			if (d.drillable && d.subClusters && d.subClusters.length > 0 && d.r >= 16) {
				const pips = d.subClusters.slice(0, 5);
				const pipR = Math.max(2, Math.min(3.5, d.r / 9));
				const spacing = pipR * 2.4;
				const totalW = spacing * (pips.length - 1);
				const pipY = d.r * 0.55;
				pips.forEach((sc, i) => {
					node.append('circle')
						.attr('cx', -totalW / 2 + i * spacing)
						.attr('cy', pipY)
						.attr('r', pipR)
						.attr('fill', colorFor(sc.primaryArea))
						.attr('fill-opacity', 0.85)
						.attr('stroke', 'rgba(255,255,255,0.75)')
						.attr('stroke-width', 0.6)
						.attr('pointer-events', 'none');
				});
			}
		});

		// Numeric badge — rendered AFTER labels + pips so it stays on top.
		if (hotCounts && hotCounts.size > 0) renderHotBadges(nodeG, hotCounts);

		if (sim) sim.stop();
		const edgePad = 24;
		const labelBelowPx = 18;
		const cx = width / 2;
		const cy = height / 2;

		// Archive pool circular keep-out: custom force nudges out, clamp
		// projects remainder. Center + radius track the CSS (96px pool at
		// right:16/bottom:16 → center (width-64, height-64), r ≈ 54).
		const POOL_CX = width - 64;
		const POOL_CY = height - 64;
		const POOL_R = 54;

		sim = d3.forceSimulation(nodes)
			.force('link', d3.forceLink(links).id((d: any) => d.id).distance(70).strength(0.15))
			.force('charge', d3.forceManyBody<Node>().strength((d) => -8 - d.r * 0.6))
			.force('center', d3.forceCenter(cx, cy))
			.force('x', d3.forceX(cx).strength(0.06))
			.force('y', d3.forceY(cy).strength(0.06))
			// Generous padding + iterations(2): label is a wide rectangle
			// offset below the circular collide, so corners slip in at
			// oblique angles unless we over-reserve.
			.force('collide', d3.forceCollide<Node>().radius((d) => {
				if (d.r >= 60) return d.r + 14;
				const labelHW = d.labelHalfWidth ?? 0;
				return Math.max(d.r + 26, labelHW + 14);
			}).strength(0.95).iterations(2))
			.force('poolKeepOut', () => {
				for (const node of nodes as Array<Node & { x?: number; y?: number; vx?: number; vy?: number }>) {
					if (typeof node.x !== 'number' || typeof node.y !== 'number') continue;
					const dx = node.x - POOL_CX;
					const dy = node.y - POOL_CY;
					const minDist = POOL_R + node.r + 6;
					const dist2 = dx * dx + dy * dy;
					if (dist2 < minDist * minDist) {
						const dist = Math.sqrt(dist2) || 0.001;
						const push = (minDist - dist) / dist;
						node.vx = (node.vx ?? 0) + dx * push * 0.4;
						node.vy = (node.vy ?? 0) + dy * push * 0.4;
					}
				}
			})
			.stop();

		const clamp = () => {
			for (const n of nodes) {
				const node = n as Node & { x: number; y: number };
				const labelHW = node.r >= 60 ? 0 : (node.labelHalfWidth ?? 0);
				const xExtent = Math.max(node.r, labelHW);
				const labelBelow = node.r >= 60 ? 0 : labelBelowPx;
				if (typeof node.x === 'number') {
					node.x = Math.max(xExtent + edgePad, Math.min(width - xExtent - edgePad, node.x));
				}
				if (typeof node.y === 'number') {
					node.y = Math.max(node.r + edgePad, Math.min(height - node.r - labelBelow - edgePad, node.y));
				}
				// Circular keep-out: project nodes still inside the pool's
				// radius outward along the line from pool center → node.
				const dx = node.x - POOL_CX;
				const dy = node.y - POOL_CY;
				const minDist = POOL_R + node.r + 6;
				const dist = Math.hypot(dx, dy);
				if (dist < minDist) {
					const k = dist === 0 ? 1 : minDist / dist;
					node.x = POOL_CX + (dx === 0 ? -minDist : dx * k);
					node.y = POOL_CY + (dy === 0 ? 0 : dy * k);
					node.x = Math.max(xExtent + edgePad, Math.min(width - xExtent - edgePad, node.x));
					node.y = Math.max(node.r + edgePad, Math.min(height - node.r - labelBelow - edgePad, node.y));
				}
			}
		};

		// Headless settle — tick synchronously to alphaMin (no on('tick')
		// callback means no per-frame DOM writes, no visible wiggle). The
		// formula ceil(log(alphaMin) / log(1 - alphaDecay)) ≈ 300 ticks;
		// at ~25 nodes this finishes in <10ms.
		const numTicks = Math.ceil(
			Math.log(sim.alphaMin()) / Math.log(1 - sim.alphaDecay())
		);
		for (let i = 0; i < numTicks; i++) {
			sim.tick();
			clamp();
		}

		// One-time paint with the settled positions.
		linkSel
			.attr('x1', (d: any) => d.source.x).attr('y1', (d: any) => d.source.y)
			.attr('x2', (d: any) => d.target.x).attr('y2', (d: any) => d.target.y);
		nodeG.attr('transform', (d: any) => `translate(${d.x},${d.y})`);
	}

	// Cheap visual update — mutates stroke attrs on the existing main circles
	// without touching the DOM structure or the force simulation. This is what
	// runs on every bubble click; the sim keeps ticking from its current state
	// instead of respringboarding from the center.
	function updateSelectionVisuals() {
		if (!mainCircleSel) return;
		const hot = (id: string) => !!hotCounts && hotCounts.has(id);
		mainCircleSel
			.attr('stroke', (d) =>
				d.id === selectedId ? currentStrokes.selected : hot(d.id) ? currentStrokes.hot : currentStrokes.idle
			)
			.attr('stroke-width', (d) => (d.id === selectedId ? 3 : hot(d.id) ? 2 : 1));
	}

	// Structural rebuild. Restarts the force simulation, so gated tightly.
	// zoomingId is intentionally excluded — zoom runs in its own effect.
	$effect(() => {
		void clusters;
		void theme;
		void hotCounts;
		void parent;
		untrack(() => {
			render();
			updateSelectionVisuals();
			if (svgEl) applyHighlight(svgEl, highlightedIds);
		});
	});

	// Hover-highlight: cheap opacity-only update so dimming flips quickly
	// without re-running the force simulation.
	$effect(() => {
		const ids = highlightedIds;
		untrack(() => {
			if (svgEl) applyHighlight(svgEl, ids);
		});
	});

	// Zoom-in animation when zoomingId becomes non-null. The page mutates
	// drillPath after ~420ms, which triggers the structural effect above.
	$effect(() => {
		const id = zoomingId;
		untrack(() => {
			if (id != null && svgEl) runBubbleZoomIn(svgEl, id, ZOOM_ANIM_MS);
		});
	});

	// Reverse zoom on drill-back. Page mutates drillPath + zoomingBackToId
	// in the same flush, so the structural effect re-renders the parent
	// view first and this effect then animates the matching bubble back.
	$effect(() => {
		const id = zoomingBackToId;
		untrack(() => {
			if (id != null && svgEl) runBubbleZoomOut(svgEl, id, ZOOM_ANIM_MS);
		});
	});

	// Cheap selection update — fires on every click (selectedId change). No
	// DOM rebuild, no sim restart.
	$effect(() => {
		void selectedId;
		untrack(() => updateSelectionVisuals());
	});

	onDestroy(() => sim?.stop());

	// Re-render when the container width changes. Triggered by the
	// page-level split handle drag (and by window resizes generally).
	// Debounced + width-thresholded so it doesn't fire on every pointer
	// move during a drag — the bubbles refit on each settled width
	// rather than thrashing continuously.
	let resizeObserver: ResizeObserver | null = null;
	let resizeTimer: number | null = null;
	let lastObservedWidth = 0;
	let lastObservedHeight = 0;
	onMount(() => {
		if (typeof ResizeObserver === 'undefined' || !svgEl) return;
		lastObservedWidth = svgEl.clientWidth;
		lastObservedHeight = svgEl.clientHeight;
		resizeObserver = new ResizeObserver((entries) => {
			const rect = entries[0]?.contentRect;
			const w = rect?.width ?? 0;
			const h = rect?.height ?? 0;
			// Threshold both axes so transient sub-pixel jitter (e.g. flexbox
			// reflows during a split-handle drag) doesn't trigger a sim restart.
			// The viz fills its parent now, so vertical resizes are first-class
			// — without observing height the radar would only refit when the
			// page width changed.
			if (Math.abs(w - lastObservedWidth) < 6 && Math.abs(h - lastObservedHeight) < 6) return;
			lastObservedWidth = w;
			lastObservedHeight = h;
			if (resizeTimer !== null) window.clearTimeout(resizeTimer);
			resizeTimer = window.setTimeout(() => {
				if (clusters.length > 0) render();
			}, 120);
		});
		resizeObserver.observe(svgEl);
	});
	onDestroy(() => {
		resizeObserver?.disconnect();
		if (resizeTimer !== null) window.clearTimeout(resizeTimer);
	});
</script>

<!--
	The radar fills its parent (which sizes itself via the page-level
	flex column). 360px is the floor — below that the d3 layout starts
	clipping labels and the radar rings look anemic.

	The .sonar-radar visual (gradient + ring/spoke overlay) lives in
	src/lib/styles/sonar.css, imported once by the page.

	The tooltip is a sibling of the SVG (NOT inside it) so it can render
	on top via z-index without fighting SVG's coordinate space. Coordinates
	are in SVG pixel space (left, top relative to .sonar-radar's top-left),
	which matches the bubble's `(d.x, d.y)` 1:1 because the SVG has no
	viewBox and fills the radar.
-->
<div class="sonar-radar">
	<svg bind:this={svgEl} class="w-full h-full" style="position: relative; z-index: 1; display: block;"></svg>
	<BubbleTooltip {tooltip} />
	<ArchivePool
		count={archivedCount}
		active={archiveActive}
		onArchive={(id) => onArchiveBug?.(id)}
		onSelect={() => onSelectArchive?.()}
	/>
</div>
