import { Router } from 'express';
import { invitePublicRoutes, roleRoutes, userRoutes } from './users.routes.js';

/**
 * Users and roles (CORE): staff logins with invitation or temporary password, privileged-role
 * approval, unlock, reset, deactivate, Super Admin safeguards; custom roles copied from system
 * roles whose permissions change only after Super Admin approval.
 */
const router = Router();
router.use(userRoutes, roleRoutes);

export const usersModule = { name: 'users', router, publicRouter: invitePublicRoutes };
