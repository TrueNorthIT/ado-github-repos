// GitHub refuses a GitHub App's change under .github/workflows/ unless the app has the "Workflows: write" permission, with a message
// such as "refusing to allow a GitHub App to create or update workflow `.github/workflows/ci.yml` without `workflows` permission"
// (an OAuth app hears "... without `workflow` scope"). GraphQL may answer it as FORBIDDEN, which arrives without the message, so a
// 403 or 404 on a change that touches a workflow file counts too. The app's permissions are not ours to change from here.

export const WORKFLOW_PERMISSION_TEXT =
  "GitHub refused the change because the GitHub Repos app does not have the Workflows permission, which GitHub requires for any change under .github/workflows/. Commit this change on GitHub or with Git, or ask an organisation owner whether the app should be given Workflows (write) access.";

export const isWorkflowPath = (path: string) => /^\.github\/workflows\/./.test(path.replace(/^\/+/, ""));

/** Whether a failed write was GitHub refusing a workflow change for want of the Workflows permission. */
export function isWorkflowPermissionError(e: { status?: number; message?: string }, paths: string[]): boolean {
  if (/without [`'"]?workflows?[`'"]? (permission|scope)/i.test(e.message ?? "")) return true;
  return paths.some(isWorkflowPath) && (e.status === 403 || e.status === 404);
}
