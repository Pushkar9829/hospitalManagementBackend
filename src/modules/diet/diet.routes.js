import { z } from 'zod';
import { objectId } from '@hms/shared/schemas';
import { defineRoutes } from '../../core/http/route.js';
import { withLiveUpdates } from '../../core/realtime/live.js';
import * as diet from './services/diet.service.js';
import * as kitchen from './services/kitchen.service.js';

const ymdQ = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

const id = z.object({ id: objectId });
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const meal = z.string().trim().toUpperCase().min(2).max(20);
/** Doctors and nurses order diets from the ward; the dietitian and kitchen manage them. */
const ORDER = ['diet:order:update', 'ipd:note:write', 'nursing:diet:update'];
const READ = ['diet:order:read', 'ipd:note:write', 'ipd:admission:read'];
const WARD = ['diet:production:update', 'nursing:diet:update'];

/** Diet and kitchen (board Diet): orders, NBM, production sheet, trays, delivery, dietitian. */
export const dietRoutes = defineRoutes({
  module: 'DIET',
  basePath: '/diet',
  routes: withLiveUpdates(
    [
      {
        method: 'get',
        path: '/billing',
        permission: READ,
        audit: null,
        summary: "A day's meals charged to running bills, by stay",
        schema: { query: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }) },
        handler: (req) => diet.mealBilling(req.valid.query),
      },
      {
        method: 'get',
        path: '/settings',
        permission: 'authenticated',
        audit: null,
        summary: 'Diet types, meals and charging rules',
        handler: () => diet.getSettings(),
      },
      {
        method: 'put',
        path: '/settings',
        permission: 'diet:settings:update',
        audit: 'UPDATE',
        summary: 'Edit diet types, meal times and charging',
        schema: { body: diet.settingsInput },
        handler: (req) => diet.saveSettings(req.valid.body),
      },
      {
        method: 'get',
        path: '/orders',
        permission: READ,
        audit: null,
        summary: 'Active diet orders by ward',
        schema: { query: z.object({ ward: z.string().trim().max(60).optional() }) },
        handler: (req) => diet.listOrders(req.valid.query),
      },
      {
        method: 'get',
        path: '/orders/:id',
        permission: READ,
        audit: null,
        summary: 'A stay’s current diet order (id is the admission)',
        schema: { params: id },
        handler: (req) => diet.activeOrder(req.valid.params.id),
      },
      {
        method: 'put',
        path: '/orders/:id',
        permission: ORDER,
        audit: 'UPDATE',
        summary: 'Order a diet for a stay (id is the admission); the old order ends',
        schema: { params: id, body: diet.orderInput },
        handler: (req) => diet.setOrder(req.valid.params.id, req.valid.body),
      },
      {
        method: 'post',
        path: '/orders/:id/nbm',
        permission: ORDER,
        audit: 'UPDATE',
        summary: 'Nil by mouth from a time (optionally until a time)',
        schema: { params: id, body: diet.nbmInput },
        handler: (req) => diet.setNbm(req.valid.params.id, req.valid.body),
      },
      {
        method: 'delete',
        path: '/orders/:id/nbm',
        permission: ORDER,
        audit: 'UPDATE',
        summary: 'End nil by mouth',
        schema: { params: id },
        noBody: true,
        handler: (req) => diet.clearNbm(req.valid.params.id),
      },
      {
        method: 'get',
        path: '/production',
        permission: ['diet:production:read', 'diet:order:read'],
        audit: null,
        summary: 'Production sheet for a meal: counts by diet and ward, held NBM trays',
        schema: { query: z.object({ date: ymd.optional(), meal }) },
        handler: (req) => diet.production(req.valid.query),
      },
      {
        method: 'post',
        path: '/production/prepare',
        permission: 'diet:production:update',
        audit: 'CREATE',
        summary: 'Prepare the meal: one labelled tray per patient',
        schema: { body: z.object({ date: ymd.optional(), meal }) },
        handler: (req) => diet.prepare(req.valid.body),
      },
      {
        method: 'get',
        path: '/trays',
        permission: READ,
        audit: null,
        summary: 'Trays for a meal (and ward)',
        schema: {
          query: z.object({
            date: ymd.optional(),
            meal,
            ward: z.string().trim().max(60).optional(),
          }),
        },
        handler: (req) => diet.trays(req.valid.query),
      },
      {
        method: 'post',
        path: '/trays/deliver',
        permission: WARD,
        audit: 'UPDATE',
        summary: 'Confirm delivery (trays or a whole ward); private-room meals are charged',
        schema: {
          body: z.object({
            trayIds: z.array(objectId).max(200).optional(),
            date: ymd.optional(),
            meal: meal.optional(),
            ward: z.string().trim().max(60).optional(),
          }),
        },
        handler: (req) => diet.deliver(req.valid.body),
      },
      {
        method: 'post',
        path: '/trays/:id/missed',
        permission: WARD,
        audit: 'UPDATE',
        summary: 'Record a missed meal with the reason',
        schema: { params: id, body: z.object({ reason: z.string().trim().min(3).max(120) }) },
        handler: (req) => diet.markMissed(req.valid.params.id, req.valid.body),
      },
      {
        method: 'get',
        path: '/missed',
        permission: ['diet:production:read', 'diet:order:read'],
        audit: null,
        summary: 'Missed meals for a day',
        schema: { query: z.object({ date: ymd.optional() }) },
        handler: (req) => diet.missedReport(req.valid.query),
      },
      {
        method: 'get',
        path: '/notes/:id',
        permission: READ,
        audit: null,
        summary: 'Dietitian notes for a stay (id is the admission)',
        schema: { params: id },
        handler: (req) => diet.notes(req.valid.params.id),
      },
      {
        method: 'post',
        path: '/notes/:id',
        permission: 'diet:note:create',
        audit: 'CREATE',
        status: 201,
        summary: 'Nutrition assessment, counselling or discharge diet plan',
        schema: { params: id, body: diet.noteInput },
        handler: (req) => diet.addNote(req.valid.params.id, req.valid.body),
      },
      // ------------------------------------------------------------ kitchen stock costing
      {
        method: 'get',
        path: '/kitchen/stock',
        permission: ['diet:kitchen:read', 'diet:production:read'],
        audit: null,
        summary: 'Food stock in the kitchen store, at cost',
        schema: { query: z.object({ storeId: objectId.optional() }) },
        handler: (req) => kitchen.kitchenStock(req.valid.query),
      },
      {
        method: 'get',
        path: '/kitchen/consumption',
        permission: ['diet:kitchen:read', 'diet:production:read'],
        audit: null,
        summary: 'Food used by the kitchen in a period',
        schema: { query: z.object({ from: ymdQ, to: ymdQ }) },
        handler: (req) => kitchen.listConsumption(req.valid.query),
      },
      {
        method: 'post',
        path: '/kitchen/consumption',
        permission: ['diet:kitchen:update', 'diet:production:update'],
        audit: 'CREATE',
        status: 201,
        summary: 'Record food used (issued from the kitchen store, oldest expiry first)',
        schema: { body: kitchen.consumptionInput },
        handler: (req) => kitchen.recordConsumption(req.valid.body),
      },
      {
        method: 'get',
        path: '/kitchen/costing',
        permission: ['diet:kitchen:read', 'reports:diet:read'],
        audit: null,
        summary: 'Cost per meal: food used against trays served, and meals recovered on bills',
        schema: { query: z.object({ from: ymdQ, to: ymdQ }) },
        handler: (req) => kitchen.costing(req.valid.query),
      },
    ],
    'diet:update',
  ),
});
