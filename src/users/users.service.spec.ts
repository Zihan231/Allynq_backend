import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { SetRolesDto } from './dto/set-roles.dto.js';
import type { User } from './entities/user.entity.js';
import { UsersService } from './users.service.js';

vi.mock('../recycle-bin/recycle-bin.service.js', () => ({ RecycleBinService: class {} }));

function service() {
  const user = { id: 'u1', roles: ['player'], primaryRole: 'player', rolesChosenAt: null } as unknown as User;
  const repo = {
    findOne: vi.fn().mockResolvedValue(user),
    save: vi.fn(async (saved: User) => saved),
  };
  const users = new UsersService(repo as never, {} as never, {} as never, {} as never);
  return { users, repo };
}

describe('UsersService.setRoles', () => {
  it('saves an esports professional with a sub-role', async () => {
    const { users } = service();
    const saved = await users.setRoles('u1', { roles: ['player', 'esports_professional', 'coach'], primaryRole: 'coach' });
    expect(saved.roles).toEqual(['player', 'esports_professional', 'coach']);
    expect(saved.primaryRole).toBe('coach');
  });

  it.each<[string, SetRolesDto]>([
    ['esports professional without a sub-role', { roles: ['esports_professional'], primaryRole: 'esports_professional' }],
    ['a sub-role without esports professional', { roles: ['coach'], primaryRole: 'coach' }],
    ['a default role that was not picked', { roles: ['player'], primaryRole: 'organizer' }],
  ])('rejects %s', async (_name, dto) => {
    const { users, repo } = service();
    await expect(users.setRoles('u1', dto)).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.save).not.toHaveBeenCalled();
  });
});
