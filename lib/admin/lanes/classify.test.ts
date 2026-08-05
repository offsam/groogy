/**
 * Unit tests for admin lane classifier (no DB).
 */
import assert from "node:assert/strict";
import { classifyLane } from "@/lib/admin/lanes/classify";

function testSeeking() {
  const r = classifyLane({
    kind: "import_review",
    status: "pending",
    title: "Ищу няню в Irvine",
    sourceText: "Посоветуйте хорошую няню, без опыта ок",
  });
  assert.equal(r.lane, "seeking");
}

function testReadyStatus() {
  const r = classifyLane({
    kind: "import_review",
    status: "ready_to_publish",
    entityType: "business",
    targetCollection: "businesses",
    title: "Cafe",
    phone: "+19495551212",
  });
  assert.equal(r.lane, "ready");
}

function testAttachSuspect() {
  const r = classifyLane({
    kind: "recommendation",
    status: "suspected_duplicate",
    displayName: "Maria",
    hasDuplicateTarget: true,
  });
  assert.equal(r.lane, "attach");
}

function testQuarantineJunk() {
  const r = classifyLane({
    kind: "import_review",
    status: "pending",
    title: "hi",
    sourceText: "ok",
  });
  assert.equal(r.lane, "quarantine");
}

function testRouteTyped() {
  const r = classifyLane({
    kind: "import_review",
    status: "pending",
    entityType: "job",
    targetCollection: "jobs",
    title: "Hiring cook",
    phone: "9495551212",
    completenessPercent: 40,
  });
  assert.equal(r.lane, "route");
}

testSeeking();
testReadyStatus();
testAttachSuspect();
testQuarantineJunk();
testRouteTyped();
console.log("admin lanes classify: ok");
