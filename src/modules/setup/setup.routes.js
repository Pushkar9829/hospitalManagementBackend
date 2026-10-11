import { z } from 'zod';
import {
  branchInput,
  departmentInput,
  hospitalSettingsInput,
  legalEntityInput,
  MASTER_TYPES,
  MASTERS,
  NUMBER_SERIES,
  numberSeriesInput,
  objectId,
  pageQuery,
} from '@hms/shared/schemas';
import { defineRoutes } from '../../core/http/route.js';
import { paginate } from '../../core/http/paginate.js';
import { errors } from '../../core/errors/index.js';
import { Department } from './models/department.model.js';
import * as hospital from './services/hospital.service.js';
import * as departments from './services/department.service.js';
import * as numbering from './services/numbering.service.js';
import * as masters from './services/masters.service.js';
import { commitImport, importTemplate, previewImport } from './services/import.service.js';

const id = z.object({ id: objectId });
const version = z.object({ version: z.number().int().min(0) });
const reason = z.object({ reason: z.string().trim().max(500).optional() });
const closeBody = version.extend({ reason: z.string().trim().min(3, 'Give a reason').max(500) });

/** Sends 202 when the result waits for approval. */
const accepted = (res, result) => {
  if (result.approvalId) res.locals.status = 202;
  return result;
};

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const settingsRoutes = defineRoutes({
  module: 'CORE',
  routes: [
    {
      method: 'get',
      path: '/settings/hospital',
      permission: 'settings:hospital:read',
      audit: null,
      summary: 'Hospital settings: name, financial year, localisation, idle timeout, communication',
      handler: () => hospital.getSettings(),
    },
    {
      method: 'put',
      path: '/settings/hospital',
      permission: 'settings:hospital:update',
      audit: 'UPDATE',
      summary: 'Save hospital settings',
      schema: { body: hospitalSettingsInput.extend({ version: z.number().int().min(0) }) },
      handler: (req) => hospital.updateSettings(req.valid.body),
    },
    {
      method: 'get',
      path: '/settings/entities',
      permission: 'settings:hospital:read',
      audit: null,
      summary: 'Legal entities that issue bills',
      handler: () => hospital.listEntities(),
    },
    {
      method: 'post',
      path: '/settings/entities',
      permission: 'settings:hospital:update',
      audit: 'CREATE',
      status: 201,
      summary: 'Add a legal entity',
      schema: { body: legalEntityInput },
      handler: (req) => hospital.saveEntity(null, req.valid.body),
    },
    {
      method: 'put',
      path: '/settings/entities/:id',
      permission: 'settings:hospital:update',
      audit: 'UPDATE',
      summary: 'Update a legal entity',
      schema: { params: id, body: legalEntityInput.extend({ version: z.number().int().min(0) }) },
      handler: (req) => hospital.saveEntity(req.valid.params.id, req.valid.body),
    },
    {
      method: 'get',
      path: '/settings/number-series',
      permission: 'settings:hospital:read',
      audit: null,
      summary: 'Prefix, reset and width of every document number series',
      handler: () => numbering.listSeries(),
    },
    {
      method: 'put',
      path: '/settings/number-series/:series',
      permission: 'settings:hospital:update',
      audit: 'UPDATE',
      summary: 'Change a number series (takes effect for the next number)',
      schema: {
        params: z.object({ series: z.enum(Object.keys(NUMBER_SERIES)) }),
        body: numberSeriesInput,
      },
      handler: (req) => numbering.updateSeries(req.valid.params.series, req.valid.body),
    },
  ],
});

