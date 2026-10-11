import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { parse as parseCookie } from 'cookie';
import { newRedisConnection } from '../cache/redis.js';
import { logger } from '../observability/logger.js';
import { tenantRegistry } from '../tenancy/tenant.registry.js';
import { ACCESS_COOKIE, tokenBlacklist, verifyAccessToken } from '../auth/tokens.js';
import { permissionCache } from '../rbac/permission.cache.js';

let io;

/**
 * Socket.IO for live screens (bed board, queue TV, approvals, critical alerts).
 * Rooms: t:{tenant}, t:{tenant}:b:{branch}, t:{tenant}:u:{user}. The Redis adapter lets any API
 * task emit to sockets held by another task.
 */
export function attachRealtime(httpServer) {
  io = new Server(httpServer, { path: '/socket.io', serveClient: false, cors: { origin: false } });
  io.adapter(createAdapter(newRedisConnection(), newRedisConnection()));

  io.use(async (socket, next) => {
    try {
      const tenant = await tenantRegistry.resolve(socket.handshake.headers);
      const token = parseCookie(socket.handshake.headers.cookie ?? '')[ACCESS_COOKIE];
      if (!tenant || !token) return next(new Error('UNAUTHENTICATED'));
      const claims = verifyAccessToken(token);
      if (claims.tid !== tenant.id || (await tokenBlacklist.has(claims.jti)))
        return next(new Error('UNAUTHENTICATED'));
      const access = await permissionCache.forUser(tenant.id, claims.sub);
      if (access?.status !== 'ACTIVE') return next(new Error('UNAUTHENTICATED'));
      socket.data = {
        tenantId: tenant.id,
        userId: claims.sub,
        branchIds: access.branchIds,
        exp: claims.exp,
      };
      next();
    } catch {
      next(new Error('UNAUTHENTICATED'));
    }
  });

  io.on('connection', (socket) => {
    const { tenantId, userId, branchIds, exp } = socket.data;
    socket.join([
      `t:${tenantId}`,
      `t:${tenantId}:u:${userId}`,
      ...branchIds.map((b) => `t:${tenantId}:b:${b}`),
    ]);
    // Drop the socket when its access token expires; the client reconnects after refreshing.
    const timer = setTimeout(() => socket.disconnect(true), Math.max(0, exp * 1000 - Date.now()));
    socket.on('disconnect', () => clearTimeout(timer));
  });
  logger.info('Realtime attached');
  return io;
}

/** Emits to a tenant (optionally one branch or one user). */
export function emit(tenantId, event, data, { branchId, userId } = {}) {
  if (!io) return;
  const room = userId
    ? `t:${tenantId}:u:${userId}`
    : branchId
      ? `t:${tenantId}:b:${branchId}`
      : `t:${tenantId}`;
  io.to(room).emit(event, data);
}

export async function closeRealtime() {
  if (io) await io.close();
  io = undefined;
}
