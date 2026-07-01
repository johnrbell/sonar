<script lang="ts">
	import { FEATURE_AREAS } from '$lib/constants';

	type Props = {
		onClose: () => void;
		onSaved: () => void;
		theme: 'light' | 'dark';
	};
	let { onClose, onSaved, theme }: Props = $props();

	type IntakeType = 'bug' | 'feature' | 'question';

	let title = $state('');
	let description = $state('');
	let reporter = $state('');
	let severity = $state<'low' | 'medium' | 'high'>('medium');
	let intakeType = $state<IntakeType>('bug');
	let areas = $state<Set<string>>(new Set());
	let saving = $state(false);
	let errorMsg = $state<string | null>(null);

	// Per-type follow-up fields. Mirror the Slack modal so we can exercise
	// the whole flow without needing Slack wired up. All optional except
	// repro/expectedActual for bugs, userPain for features, context for
	// questions — but we don't enforce client-side; the server treats
	// meta as opaque.
	let device = $state('');
	let browser = $state('');
	let urlField = $state('');
	let repro = $state('');
	let expectedActual = $state('');
	let screenshotUrl = $state('');
	let userPain = $state('');
	let proposedApproach = $state('');
	let urgency = $state('');
	let audience = $state('');
	let context = $state('');

	function collectMeta(): Record<string, string> {
		const trim = (s: string) => s.trim();
		const out: Record<string, string> = {};
		if (intakeType === 'bug') {
			if (trim(device)) out.device = trim(device);
			if (trim(browser)) out.browser = trim(browser);
			if (trim(urlField)) out.url = trim(urlField);
			if (trim(repro)) out.repro = trim(repro);
			if (trim(expectedActual)) out.expectedActual = trim(expectedActual);
			if (trim(screenshotUrl)) out.screenshotUrl = trim(screenshotUrl);
		} else if (intakeType === 'feature') {
			if (trim(userPain)) out.userPain = trim(userPain);
			if (trim(proposedApproach)) out.proposedApproach = trim(proposedApproach);
			if (trim(urgency)) out.urgency = trim(urgency);
		} else {
			if (trim(audience)) out.audience = trim(audience);
			if (trim(context)) out.context = trim(context);
		}
		return out;
	}

	function toggle(a: string) {
		if (areas.has(a)) areas.delete(a);
		else areas.add(a);
		areas = new Set(areas);
	}

	async function save() {
		errorMsg = null;
		if (!title.trim() || !description.trim()) {
			errorMsg = 'Title and description are both required.';
			return;
		}
		saving = true;
		try {
			const r = await fetch('/api/bugs', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					title,
					description,
					reporter: reporter || undefined,
					severity,
					areas: Array.from(areas),
					intakeType,
					source: 'internal',
					meta: collectMeta()
				})
			});
			if (!r.ok) {
				const data = await r.json().catch(() => ({}));
				errorMsg = data.error || `Failed to save (${r.status})`;
				return;
			}
			onSaved();
		} finally {
			saving = false;
		}
	}
</script>

<div
	class="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
	data-theme={theme}
	onclick={(e) => { if (e.target === e.currentTarget) onClose(); }}
	role="presentation"
