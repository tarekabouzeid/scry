"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { AuthenticatedUser, Initiative } from "@scry/shared";
import { api, type InitiativeInput } from "@/lib/api";
import { useInvalidateInitiatives } from "@/lib/queries";
import { useUrlState, type UrlState, type ViewMode } from "@/lib/url-state";
import { InitiativeFormDialog } from "./initiative-form";
import { useToast } from "./ui/toast";

interface Workspace {
  user: AuthenticatedUser;
  /**
   * Can register and change things: anyone in a team, and admins. People
   * waiting for a team admin's approval can only look around.
   */
  canWrite: boolean;
  url: UrlState;
  navigate: (patch: Partial<UrlState>, options?: { replace?: boolean }) => void;
  goTo: (view: ViewMode) => void;
  select: (initiativeId: string | null) => void;
  openCreate: (initial?: Partial<Initiative>) => void;
  openEdit: (initiative: Initiative) => void;
}

const WorkspaceContext = createContext<Workspace | null>(null);

export function useWorkspace(): Workspace {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used inside <WorkspaceProvider>");
  return ctx;
}

type FormState =
  { mode: "create"; initial?: Partial<Initiative> } | { mode: "edit"; initial: Initiative } | null;

export function WorkspaceProvider({
  user,
  children,
}: {
  user: AuthenticatedUser;
  children: ReactNode;
}) {
  const [url, navigate] = useUrlState();
  const [form, setForm] = useState<FormState>(null);
  const invalidate = useInvalidateInitiatives();
  const toast = useToast();

  const select = useCallback((id: string | null) => navigate({ i: id }), [navigate]);
  const goTo = useCallback((view: ViewMode) => navigate({ view, tab: "" }), [navigate]);

  const submit = useCallback(
    async (input: InitiativeInput) => {
      if (form?.mode === "edit") {
        await api.updateInitiative(form.initial.id, input);
        await invalidate();
        toast({ tone: "success", message: "Changes saved" });
      } else {
        const created = await api.createInitiative(input);
        await invalidate();
        toast({
          tone: "success",
          message: (
            <>
              Created <strong>{created.title}</strong>
            </>
          ),
          action: { label: "Open", onClick: () => navigate({ i: created.id }) },
        });
      }
    },
    [form, invalidate, toast, navigate],
  );

  const canWrite = user.role === "admin" || user.teamId !== null;
  const value = useMemo<Workspace>(
    () => ({
      user,
      canWrite,
      url,
      navigate,
      goTo,
      select,
      openCreate: (initial) => {
        if (!canWrite) {
          toast({
            tone: "error",
            message: "You can register initiatives once a team admin lets you in.",
          });
          return;
        }
        setForm({ mode: "create", initial });
      },
      openEdit: (initiative) => setForm({ mode: "edit", initial: initiative }),
    }),
    [user, canWrite, url, navigate, goTo, select, toast],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
      <InitiativeFormDialog
        open={form !== null}
        onClose={() => setForm(null)}
        mode={form?.mode ?? "create"}
        initial={form?.initial}
        defaults={{ teamId: user.teamId ?? "", userId: user.id }}
        canChangeTeam={user.role === "admin"}
        onSubmit={submit}
      />
    </WorkspaceContext.Provider>
  );
}
