/**
 * Ready-to-publish quality gate contract.
 * Run: npx tsx lib/import-review/ready-to-publish-gate.test.ts
 */
import assert from "node:assert/strict";
import {
  isUnusableReadyTitle,
  qualifiesReadyToPublish,
  statusAfterReadyGate,
} from "./ready-to-publish-gate";

assert.equal(isUnusableReadyTitle(""), true, "empty title");
assert.equal(isUnusableReadyTitle("S"), true, "one letter");
assert.equal(isUnusableReadyTitle("makeupme_sasha"), true, "snake username");
assert.equal(
  isUnusableReadyTitle("Sasha makeupme_sasha"),
  true,
  "name + telegram handle",
);
assert.equal(isUnusableReadyTitle("@nails_la"), true, "@handle");

const dump =
  "Ищу мастера по наращиванию ресниц в Irvine на выходные, пишите в личку если можете принять завтра утром, очень срочно нужно к празднику и ещё куча текста объявления целиком";
assert.equal(isUnusableReadyTitle(dump), true, "whole post as title");

assert.equal(
  isUnusableReadyTitle("Саша, визажист", {
    description: "Саша делает макияж в Irvine. Телефон в контактах.",
  }),
  false,
  "short human title is fine",
);

const ok = qualifiesReadyToPublish({
  title: "Саша, визажист",
  phone: ["+19495551212"],
  city: null,
  duplicate_status: "unique",
});
assert.equal(ok.ok, true, "phone + real title qualifies");

const cityOnly = qualifiesReadyToPublish({
  title: "Пекарня на Main",
  phone: [],
  city: "Irvine",
});
assert.equal(cityOnly.ok, true, "city without phone still qualifies");

const noContact = qualifiesReadyToPublish({
  title: "Саша, визажист",
  phone: [],
  city: "",
});
assert.equal(noContact.ok, false);
assert.equal(noContact.reason, "no_phone_or_city");

const dup = qualifiesReadyToPublish({
  title: "Саша, визажист",
  phone: ["+19495551212"],
  duplicate_status: "likely_duplicate",
});
assert.equal(dup.ok, false);
assert.equal(dup.reason, "duplicate");

const junkTitle = qualifiesReadyToPublish({
  title: "Sasha makeupme_sasha",
  phone: ["+19495551212"],
  city: "Irvine",
});
assert.equal(junkTitle.ok, false);
assert.equal(junkTitle.reason, "unusable_title");

assert.equal(
  statusAfterReadyGate(
    { title: "Саша, визажист", phone: ["+1"], city: "Irvine" },
    "pending",
  ).status,
  "pending",
  "pending stays pending unless preferReady",
);

assert.equal(
  statusAfterReadyGate(
    {
      title: "Саша, визажист",
      phone: ["+19495551212"],
      city: "Irvine",
    },
    "pending",
    { preferReady: true },
  ).status,
  "ready_to_publish",
);

assert.equal(
  statusAfterReadyGate(
    { title: "Саша, визажист", phone: [], city: "" },
    "ready_to_publish",
  ).status,
  "needs_more_info",
);

assert.equal(
  statusAfterReadyGate(
    {
      title: "makeupme_sasha",
      phone: ["+19495551212"],
      city: "Irvine",
    },
    "ready_to_publish",
  ).status,
  "pending",
);

assert.equal(
  statusAfterReadyGate(
    { title: "X", phone: ["+1"] },
    "rejected",
  ).status,
  "rejected",
  "locked statuses pass through",
);

console.log("OK: ready-to-publish quality gate");
