import assert from "node:assert/strict";
import test from "node:test";
import { topPostKeywordFilter, wildcardToSqlLike } from "../src/hivesql/api.js";

test("HiveSQL wildcard patterns are translated to escaped SQL LIKE patterns", () => {
  assert.equal(wildcardToSqlLike("inertia*"), "inertia%");
  assert.equal(wildcardToSqlLike("*bot"), "%bot");
  assert.equal(wildcardToSqlLike("team_["), "team\\_\\[");
  assert.equal(wildcardToSqlLike("literal\\slash"), "literal\\\\slash");
});

test("HiveSQL top post keyword filters match selected posts for non-reply rankings", () => {
  const filter = topPostKeywordFilter("post", "keyword0");

  assert.match(filter, /\[post\]\.\[title\]/);
  assert.match(filter, /\[post\]\.\[body\]/);
  assert.match(filter, /\[post\]\.\[json_metadata\]/);
  assert.doesNotMatch(filter, /\[reply\]/);
  assert.match(filter, /@keyword0/);
});

test("HiveSQL top reply keyword filters stay scoped to reply bodies", () => {
  const filter = topPostKeywordFilter("reply", "keyword0");

  assert.equal(filter, "LOWER(COALESCE([reply].[body], '')) LIKE @keyword0");
});
