<script lang="ts">
	import { goto } from '$app/navigation';

	let password = $state('');
	let error = $state<string | null>(null);
	let submitting = $state(false);

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		error = null;
		submitting = true;
		try {
			const r = await fetch('/api/login', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ password })
			});
			if (!r.ok) {
				const data = await r.json().catch(() => ({}));
				error = data.error || `Sign in failed (${r.status})`;
				return;
			}
			await goto('/', { invalidateAll: true });
		} catch (err) {
			error = err instanceof Error ? err.message : 'Something went wrong.';
		} finally {
			submitting = false;
		}
	}
</script>

<svelte:head>
	<title>Sonar — sign in</title>
</svelte:head>

<div class="min-h-screen flex items-center justify-center bg-gray-50 px-6">
	<form
		onsubmit={submit}
		class="w-full max-w-sm bg-white rounded-xl border border-gray-200 shadow-sm p-8"
	>
		<div class="flex items-center gap-3 mb-6">
			<svg
				width="32"
				height="32"
				viewBox="0 0 24 24"
				fill="none"
				stroke="#4a1ee3"
				stroke-width="1.5"
				aria-hidden="true"
			>
				<circle cx="12" cy="12" r="3" />
				<circle cx="12" cy="12" r="7" stroke-opacity="0.6" />
				<circle cx="12" cy="12" r="11" stroke-opacity="0.35" />
				<line x1="12" y1="12" x2="20" y2="6" stroke-width="1.5" />
			</svg>
			<div>
				<h1 class="text-lg font-semibold text-gray-900 leading-tight">Sonar</h1>
				<p class="text-xs text-gray-500">Bug &amp; feedback radar</p>
			</div>
		</div>

		<label class="block mb-4">
			<span class="text-xs font-medium uppercase tracking-wider text-gray-500">Password</span>
			<!-- svelte-ignore a11y_autofocus -->
			<input
				type="password"
				bind:value={password}
				autofocus
				autocomplete="current-password"
				class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#4a1ee3] focus:border-[#4a1ee3]"
				placeholder="Enter password"
			/>
		</label>

		{#if error}
			<div class="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
				{error}
			</div>
		{/if}

		<button
			type="submit"
			disabled={submitting || !password}
			class="w-full px-4 py-2.5 rounded-lg bg-[#4a1ee3] text-white font-medium text-sm hover:bg-[#3e18bb] transition-colors disabled:opacity-50"
		>
			{submitting ? 'Signing in…' : 'Sign in'}
		</button>
	</form>
</div>
