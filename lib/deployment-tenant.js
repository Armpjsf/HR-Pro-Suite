// Dependency-free: public company rendering must not import the authentication runtime.
export function getDeploymentTenantId() {
  return process.env.HR_TENANT_ID?.trim() || 'default-tenant';
}
