import { supabase } from '../lib/supabase';
import { ChatParticipantIdentity } from '../types/chat';

// Role hierarchy priority for canonical display
const ROLE_PRIORITY_ORDER: string[] = [
  'SUPER_ADMIN',
  'ADMIN',
  'ORGANIZER',
  'REFEREE',
  'TECHNICAL_OFFICIAL',
  'TABLE_OFFICIAL',
  'MEDICAL_OFFICIAL',
  'COACH',
  'ATHLETE',
  'USER',
];

const OFFICIAL_ROLES = new Set([
  'REFEREE',
  'TECHNICAL_OFFICIAL',
  'TABLE_OFFICIAL',
  'MEDICAL_OFFICIAL',
]);

const ROLE_DISPLAY_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'SUPER ADMIN',
  ADMIN: 'ADMIN',
  ORGANIZER: 'ORGANIZER',
  REFEREE: 'REFEREE',
  TECHNICAL_OFFICIAL: 'TECHNICAL OFFICIAL',
  TABLE_OFFICIAL: 'TABLE OFFICIAL',
  MEDICAL_OFFICIAL: 'MEDICAL OFFICIAL',
  COACH: 'COACH',
  ATHLETE: 'ATHLETE',
  USER: 'USER',
};

// In-memory cache to prevent redundant queries during session
const identityCache = new Map<string, { data: ChatParticipantIdentity; cachedAt: number }>();
const CACHE_TTL_MS = 60 * 1000; // 1 minute TTL

/**
 * Clears in-memory identity cache.
 */
export function clearIdentityCache(): void {
  identityCache.clear();
}

