// Finding Azure Boards work items to link (ED-4): by id, or by words in the title through WIQL within the current project.

/** What the user typed as a work item id: "123", "#123" or "AB#123". null when it is not one. */
export function parseWorkItemId(text: string): number | null {
  const m = /^\s*(?:AB)?#?(\d{1,9})\s*$/i.exec(text);
  const id = m ? Number(m[1]) : 0;
  return id > 0 ? id : null;
}

/** WIQL for work items of the current project whose title contains `text`, newest change first. Single quotes are doubled (WIQL's escape) and the text never leaves the string literal. */
export function wiqlTitleQuery(text: string): { query: string } {
  const t = text.trim().replace(/'/g, "''");
  return { query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.Title] CONTAINS '${t}' ORDER BY [System.ChangedDate] DESC` };
}

export const wiqlUrl = (org: string, project: string, top: number) => `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/wit/wiql?$top=${top}&api-version=7.1`;

/** The ids in a WIQL answer, in order. */
export function parseWiqlIds(body: { workItems?: ({ id: number } | null)[] } | null | undefined): number[] {
  return (body?.workItems ?? []).flatMap((w) => (w && Number.isSafeInteger(w.id) && w.id > 0 ? [w.id] : []));
}
