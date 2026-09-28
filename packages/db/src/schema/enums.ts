import { pgEnum } from "drizzle-orm/pg-core";

export const initiativeStatusEnum = pgEnum("initiative_status", [
  "idea",
  "planned",
  "in_progress",
  "on_hold",
  "shipped",
  "cancelled",
]);

export const initiativeTierEnum = pgEnum("initiative_tier", ["strategic", "tactical"]);

export const userRoleEnum = pgEnum("user_role", ["member", "admin"]);

// Relationships say which teams should know about each other, never what is
// scheduled after what: "builds on" (we plan to use their work), "replaces"
// and "related" (symmetric). They only ever connect different teams.
export const edgeTypeEnum = pgEnum("edge_type", ["builds_on", "replaces", "related"]);

export const chatRoleEnum = pgEnum("chat_role", ["user", "assistant", "tool"]);

export const matchClassificationEnum = pgEnum("match_classification", [
  "STRONG_MATCH",
  "WEAK_MATCH",
  "NO_MATCH",
]);

export const activityKindEnum = pgEnum("activity_kind", [
  "created",
  "updated",
  "status_changed",
  "edge_added",
  "edge_removed",
  "commented",
  "overlap_detected",
  "registered_from_chat",
  "merged_into",
  "merged_from",
  "signal_added",
  // Asked to fold this duplicate into another team's work, and the answer.
  "merge_requested",
  "merge_declined",
]);

export const notificationKindEnum = pgEnum("notification_kind", [
  "overlap_detected",
  "status_changed",
  "dependency_added",
  "commented",
  "merged",
  "signal_added",
  // Not about an initiative: someone asked to join a team (to its team
  // admins) or for a new team (to admins); and the answer, back to them.
  "team_request",
  "team_update",
  // Asked to merge a duplicate into your work (to its owners and team
  // admins); declined or withdrawn (back to the other side).
  "merge_request",
  "merge_update",
]);

export const mergeRequestStatusEnum = pgEnum("merge_request_status", [
  "pending",
  "approved",
  "declined",
  "withdrawn",
]);

// A team someone created during onboarding waits for an admin to approve it.
export const teamStatusEnum = pgEnum("team_status", ["pending", "active"]);

export const joinRequestStatusEnum = pgEnum("join_request_status", [
  "pending",
  "approved",
  "declined",
]);

export const subscriptionTargetEnum = pgEnum("subscription_target", ["team", "initiative", "tag"]);

export const overlapStatusEnum = pgEnum("overlap_status", [
  "open",
  "dismissed",
  "linked",
  "merged",
]);

export const tokenScopeEnum = pgEnum("token_scope", ["read", "write"]);
