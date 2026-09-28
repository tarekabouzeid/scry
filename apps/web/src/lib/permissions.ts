import type { AuthenticatedUser, Initiative } from "@scry/shared";

type Viewer = Pick<AuthenticatedUser, "id" | "role" | "teamId" | "teamAdmin">;
type Owned = Pick<Initiative, "submittedBy" | "contactPerson" | "teamId">;

/**
 * Mirrors the api (apps/api/src/common/permissions.ts): the submitter, the
 * contact person, a team admin of the owning team, or an admin. Change both.
 */
export function canEditInitiative(user: Viewer, initiative: Owned | undefined): boolean {
  if (!initiative) return false;
  return (
    user.role === "admin" ||
    initiative.submittedBy === user.id ||
    initiative.contactPerson === user.id ||
    (user.teamAdmin && user.teamId !== null && initiative.teamId === user.teamId)
  );
}

/** Mirrors the api: those who can edit it, or anyone on the owning team. */
export function canRelateInitiative(user: Viewer, initiative: Owned | undefined): boolean {
  if (!initiative) return false;
  return (
    canEditInitiative(user, initiative) ||
    (user.teamId !== null && initiative.teamId === user.teamId)
  );
}