export const chatIdentityResolver = {
  /**
   * Clears in-memory identity cache.
   */
  clearCache(): void {
    clearIdentityCache();
  },

  /**
   * Batched resolution of participant identities for a list of user IDs.
   * Guarantees ZERO N+1 queries by using the authoritative get_chat_identities_batch RPC.
   */
  async resolveIdentities(
    userIds: string[],
    tournamentId?: string | null,
    forceRefresh = false
  ): Promise<Record<string, ChatParticipantIdentity>> {
    const uniqueIds = Array.from(new Set(userIds.filter((id) => Boolean(id) && typeof id === 'string')));
    if (uniqueIds.length === 0) {
      return {};
    }

    const scopeKey = tournamentId || 'GLOBAL';
    const now = Date.now();
    const result: Record<string, ChatParticipantIdentity> = {};
    const idsToFetch: string[] = [];

    if (!forceRefresh) {
      for (const uid of uniqueIds) {
        const cacheKey = `${uid}_${scopeKey}`;
        const cached = identityCache.get(cacheKey);
        if (cached && now - cached.cachedAt < CACHE_TTL_MS) {
          result[uid] = cached.data;
        } else {
          idsToFetch.push(uid);
        }
      }
    } else {
      idsToFetch.push(...uniqueIds);
    }

    if (idsToFetch.length === 0) {
      return result;
    }

    try {
      console.debug('[CHAT_IDENTITY_RESOLVE]', {
        totalRequested: uniqueIds.length,
        fetchingCount: idsToFetch.length,
        scope: scopeKey,
      });

      // 1. Fetch Authoritative Identity Projection via Least-Privilege SECURITY DEFINER Batch RPC
      const { data: rpcData, error: rpcErr } = await supabase.rpc('get_chat_identities_batch', {
        p_user_ids: idsToFetch,
      });

      if (rpcErr) {
        console.warn('Error fetching identities from get_chat_identities_batch RPC:', rpcErr.message);
      }

      const rpcMap = new Map<
        string,
        {
          user_id: string;
          full_name: string | null;
          avatar_url: string | null;
          roles: string[];
          club_id: string | null;
          club_name: string | null;
          club_short_name: string | null;
        }
      >();

      (rpcData || []).forEach((row: any) => {
        if (row && row.user_id) {
          rpcMap.set(row.user_id, {
            user_id: row.user_id,
            full_name: row.full_name,
            avatar_url: row.avatar_url,
            roles: Array.isArray(row.roles) ? row.roles : [],
            club_id: row.club_id || null,
            club_name: row.club_name || null,
            club_short_name: row.club_short_name || null,
          });
        }
      });

      // 2. Fetch Tournament Registrations (if tournamentId is provided)
      const tournamentRegMap = new Map<string, { team_name: string | null }>();
      if (tournamentId) {
        const { data: registrations, error: regErr } = await supabase
          .from('registrations')
          .select('user_id, team_name, event:events!event_id(tournament_id)')
          .in('user_id', idsToFetch);

        if (regErr) {
          console.warn('Error fetching tournament registrations in identity resolver:', regErr.message);
        }

        (registrations || []).forEach((reg: any) => {
          if (reg.event?.tournament_id === tournamentId && reg.team_name) {
            tournamentRegMap.set(reg.user_id, { team_name: reg.team_name });
          }
        });
      }

      // 3. Assemble Participant Identity Records with Canonical Priority
      for (const uid of idsToFetch) {
        const rpcRecord = rpcMap.get(uid);
        const roles = rpcRecord?.roles || [];

        // Determine Canonical Primary Role by priority
        let canonicalRole = 'No Role';
        let roleBadge = 'No Role';
        for (const priorityRole of ROLE_PRIORITY_ORDER) {
          if (roles.includes(priorityRole)) {
            canonicalRole = priorityRole;
            roleBadge = ROLE_DISPLAY_LABELS[priorityRole] || priorityRole;
            break;
          }
        }

        // Fallback: If roles list is non-empty but not explicitly matched
        if (canonicalRole === 'No Role' && roles.length > 0) {
          canonicalRole = roles[0];
          roleBadge = ROLE_DISPLAY_LABELS[roles[0]] || roles[0];
        }

        const isOfficial = OFFICIAL_ROLES.has(canonicalRole);

        // Resolve Club & Team
        const clubId: string | null = rpcRecord?.club_id || null;
        const clubName: string | null = rpcRecord?.club_name || null;
        const tournamentReg = tournamentRegMap.get(uid);
        const teamName: string | null = tournamentReg?.team_name || null;
        let affiliationLabel = 'No Team/Club';

        if (isOfficial) {
          affiliationLabel = 'OFFICIAL • UAAPHIL';
        } else if (tournamentId && tournamentReg?.team_name) {
          // Tournament Chat identity prioritization
          if (clubName) {
            affiliationLabel = `${clubName} • ${tournamentReg.team_name}`;
          } else {
            affiliationLabel = tournamentReg.team_name;
          }
        } else if (clubName) {
          affiliationLabel = clubName;
        } else {
          affiliationLabel = 'No Team/Club';
        }

        const identity: ChatParticipantIdentity = {
          userId: uid,
          fullName: rpcRecord?.full_name?.trim() || 'Unknown User',
          avatarUrl: rpcRecord?.avatar_url || null,
          canonicalRole,
          roleBadge,
          allRoles: roles,
          clubId,
          clubName,
          teamName,
          affiliationLabel,
          isOfficial,
        };

        const cacheKey = `${uid}_${scopeKey}`;
        identityCache.set(cacheKey, { data: identity, cachedAt: now });
        result[uid] = identity;
      }
    } catch (err: unknown) {
      console.error('Failed to batch resolve participant identities:', err);
      // Fallback safe identity for any missing
      for (const uid of idsToFetch) {
        if (!result[uid]) {
          result[uid] = {
            userId: uid,
            fullName: 'Unknown User',
            avatarUrl: null,
            canonicalRole: 'No Role',
            roleBadge: 'No Role',
            allRoles: [],
            clubId: null,
            clubName: null,
            teamName: null,
            affiliationLabel: 'No Team/Club',
            isOfficial: false,
          };
        }
      }
    }

    return result;
  },

  /**
   * Resolves a single user's identity.
   */
  async resolveSingleIdentity(
    userId: string,
    tournamentId?: string | null,
    forceRefresh = false
  ): Promise<ChatParticipantIdentity> {
    const map = await this.resolveIdentities([userId], tournamentId, forceRefresh);
    return (
      map[userId] || {
        userId,
        fullName: 'Unknown User',
        avatarUrl: null,
        canonicalRole: 'No Role',
        roleBadge: 'No Role',
        allRoles: [],
        clubId: null,
        clubName: null,
        teamName: null,
        affiliationLabel: 'No Team/Club',
        isOfficial: false,
      }
    );
  },
};
