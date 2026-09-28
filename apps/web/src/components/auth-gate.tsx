"use client";

import type { ReactNode } from "react";
import { ArrowRight, GitBranch, RefreshCw, ServerCrash, Sparkles, Users } from "lucide-react";
import { useCurrentUser } from "@/lib/use-current-user";
import { api, ApiError } from "@/lib/api";
import { Button } from "./ui/button";
import { LogoMark } from "./ui/logo";
import { Spinner } from "./ui/feedback";

/** Full-screen backdrop shared by the pre-app screens (loading, sign-in, onboarding). */
export function SplashShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <div className="bg-grid pointer-events-none absolute inset-0 mask-[radial-gradient(ellipse_at_center,black_20%,transparent_70%)]" />
      <div className="pointer-events-none absolute left-1/2 -top-48 h-128 w-3xl -translate-x-1/2 rounded-full bg-accent/20 blur-[120px]" />
      <div className="pointer-events-none absolute -bottom-40 -right-24 h-96 w-[24rem] rounded-full bg-accent-2/10 blur-[100px]" />
      <div className="relative w-full">{children}</div>
    </div>
  );
}

export function FullScreenLoader({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4">
      <div className="relative">
        <div className="absolute inset-0 animate-pulse rounded-2xl bg-accent/30 blur-xl" />
        <LogoMark className="relative h-10 w-10" />
      </div>
      <div className="flex items-center gap-2 text-sm text-muted">
        <Spinner className="h-3.5 w-3.5" />
        {label}…
      </div>
    </div>
  );
}

const FEATURES = [
  {
    icon: Users,
    title: "Every team, one view",
    body: "See what every team is committing to — table, board, or graph.",
  },
  {
    icon: Sparkles,
    title: "Catch overlap early",
    body: "The agent checks new ideas against everything already registered.",
  },
  {
    icon: GitBranch,
    title: "Know who to talk to",
    body: "See which teams build on, replace or relate to each other's work.",
  },
];

function SignIn() {
  return (
    <SplashShell>
      <div className="mx-auto flex max-w-md flex-col items-center text-center animate-fade-in">
        <div className="relative mb-6">
          <div className="absolute inset-0 rounded-2xl bg-accent/40 blur-2xl" />
          <LogoMark className="relative h-14 w-14" />
        </div>
        <h1 className="text-gradient text-4xl font-semibold tracking-tight">Scry</h1>
        <p className="mt-3 text-base text-muted">
          Cross-team initiative visibility. See what every other team is building — so overlapping
          work gets caught before it collides.
        </p>

        <Button
          variant="primary"
          size="lg"
          className="mt-8 w-full max-w-xs"
          // Come back here after signing in (e.g. an AI tool's consent page).
          onClick={() =>
            (window.location.href = api.loginUrl(
              window.location.pathname === "/" && !window.location.search
                ? undefined
                : window.location.pathname + window.location.search,
            ))
          }
        >
          Continue with SSO
          <ArrowRight className="h-4 w-4" />
        </Button>
        <p className="mt-3 text-xs text-subtle">
          You&apos;ll be redirected to your identity provider.
        </p>

        <div className="mt-12 grid w-full gap-3 text-left">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="flex items-start gap-3 rounded-xl border border-border/80 bg-surface/60 p-3.5 backdrop-blur-sm"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                <Icon className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">{title}</p>
                <p className="text-xs text-muted">{body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </SplashShell>
  );
}

function ApiUnreachable({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
  return (
    <SplashShell>
      <div className="mx-auto max-w-sm rounded-2xl border border-border bg-surface/80 p-6 text-center shadow-pop backdrop-blur-sm animate-fade-in">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-status-blocked/10 text-status-blocked">
          <ServerCrash className="h-5 w-5" />
        </div>
        <p className="mt-4 font-medium text-foreground">Can&apos;t reach the Scry API</p>
        <p className="mt-1 text-sm text-muted">
          Check that the API is running and that{" "}
          <code className="font-mono text-xs">NEXT_PUBLIC_API_URL</code> points at it.
        </p>
        <Button className="mt-5" onClick={onRetry} disabled={retrying}>
          <RefreshCw className={retrying ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          Try again
        </Button>
      </div>
    </SplashShell>
  );
}

export function AuthGate({ children }: { children: ReactNode }) {
  const { data: user, isLoading, error, refetch, isFetching } = useCurrentUser();

  if (isLoading) return <FullScreenLoader />;

  if (error instanceof ApiError && error.status === 401) return <SignIn />;

  if (error || !user) {
    return <ApiUnreachable onRetry={() => refetch()} retrying={isFetching} />;
  }

  return <>{children}</>;
}
