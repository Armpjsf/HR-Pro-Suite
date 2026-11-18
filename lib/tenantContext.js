import { requireAuth, requireRole } from './auth.js';
export { getDeploymentTenantId } from './deployment-tenant.js';
import { getDeploymentTenantId } from './deployment-tenant.js';

export class TenantContextError extends Error {
  constructor(message, status = 401) {
    super(message);
    this.name = 'TenantContextError';
    this.status = status;
  }
}

/**
 * Resolves and validates the trusted HR tenant context from the authenticated JWT + active DB user.
 * Never trusts tenant_id from the request body or query parameters.
 */
export async function requireTenantContext(request, options = {}) {
  const authResult = Array.isArray(options.allowedRoles) && options.allowedRoles.length > 0
    ? await requireRole(request, options.allowedRoles)
    : await requireAuth(request);

  if (authResult.error) {
    throw new TenantContextError(authResult.error, authResult.status || 401);
  }

  const { user } = authResult;
  const deploymentTenantId = getDeploymentTenantId();

  if (user.tenantId && user.tenantId !== deploymentTenantId) {
    throw new TenantContextError('Token tenant mismatch', 403);
  }

  return Object.freeze({
    tenantId: deploymentTenantId,
    userId: user.id,
    role: user.role,
    employeeId: user.employeeId,
    department: user.department,
    user,
  });
}
