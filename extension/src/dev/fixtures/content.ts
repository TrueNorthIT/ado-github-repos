// Hand-written file contents and GitHub-style rendered HTML for the mock repos.
export const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAADAAAAAYCAIAAAAzn+mLAAAAPUlEQVR4nGNgiFqAFYnk3cGKaK5+1EGjDhp10Ihz0IBZjEP9qINGHTTqoJHnoIGyGKf6UQeNOmjUQSPNQQBA9UZMRs7yRQAAAABJRU5ErkJggg==";
export const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80" viewBox="0 0 160 80"><rect width="160" height="80" rx="8" fill="#0b6e4f"/><circle cx="40" cy="40" r="22" fill="#f4d35e"/><text x="76" y="46" font-family="Segoe UI, sans-serif" font-size="18" fill="#fff">diagram</text></svg>`;

export const README_MD = `# GitHub Repos

![Logo](docs/img/logo.png)

A **fixture** README. See the [guide](docs/guide.md) or [the entry point](src/index.ts).
`;

export const GUIDE_MD = `# Guide

Short markdown doc. Back to the [README](../README.md).
`;

export const README_HTML = `<div class="markdown-body"><h1><a id="user-content-github-repos" class="anchor" aria-hidden="true" href="#github-repos"></a>GitHub Repos</h1>
<p><img src="docs/img/logo.png" alt="Logo" width="192"></p>
<p>A <strong>fixture</strong> README. See the <a href="docs/guide.md">guide</a> or <a href="src/index.ts">the entry point</a>, or the <a href="https://example.com/">outside world</a>.</p>
<div class="markdown-alert markdown-alert-note" dir="auto"><p class="markdown-alert-title" dir="auto"><svg class="octicon octicon-info mr-2" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Z"></path></svg>Note</p><p dir="auto">This is mock data served by <code>src/dev/mockFetch.ts</code>.</p></div>
<div class="markdown-alert markdown-alert-tip" dir="auto"><p class="markdown-alert-title" dir="auto"><svg class="octicon octicon-info mr-2" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Z"></path></svg>Tip</p><p dir="auto">Add <code>?theme=dark</code> to see the dark theme.</p></div>
<div class="markdown-alert markdown-alert-important" dir="auto"><p class="markdown-alert-title" dir="auto"><svg class="octicon octicon-info mr-2" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Z"></path></svg>Important</p><p dir="auto">Mocks stay behind the esbuild alias.</p><ul><li>They never reach <code>dist</code>.</li><li>The publish workflow checks.</li></ul></div>
<div class="markdown-alert markdown-alert-warning" dir="auto"><p class="markdown-alert-title" dir="auto"><svg class="octicon octicon-info mr-2" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Z"></path></svg>Warning</p><p dir="auto">Nothing here is real.</p></div>
<div class="markdown-alert markdown-alert-caution" dir="auto"><p class="markdown-alert-title" dir="auto"><svg class="octicon octicon-info mr-2" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Z"></path></svg>Caution</p><p dir="auto">Writes in live mode land in the real sandbox.</p></div>
<h2><a id="user-content-install" class="anchor" aria-hidden="true" href="#install"></a>Install</h2>
<div class="highlight highlight-source-shell"><pre>npm install
npm run dev <span class="pl-c"><span class="pl-c">#</span> http://localhost:3000</span></pre></div>
<div class="highlight highlight-source-ts"><pre><span class="pl-k">export</span> <span class="pl-k">function</span> <span class="pl-en">greet</span>(<span class="pl-s1">name</span>: <span class="pl-smi">string</span>) {
  <span class="pl-k">return</span> <span class="pl-s">"Hello, "</span> <span class="pl-c1">+</span> <span class="pl-s1">name</span><span class="pl-kos">;</span>
}</pre></div>
<h2><a id="user-content-features" class="anchor" aria-hidden="true" href="#features"></a>Features</h2>
<table><thead><tr><th>Feature</th><th>Status</th></tr></thead><tbody>
<tr><td>Repo list</td><td>Done</td></tr><tr><td>File browser</td><td>Done</td></tr><tr><td>Search</td><td>Planned</td></tr></tbody></table>
<ul class="contains-task-list">
<li class="task-list-item"><input type="checkbox" class="task-list-item-checkbox" disabled checked> Browse files</li>
<li class="task-list-item"><input type="checkbox" class="task-list-item-checkbox" disabled> Dark mode polish</li>
</ul>
<blockquote><p>A quote, for the border colour.</p></blockquote></div>`;

export const GUIDE_HTML = `<div class="markdown-body"><h1><a id="user-content-guide" class="anchor" aria-hidden="true" href="#guide"></a>Guide</h1>
<p>Short markdown doc. Back to the <a href="../README.md">README</a>.</p></div>`;

export const INDEX_TS = `import { greet } from "./util/greet";

interface User {
  id: number;
  name: string;
}

const users: User[] = [{ id: 1, name: "Ada" }, { id: 2, name: "Grace" }];

// Print a greeting for everyone.
export async function main(): Promise<void> {
  for (const u of users) {
    console.log(greet(u.name), \`(#\${u.id})\`);
  }
}

main();
`;

export const PROGRAM_CS = `using System;

namespace Demo
{
    public class Program
    {
        // Entry point.
        public static void Main(string[] args)
        {
            var names = new[] { "Ada", "Grace" };
            foreach (var n in names) Console.WriteLine($"Hello, {n}!");
        }
    }
}
`;

export const PACKAGE_JSON = `{
  "name": "github-repos",
  "version": "1.2.3",
  "private": true,
  "scripts": { "build": "tsc", "test": "vitest run" },
  "dependencies": { "react": "^16.14.0" }
}
`;

export const CI_YML = `name: ci
on:
  push:
    branches: [main]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm test
`;

export const LICENSE = "MIT License\n\nCopyright (c) 2026 TrueNorthIT\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software.\n";