export const branchRoutes = defineRoutes({
  module: 'CORE',
  basePath: '/branches',
  routes: [
    {
      method: 'get',
      path: '/',
      permission: 'authenticated',
      audit: null,
      summary: 'Branches with their status',
      handler: () => hospital.listBranches(),
    },
    {
      method: 'post',
      path: '/',
      permission: 'settings:branch:create',
      audit: 'CREATE',
      status: 201,
      summary: 'Open a branch (within the plan limit; needs Super Admin approval: 202)',
      schema: { body: branchInput.extend(reason.shape) },
      handler: async (req, res) => {
        const { reason: why, ...input } = req.valid.body;
        return accepted(res, await hospital.createBranch(input, why));
      },
    },
    {
      method: 'put',
      path: '/:id',
      permission: 'settings:branch:update',
      audit: 'UPDATE',
      summary: 'Update branch details',
      schema: { params: id, body: branchInput.extend(version.shape) },
      handler: (req) => hospital.updateBranch(req.valid.params.id, req.valid.body),
    },
    {
      method: 'post',
      path: '/:id/close',
      permission: 'settings:branch:update',
      audit: 'UPDATE',
      summary: 'Close a branch (needs Super Admin approval)',
      schema: { params: id, body: closeBody },
      handler: async (req, res) =>
        accepted(res, await hospital.closeBranch(req.valid.params.id, req.valid.body)),
    },
  ],
});

