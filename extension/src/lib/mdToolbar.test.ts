import { describe, it, expect } from "vitest";
import {
  bold,
  italic,
  code,
  link,
  quote,
  bulletList,
  numberedList,
  taskList,
  heading,
  suggestion,
  shortcutAction,
  applyToolbar,
  type ToolbarAction,
} from "./mdToolbar";

// Module under test: src/lib/mdToolbar.ts (stubs until the developer implements them). Requirement CM-9: "Formatting toolbar".
// The writing rules (markers, selection after the edit, toggling off) are in the header and doc comments of src/lib/mdToolbar.ts. Each test states the whole expected result:
// the new value and the new selection, so a failure shows which of the two diverged.

const ed = (value: string, selStart: number, selEnd: number) => ({ value, selStart, selEnd });
const F = "```";

describe("CM-9: bold wraps the selection in ** and toggles off", () => {
  it("wraps the selected text and keeps the text selected", () => {
    expect(bold("hello world", 6, 11), "Expected 'hello **world**' with 'world' selected (8 to 13)").toEqual(ed("hello **world**", 8, 13));
  });

  it("wraps a selection in the middle of the text", () => {
    expect(bold("say hi now", 4, 6), "Expected 'say **hi** now' with 'hi' selected").toEqual(ed("say **hi** now", 6, 8));
  });

  it("inserts an empty pair with the caret between when nothing is selected", () => {
    expect(bold("hello ", 6, 6), "Expected 'hello ****' with the caret at 8").toEqual(ed("hello ****", 8, 8));
  });

  it("removes the markers around the selection", () => {
    expect(bold("hello **world**", 8, 13), "Expected 'hello world' with 'world' still selected (6 to 11)").toEqual(ed("hello world", 6, 11));
  });

  it("removes the markers when the selection includes them", () => {
    expect(bold("**world**", 0, 9), "Expected 'world' selected (0 to 5)").toEqual(ed("world", 0, 5));
  });

  it("removes an empty pair when the caret is between the markers", () => {
    expect(bold("a ****", 4, 4), "Expected 'a ' with the caret at 2").toEqual(ed("a ", 2, 2));
  });

  it("wraps text that is already italic rather than unwrapping it", () => {
    expect(bold("_x_", 1, 2), "Expected '_**x**_' with 'x' selected").toEqual(ed("_**x**_", 3, 4));
  });

  it("wrapping twice with the toggle returns the starting text", () => {
    const once = bold("hello world", 6, 11);
    expect(bold(once.value, once.selStart, once.selEnd), "Expected bold then bold to restore the text and selection").toEqual(ed("hello world", 6, 11));
  });
});

describe("CM-9: italic wraps the selection in _ and toggles off", () => {
  it("wraps the selected text", () => {
    expect(italic("a b", 2, 3), "Expected 'a _b_' with 'b' selected").toEqual(ed("a _b_", 3, 4));
  });

  it("inserts an empty pair with the caret between when nothing is selected", () => {
    expect(italic("x", 1, 1), "Expected 'x__' with the caret at 2").toEqual(ed("x__", 2, 2));
  });

  it("removes the underscores around the selection", () => {
    expect(italic("a _b_", 3, 4), "Expected 'a b' with 'b' selected").toEqual(ed("a b", 2, 3));
  });

  it("wraps text that is bold instead of unwrapping the bold markers", () => {
    expect(italic("**x**", 2, 3), "Expected '**_x_**': ** is not italic").toEqual(ed("**_x_**", 3, 4));
  });
});

