"use client";

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Hourglass } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "./ui/button";
import { useToast } from "./ui/toast";

/**
 * For someone waiting to get into a team: what they're waiting for, and a way
 * to withdraw and choose again. Until then they can look but not change.
 */
export function PendingBanner() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { data } = useQuery({
    queryKey: ["onboarding-status"],
    queryFn: api.onboardingStatus,
    // While waiting, notice being let in without a reload.
    refetchInterval: (q) => (q.state.data?.pending ? 60_000 : false),
  });
  const inTeam = data?.hasTeam;
  useEffect(() => {
    if (inTeam) void queryClient.invalidateQueries({ queryKey: ["me"] });
  }, [inTeam, queryClient]);
  const withdraw = useMutation({
    mutationFn: api.withdrawPending,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["onboarding-status"] }),
    onError: (err) => toast({ tone: "error", message: err.message }),
  });
  const pending = data?.pending;
  if (!pending) return null;
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-accent/25 bg-accent/[0.07] px-4 py-2 text-sm sm:px-6 print:hidden"
    >
      <Hourglass className="h-4 w-4 shrink-0 text-accent" />
      <p className="min-w-0 flex-1 text-muted">
        {pending.kind === "join" ? (
          <>
            <span className="font-medium text-foreground">
              Waiting for {pending.team.name} to let you in.
            </span>{" "}
            Its team admins approve new members. Until then you can look around, but not change
            anything.
          </>
        ) : (
          <>
            <span className="font-medium text-foreground">
              Waiting for an admin to approve {pending.team.name}.
            </span>{" "}
            You&apos;ll be its team admin. Until then you can look around, but not change anything.
          </>
        )}
      </p>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => withdraw.mutate()}
        disabled={withdraw.isPending}
      >
        Withdraw
      </Button>
    </div>
  );
}
