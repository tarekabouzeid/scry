"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Eye, EyeOff, PlugZap } from "lucide-react";
import { api } from "@/lib/api";
import { useCurrentUser } from "@/lib/use-current-user";
import { Button } from "./ui/button";
import { ErrorNote, Spinner } from "./ui/feedback";
import { LogoMark } from "./ui/logo";
import { SplashShell } from "./auth-gate";

/**
 * The consent step of connecting an AI tool: which tool, what it can do
 * (read, as you; never change anything), and Allow / Cancel. The api
 * signed the request, so nothing here can be edited on the way.
 */
export function ConnectConsent() {
  const requestToken = useSearchParams().get("request") ?? "";
  const { data: user } = useCurrentUser();
  const [leaving, setLeaving] = useState<"allowed" | "cancelled" | null>(null);
  const { data: info, error } = useQuery({
    queryKey: ["oauth-request", requestToken],
    queryFn: () => api.oauthRequest(requestToken),
    enabled: !!requestToken,
    retry: false,
  });
  const decide = useMutation({
    mutationFn: (allow: boolean) => api.oauthDecision(requestToken, allow),
    onSuccess: ({ redirect }, allow) => {
      setLeaving(allow ? "allowed" : "cancelled");
      window.location.href = redirect;
    },
  });

  return (
    <SplashShell>
      <div className="mx-auto w-full max-w-md rounded-2xl border border-border bg-surface/90 p-6 shadow-pop backdrop-blur-sm animate-fade-in">
        <div className="flex items-center gap-3">
          <LogoMark className="h-9 w-9" />
          <PlugZap className="h-4 w-4 text-subtle" />
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <Eye className="h-4 w-4" />
          </span>
        </div>
        {!requestToken || error ? (
          <>
            <h1 className="mt-5 text-lg font-semibold text-foreground">
              This link doesn&apos;t work
            </h1>
            <p className="mt-1 text-sm text-muted">
              {error?.message ??
                "It's missing its sign-in request. Start connecting again from your AI tool."}
            </p>
          </>
        ) : !info ? (
          <div className="mt-6 flex items-center gap-2 text-sm text-muted">
            <Spinner className="h-3.5 w-3.5" />
            Checking the request…
          </div>
        ) : leaving ? (
          <>
            <h1 className="mt-5 text-lg font-semibold text-foreground">
              {leaving === "allowed" ? "Connected" : "Not connected"}
            </h1>
            <p className="mt-1 text-sm text-muted">
              Going back to {info.clientName}. You can close this tab once it says so.
            </p>
          </>
        ) : (
          <>
            <h1 className="mt-5 text-lg font-semibold text-foreground">
              Let {info.clientName} read Scry as you?
            </h1>
            <p className="mt-1 text-sm text-muted">
              Signed in as {user?.name ?? "you"}. Afterwards you&apos;ll go back to{" "}
              <span className="font-medium text-foreground">{info.returnsTo}</span>.
            </p>
            <ul className="mt-4 space-y-2 text-sm">
              <li className="flex gap-2 text-foreground">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-status-shipped" />
                It can search and read initiatives, teams, relationships and the brief: what you can
                see in Scry.
              </li>
              <li className="flex gap-2 text-foreground">
                <EyeOff className="mt-0.5 h-4 w-4 shrink-0 text-subtle" />
                It can&apos;t add, change or delete anything.
              </li>
              <li className="flex gap-2 text-muted">
                <Eye className="mt-0.5 h-4 w-4 shrink-0 text-subtle" />
                What it asks is logged with your name, for your admins. Disconnect it any time in
                Settings.
              </li>
            </ul>
            {!info.enabled && (
              <p className="mt-4 rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs text-foreground">
                An admin hasn&apos;t turned on connecting AI tools to Scry yet.
              </p>
            )}
            {decide.error && <ErrorNote className="mt-4">{decide.error.message}</ErrorNote>}
            <div className="mt-6 flex justify-end gap-2">
              <Button
                variant="ghost"
                disabled={decide.isPending}
                onClick={() => decide.mutate(false)}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={decide.isPending || !info.enabled}
                onClick={() => decide.mutate(true)}
              >
                Allow read access
              </Button>
            </div>
          </>
        )}
      </div>
    </SplashShell>
  );
}