describe("CM-9: code uses backticks inline and a fence for several lines", () => {
  it("wraps a single-line selection in backticks", () => {
    expect(code("use foo here", 4, 7), "Expected 'use `foo` here' with 'foo' selected").toEqual(ed("use `foo` here", 5, 8));
  });

  it("inserts an empty pair with the caret between when nothing is selected", () => {
    expect(code("x ", 2, 2), "Expected 'x ``' with the caret at 3").toEqual(ed("x ``", 3, 3));
  });

  it("removes the backticks around a selection", () => {
    expect(code("use `foo` here", 5, 8), "Expected 'use foo here' with 'foo' selected").toEqual(ed("use foo here", 4, 7));
  });

  it("fences a multi-line selection and selects the inner lines", () => {
    expect(code("a\nb\nc", 0, 3), "Expected the first two lines fenced and 'a\\nb' selected (4 to 7)").toEqual(ed(`${F}\na\nb\n${F}\nc`, 4, 7));
  });

  it("widens a selection that starts mid-line to whole lines before fencing", () => {
    expect(code("xa\nby\nc", 1, 4), "Expected both whole lines 'xa' and 'by' inside the fence").toEqual(ed(`${F}\nxa\nby\n${F}\nc`, 4, 9));
  });

  it("fences lines at the end of the text without adding a trailing newline", () => {
    expect(code("a\nb", 0, 3), "Expected no newline after the closing fence").toEqual(ed(`${F}\na\nb\n${F}`, 4, 7));
  });

  it("keeps a final newline after the closing fence", () => {
    expect(code("a\nb\n", 0, 3), "Expected the trailing newline to stay after the fence").toEqual(ed(`${F}\na\nb\n${F}\n`, 4, 7));
  });

  it("removes the fence lines when the selected lines are already fenced", () => {
    expect(code(`${F}\na\nb\n${F}\nc`, 4, 7), "Expected 'a\\nb\\nc' with 'a\\nb' selected (0 to 3)").toEqual(ed("a\nb\nc", 0, 3));
  });
});

describe("CM-9: link writes [text](url)", () => {
  it("wraps the selection as the label and selects the url placeholder", () => {
    expect(link("see docs", 4, 8), "Expected 'see [docs](url)' with 'url' selected (11 to 14)").toEqual(ed("see [docs](url)", 11, 14));
  });

  it("inserts an empty link with the caret in the label when nothing is selected", () => {
    expect(link("a ", 2, 2), "Expected 'a [](url)' with the caret at 3").toEqual(ed("a [](url)", 3, 3));
  });

  it("uses a selected web address as the target and puts the caret in the label", () => {
    expect(link("https://example.test", 0, 20), "Expected '[](https://example.test)' with the caret at 1").toEqual(ed("[](https://example.test)", 1, 1));
  });

  it("turns a selected link back into its text", () => {
    expect(link("see [docs](url)", 4, 15), "Expected 'see docs' with 'docs' selected").toEqual(ed("see docs", 4, 8));
  });

  it("turns a link back into its text when only the label is selected, whatever the target", () => {
    expect(link("see [docs](https://x.test/a)", 5, 9), "Expected 'see docs' with 'docs' selected").toEqual(ed("see docs", 4, 8));
  });
});

describe("CM-9: quote adds or removes '> ' on the touched lines", () => {
  it("quotes the caret's line and moves the caret past the prefix", () => {
    expect(quote("hello", 2, 2), "Expected '> hello' with the caret at 4").toEqual(ed("> hello", 4, 4));
  });

  it("quotes every selected line and keeps the same text selected", () => {
    expect(quote("a\nb", 0, 3), "Expected '> a\\n> b' with the selection 2 to 7").toEqual(ed("> a\n> b", 2, 7));
  });

  it("quotes whole lines for a selection that starts and ends mid-line", () => {
    expect(quote("one\ntwo\nthree", 5, 9), "Expected only 'two' and 'three' quoted, selection 7 to 13").toEqual(ed("one\n> two\n> three", 7, 13));
  });

  it("leaves blank lines alone", () => {
    expect(quote("a\n\nb", 0, 4), "Expected the empty middle line to stay empty").toEqual(ed("> a\n\n> b", 2, 8));
  });

  it("gives an empty line the prefix", () => {
    expect(quote("", 0, 0), "Expected '> ' with the caret at 2").toEqual(ed("> ", 2, 2));
  });

  it("removes the prefix when every touched line already has it", () => {
    expect(quote("> a\n> b", 2, 7), "Expected 'a\\nb' with the selection 0 to 3").toEqual(ed("a\nb", 0, 3));
  });
});

