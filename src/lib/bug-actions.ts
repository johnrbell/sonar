// Page-level mutation helpers extracted to keep +page.svelte under
// the 500-line cap. Each function does the same shape: PATCH /api/bugs/[id],
// surface any failure via the caller's error setter, then reload via the
// caller's `reload` callback so the cluster + archive views re-derive on the
// next tick. Auth rides along on the session cookie (same-origin fetch).

type Ctx = {
	reload: () => Promise<void> | void;
	setError: (msg: string | null) => void;
};

async function patchBug(
	ctx: Ctx,
	bugId: string,
	body: Record<string, unknown>,
	failLabel: string
): Promise<void> {
	try {
		const r = await fetch(`/api/bugs/${encodeURIComponent(bugId)}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
		if (!r.ok) throw new Error(`${failLabel} failed (${r.status})`);
		await ctx.reload();
	} catch (e) {
		ctx.setError(e instanceof Error ? e.message : `${failLabel} failed`);
	}
}

export function makeBugActions(ctx: Ctx) {
	return {
		archive: (id: string) => patchBug(ctx, id, { archived: true }, 'Archive'),
		unarchive: (id: string) => patchBug(ctx, id, { archived: false }, 'Unarchive')
	};
}
