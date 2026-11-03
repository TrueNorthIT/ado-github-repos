// CI-1: check annotations under a line of the diff (head side). One MessageCard per annotation: its severity icon is the failure / warning / notice marker,
// and rawDetails folds away behind a native <details> (azure-devops-ui has no inline disclosure for plain text).
import * as React from "react";
import { Link } from "azure-devops-ui/Link";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import type { AnnotationAnchor, AnnotationLevel } from "./lib/annotations";

const SEVERITY: Record<AnnotationLevel, MessageCardSeverity> = { FAILURE: MessageCardSeverity.Error, WARNING: MessageCardSeverity.Warning, NOTICE: MessageCardSeverity.Info };
const LEVEL_TEXT: Record<AnnotationLevel, string> = { FAILURE: "Failure", WARNING: "Warning", NOTICE: "Notice" };
const safeUrl = (u?: string | null) => (u && /^https?:\/\//i.test(u) ? u : undefined);

/** `urls` maps a check name to its details page. */
export function AnnotationZone({ anchor, urls }: { anchor: AnnotationAnchor; urls: Map<string, string> }) {
  return (
    <>
      {anchor.annotations.map((a, i) => {
        const href = safeUrl(urls.get(a.checkName));
        return (
          <MessageCard key={i} className="gh-annotation" severity={SEVERITY[a.level]}>
            <div className="flex-column gh-annotation-body" role="group" aria-label={`${LEVEL_TEXT[a.level]} annotation from ${a.checkName}`}>
              {a.title && <span className="font-weight-semibold">{a.title}</span>}
              <span className="gh-annotation-message">{a.message}</span>
              <span className="secondary-text body-s">
                {LEVEL_TEXT[a.level]} from {href ? <Link href={href} target="_blank" rel="noopener noreferrer">{a.checkName}</Link> : a.checkName}
              </span>
              {a.details && (
                <details className="gh-annotation-details">
                  <summary className="body-s">Details</summary>
                  <pre className="body-s">{a.details}</pre>
                </details>
              )}
            </div>
          </MessageCard>
        );
      })}
    </>
  );
}