describe("CM-9: bulletList, numberedList and taskList", () => {
  it("bullets each selected line", () => {
    expect(bulletList("a\nb", 0, 3), "Expected '- a\\n- b' with the selection 2 to 7").toEqual(ed("- a\n- b", 2, 7));
  });

  it("bullets the caret's line", () => {
    expect(bulletList("hello", 3, 3), "Expected '- hello' with the caret at 5").toEqual(ed("- hello", 5, 5));
  });

  it("gives an empty line a bullet", () => {
    expect(bulletList("", 0, 0), "Expected '- ' with the caret at 2").toEqual(ed("- ", 2, 2));
  });

  it("numbers the selected lines from 1", () => {
    expect(numberedList("a\nb\nc", 0, 5), "Expected '1. a\\n2. b\\n3. c' with the selection 3 to 14").toEqual(ed("1. a\n2. b\n3. c", 3, 14));
  });

  it("skips blank lines when numbering", () => {
    expect(numberedList("a\n\nb", 0, 4), "Expected the blank line unnumbered and 'b' numbered 2").toEqual(ed("1. a\n\n2. b", 3, 10));
  });

  it("makes each selected line a task", () => {
    expect(taskList("a", 0, 1), "Expected '- [ ] a' with 'a' selected (6 to 7)").toEqual(ed("- [ ] a", 6, 7));
  });

  it("removes bullets when every line is already a bullet", () => {
    expect(bulletList("- a\n- b", 2, 7), "Expected 'a\\nb' with the selection 0 to 3").toEqual(ed("a\nb", 0, 3));
  });

  it("removes numbers when every line is already numbered", () => {
    expect(numberedList("1. a\n2. b", 3, 9), "Expected 'a\\nb' with the selection 0 to 3").toEqual(ed("a\nb", 0, 3));
  });

  it("removes task markers when every line is already a task, checked or not", () => {
    expect(taskList("- [ ] a\n- [x] b", 6, 15), "Expected 'a\\nb' with the selection 0 to 3").toEqual(ed("a\nb", 0, 3));
  });

  it("turns a numbered list into a bulleted one instead of toggling", () => {
    expect(bulletList("1. a\n2. b", 3, 9), "Expected '- a\\n- b' with the selection 2 to 7").toEqual(ed("- a\n- b", 2, 7));
  });

  it("turns a bullet into a task", () => {
    expect(taskList("- a", 2, 3), "Expected '- [ ] a' with 'a' selected (6 to 7)").toEqual(ed("- [ ] a", 6, 7));
  });

  it("turns a task into a plain bullet", () => {
    expect(bulletList("- [ ] a", 6, 7), "Expected '- a' with 'a' selected (2 to 3)").toEqual(ed("- a", 2, 3));
  });

  it("adds markers to the lines that lack them when only some are bullets", () => {
    expect(bulletList("- a\nb", 2, 5), "Expected both lines bulleted without doubling the first").toEqual(ed("- a\n- b", 2, 7));
  });
});

describe("CM-9: heading writes ### and toggles off", () => {
  it("adds the prefix and keeps the text selected", () => {
    expect(heading("Title", 0, 5), "Expected '### Title' with 'Title' selected (4 to 9)").toEqual(ed("### Title", 4, 9));
  });

  it("removes the prefix when the line already has it", () => {
    expect(heading("### Title", 4, 9), "Expected 'Title' with the selection 0 to 5").toEqual(ed("Title", 0, 5));
  });

  it("changes another heading level to ###", () => {
    expect(heading("# Title", 2, 7), "Expected '### Title' with the selection 4 to 9").toEqual(ed("### Title", 4, 9));
  });
});