export const departmentRoutes = defineRoutes({
  module: 'CORE',
  basePath: '/departments',
  routes: [
    {
      method: 'get',
      path: '/',
      permission: 'authenticated',
      audit: null,
      summary: 'Departments, filterable by status, type, branch and name',
      schema: {
        query: pageQuery.extend({
          status: z.enum(['DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'CLOSING', 'INACTIVE']).optional(),
          type: z.enum(['CLINICAL', 'DIAGNOSTIC', 'SUPPORT', 'ADMINISTRATIVE']).optional(),
          branchId: objectId.optional(),
          q: z.string().trim().max(60).optional(),
          opd: z.coerce.boolean().optional(),
        }),
      },
      handler: (req) => {
        const { status, type, branchId, q, opd, ...page } = req.valid.query;
        const filter = {
          ...(status ? { status } : {}),
          ...(type ? { type } : {}),
          ...(branchId ? { 'location.branchId': branchId } : {}),
          ...(opd ? { 'services.opd': true } : {}),
          ...(q
            ? {
                $or: [
                  { code: new RegExp(`^${escapeRegex(q.toUpperCase())}`) },
                  { name: new RegExp(escapeRegex(q), 'i') },
                ],
              }
            : {}),
        };
        return paginate(
          Department,
          filter,
          { ...page, sort: page.sort ?? 'name' },
          {
            allowedSort: ['name', 'code', 'createdAt'],
            defaultSort: 'name',
            map: departments.departmentDto,
          },
        );
      },
    },
    {
      method: 'get',
      path: '/:id',
      permission: 'authenticated',
      audit: null,
      summary: 'One department',
      schema: { params: id },
      handler: async (req) => {
        const d = await Department.findById(req.valid.params.id).lean();
        if (!d) throw errors.notFound('Department');
        return departments.departmentDto(d);
      },
    },
    {
      method: 'post',
      path: '/',
      permission: 'settings:department:create',
      audit: 'CREATE',
      status: 201,
      summary: 'Register a department; it waits for Super Admin approval (202)',
      schema: { body: departmentInput.extend(reason.shape) },
      handler: async (req, res) => {
        const { reason: why, ...input } = req.valid.body;
        return accepted(res, await departments.createDepartment(input, why));
      },
    },
    {
      method: 'put',
      path: '/:id',
      permission: 'settings:department:update',
      audit: 'UPDATE',
      summary: 'Update a department (code is fixed after approval)',
      schema: { params: id, body: departmentInput.extend(version.shape) },
      handler: (req) => departments.updateDepartment(req.valid.params.id, req.valid.body),
    },
    {
      method: 'post',
      path: '/:id/submit',
      permission: 'settings:department:create',
      audit: 'UPDATE',
      summary: 'Send a draft department for approval again',
      schema: { params: id, body: version.extend(reason.shape) },
      handler: async (req, res) =>
        accepted(res, await departments.submitDepartment(req.valid.params.id, req.valid.body)),
    },
    {
      method: 'post',
      path: '/:id/close',
      permission: 'settings:department:update',
      audit: 'UPDATE',
      summary: 'Close a department: lists what still uses it, otherwise asks for approval',
      schema: { params: id, body: closeBody },
      handler: async (req, res) =>
        accepted(res, await departments.closeDepartment(req.valid.params.id, req.valid.body)),
    },
  ],
});

const typeParam = z.object({ type: z.enum(MASTER_TYPES) });
const anyMaster = z.union(MASTER_TYPES.map((t) => MASTERS[t].input));

export const masterRoutes = defineRoutes({
  module: 'CORE',
  basePath: '/masters',
  routes: [
    {
      method: 'get',
      path: '/:type',
      permission: 'authenticated',
      audit: null,
      summary: 'List a master (price lists, tax codes, payment modes, services ...)',
      schema: {
        params: typeParam,
        query: pageQuery.extend({
          q: z.string().trim().max(60).optional(),
          active: z
            .enum(['true', 'false'])
            .transform((v) => v === 'true')
            .optional(),
          // Narrowing filters, used by the types that support them (beds by ward, ...).
          branchId: objectId.optional(),
          wardId: objectId.optional(),
          departmentId: objectId.optional(),
          kind: z.string().trim().max(30).optional(),
        }),
      },
      handler: (req) => masters.listMasters(req.valid.params.type, req.valid.query),
    },
    {
      method: 'get',
      path: '/:type/template',
      permission: 'settings:master:import',
      audit: null,
      summary: 'Excel template for importing a master',
      schema: { params: typeParam },
      handler: async (req, res) => {
        const t = await importTemplate(req.valid.params.type);
        res.setHeader('Content-Type', t.mime);
        res.setHeader('Content-Disposition', `attachment; filename="${t.filename}"`);
        res.send(t.buffer);
      },
    },
    {
      method: 'post',
      path: '/:type',
      permission: 'settings:master:create',
      audit: 'CREATE',
      status: 201,
      summary: 'Add a master record (services wait for tariff approval: 202)',
      schema: {
        params: typeParam,
        body: z.object({ reason: z.string().trim().max(500).optional() }).passthrough(),
      },
      handler: async (req, res) => {
        const { type } = req.valid.params;
        const { reason: why, ...raw } = req.valid.body;
        const parsed = MASTERS[type].input.safeParse(raw);
        if (!parsed.success)
          throw errors.validation(
            parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
          );
        return accepted(res, await masters.createMaster(type, parsed.data, { reason: why }));
      },
    },
    {
      method: 'put',
      path: '/:type/:id',
      permission: 'settings:master:update',
      audit: 'UPDATE',
      summary: 'Update a master record (service rate changes wait for approval: 202)',
      schema: {
        params: typeParam.extend(id.shape),
        body: z
          .object({
            version: z.number().int().min(0),
            reason: z.string().trim().max(500).optional(),
          })
          .passthrough(),
      },
      handler: async (req, res) => {
        const { type, id: recordId } = req.valid.params;
        const { reason: why, version: v, ...raw } = req.valid.body;
        const parsed = MASTERS[type].input.safeParse(raw);
        if (!parsed.success)
          throw errors.validation(
            parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
          );
        return accepted(
          res,
          await masters.updateMaster(
            type,
            recordId,
            { ...parsed.data, version: v },
            { reason: why },
          ),
        );
      },
    },
    {
      method: 'post',
      path: '/:type/:id/active',
      permission: 'settings:master:update',
      audit: 'UPDATE',
      summary: 'Activate or deactivate a master record',
      schema: { params: typeParam.extend(id.shape), body: version.extend({ active: z.boolean() }) },
      handler: (req) =>
        masters.setMasterActive(req.valid.params.type, req.valid.params.id, req.valid.body),
    },
    {
      method: 'post',
      path: '/:type/import',
      permission: 'settings:master:import',
      audit: 'CREATE',
      summary:
        'Import from an uploaded Excel/CSV file: preview (commit=false) or save all rows (commit=true)',
      schema: {
        params: typeParam,
        body: z.object({
          fileId: objectId,
          commit: z.boolean().default(false),
          reason: z.string().trim().max(500).optional(),
        }),
      },
      handler: async (req, res) => {
        const { type } = req.valid.params;
        const { fileId, commit, reason: why } = req.valid.body;
        return commit
          ? accepted(res, await commitImport(type, fileId, { reason: why }))
          : previewImport(type, fileId);
      },
    },
  ],
});

// Keep the union referenced for the OpenAPI document of POST /masters/:type.
export const masterInputSchema = anyMaster;
