import { describe, it, expect } from "vitest";
import { classifyFile, monacoLanguage } from "./fileKind";

// Module under test: src/lib/fileKind.ts (classifyFile, monacoLanguage).

const MB = 1048576;
const textBytes = (n = 100) => new Uint8Array(n).fill(65); // "A" repeated, no NUL
const withNulAt = (index: number, length = Math.max(index + 1, 100)) => {
  const b = textBytes(length);
  b[index] = 0;
  return b;
};

describe("B-9: Images show as images", () => {
  // classifyFile(name, size) returns "image" for these extensions, case-insensitively, even without bytes.
  it.each(["a.png", "a.jpg", "a.jpeg", "a.gif", "a.webp", "a.bmp", "a.ico", "a.svg", "PHOTO.PNG", "dir.v2/pic.Jpeg"])("classifies %s as an image", (name) => {
    expect(classifyFile(name, 2048), `Expected ${name} to be classified as "image"`).toBe("image");
  });

  it("still treats an image as an image when its bytes contain NUL (PNG headers do)", () => {
    expect(classifyFile("a.png", 2048, withNulAt(2)), "Expected NUL bytes not to make an image 'binary'").toBe("image");
  });

  it("allows images over 1 MB, up to 10 MB inclusive", () => {
    expect(classifyFile("big.png", 5 * MB), "Expected a 5 MB image to be shown").toBe("image");
    expect(classifyFile("big.png", 10 * MB), "Expected a 10 MB (10,485,760 byte) image to be shown").toBe("image");
  });

  it("treats an image over 10 MB as too large", () => {
    expect(classifyFile("huge.png", 10 * MB + 1), "Expected a 10,485,761 byte image to be 'tooLarge'").toBe("tooLarge");
  });
});

describe("B-6: Markdown files open rendered", () => {
  it.each(["README.md", "notes.markdown", "README.MD", "docs/guide.md"])("classifies %s as markdown", (name) => {
    expect(classifyFile(name, 500), `Expected ${name} to be classified as "markdown"`).toBe("markdown");
  });
  it("classifies an empty markdown file as markdown", () => {
    expect(classifyFile("empty.md", 0), "Expected a zero-byte .md to be markdown").toBe("markdown");
  });
  it("classifies markdown with ordinary text bytes as markdown", () => {
    expect(classifyFile("a.md", 100, textBytes()), "Expected .md with text bytes to stay markdown").toBe("markdown");
  });
});

describe("B-9: Files over 1 MB show \"Can't preview\"", () => {
  it("allows text exactly 1 MB (1,048,576 bytes)", () => {
    expect(classifyFile("a.ts", MB), "Expected exactly 1,048,576 bytes not to be 'tooLarge'").toBe("text");
  });
  it("treats text one byte over 1 MB as too large", () => {
    expect(classifyFile("a.ts", MB + 1), "Expected 1,048,577 bytes to be 'tooLarge'").toBe("tooLarge");
  });
  it("treats markdown over 1 MB as too large", () => {
    expect(classifyFile("big.md", MB + 1), "Expected a large .md to be 'tooLarge'").toBe("tooLarge");
  });
  it("treats a file with no extension over 1 MB as too large", () => {
    expect(classifyFile("LICENSE", 2 * MB), "Expected a large extensionless file to be 'tooLarge'").toBe("tooLarge");
  });
});

describe("B-9: Other binary files show \"Can't preview\"", () => {
  it.each(["a.zip", "a.exe", "a.dll", "a.pdf", "a.woff", "a.woff2", "A.ZIP"])("classifies %s as binary from the name alone", (name) => {
    expect(classifyFile(name, 2048), `Expected ${name} to be 'binary' without reading bytes`).toBe("binary");
  });

  it("classifies a NUL byte in the first 8,000 bytes as binary, whatever the extension", () => {
    expect(classifyFile("data.txt", 100, withNulAt(0)), "Expected NUL at byte 0 in .txt to be 'binary'").toBe("binary");
    expect(classifyFile("script.ts", 9000, withNulAt(7999, 8000)), "Expected NUL at byte 7,999 in .ts to be 'binary'").toBe("binary");
    expect(classifyFile("notes.md", 100, withNulAt(50)), "Expected NUL in a .md to be 'binary', not markdown").toBe("binary");
    expect(classifyFile("noext", 100, withNulAt(10)), "Expected NUL in an extensionless file to be 'binary'").toBe("binary");
  });

  it("ignores a NUL byte after the first 8,000 bytes", () => {
    expect(classifyFile("big.txt", 9000, withNulAt(8000, 9000)), "Expected NUL at byte 8,000 (past the window) not to make a file binary").toBe("text");
  });

  it("classifies ordinary text bytes as text", () => {
    expect(classifyFile("a.cs", 100, textBytes()), "Expected a .cs with text bytes to be 'text'").toBe("text");
  });

  it("classifies unknown and missing extensions as text when there are no bytes to contradict it", () => {
    expect(classifyFile("LICENSE", 100), "Expected an extensionless file to be 'text'").toBe("text");
    expect(classifyFile("Makefile", 100), "Expected Makefile to be 'text'").toBe("text");
    expect(classifyFile("a.unknownext", 100), "Expected an unknown extension to be 'text'").toBe("text");
    expect(classifyFile(".gitignore", 100), "Expected a dotfile to be 'text'").toBe("text");
  });
});

describe("B-9: Monaco language from the file name (monacoLanguage)", () => {
  it.each([
    ["a.ts", "typescript"],
    ["a.tsx", "typescript"],
    ["a.js", "javascript"],
    ["a.json", "json"],
    ["a.cs", "csharp"],
    ["a.py", "python"],
    ["a.yml", "yaml"],
    ["a.yaml", "yaml"],
    ["a.xml", "xml"],
    ["a.md", "markdown"],
    ["a.html", "html"],
    ["a.css", "css"],
    ["a.sql", "sql"],
    ["a.ps1", "powershell"],
    ["a.sh", "shell"],
    ["Dockerfile", "dockerfile"],
    ["src/deep/dir/a.test.ts", "typescript"],
    ["FOO.TS", "typescript"],
  ])("maps %s to %s", (name, language) => {
    expect(monacoLanguage(name), `Expected ${name} to map to Monaco language "${language}"`).toBe(language);
  });

  it("maps bicep to plaintext or bicep", () => {
    expect(["plaintext", "bicep"], "Expected a.bicep to map to 'plaintext' (or 'bicep')").toContain(monacoLanguage("a.bicep"));
  });

  it.each(["a.unknownext", "LICENSE", ".gitignore", "noext", ""])("defaults %j to plaintext", (name) => {
    expect(monacoLanguage(name), `Expected ${JSON.stringify(name)} to default to "plaintext"`).toBe("plaintext");
  });
});
