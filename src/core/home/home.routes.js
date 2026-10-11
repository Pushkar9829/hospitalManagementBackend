import { Router } from 'express';
import { z } from 'zod';
import { hasPermission } from '@hms/shared';
import { defineRoutes } from '../http/route.js';
import { current } from '../tenancy/context.js';
import { logger } from '../observability/logger.js';
import { PANELS_ALL, homeWidgets, istDay } from './registry.js';
import './core.widgets.js';

const can = (key) => key === 'authenticated' || hasPermission([...current().permissions], key);
const subscribed = (module) => module === 'CORE' || current().modules.has(module);

/**
 * The widgets of one role panel for the signed-in user. Each widget checks its own permission
 * and module; one that fails is left out (logged) so the rest of the home page still loads.
 */
export async function homePage(panel, now = new Date()) {
  const c = current();
  const day = istDay(now);
  const ctx = { panel, userId: c.userId, branchId: c.branchId, today: day.today, day, now };
  const visible = homeWidgets(panel).filter((w) => subscribed(w.module) && can(w.permission));
  const built = await Promise.all(
    visible.map(async (w) => {
      try {
        const data = await w.build(ctx);
        return data == null ? null : { id: w.id, kind: w.kind, ...data };
      } catch (err) {
        logger.warn({ err, widget: w.id }, 'home widget failed');
        return null;
      }
    }),
  );
  return { panel, at: now.toISOString(), today: day.today, widgets: built.filter(Boolean) };
}

const routes = defineRoutes({
  module: 'CORE',
  basePath: '/home',
  routes: [
    {
      method: 'get',
      path: '',
      permission: 'authenticated',
      audit: null,
      summary: 'Role home page: KPIs, worklist and alerts for one panel',
      schema: { query: z.object({ panel: z.enum(PANELS_ALL) }) },
      handler: (req) => homePage(req.valid.query.panel),
    },
  ],
});

const router = Router();
router.use(routes);
export const homeModule = { name: 'home', router };
