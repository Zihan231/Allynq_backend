import fs from 'fs';
import path from 'path';

const frontendDir = 'C:\\Users\\User\\Desktop\\Zihan\\Allync';

// 1. Write src/lib/api/communities.ts
const communitiesApiContent = `import { api } from "./axios";
import type { BackendCommunity, BackendCommunityMember } from "./types";

export interface CreateCommunityPayload {
  name: string;
  rules: string;
  joinPolicy?: string;
  color?: string;
  initials?: string;
  dpUrl?: string | null;
  coverUrl?: string | null;
  location?: string | null;
  motto?: string | null;
  facebookUrl?: string | null;
}

export async function getCommunities(query?: { search?: string; tier?: string }): Promise<BackendCommunity[]> {
  const res = await api.get<BackendCommunity[]>("/communities", { params: query });
  return res.data;
}

export async function getCommunity(id: string): Promise<BackendCommunity> {
  const res = await api.get<BackendCommunity>(\`/communities/\${id}\`);
  return res.data;
}

export async function createCommunityRequest(payload: CreateCommunityPayload): Promise<BackendCommunity> {
  const res = await api.post<BackendCommunity>("/communities", payload);
  return res.data;
}

export async function updateCommunityRequest(
  communityId: string,
  payload: Record<string, unknown>,
): Promise<BackendCommunity> {
  const res = await api.patch<BackendCommunity>(\`/communities/\${communityId}\`, payload);
  return res.data;
}

export async function deleteCommunityRequest(communityId: string): Promise<void> {
  await api.delete(\`/communities/\${communityId}\`);
}

export async function joinCommunityRequest(communityId: string): Promise<any> {
  const res = await api.post(\`/communities/\${communityId}/join\`);
  return res.data;
}

export async function leaveCommunityRequest(communityId: string): Promise<any> {
  const res = await api.post(\`/communities/\${communityId}/leave\`);
  return res.data;
}

export async function addClubToCommunityRequest(communityId: string, clubId: string): Promise<any> {
  const res = await api.post(\`/communities/\${communityId}/clubs/\${clubId}\`);
  return res.data;
}

export async function removeClubFromCommunityRequest(communityId: string, clubId: string): Promise<any> {
  const res = await api.delete(\`/communities/\${communityId}/clubs/\${clubId}\`);
  return res.data;
}

export async function getCommunityMembersRequest(communityId: string): Promise<BackendCommunityMember[]> {
  const res = await api.get<BackendCommunityMember[]>(\`/communities/\${communityId}/members\`);
  return res.data;
}

export async function getCommunityRequestsRequest(communityId: string): Promise<any[]> {
  const res = await api.get(\`/communities/\${communityId}/requests\`);
  return res.data;
}

export async function reviewCommunityRequestRequest(
  communityId: string,
  requestId: string,
  status: "approved" | "rejected",
): Promise<any> {
  const res = await api.post(\`/communities/\${communityId}/requests/\${requestId}/review\`, { status });
  return res.data;
}
`;

fs.writeFileSync(path.join(frontendDir, 'src/lib/api/communities.ts'), communitiesApiContent, 'utf-8');
console.log('✓ Wrote src/lib/api/communities.ts');

// 2. Update src/lib/api/types.ts
const typesPath = path.join(frontendDir, 'src/lib/api/types.ts');
let typesContent = fs.readFileSync(typesPath, 'utf-8');
if (!typesContent.includes('export interface BackendCommunity')) {
  typesContent += `

export interface BackendCommunity {
  id: string;
  name: string;
  rules: string;
  dpUrl: string | null;
  coverUrl: string | null;
  color: string;
  initials: string;
  points: number;
  tier: string;
  joinPolicy: string;
  location: string | null;
  motto: string | null;
  facebookUrl: string | null;
  memberClubIds: string[];
  freeAgentCount: number;
  memberCount: number;
  clubCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface BackendCommunityMember {
  id: string;
  profileId: string;
  name: string;
  dpUrl: string | null;
  coverUrl: string | null;
  clubId: string | null;
  clubName: string | null;
  clubRole: string | null;
  communityId: string;
  communityRole: string;
  isDirectMember: boolean;
  sourceClubIds: string[];
  joinedAt: string;
  points: number;
}
`;
  fs.writeFileSync(typesPath, typesContent, 'utf-8');
  console.log('✓ Updated src/lib/api/types.ts');
}

// 3. Update src/lib/mock/communityStore.ts
const storePath = path.join(frontendDir, 'src/lib/mock/communityStore.ts');
let storeContent = fs.readFileSync(storePath, 'utf-8');

if (!storeContent.includes('backendCommunities] = await Promise.all')) {
  if (!storeContent.includes('getCommunities')) {
    storeContent = storeContent.replace(
      'import { getClubs } from "@/lib/api/clubs";',
      'import { getClubs } from "@/lib/api/clubs";\nimport { getCommunities, createCommunityRequest, updateCommunityRequest, deleteCommunityRequest, joinCommunityRequest, leaveCommunityRequest } from "@/lib/api/communities";'
    );
  }

  storeContent = storeContent.replace(
    /const\s+\[backendClubs,\s*backendUsers\]\s*=\s*await\s+Promise\.all\(\[\s*getClubs\(\)\.catch\(\(\)\s*=>\s*null\),\s*getUsers\(\)\.catch\(\(\)\s*=>\s*null\),?\s*\]\);/,
    `const [backendClubs, backendUsers, backendCommunities] = await Promise.all([
      getClubs().catch(() => null),
      getUsers().catch(() => null),
      getCommunities().catch(() => null),
    ]);`
  );

  const communitySyncCode = `
    if (backendCommunities && Array.isArray(backendCommunities) && backendCommunities.length > 0) {
      const mappedCommunities: Community[] = backendCommunities.map((bc) => ({
        id: bc.id,
        name: bc.name,
        dpUrl: bc.dpUrl ?? null,
        coverUrl: bc.coverUrl ?? null,
        rules: bc.rules || "",
        points: bc.points ?? 0,
        joinPolicy: (bc.joinPolicy || "instant") as Community["joinPolicy"],
        memberClubIds: bc.memberClubIds || [],
        freeAgentCount: bc.freeAgentCount ?? 0,
        tournamentIds: [],
        color: bc.color || "#4c8dff",
        initials: bc.initials || "CM",
        tier: (bc.tier || "New") as Community["tier"],
        location: bc.location ?? undefined,
        motto: bc.motto ?? undefined,
        facebookUrl: bc.facebookUrl ?? undefined,
      }));

      const backendNames = new Set(mappedCommunities.map((c) => c.name.toLowerCase()));
      const remainingMocks = mockCommunities.filter((c) => !backendNames.has(c.name.toLowerCase()));
      communities = [...mappedCommunities, ...remainingMocks];
    }
`;

  storeContent = storeContent.replace(
    'hasSynced = true;',
    communitySyncCode + '\n    hasSynced = true;'
  );

  fs.writeFileSync(storePath, storeContent, 'utf-8');
  console.log('✓ Updated src/lib/mock/communityStore.ts');
}

console.log('Frontend successfully wired up!');
