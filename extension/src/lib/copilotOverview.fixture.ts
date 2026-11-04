// Trimmed from a real Copilot review body (TrueNorthIT/tn-local-agents#1, read with `gh api .../pulls/1/reviews/5765347505`, 2026-11-04): the overview
// list kept to four of its eight items and the "What changed" section dropped. Item text is verbatim.
export const COPILOT_OVERVIEW_BODY = `<!-- ccr-overview-v2 -->

### 🟡 Changes recommended

Agent-controlled output symlinks can expose private runner files, while unrecovered agent errors can cause partial changes to be published and marked complete.

<details open>
<summary><strong>8 open issues</strong></summary>

- <picture><source media="(prefers-color-scheme: dark)" srcset="https://github.githubassets.com/static/images/icons/copilot-code-review/high-v2-dark.svg"><source media="(prefers-color-scheme: light)" srcset="https://github.githubassets.com/static/images/icons/copilot-code-review/high-v2-light.svg"><img src="https://github.githubassets.com/static/images/icons/copilot-code-review/high-v2-light.png" alt="High severity" width="62" height="18" align="texttop"></picture> [Reject symlinks before reading agent-written output](https://github.com/TrueNorthIT/tn-local-agents/pull/1#discussion_r4465220965) · New
- <picture><source media="(prefers-color-scheme: dark)" srcset="https://github.githubassets.com/static/images/icons/copilot-code-review/high-v2-dark.svg"><source media="(prefers-color-scheme: light)" srcset="https://github.githubassets.com/static/images/icons/copilot-code-review/high-v2-light.svg"><img src="https://github.githubassets.com/static/images/icons/copilot-code-review/high-v2-light.png" alt="High severity" width="62" height="18" align="texttop"></picture> [Exit nonzero when the agent run fails](https://github.com/TrueNorthIT/tn-local-agents/pull/1#discussion_r4465221016) · New
- <picture><source media="(prefers-color-scheme: dark)" srcset="https://github.githubassets.com/static/images/icons/copilot-code-review/medium-v2-dark.svg"><source media="(prefers-color-scheme: light)" srcset="https://github.githubassets.com/static/images/icons/copilot-code-review/medium-v2-light.svg"><img src="https://github.githubassets.com/static/images/icons/copilot-code-review/medium-v2-light.png" alt="Medium severity" width="62" height="18" align="texttop"></picture> [Handle missing xUnit summaries without aborting](https://github.com/TrueNorthIT/tn-local-agents/pull/1#discussion_r4465221138) · New
- <picture><source media="(prefers-color-scheme: dark)" srcset="https://github.githubassets.com/static/images/icons/copilot-code-review/medium-v2-dark.svg"><source media="(prefers-color-scheme: light)" srcset="https://github.githubassets.com/static/images/icons/copilot-code-review/medium-v2-light.svg"><img src="https://github.githubassets.com/static/images/icons/copilot-code-review/medium-v2-light.png" alt="Medium severity" width="62" height="18" align="texttop"></picture> [Expand and JSON-quote the default reasoning effort](https://github.com/TrueNorthIT/tn-local-agents/pull/1#discussion_r4465221234) · New
</details>

<sub>Review effort: Balanced</sub>`;
