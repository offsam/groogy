"use client";

/**
 * Local fallback for skill frames when DB migration is not applied yet.
 * Keyed by user id so accounts don't collide in one browser.
 */

import type { ProfileSkillFrame } from "@/types/profile-cabinet";

const PREFIX = "kroogy.skill_frames.";

function storageKey(userId: string) {
  return `${PREFIX}${userId}`;
}

export function loadLocalSkillFrames(userId: string): ProfileSkillFrame[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ProfileSkillFrame[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveLocalSkillFrames(
  userId: string,
  frames: ProfileSkillFrame[],
) {
  if (typeof window === "undefined") return;
  localStorage.setItem(storageKey(userId), JSON.stringify(frames));
}

export function createLocalSkillFrame(userId: string): ProfileSkillFrame {
  const frames = loadLocalSkillFrames(userId);
  const now = new Date().toISOString();
  const frame: ProfileSkillFrame = {
    id: `local-${crypto.randomUUID()}`,
    userId,
    title: "",
    skills: "",
    workplace: null,
    specialty: null,
    showPublic: false,
    isActive: false,
    listingId: null,
    listingStatus: null,
    sortOrder: frames.length + 1,
    createdAt: now,
    updatedAt: now,
  };
  saveLocalSkillFrames(userId, [...frames, frame]);
  return frame;
}

export function upsertLocalSkillFrame(
  userId: string,
  frame: ProfileSkillFrame,
) {
  const frames = loadLocalSkillFrames(userId);
  const idx = frames.findIndex((f) => f.id === frame.id);
  if (idx >= 0) frames[idx] = frame;
  else frames.push(frame);
  saveLocalSkillFrames(userId, frames);
}

export function removeLocalSkillFrame(userId: string, frameId: string) {
  saveLocalSkillFrames(
    userId,
    loadLocalSkillFrames(userId).filter((f) => f.id !== frameId),
  );
}

export function isSchemaMissingError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("does not exist") ||
    m.includes("schema cache") ||
    m.includes("could not find the table") ||
    m.includes("relation") && m.includes("profile_skill_frames")
  );
}
