import { createMemoryHistory } from "@tanstack/react-router";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  WS_METHODS,
  type AgentSessionImportSessionInput,
  type AgentSessionListResult,
} from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { AppRoot } from "~/AppRoot";
// The draft route loads ChatView lazily; importing it here keeps its first transform out of the test's timeout.
import "~/components/ChatView";
import { DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { getRouter } from "~/router";
import { useUiStateStore } from "~/uiStateStore";
import {
  ENVIRONMENT_ID,
  PROJECT_ID,
  answerRpc,
  installFakeEnvironment,
  type FakeDriver,
} from "../../../test/fakeEnvironment";
import { render } from "../../../test/render";

// The socket is the only fake layer; see test/appScenarios.renders.tsx.
vi.mock(
  "../../../../../packages/client-runtime/src/connection/driver.ts",
  async (importOriginal) => {
    const [actual, { fakeDriver }, Layer] = await Promise.all([
      importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
      import("../../../test/fakeEnvironment"),
      import("effect/Layer"),
    ]);
    return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
  },
);

vi.mock(import("~/rpc/requestLatencyState"), async (original) => ({
  ...(await original()),
  trackRpcRequestSent: () => {},
}));

it("the new-thread project picker follows the manual sidebar project order", async () => {
  using _environment = installFakeEnvironment([], {
    extraProjects: [
      { id: ProjectId.make("project-alpha"), title: "alpha" },
      { id: ProjectId.make("project-beta"), title: "beta" },
    ],
  });
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
    sidebarProjectSortOrder: "manual",
  });
  useUiStateStore.setState({
    projectOrder: [
      `${ENVIRONMENT_ID}:/workspace/beta`,
      `${ENVIRONMENT_ID}:/workspace/render`,
      `${ENVIRONMENT_ID}:/workspace/alpha`,
    ],
  });
  using _order = { [Symbol.dispose]: () => useUiStateStore.setState({ projectOrder: [] }) };
  const draftId = DraftId.make("draft-manual-order");
  useComposerDraftStore
    .getState()
    .setProjectDraftThreadId(scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID), draftId);

  const router = getRouter(createMemoryHistory({ initialEntries: [`/draft/${draftId}`] }));
  await router.load();
  await using _app = await render(<AppRoot router={router} />, {
    // AppRoot brings its own router.
    router: false,
  });
  // The shell snapshot has arrived once the sidebar lists the project.
  await expect.element(page.getByText("render", { exact: true }).first()).toBeVisible();
  const trigger = document.querySelector<HTMLElement>("[data-draft-project-trigger]");
  if (!trigger) throw new Error("The draft project picker did not render.");
  await userEvent.click(page.elementLocator(trigger));
  await expect.element(page.getByRole("option", { name: "beta" })).toBeVisible();

  // The draft's own project leads; the rest keep the sidebar's order.
  await vi.waitFor(() => {
    expect(
      page
        .getByRole("option")
        .elements()
        .map((option) => option.textContent),
    ).toEqual([
      expect.stringMatching(/render$/),
      expect.stringMatching(/beta$/),
      expect.stringMatching(/alpha$/),
      "Add project",
    ]);
  });
});

it("a terminal Claude Code session picked on the new-thread screen opens as a thread", async () => {
  using _environment = installFakeEnvironment([]);
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  const providerInstanceId = ProviderInstanceId.make("claudeAgent");
  const sessions: AgentSessionListResult = {
    sessions: [
      {
        provider: "claudeAgent",
        providerInstanceId,
        providerSessionId: "session-reports",
        title: "Support reports",
        lastPrompt: "Can the MCP be extended?",
        lastActiveAt: "2026-01-01T00:00:00.000Z",
        branch: "feat/reports",
        threadId: null,
      },
      {
        provider: "claudeAgent",
        providerInstanceId,
        providerSessionId: "session-untitled",
        title: null,
        lastPrompt: "Fix the flaky test",
        lastActiveAt: "2025-12-01T00:00:00.000Z",
        branch: null,
        threadId: null,
      },
    ],
    truncated: false,
  };
  using _list = answerRpc(WS_METHODS.agentSessionsListSessions, () => Effect.succeed(sessions));
  const imported: Array<AgentSessionImportSessionInput> = [];
  const threadId = ThreadId.make("thread-imported");
  using _import = answerRpc(
    WS_METHODS.agentSessionsImportSession,
    (input: AgentSessionImportSessionInput) => {
      imported.push(input);
      return Effect.succeed({ threadId });
    },
  );
  const draftId = DraftId.make("draft-continue-session");
  useComposerDraftStore
    .getState()
    .setProjectDraftThreadId(scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID), draftId);

  const router = getRouter(createMemoryHistory({ initialEntries: [`/draft/${draftId}`] }));
  await router.load();
  await using _app = await render(<AppRoot router={router} />, { router: false });

  await userEvent.click(page.getByRole("button", { name: "or continue a Claude Code session" }));
  // A session without a title is named after its last prompt.
  await expect.element(page.getByText("Fix the flaky test")).toBeVisible();
  await expect.element(page.getByText("feat/reports")).toBeVisible();

  await userEvent.fill(page.getByPlaceholder("Search sessions..."), "reports");
  await expect.element(page.getByText("Fix the flaky test")).not.toBeInTheDocument();
  await userEvent.click(page.getByText("Support reports"));

  await vi.waitFor(() => {
    expect(imported).toEqual([
      { projectId: PROJECT_ID, providerInstanceId, providerSessionId: "session-reports" },
    ]);
    expect(router.state.location.pathname).toBe(`/${ENVIRONMENT_ID}/${threadId}`);
  });
});
