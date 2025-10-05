// Helpers de RBAC para Express
export function getRoles(req) {
  return Array.isArray(req.user?.roles) ? req.user.roles : [];
}

export function requireRole(role) {
  return (req, res, next) => {
    const roles = getRoles(req);
    const has = roles.includes(role);
    if (!has) {
      console.warn(`[403] uid=${req.user?.uid||'anon'} roles=${JSON.stringify(roles)} endpoint=${req.method} ${req.originalUrl}`);
      return res.status(403).json({ error: 'forbidden', reason: `requires role: ${role}`, uid: req.user?.uid||null, roles });
    }
    next();
  };
}

export function requireEditorOrAdmin(req, res, next) {
  const roles = getRoles(req);
  const has = roles.includes('editor') || roles.includes('admin');
  if (!has) {
    console.warn(`[403] uid=${req.user?.uid||'anon'} roles=${JSON.stringify(roles)} endpoint=${req.method} ${req.originalUrl}`);
    return res.status(403).json({ error: 'forbidden', reason: 'requires role: editor or admin', uid: req.user?.uid||null, roles });
  }
  next();
}