>
	<div class="modal-card rounded-xl p-6 w-[560px] max-w-[92vw] max-h-[90vh] overflow-y-auto shadow-xl">
		<div class="flex justify-between items-start mb-4">
			<div>
				<h2 class="text-lg font-medium modal-text">Log a ticket</h2>
				<p class="text-xs modal-muted mt-1">Mirrors the Slack follow-up flow — same fields, same `meta` shape.</p>
			</div>
			<button onclick={onClose} class="text-xl modal-muted hover:opacity-70" aria-label="Close">×</button>
		</div>

		<div class="flex flex-col gap-3">
			<div>
				<span class="text-xs uppercase tracking-wider modal-muted">Type</span>
				<div class="mt-1 inline-flex rounded border modal-border overflow-hidden">
					{#each [['bug', 'Bug'], ['feature', 'Feature'], ['question', 'Question']] as [v, label] (v)}
						<button
							type="button"
							onclick={() => (intakeType = v as IntakeType)}
							class="px-3 py-1.5 text-xs"
							class:type-tab-active={intakeType === v}
							style={intakeType === v ? '' : 'background: var(--modal-input-bg);'}
						>{label}</button>
					{/each}
				</div>
			</div>
			<label class="block">
				<span class="text-xs uppercase tracking-wider modal-muted">Title</span>
				<input bind:value={title} class="modal-input mt-1 w-full rounded px-3 py-2 text-sm" placeholder="One-line summary" />
			</label>
			<label class="block">
				<span class="text-xs uppercase tracking-wider modal-muted">Description</span>
				<textarea bind:value={description} rows="4" class="modal-input mt-1 w-full rounded px-3 py-2 text-sm" placeholder="What's broken? Browser, version, what you tried, who's affected."></textarea>
			</label>
			<div class="grid grid-cols-2 gap-3">
				<label class="block">
					<span class="text-xs uppercase tracking-wider modal-muted">Your name</span>
					<input bind:value={reporter} class="modal-input mt-1 w-full rounded px-3 py-2 text-sm" placeholder="Reporter" />
				</label>
				<label class="block">
					<span class="text-xs uppercase tracking-wider modal-muted">Severity</span>
					<select bind:value={severity} class="modal-input mt-1 w-full rounded px-3 py-2 text-sm">
						<option value="low">Low</option>
						<option value="medium">Medium</option>
						<option value="high">High</option>
					</select>
				</label>
			</div>
			<div>
				<span class="text-xs uppercase tracking-wider modal-muted">Feature areas</span>
				<div class="mt-1 flex flex-wrap gap-1 max-h-40 overflow-y-auto">
					{#each FEATURE_AREAS as a (a)}
						<button
							type="button"
							onclick={() => toggle(a)}
							class="px-2 py-1 text-xs rounded-full border transition area-pill"
							class:area-pill-active={areas.has(a)}
						>{a}</button>
					{/each}
				</div>
				<p class="text-xs modal-muted mt-1">Leave blank if unsure — AI also infers from the text.</p>
			</div>

			<div class="rounded border modal-border p-3" style="background: var(--modal-input-bg);">
				<div class="text-xs uppercase tracking-wider modal-muted mb-2">
					{intakeType === 'bug' ? 'Repro details' : intakeType === 'feature' ? 'Feature details' : 'Question details'}
				</div>
				{#if intakeType === 'bug'}
					<div class="grid grid-cols-2 gap-2">
						<input bind:value={device} class="modal-input rounded px-3 py-2 text-sm" placeholder="Device / OS (e.g. MacBook · macOS 14)" />
						<input bind:value={browser} class="modal-input rounded px-3 py-2 text-sm" placeholder="Browser (e.g. Chrome 124)" />
					</div>
					<input bind:value={urlField} class="modal-input mt-2 w-full rounded px-3 py-2 text-sm" placeholder="URL where it happens" />
					<textarea bind:value={repro} rows="3" class="modal-input mt-2 w-full rounded px-3 py-2 text-sm" placeholder="Repro steps — 1. Open … 2. Click … 3. See …"></textarea>
					<textarea bind:value={expectedActual} rows="2" class="modal-input mt-2 w-full rounded px-3 py-2 text-sm" placeholder="Expected vs. actual"></textarea>
					<input bind:value={screenshotUrl} class="modal-input mt-2 w-full rounded px-3 py-2 text-sm" placeholder="Screenshot URL (Slack/Drive/Cleanshot link)" />
				{:else if intakeType === 'feature'}
					<textarea bind:value={userPain} rows="3" class="modal-input w-full rounded px-3 py-2 text-sm" placeholder="User pain — what problem does this solve?"></textarea>
					<textarea bind:value={proposedApproach} rows="2" class="modal-input mt-2 w-full rounded px-3 py-2 text-sm" placeholder="Proposed approach (optional)"></textarea>
					<input bind:value={urgency} class="modal-input mt-2 w-full rounded px-3 py-2 text-sm" placeholder="Urgency / business value" />
				{:else}
					<input bind:value={audience} class="modal-input w-full rounded px-3 py-2 text-sm" placeholder="Who is this for? (internal / customer / partner)" />
					<textarea bind:value={context} rows="3" class="modal-input mt-2 w-full rounded px-3 py-2 text-sm" placeholder="Context — what are you trying to do?"></textarea>
				{/if}
			</div>

			{#if errorMsg}
				<div class="bg-red-50 dark-error border border-red-200 text-red-700 px-3 py-2 rounded text-sm">{errorMsg}</div>
			{/if}

			<div class="flex justify-end gap-2 mt-2">
				<button onclick={onClose} class="px-3 py-2 border modal-border modal-text rounded text-sm">Cancel</button>
				<button onclick={save} disabled={saving} class="px-3 py-2 text-white rounded text-sm disabled:opacity-60" style="background: #4a1ee3;">
					{saving ? 'Saving…' : 'Save bug'}
				</button>
			</div>
		</div>
	</div>
</div>

<style>
	[data-theme='light'] {
		--modal-bg: #ffffff;
		--modal-input-bg: #f8f8fa;
		--modal-text: #15151a;
		--modal-muted: #6b7280;
		--modal-border: #e5e7eb;
	}
	[data-theme='dark'] {
		--modal-bg: #16161e;
		--modal-input-bg: #1c1c26;
		--modal-text: #e8e8ee;
		--modal-muted: #9aa0aa;
		--modal-border: #2a2a36;
	}
	.modal-card { background: var(--modal-bg); color: var(--modal-text); border: 1px solid var(--modal-border); }
	.modal-text { color: var(--modal-text); }
	.modal-muted { color: var(--modal-muted); }
	.modal-border { border-color: var(--modal-border); }
	.modal-input {
		background: var(--modal-input-bg);
		border: 1px solid var(--modal-border);
		color: var(--modal-text);
	}
	.modal-input:focus { outline: 2px solid #4a1ee3; outline-offset: 0; border-color: #4a1ee3; }
	.area-pill {
		background: var(--modal-input-bg);
		border-color: var(--modal-border);
		color: var(--modal-text);
	}
	.area-pill-active {
		background: #4a1ee3 !important;
		border-color: #4a1ee3 !important;
		color: #ffffff !important;
	}
	.type-tab-active {
		background: #4a1ee3;
		color: #ffffff;
	}
	[data-theme='dark'] .dark-error {
		background: rgba(239, 68, 68, 0.12);
		border-color: rgba(239, 68, 68, 0.4);
		color: #fca5a5;
	}
</style>
