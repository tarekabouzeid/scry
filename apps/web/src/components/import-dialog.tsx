"use client";

import { useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Download, FileUp, XCircle } from "lucide-react";
import type { ImportResult } from "@scry/shared";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { mapRows, parseCsv, SCRY_TEMPLATE, type ImportPreset } from "@/lib/csv";
import { useInvalidateInitiatives, useTeamLookup, useTeams } from "@/lib/queries";
import { STATUS_META } from "@/lib/format";
import { Dialog } from "./ui/dialog";
import { Button } from "./ui/button";
import { Field } from "./ui/form";
import { Input } from "./ui/input";
import { ErrorNote } from "./ui/feedback";

const PRESETS: { id: ImportPreset; label: string; hint: string }[] = [
  {
    id: "scry",
    label: "Scry CSV",
    hint: "Columns: title, summary, status, tier, team, start date, target date, tags, link.",
  },
  {
    id: "jira",
    label: "Jira export",
    hint: "In Jira: Filters → Export → CSV (all fields). Summary, Description, Status, Labels and Due date are mapped.",
  },
];

const MAX_ROWS = 500;

export function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: teams } = useTeams();
  const teamOf = useTeamLookup();
  const invalidate = useInvalidateInitiatives();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preset, setPreset] = useState<ImportPreset>("scry");
  const [fileName, setFileName] = useState("");
  const [raw, setRaw] = useState<string[][] | null>(null);
  const [jiraBase, setJiraBase] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);

  const mapped = useMemo(
    () => (raw ? mapRows(raw, preset, teams ?? [], jiraBase) : []),
    [raw, preset, teams, jiraBase],
  );
  const valid = mapped.filter((r) => r.input);
  const invalid = mapped.filter((r) => !r.input);

  const run = useMutation({
    mutationFn: () => api.importInitiatives(valid.slice(0, MAX_ROWS).map((r) => r.input!)),
    onSuccess: async (res) => {
      setResult(res);
      await invalidate();
    },
  });

  const reset = () => {
    setRaw(null);
    setFileName("");
    setResult(null);
    run.reset();
    if (fileRef.current) fileRef.current.value = "";
  };
  const close = () => {
    reset();
    onClose();
  };

  const onFile = async (file: File) => {
    setFileName(file.name);
    setResult(null);
    const text = await file.text();
    const rows = parseCsv(text);
    // Auto-detect Jira exports from their tell-tale header.
    if (rows[0]?.some((h) => /^issue (key|id)$/i.test(h.trim()))) setPreset("jira");
    setRaw(rows);
  };

  const downloadTemplate = () => {
    const url = URL.createObjectURL(new Blob([SCRY_TEMPLATE], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "scry-import-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Import initiatives"
      description="Bring your existing roadmap in from a spreadsheet or a Jira export."
      size="lg"
      footer={
        result ? (
          <Button variant="primary" onClick={close}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!valid.length || run.isPending}
              onClick={() => run.mutate()}
            >
              {run.isPending
                ? "Importing…"
                : `Import ${Math.min(valid.length, MAX_ROWS)} initiative${valid.length === 1 ? "" : "s"}`}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-3">
          <div className="flex items-center gap-3 rounded-xl border border-status-shipped/30 bg-status-shipped/5 p-4">
            <CheckCircle2 className="h-5 w-5 text-status-shipped" />
            <p className="text-sm text-foreground">
              Imported <strong>{result.created}</strong> initiative{result.created === 1 ? "" : "s"}
              . They&apos;ll be indexed for search and checked for overlaps in the background.
            </p>
          </div>
          {result.errors.length > 0 && (
            <ErrorNote>
              {result.errors.length} row(s) failed:
              <ul className="mt-1 list-disc pl-4">
                {result.errors.slice(0, 10).map((e) => (
                  <li key={e.row}>
                    Row {valid[e.row - 1]?.line ?? e.row}: {e.message}
                  </li>
                ))}
              </ul>
            </ErrorNote>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPreset(p.id)}
                className={cn(
                  "focus-ring rounded-xl border p-3 text-left transition-colors",
                  preset === p.id
                    ? "border-accent/60 bg-accent/5"
                    : "border-border hover:border-border-strong",
                )}
              >
                <p className="text-sm font-medium text-foreground">{p.label}</p>
                <p className="mt-0.5 text-xs text-muted">{p.hint}</p>
              </button>
            ))}
          </div>

          {preset === "jira" && (
            <Field
              label="Jira base URL"
              hint="Optional — links each initiative back to its Jira issue."
            >
              <Input
                placeholder="https://yourcompany.atlassian.net"
                value={jiraBase}
                onChange={(e) => setJiraBase(e.target.value)}
              />
            </Field>
          )}

          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files[0];
              if (file) void onFile(file);
            }}
            className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border-strong bg-background/40 px-4 py-8 text-center"
          >
            <FileUp className="h-6 w-6 text-accent" />
            <p className="text-sm text-foreground">{fileName || "Drop a .csv file here"}</p>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => fileRef.current?.click()}>
                Choose file
              </Button>
              {preset === "scry" && (
                <Button size="sm" variant="ghost" onClick={downloadTemplate}>
                  <Download className="h-3.5 w-3.5" />
                  Template
                </Button>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onFile(file);
              }}
            />
          </div>

          {raw && (
            <div className="space-y-2">
              <p className="flex flex-wrap items-center gap-3 text-xs">
                <span className="inline-flex items-center gap-1 text-status-shipped">
                  <CheckCircle2 className="h-3.5 w-3.5" /> {valid.length} ready
                </span>
                {invalid.length > 0 && (
                  <span className="inline-flex items-center gap-1 text-status-blocked">
                    <XCircle className="h-3.5 w-3.5" /> {invalid.length} skipped
                  </span>
                )}
                {valid.length > MAX_ROWS && (
                  <span className="text-warning">
                    Only the first {MAX_ROWS} are imported per batch.
                  </span>
                )}
                <span className="text-subtle">Rows without a team go to your team.</span>
              </p>
              <div className="max-h-72 overflow-auto rounded-lg border border-border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-elevated text-left text-subtle">
                    <tr>
                      <th className="px-2 py-1.5 font-medium">Row</th>
                      <th className="px-2 py-1.5 font-medium">Title</th>
                      <th className="px-2 py-1.5 font-medium">Team</th>
                      <th className="px-2 py-1.5 font-medium">Status</th>
                      <th className="px-2 py-1.5 font-medium">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {mapped.slice(0, 200).map((r) => (
                      <tr key={r.line} className={cn(!r.input && "bg-status-blocked/5")}>
                        <td className="px-2 py-1.5 tabular-nums text-subtle">{r.line}</td>
                        <td className="max-w-[16rem] truncate px-2 py-1.5 text-foreground">
                          {r.input?.title ?? "—"}
                        </td>
                        <td className="px-2 py-1.5 text-muted">
                          {r.input
                            ? r.input.teamId
                              ? teamOf(r.input.teamId)?.name
                              : "Your team"
                            : ""}
                        </td>
                        <td className="px-2 py-1.5 text-muted">
                          {r.input?.status ? STATUS_META[r.input.status].label : ""}
                        </td>
                        <td className="px-2 py-1.5">
                          {r.error ? (
                            <span className="text-status-blocked">{r.error}</span>
                          ) : r.warning ? (
                            <span className="inline-flex items-center gap-1 text-warning">
                              <AlertTriangle className="h-3 w-3" />
                              {r.warning}
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {mapped.length === 0 && (
                <ErrorNote>That file has a header row but no data.</ErrorNote>
              )}
            </div>
          )}
          {run.error && <ErrorNote>{run.error.message}</ErrorNote>}
        </div>
      )}
    </Dialog>
  );
}
