/** A GitHub REST call described as data, so the logic can be tested without the network. `path` starts with `/repos/{owner}/{repo}`; `body` is absent when the call takes none. */
export interface RestRequest {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  body?: Record<string, unknown>;
}
