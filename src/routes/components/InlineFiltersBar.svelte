<script lang="ts">
	import { FEATURE_AREAS } from '$lib/constants';
	import type { IntakeType, Severity, Status } from '$lib/schemas';
	import { UNASSIGNED_SENTINEL } from '$lib/filter-helpers';
	import InlineMultiPicker from './InlineMultiPicker.svelte';

	// Single-row, always-visible filter bar. Replaces the chip row + the
	// People + Attributes tabs of the old popover menu. Threshold, AI
	// toggle, and the cluster directory still live in the header popover
	// (they're settings, not filters).
	type SourceFilter = '' | 'internal' | 'public' | 'slack';

	type Props = {
		searchText: string;
		sourceFilter: SourceFilter;
		areaFilter: string;
		severityFilter: Set<Severity>;
		statusFilter: Set<Status>;
		intakeTypeFilter: Set<IntakeType>;
		reporterFilter: Set<string>;
		responderFilter: Set<string>;
		assigneeFilter: Set<string>;
		reporterOptions: Array<[string, number]>;
		responderOptions: Array<[string, number]>;
		assigneeOptions: Array<[string, number]>;
		hasUnassignedBugs: boolean;
		activeFilterCount: number;
		onSetSearch: (v: string) => void;
		onSetArea: (v: string) => void;
		onSetSource: (v: SourceFilter) => void;
		onToggleSeverity: (v: Severity) => void;
		onToggleStatus: (v: Status) => void;
		onToggleIntakeType: (v: IntakeType) => void;
		onToggleReporter: (v: string) => void;
		onToggleResponder: (v: string) => void;
		onToggleAssignee: (v: string) => void;
		onClearAll: () => void;
		onClearDimension: (kind: 'severity' | 'status' | 'intakeType' | 'reporter' | 'responder' | 'assignee') => void;
	};
	let {
		searchText,
		sourceFilter,
		areaFilter,
		severityFilter,
		statusFilter,
		intakeTypeFilter,
		reporterFilter,
		responderFilter,
		assigneeFilter,
		reporterOptions,
		responderOptions,
		assigneeOptions,
		hasUnassignedBugs,
		activeFilterCount,
		onSetSearch,
		onSetArea,
		onSetSource,
		onToggleSeverity,
		onToggleStatus,
		onToggleIntakeType,
		onToggleReporter,
		onToggleResponder,
		onToggleAssignee,
		onClearAll,
		onClearDimension
	}: Props = $props();

	const SEVERITY_OPTIONS: Array<{ value: Severity; label: string }> = [
		{ value: 'high', label: 'High' },
		{ value: 'medium', label: 'Medium' },
		{ value: 'low', label: 'Low' }
	];
	const STATUS_OPTIONS: Array<{ value: Status; label: string }> = [
		{ value: 'open', label: 'Open' },
		{ value: 'in-progress', label: 'In progress' },
		{ value: 'resolved', label: 'Resolved' }
	];
	const INTAKE_TYPE_OPTIONS: Array<{ value: IntakeType; label: string }> = [
		{ value: 'bug', label: 'Bug' },
		{ value: 'feature', label: 'Feature' },
		{ value: 'question', label: 'Question' }
	];

	// Map [value, count] tuples into the picker's Option shape.
	const reporterOpts = $derived(reporterOptions.map(([v, c]) => ({ value: v, count: c })));
	const responderOpts = $derived(responderOptions.map(([v, c]) => ({ value: v, count: c })));
	const assigneeOpts = $derived(assigneeOptions.map(([v, c]) => ({ value: v, count: c })));
</script>

<div class="sonar-inline-filters" role="region" aria-label="Filters">
	<div class="sonar-inline-filters-row">
		<!-- Free-text search -->
		<div class="sonar-inline-search">
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				<circle cx="11" cy="11" r="7" />
				<line x1="21" y1="21" x2="16.65" y2="16.65" />
			</svg>
			<input
				type="search"
				placeholder="Search title + description…"
				value={searchText}
				oninput={(e) => onSetSearch((e.currentTarget as HTMLInputElement).value)}
				class="sonar-inline-search-input"
				aria-label="Search bugs"
			/>
		</div>

		<InlineMultiPicker
			label="Severity"
			options={SEVERITY_OPTIONS}
			selected={severityFilter as Set<string>}
			onToggle={(v) => onToggleSeverity(v as Severity)}
			onClear={() => onClearDimension('severity')}
			searchAfter={99}
		/>

		<InlineMultiPicker
			label="Status"
			options={STATUS_OPTIONS}
			selected={statusFilter as Set<string>}
			onToggle={(v) => onToggleStatus(v as Status)}
			onClear={() => onClearDimension('status')}
			searchAfter={99}
		/>

		<InlineMultiPicker
			label="Type"
			options={INTAKE_TYPE_OPTIONS}
			selected={intakeTypeFilter as Set<string>}
			onToggle={(v) => onToggleIntakeType(v as IntakeType)}
			onClear={() => onClearDimension('intakeType')}
			searchAfter={99}
		/>

		<!-- Single-select native dropdowns for area + source — they're 1-of-N
		   and don't need the multi-select popover treatment. -->
		<select
			value={areaFilter}
			onchange={(e) => onSetArea((e.currentTarget as HTMLSelectElement).value)}
			class="sonar-inline-select"
			class:is-active={!!areaFilter}
			aria-label="Filter by area"
		>
			<option value="">Area</option>
			{#each FEATURE_AREAS as a (a)}
				<option value={a}>{a}</option>
			{/each}
		</select>

		<select
			value={sourceFilter}
			onchange={(e) => onSetSource((e.currentTarget as HTMLSelectElement).value as SourceFilter)}
			class="sonar-inline-select"
			class:is-active={!!sourceFilter}
			aria-label="Filter by source"
		>
			<option value="">Source</option>
			<option value="slack">Slack</option>
			<option value="internal">Internal</option>
			<option value="public">Public</option>
		</select>

		<InlineMultiPicker
			label="Reporter"
			options={reporterOpts}
			selected={reporterFilter}
			onToggle={onToggleReporter}
			onClear={() => onClearDimension('reporter')}
		/>

		<InlineMultiPicker
			label="Tagged"
			options={responderOpts}
			selected={responderFilter}
			onToggle={onToggleResponder}
			onClear={() => onClearDimension('responder')}
		/>

		<InlineMultiPicker
			label="Owner"
			options={assigneeOpts}
			selected={assigneeFilter}
			onToggle={onToggleAssignee}
			onClear={() => onClearDimension('assignee')}
			noneSentinel={{ value: UNASSIGNED_SENTINEL, label: '(unassigned)', show: hasUnassignedBugs }}
		/>

		{#if activeFilterCount > 0}
			<button
				type="button"
				class="sonar-inline-clear-all"
				onclick={onClearAll}
			>Clear all</button>
		{/if}
	</div>
</div>
