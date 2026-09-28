import type { PublicInitiativeRow } from "@scry/db";
import type { AuthenticatedUser } from "../auth/types";

type Owned = Pick<PublicInitiativeRow, "submittedBy" | "contactPerson" | "teamId">;

/**
 * Who may edit an initiative: its submitter or contact person, a team admin
 * of the team that owns it, or an admin. The web app mirrors this (e.g.
 * which board cards can be dragged); change both.
 */
export function canEditInitiative(user: AuthenticatedUser, initiative: Owned): boolean {
  return (
    user.role === "admin" ||
    initiative.submittedBy === user.id ||
    initiative.contactPerson === user.id ||
    (user.teamAdmin && user.teamId !== null && initiative.teamId === user.teamId)
  );
}

/**
 * Who may declare a relationship from or to an initiative: its owners, plus
 * anyone on the team that owns it. Relationships are cross-team by nature,
 * so one side is enough — but at least one side must be yours.
 */
export function canRelateInitiative(user: AuthenticatedUser, initiative: Owned): boolean {
  return (
    canEditInitiative(user, initiative) ||
    (user.teamId !== null && initiative.teamId === user.teamId)
  );
}
