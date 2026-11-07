import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { badgeFor, compareSeen, dayLabel, flagKey, hash, pruneSeen, seenKey, textFragmentUrl, watchKey, watchLine, type Seen } from "../extension/lib.ts";

const DAY = 86_400_000;
const NOW = new Date(2026, 10, 7, 15, 0).getTime();

describe("flag keys", () => {
  test("the same rule and sentence give the same key, whatever the spacing", () => {
    assert.equal(flagKey("sells_data", "We may sell\n  your data."), flagKey("sells_data", "We may sell your data."));
  });
  test("a different rule or sentence gives a different key", () => {
    assert.notEqual(flagKey("sells_data", "We may sell your data."), flagKey("shares_data", "We may sell your data."));
    assert.notEqual(flagKey("sells_data", "We may sell your data."), flagKey("sells_data", "We may sell your photos."));
  });
  test("hash is stable", () => {
    assert.equal(hash("tickwise"), hash("tickwise"));
    assert.notEqual(hash("tickwise"), hash("Tickwise"));
  });
});

describe("watchKey", () => {
  test("drops the fragment and tracking parameters, keeps the rest", () => {
    assert.equal(watchKey("https://x.com/terms?utm_source=a&lang=en&fbclid=1#s3"), "https://x.com/terms?lang=en");
  });
  test("leaves anything that isn't a URL alone", () => {
    assert.equal(watchKey("not a url"), "not a url");
  });
});

describe("seenKey", () => {
  test("is a hash: nothing of the address is stored", () => {
    const key = seenKey("https://example.com/terms?invite=abc123");
    assert.match(key, /^[0-9a-z]+$/);
    assert.ok(!key.includes("example") && !key.includes("abc123"));
  });
  test("the same page gives the same key, another page a different one", () => {
    assert.equal(seenKey("https://x.com/terms#s3"), seenKey("https://x.com/terms?utm_source=a"));
    assert.notEqual(seenKey("https://x.com/terms"), seenKey("https://x.com/privacy"));
  });
});

describe("compareSeen", () => {
  test("first check: no change", () => {
    assert.deepEqual(compareSeen(undefined, ["a", "b", "a"], NOW), { checked: NOW, flags: ["a", "b"] });
  });
  test("same flags: no change, new check time", () => {
    const prev: Seen = { checked: NOW - DAY, flags: ["a", "b"] };
    assert.deepEqual(compareSeen(prev, ["b", "a"], NOW), { checked: NOW, flags: ["b", "a"] });
  });
  test("new and removed flags are a change since the last check", () => {
    const prev: Seen = { checked: NOW - 3 * DAY, flags: ["a", "b", "c"] };
    assert.deepEqual(compareSeen(prev, ["a", "d"], NOW).change, { since: NOW - 3 * DAY, on: NOW, added: ["d"], removed: 2 });
  });
  test("an earlier change is kept until the next one", () => {
    const change = { since: NOW - 5 * DAY, on: NOW - 2 * DAY, added: ["d"], removed: 0 };
    const prev: Seen = { checked: NOW - DAY, flags: ["a", "d"], change };
    assert.deepEqual(compareSeen(prev, ["a", "d"], NOW).change, change);
  });
});

describe("pruneSeen", () => {
  test("keeps the most recently checked", () => {
    const seen: Record<string, Seen> = { old: { checked: 1, flags: [] }, mid: { checked: 2, flags: [] }, new: { checked: 3, flags: [] } };
    assert.deepEqual(Object.keys(pruneSeen(seen, 2)).sort(), ["mid", "new"]);
    assert.equal(pruneSeen(seen, 5), seen);
  });
});

describe("watchLine", () => {
  test("first check, no change, a change found now, and an older change", () => {
    const first = compareSeen(undefined, ["a"], NOW);
    assert.deepEqual(watchLine(undefined, first, NOW), { text: "First check", changed: false });

    const prev: Seen = { checked: NOW - DAY, flags: ["a"] };
    assert.deepEqual(watchLine(prev, compareSeen(prev, ["a"], NOW), NOW), { text: "No change since you checked yesterday", changed: false });

    const now = compareSeen(prev, ["b", "c"], NOW);
    assert.deepEqual(watchLine(prev, now, NOW), { text: "Changed since you checked yesterday: 2 new flags, 1 gone", changed: true });

    const later = compareSeen(now, ["b", "c"], NOW + 1000);
    assert.deepEqual(watchLine(now, later, NOW + 1000), { text: "Last change, seen today: 2 new flags, 1 gone", changed: true });
  });
  test("dates", () => {
    assert.equal(dayLabel(NOW - 60_000, NOW), "today");
    assert.equal(dayLabel(NOW - DAY, NOW), "yesterday");
    assert.equal(dayLabel(NOW - 4 * DAY, NOW, "en-GB"), "on 3 Nov");
    assert.equal(dayLabel(NOW - 365 * DAY, NOW, "en-GB"), "on 7 Nov 2025");
  });
});

describe("textFragmentUrl", () => {
  test("a short quote is matched whole", () => {
    assert.equal(textFragmentUrl("https://x.com/privacy#top", "We sell your data."), "https://x.com/privacy#:~:text=We%20sell%20your%20data.");
  });
  test("a long quote is matched by its first and last four words", () => {
    const url = textFragmentUrl("https://x.com/p", "We may share your personal information, including your contacts and location, with advertising partners.");
    assert.equal(url, "https://x.com/p#:~:text=We%20may%20share%20your,location%2C%20with%20advertising%20partners.");
  });
  test("dashes and commas inside the text are escaped", () => {
    assert.equal(textFragmentUrl("https://x.com/p", "Opt-out by email, today."), "https://x.com/p#:~:text=Opt%2Dout%20by%20email%2C%20today.");
  });
});

describe("badgeFor", () => {
  test("shows the high-risk count, or nothing", () => {
    assert.deepEqual(badgeFor(3), { text: "3", title: "Tickwise: 3 high-risk flags here. Click to see them." });
    assert.equal(badgeFor(1).title, "Tickwise: 1 high-risk flag here. Click to see them.");
    assert.equal(badgeFor(0).text, "");
    assert.equal(badgeFor(120).text, "99+");
  });
});