describe("CM-9: suggestion inserts a suggestion fence holding the thread's original lines", () => {
  it("inserts the block into an empty box and selects the original lines", () => {
    expect(suggestion("", 0, 0, ["a", "b"]), "Expected the fence with 'a\\nb' selected (14 to 17)").toEqual(ed(`${F}suggestion\na\nb\n${F}`, 14, 17));
  });

  it("starts the block on its own line after text on the same line", () => {
    expect(suggestion("Please change: ", 15, 15, ["x"]), "Expected a line break added before the fence; 'x' selected (30 to 31)").toEqual(ed(`Please change: \n${F}suggestion\nx\n${F}`, 30, 31));
  });

  it("replaces the selected text", () => {
    expect(suggestion("abc", 0, 3, ["x"]), "Expected the selected 'abc' replaced by the block").toEqual(ed(`${F}suggestion\nx\n${F}`, 14, 15));
  });

  it("puts following text on a new line after the block", () => {
    expect(suggestion("ab", 1, 1, ["X"]), "Expected 'a', a line break, the block, a line break, then 'b'").toEqual(ed(`a\n${F}suggestion\nX\n${F}\nb`, 16, 17));
  });

  it("uses a longer fence when an original line starts a fence of its own", () => {
    expect(suggestion("", 0, 0, [`${F}js`, "x", F]), "Expected a four-backtick outer fence").toEqual(ed(`\`\`\`\`suggestion\n${F}js\nx\n${F}\n\`\`\`\``, 15, 26));
  });

  it("rejects an empty list of original lines", () => {
    expect(() => suggestion("", 0, 0, []), "Expected a suggestion without original lines to be rejected").toThrow(/original lines are required/);
  });
});

describe("CM-9: shortcutAction maps Ctrl+B, Ctrl+I, Ctrl+K and Ctrl+E", () => {
  const key = (k: string, over: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({ key: k, ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, ...over });

  it.each<[string, ToolbarAction]>([["b", "bold"], ["i", "italic"], ["k", "link"], ["e", "code"]])("Ctrl+%s runs %s", (k, action) => {
    expect(shortcutAction(key(k)), `Expected Ctrl+${k.toUpperCase()} to run ${action}`).toBe(action);
  });

  it("accepts the capital letter (Caps Lock) and Cmd instead of Ctrl", () => {
    expect(shortcutAction(key("B")), "Expected Ctrl+B with a capital letter to run bold").toBe("bold");
    expect(shortcutAction(key("i", { ctrlKey: false, metaKey: true })), "Expected Cmd+I to run italic").toBe("italic");
  });

  it("ignores other keys", () => {
    expect(shortcutAction(key("x")), "Expected Ctrl+X to be left to the browser").toBeNull();
  });

  it("ignores the letter without Ctrl or Cmd", () => {
    expect(shortcutAction(key("b", { ctrlKey: false })), "Expected a plain B to type a letter").toBeNull();
  });

  it("ignores the combination when Alt or Shift is held", () => {
    expect(shortcutAction(key("b", { altKey: true })), "Expected Ctrl+Alt+B to be ignored").toBeNull();
    expect(shortcutAction(key("k", { shiftKey: true })), "Expected Ctrl+Shift+K to be ignored").toBeNull();
  });
});

describe("CM-9: applyToolbar runs the named action", () => {
  const cases: [Exclude<ToolbarAction, "suggestion">, (v: string, s: number, e: number) => unknown][] = [
    ["bold", bold], ["italic", italic], ["code", code], ["link", link], ["quote", quote], ["bulletList", bulletList], ["numberedList", numberedList], ["taskList", taskList], ["heading", heading],
  ];

  it.each(cases)("%s gives the same result as calling it directly", (action, fn) => {
    expect(applyToolbar(action, "one\ntwo", 0, 7), `Expected applyToolbar('${action}') to equal the ${action} function`).toEqual(fn("one\ntwo", 0, 7));
  });

  it("runs suggestion with the supplied original lines", () => {
    expect(applyToolbar("suggestion", "", 0, 0, { originalLines: ["a"] }), "Expected the suggestion block for 'a'").toEqual(suggestion("", 0, 0, ["a"]));
  });

  it("rejects suggestion without original lines", () => {
    expect(() => applyToolbar("suggestion", "", 0, 0), "Expected a suggestion without a thread context to be rejected").toThrow(/original lines are required/);
  });
});
