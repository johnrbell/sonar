/**
 * Page-mount helpers extracted from +page.svelte so the script block has
 * room to host the URL-sync wiring without blowing the 500-line budget.
 *
 *  - restoreLocalPrefs: pulls theme + split ratio from localStorage,
 *    guarded against environments where localStorage throws (private
 *    browsing, embedded contexts).
 *  - lockDocumentOverflow: pins `<html>` and `<body>` to overflow:hidden
 *    + overscroll-behavior:none while Sonar is mounted so the fixed
 *    100vh layout doesn't trigger rubber-band bounce. Returns a cleanup
 *    fn that restores the prior values.
 */
import { SPLIT_MIN, SPLIT_MAX } from './split-drag';

export interface LocalPrefs {
	theme: 'light' | 'dark' | null;
	splitRatio: number | null;
}

export function restoreLocalPrefs(): LocalPrefs {
	try {
		const theme = localStorage.getItem('sonar.theme');
		const ratio = localStorage.getItem('sonar.split');
		const parsedRatio = ratio ? parseFloat(ratio) : null;
		const validRatio =
			parsedRatio !== null && !Number.isNaN(parsedRatio) && parsedRatio >= SPLIT_MIN && parsedRatio <= SPLIT_MAX;
		return {
			theme: theme === 'dark' || theme === 'light' ? theme : null,
			splitRatio: validRatio ? parsedRatio : null
		};
	} catch (e) {
		console.warn('[sonar] localStorage unavailable', e);
		return { theme: null, splitRatio: null };
	}
}

export function lockDocumentOverflow(): () => void {
	const html = document.documentElement;
	const body = document.body;
	const prev = [
		html.style.overflow,
		body.style.overflow,
		html.style.overscrollBehavior,
		body.style.overscrollBehavior
	];
	html.style.overflow = body.style.overflow = 'hidden';
	html.style.overscrollBehavior = body.style.overscrollBehavior = 'none';
	return () => {
		[
			html.style.overflow,
			body.style.overflow,
			html.style.overscrollBehavior,
			body.style.overscrollBehavior
		] = prev;
	};
}
