import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { roleHasPermission, type UserRole } from '@blinkscore/core';
import { api } from '../lib/api.js';

export interface MeUser {
  id: string;
  username: string;
  email: string;
  displayName: string;
  isSuperAdmin: boolean;
  mustChangePassword?: boolean;
  createdAt?: string;
}
export interface MeRole {
  organizationId: string;
  role: string;
}

interface AuthState {
  user: MeUser | null;
  roles: MeRole[];
  ready: boolean;
  restore: () => Promise<boolean>;
  login: (usernameOrEmail: string, password: string) => Promise<MeUser>;
  logout: () => Promise<void>;
  setUser: (u: MeUser) => void;
  setRoles: (r: MeRole[]) => void;
}

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      roles: [],
      ready: false,
      restore: async () => {
        try {
          const me = await api<{ user: MeUser; roles: MeRole[] }>('/api/auth/me');
          set({ user: me.user, roles: me.roles, ready: true });
          return true;
        } catch {
          set({ user: null, roles: [], ready: true });
          return false;
        }
      },
      login: async (usernameOrEmail, password) => {
        const me = await api<{ user: MeUser; roles: MeRole[] }>('/api/auth/login', { method: 'POST', json: { usernameOrEmail, password } });
        set({ user: me.user, roles: me.roles, ready: true });
        return me.user;
      },
      logout: async () => {
        try {
          await api('/api/auth/logout', { method: 'POST' });
        } finally {
          set({ user: null, roles: [], ready: true });
        }
      },
      setUser: (u) => set({ user: u }),
      setRoles: (r) => set({ roles: r }),
    }),
    { name: 'psa-auth', storage: createJSONStorage(() => localStorage), partialize: (s) => ({ user: s.user, roles: s.roles }) },
  ),
);

export function allowed(roles: MeRole[], organizationId: string, permission: string): boolean {
  // An org-scoped role, or a platform-scoped role (organizationId '*'), satisfies org permissions.
  return roles.some(
    (r) => (r.organizationId === organizationId || r.organizationId === '*') && roleHasPermission(r.role as UserRole, permission as never),
  );
}

export function useOrgPerm(orgId: string, permission: string): boolean {
  const user = useAuth((s) => s.user);
  const roles = useAuth((s) => s.roles);
  if (user?.isSuperAdmin) return true;
  return allowed(roles, orgId, permission);
}

/** True when the user holds the permission anywhere (any org role or super admin). */
export function useAnyPerm(permission: string): boolean {
  const user = useAuth((s) => s.user);
  const roles = useAuth((s) => s.roles);
  if (user?.isSuperAdmin) return true;
  return roles.some((r) => roleHasPermission(r.role as UserRole, permission as never));
}