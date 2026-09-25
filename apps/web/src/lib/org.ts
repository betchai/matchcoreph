import { useEffect, useState } from 'react';
import { api } from './api.js';

export interface OrgInfo {
  id: string;
  name: string;
  shortName: string | null;
  city?: string | null;
  province?: string | null;
  country?: string | null;
  slug?: string | null;
}

export function useOrg(orgId: string | undefined): OrgInfo | null {
  const [org, setOrg] = useState<OrgInfo | null>(null);

  useEffect(() => {
    let alive = true;
    if (!orgId) {
      setOrg(null);
      return undefined;
    }
    api<OrgInfo>(`/api/orgs/${orgId}`)
      .then((o) => alive && setOrg(o))
      .catch(() => alive && setOrg(null));
    return () => {
      alive = false;
    };
  }, [orgId]);

  return org;
}