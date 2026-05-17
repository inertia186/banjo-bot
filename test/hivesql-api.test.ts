import assert from "node:assert/strict";
import test from "node:test";
import { wildcardToSqlLike } from "../src/hivesql/api.js";

test("HiveSQL wildcard patterns are translated to escaped SQL LIKE patterns", () => {
  assert.equal(wildcardToSqlLike("inertia*"), "inertia%");
  assert.equal(wildcardToSqlLike("*bot"), "%bot");
  assert.equal(wildcardToSqlLike("team_["), "team\\_\\[");
  assert.equal(wildcardToSqlLike("literal\\slash"), "literal\\\\slash");
});
