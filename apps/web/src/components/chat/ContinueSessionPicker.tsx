import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  type AgentSessionSummary,
  type ScopedProjectRef,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { msg, T, useGT, useMessages, Var } from "gt-react";
import { TerminalIcon } from "lucide-react";
import { useState } from "react";

import { m } from "~/i18n/messages";
import { agentSessionImportSession, agentSessionList } from "~/state/agentSessions";
import { useEnvironmentQuery } from "~/state/query";
import { useEnvironmentScope } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";
import { buildThreadRouteParams } from "~/threadRoutes";

import { readableFailure } from "../pullRequest/pullRequestDetail.logic";
import { RelativeTime } from "../RelativeTime";
import { threadLinkMatcher } from "../ThreadLinkPicker.logic";
import { InlineButton } from "../ui/button";
import { Command, CommandInput, CommandItem, CommandList } from "../ui/command";
import { Dialog, DialogPopup, DialogTitle } from "../ui/dialog";
import { toastManager } from "../ui/toast";

const CLAUDE_CODE = "Claude Code";

/** Opens a project's terminal Claude Code sessions, to continue one as a thread. */
export function ContinueSessionButton({ projectRef }: { readonly projectRef: ScopedProjectRef }) {
  const [open, setOpen] = useState(false);
  const canOperate = useEnvironmentScope(projectRef.environmentId, AuthOrchestrationOperateScope);
  if (!canOperate) return null;
  return (
    <>
      <InlineButton tone="muted" className="pointer-events-auto" onClick={() => setOpen(true)}>
        <T>
          or continue a <Var>{CLAUDE_CODE}</Var> session
        </T>
      </InlineButton>
      {open ? (
        <Dialog open onOpenChange={setOpen}>
          <DialogPopup className="max-w-md" showCloseButton={false}>
            <DialogTitle className="sr-only">
              <T>
                Continue a <Var>{CLAUDE_CODE}</Var> session
              </T>
            </DialogTitle>
            <ContinueSessionPicker projectRef={projectRef} onClose={() => setOpen(false)} />
          </DialogPopup>
        </Dialog>
      ) : null}
    </>
  );
}

function ContinueSessionPicker({
  projectRef,
  onClose,
}: {
  readonly projectRef: ScopedProjectRef;
  readonly onClose: () => void;
}) {
  const gt = useGT();
  const navigate = useNavigate();
  const { environmentId, projectId } = projectRef;
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(false);
  const sessions = useEnvironmentQuery(
    agentSessionList({ environmentId, input: { projectId } }),
    useMessages(),
  );
  const importSession = useAtomCommand(agentSessionImportSession, { reportFailure: false });

  const pick = async (session: AgentSessionSummary) => {
    setPending(true);
    const result = await importSession({
      environmentId,
      input: {
        projectId,
        providerInstanceId: session.providerInstanceId,
        providerSessionId: session.providerSessionId,
      },
    });
    setPending(false);
    if (result._tag === "Failure") {
      if (isAtomCommandInterrupted(result)) return;
      toastManager.add({
        type: "error",
        title: m(msg("Could not continue the session")),
        description: readableFailure(
          squashAtomCommandFailure(result),
          m(msg("The server refused it.")),
        ),
      });
      return;
    }
    onClose();
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(environmentId, result.value.threadId)),
    });
  };

  const matches = threadLinkMatcher(query);
  const candidates = (sessions.data?.sessions ?? []).filter((session) =>
    matches(`${session.title ?? ""} ${session.lastPrompt ?? ""} ${session.branch ?? ""}`),
  );
  const status =
    sessions.data === null ? (
      sessions.error === null ? (
        <T>Looking for sessions...</T>
      ) : (
        sessions.error
      )
    ) : candidates.length === 0 ? (
      <T>
        No <Var>{CLAUDE_CODE}</Var> sessions found for this project.
      </T>
    ) : null;

  return (
    <Command mode="none" value={query} onValueChange={setQuery} aria-label={gt("Choose a session")}>
      <CommandInput placeholder={gt("Search sessions...")} disabled={pending} />
      <CommandList className="max-h-80 overflow-y-auto">
        {status === null ? (
          candidates.map((session) => (
            <CommandItem
              key={`${session.providerInstanceId}:${session.providerSessionId}`}
              value={`${session.providerInstanceId}:${session.providerSessionId}`}
              disabled={pending}
              onClick={() => void pick(session)}
            >
              <TerminalIcon aria-hidden className="size-4 shrink-0" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">
                  {session.title ?? session.lastPrompt ?? gt("Untitled session")}
                </span>
                <span className="flex min-w-0 gap-1.5 text-xs text-muted-foreground">
                  <span className="shrink-0">
                    <RelativeTime timestamp={session.lastActiveAt} />
                  </span>
                  {session.branch === null ? null : (
                    <span className="truncate">{session.branch}</span>
                  )}
                </span>
              </span>
              {session.threadId === null ? null : (
                <span className="shrink-0 text-xs text-muted-foreground">
                  <T context="session already has a thread">Opened</T>
                </span>
              )}
            </CommandItem>
          ))
        ) : (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">{status}</div>
        )}
      </CommandList>
      {sessions.data?.truncated === true ? (
        <p className="border-t px-3 py-2 text-xs text-muted-foreground">
          <T>Showing the most recent sessions.</T>
        </p>
      ) : null}
    </Command>
  );
}
