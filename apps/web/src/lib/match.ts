import { useEffect, useState } from 'react';
import { api } from './api.js';

export interface MatchInfo {
  id: string;
  name: string;
  status: string;
}

export function useMatch(orgId: string | undefined, matchId: string | undefined): MatchInfo | null {
  const [match, setMatch] = useState<MatchInfo | null>(null);

  useEffect(() => {
    let alive = true;
    if (!orgId || !matchId) {
      setMatch(null);
      return undefined;
    }
    api<MatchInfo>(`/api/orgs/${orgId}/matches/${matchId}`)
      .then((m) => alive && setMatch(m))
      .catch(() => alive && setMatch(null));
    return () => {
      alive = false;
    };
  }, [orgId, matchId]);

  return match;
}