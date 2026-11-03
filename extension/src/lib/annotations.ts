// CI-1: check annotations placed inline on the head (RIGHT) side of the Files diff. STUBS: the developer implements them.
// Source: GraphQL, not REST. One query reads the head commit's check runs with their first 50 annotations each and costs 3 rate-limit
// points for three PRs of up to 100 checks (measured with rateLimit { cost }), where REST needs one call per check run
// (GET /repos/{o}/{r}/check-runs/{id}/annotations). `totalCount` gives the true count when a run has more than 50.
// Rule shared with feedQuery.ts / prQuery.ts: every caller-supplied value travels in `variables`, never in the query text.
import type { GraphQlRequest } from "./prQuery";

export type AnnotationLevel = "FAILURE" | "WARNING" | "NOTICE";

/** CheckAnnotation as the query selects it. GitHub sends null for absent text and, for some apps, "" or a non-file path such as ".github" or "Build log ". */
export interface AnnotationNode {
  path: string | null;
  location: { start: { line: number | null } | null; end: { line: number | null } | null } | null;
  /** Nullable in the schema; null is treated as NOTICE. */
  annotationLevel: AnnotationLevel | null;
  title: string | null;
  message: string | null;
  rawDetails: string | null;
}

/** One entry of statusCheckRollup.contexts.nodes. StatusContext entries carry no annotations and are ignored. */
export type AnnotatedContext =
  | { __typename: "CheckRun"; databaseId: number; name: string; annotations: { totalCount: number; nodes: AnnotationNode[] } | null }
  | { __typename: "StatusContext" };

/** The head commit's check runs with annotations. Variables { owner, name, number }. Selects, per CheckRun, databaseId, name and annotations(first: 50) { totalCount nodes { path location { start { line } end { line } } annotationLevel title message rawDetails } }. */
export function annotationsQuery(_p: { owner: string; name: string; number: number }): GraphQlRequest {
  throw new Error("Not implemented");
}

export interface InlineAnnotation {
  checkName: string;
  level: AnnotationLevel;
  /** "" when GitHub sent none. */
  title: string;
  message: string;
  /** rawDetails; absent when null or blank. */
  details?: string;
}

export interface AnnotationAnchor {
  line: number;
  /** Always RIGHT: annotations describe the head commit. */
  side: "RIGHT";
  /** The worst level among `annotations`. */
  level: AnnotationLevel;
  /** FAILURE, then WARNING, then NOTICE; input order within a level. */
  annotations: InlineAnnotation[];
}

export interface CheckAnnotationCount {
  checkName: string;
  /** annotations.totalCount: every annotation, including those dropped from the diff and those beyond the 50 fetched. */
  total: number;
  failure: number;
  warning: number;
  notice: number;
  /** How many were placed on a file of the pull request. */
  inline: number;
  /** total is larger than the annotations fetched, so the counts by level are a lower bound. */
  truncated: boolean;
}

export interface MappedAnnotations {
  /** Anchors per PR file path, ascending by line. Files with no placed annotation have no entry. */
  byFile: Map<string, AnnotationAnchor[]>;
  /** One per check run that has at least one annotation: worst level first (FAILURE, WARNING, NOTICE), input order within a level. */
  perCheck: CheckAnnotationCount[];
}

/**
 * Places annotations on the head side of the pull request's files, grouped per (path, line) by the annotation's END line
 * (start line when no end line), and counts every annotation per check, whether or not it could be placed.
 * An annotation is dropped from the inline view when its path is not in `prPaths` or it has no line.
 */
export function mapAnnotations(_contexts: AnnotatedContext[], _prPaths: Iterable<string>): MappedAnnotations {
  throw new Error("Not implemented");
}
