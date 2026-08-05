import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
} from '@tanstack/react-router';

import { Activity } from './pages/Activity';
import { Dashboard } from './pages/Dashboard';
import { Embeds } from './pages/Embeds';
import { Listeners } from './pages/Listeners';
import { Reports } from './pages/Reports';
import { Settings } from './pages/Settings';

const rootRoute = createRootRoute({
  validateSearch: (search: Record<string, unknown>) => ({
    leak: search.leak === true ? true : undefined,
  }),
  component: Layout,
});

/** Carry `?leak=true` across navigations, so leaky mode survives a route change. */
const keepLeak = (prev: { leak?: boolean }) => ({ leak: prev.leak });

function Layout() {
  return (
    <>
      <nav>
        <Link to="/" search={keepLeak}>
          Dashboard
        </Link>
        <Link to="/reports" search={keepLeak}>
          Reports
        </Link>
        <Link to="/listeners" search={keepLeak}>
          Listeners
        </Link>
        <Link to="/embeds" search={keepLeak}>
          Embeds
        </Link>
        <Link to="/activity" search={keepLeak}>
          Activity
        </Link>
        <Link to="/settings" search={keepLeak}>
          Settings
        </Link>
      </nav>
      <Outlet />
    </>
  );
}

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: Dashboard,
});

const reportsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reports',
  component: Reports,
});

const listenersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/listeners',
  component: Listeners,
});

const embedsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/embeds',
  component: Embeds,
});

const activityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/activity',
  component: Activity,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: Settings,
});

const routeTree = rootRoute.addChildren([
  dashboardRoute,
  reportsRoute,
  listenersRoute,
  embedsRoute,
  activityRoute,
  settingsRoute,
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
