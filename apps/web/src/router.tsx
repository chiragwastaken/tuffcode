import { Navigate, createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { EmptyState } from '@tuffcode/ui';
import { useEffect } from 'react';
import { AppShell } from './components/AppShell';
import { EmptyWorkspace } from './components/EmptyWorkspace';
import { ThreadPlaceholder } from './components/thread/ThreadPlaceholder';
import { SettingsPage } from './routes/settings/settings-page';
import { useAppStore } from './store/app-store';

function WorkspaceIndex() {
  const projects = useAppStore((state) => state.projects);
  const threads = useAppStore((state) => state.threads);
  const activeThreadId = useAppStore((state) => state.activeThreadId);

  if (projects.length === 0) return <EmptyWorkspace />;

  const candidate =
    (activeThreadId ? threads[activeThreadId] : undefined) ??
    Object.values(threads).toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];

  if (candidate) {
    return (
      <Navigate
        to="/project/$projectId/thread/$threadId"
        params={{ projectId: candidate.projectId, threadId: candidate.id }}
        replace
      />
    );
  }

  return (
    <div className="flex h-full items-center justify-center p-6">
      <EmptyState
        title="No threads yet"
        description="Create a thread from the sidebar to start a conversation."
        className="w-full max-w-md"
      />
    </div>
  );
}

function ThreadView() {
  const { projectId, threadId } = threadRoute.useParams();
  const thread = useAppStore((state) => state.threads[threadId]);
  const projectName = useAppStore(
    (state) => state.projects.find((project) => project.id === projectId)?.name,
  );
  const setActiveThread = useAppStore((state) => state.setActiveThread);

  useEffect(() => {
    setActiveThread(threadId);
  }, [setActiveThread, threadId]);

  return <ThreadPlaceholder threadId={threadId} thread={thread} projectName={projectName} />;
}

function SettingsView() {
  const { section } = settingsRoute.useParams();

  return <SettingsPage section={section} />;
}

function NotFound() {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <EmptyState title="Not found" description="That route does not exist." />
    </div>
  );
}

const rootRoute = createRootRoute({
  component: AppShell,
  notFoundComponent: NotFound,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: WorkspaceIndex,
});

const threadRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/project/$projectId/thread/$threadId',
  component: ThreadView,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/{-$section}',
  component: SettingsView,
});

const routeTree = rootRoute.addChildren([indexRoute, threadRoute, settingsRoute]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
