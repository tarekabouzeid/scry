export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role: "member" | "admin";
  teamId: string | null;
  /** Runs their team: approves joiners, removes members, edits the team's work. */
  teamAdmin: boolean;
  /** When the product tour was finished or skipped (ISO), or null. */
  tourSeenAt?: string | null;
}

export interface SessionClaims {
  sub: string;
  role: "member" | "admin";
}
