import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Club } from '../clubs/entities/club.entity.js';
import {
  ClubRole,
  CommunityRole,
} from '../users/enums/user-attributes.enum.js';
import { Community } from '../communities/entities/community.entity.js';
import { CommunityMember } from '../communities/entities/community-member.entity.js';
import { NotificationsService, type NotificationI18n } from '../notifications/notifications.service.js';
import { RecycleBinService } from '../recycle-bin/recycle-bin.service.js';
import { EfootballProfile } from '../users/entities/efootball-profile.entity.js';
import { User } from '../users/entities/user.entity.js';
import { CreateTournamentDto } from './dto/create-tournament.dto.js';
import { JoinTournamentDto } from './dto/join-tournament.dto.js';
import { SubmitLineupDto } from './dto/submit-lineup.dto.js';
import { TournamentQueryDto } from './dto/tournament-query.dto.js';
import { UpdateTournamentDto } from './dto/update-tournament.dto.js';
import { normalizePlayHours, playHoursError } from './bracket/schedule.js';
import {
  BracketMatch,
  hostOf,
  hostTournamentsLink,
  Tournament,
  type TournamentHost,
  tournamentLink,
} from './entities/tournament.entity.js';
import {
  TournamentParticipant,
  type TournamentLineup,
} from './entities/tournament-participant.entity.js';
import {
  ParticipantStatus,
  ParticipantType,
  TOURNAMENT_PRESET_ROSTERS,
  TournamentPreset,
  TournamentStatus,
  TournamentType,
} from './enums/tournament.enum.js';

const LINEUP_CUTOFF_MS = 2 * 60 * 60 * 1000;

/** Community roles that may be appointed as a tournament's match officials. */
export const MATCH_OFFICIAL_ROLES: CommunityRole[] = [
  CommunityRole.TEAM_MANAGER,
  CommunityRole.HEAD_OF_DISCIPLINE,
  CommunityRole.SCOUT,
];

/** Community roles that host (organize) the community's tournaments. */
const LEADER_ROLES: string[] = [CommunityRole.PRESIDENT, CommunityRole.VICE_PRESIDENT];

/** Club roles that host (organize) a club's tournaments. */
export const CLUB_LEADER_ROLES: string[] = [ClubRole.PRESIDENT, ClubRole.GENERAL_SECRETARY];

/** Club roles that may be appointed as a club tournament's match officials. */
export const CLUB_OFFICIAL_ROLES: string[] = [
  ClubRole.CAPTAIN,
  ClubRole.VICE_CAPTAIN,
  ClubRole.ACADEMY_CAPTAIN,
  ClubRole.MANAGER,
];

/** SQL: the user (`user` placeholder) or their club entered tournament `t`. */
const joinedSql = (user: string) =>
  `EXISTS (
    SELECT 1 FROM tournament_participants tp
     WHERE tp."tournamentId" = t.id
       AND (tp."userId" = ${user}
         OR tp."clubId" = (SELECT jp."clubId" FROM efootball_profiles jp WHERE jp."userId" = ${user}))
  )`;

/**
 * SQL: the user hosts tournament `t` (joined with its `community`): they created
 * it or the community, they're the hosting community's President / Vice President
 * (`roles`: text[]), or the hosting club's President / General Secretary (`clubRoles`: text[]).
 */
const hostedSql = (user: string, roles: string, clubRoles: string) =>
  `(t."creatorId" = ${user}
    OR community."creatorId" = ${user}
    OR t."communityId" IN (
      SELECT m."communityId" FROM community_members m
        JOIN efootball_profiles lp ON lp.id = m."profileId"
       WHERE lp."userId" = ${user} AND m.role::text = ANY(${roles})
    )
    OR t."hostClubId" IN (
      SELECT cp."clubId" FROM efootball_profiles cp
       WHERE cp."userId" = ${user} AND cp."clubRole"::text = ANY(${clubRoles})
    ))`;

/**
 * A tournament notification: English `title` / `message` (the fallback) plus a
 * message `code` and `params` the app renders in the viewer's language.
 */
export type TournamentNotification = { title: string; message: string; link: string } & NotificationI18n;

export interface PlayerCommitment {
  profileId: string;
  tournamentId: string;
  tournamentName: string;
}
// TEMP (testing auto bracket generation): allow start times < 2h away. Set back to true.
const ENFORCE_START_LEAD = false;

@Injectable()
export class TournamentsService {
  private readonly logger = new Logger(TournamentsService.name);

  constructor(
    @InjectRepository(Tournament)
    private readonly tournamentsRepository: Repository<Tournament>,
    @InjectRepository(TournamentParticipant)
    private readonly participantsRepository: Repository<TournamentParticipant>,
    @InjectRepository(Community)
    private readonly communitiesRepository: Repository<Community>,
    @InjectRepository(CommunityMember)
    private readonly communityMembersRepository: Repository<CommunityMember>,
    @InjectRepository(Club)
    private readonly clubsRepository: Repository<Club>,
    @InjectRepository(EfootballProfile)
    private readonly profilesRepository: Repository<EfootballProfile>,
    private readonly notificationsService: NotificationsService,
    private readonly recycleBin: RecycleBinService,
  ) {}

  /** Club tournaments are friendlies: refuse an entry fee or prize pool. */
  private assertFriendly(dto: { entryFeeBdt?: number; prizePoolBdt?: number }) {
    if ((dto.entryFeeBdt ?? 0) > 0 || (dto.prizePoolBdt ?? 0) > 0) {
      throw new BadRequestException('Club tournaments are friendlies and cannot have an entry fee or prize pool');
    }
  }

  async create(userId: string, dto: CreateTournamentDto): Promise<Tournament> {
    if (Boolean(dto.communityId) === Boolean(dto.hostClubId)) {
      throw new BadRequestException('Choose exactly one host for the tournament: a community or a club');
    }

    let host: TournamentHost;
    if (dto.hostClubId) {
      // Club tournaments: PvP between the club's members, run by its President / General Secretary.
      await this.assertClubLeader(userId, dto.hostClubId, 'create club tournaments');
      if (dto.type !== TournamentType.PVP) {
        throw new BadRequestException('Club tournaments are Player vs Player only');
      }
      this.assertFriendly(dto);
      host = { kind: 'club', id: dto.hostClubId };
    } else {
      await this.assertCommunityLeaderForCreate(userId, dto.communityId!);
      host = { kind: 'community', id: dto.communityId! };
    }

    const startAt = new Date(dto.startAt);
    if (isNaN(startAt.getTime())) {
      throw new BadRequestException('Invalid startAt datetime');
    }

    // Automatically calculate lineup submission deadline = 2 hours before startAt
    const teamSubmissionDeadline = new Date(
      startAt.getTime() - 2 * 60 * 60 * 1000,
    );

    const { preset, startersCount, subsCount } = this.resolveRoster(dto);

    // Club tournaments are friendlies: no entry fee or prize.
    const entryFeeBdt = host.kind === 'club' || dto.isPaid === false ? 0 : (dto.entryFeeBdt ?? 0);

    const tournament = this.tournamentsRepository.create({
      name: dto.name,
      description: dto.description ?? null,
      type: dto.type,
      status: TournamentStatus.REGISTRATION_OPEN,
      preset,
      startersCount,
      subsCount,
      maxParticipants: dto.maxParticipants ?? 16,
      entryFeeBdt,
      prizePoolBdt: host.kind === 'club' ? 0 : (dto.prizePoolBdt ?? 0),
      ...this.resolvePlayHours(dto.playHoursStart, dto.playHoursEnd),
      matchOfficialIds: await this.resolveMatchOfficials(host, dto.matchOfficialIds),
      registrationDeadline: dto.registrationDeadline
        ? new Date(dto.registrationDeadline)
        : teamSubmissionDeadline,
      teamSubmissionDeadline,
      startAt,
      endAt: dto.endAt ? new Date(dto.endAt) : null,
      communityId: host.kind === 'community' ? host.id : null,
      hostClubId: host.kind === 'club' ? host.id : null,
      creatorId: userId,
    });

    const saved = await this.tournamentsRepository.save(tournament);
    await this.notifyNewOfficials(saved, saved.matchOfficialIds, userId);
    return saved;
  }

  /** Community tournaments are created by the community's creator, President or Vice President. */
  private async assertCommunityLeaderForCreate(userId: string, communityId: string): Promise<void> {
    const community = await this.communitiesRepository.findOne({ where: { id: communityId } });
    if (!community) {
      throw new NotFoundException(`Community ${communityId} not found`);
    }

    const callerProfile = await this.profilesRepository.findOne({ where: { userId } });
    if (!callerProfile) {
      throw new ForbiddenException('User eFootball profile not found');
    }

    const membership = await this.communityMembersRepository.findOne({
      where: { communityId, profileId: callerProfile.id },
    });

    const isCreator = community.creatorId === userId;
    const isProfileAuthority =
      callerProfile.communityId === communityId && LEADER_ROLES.includes(callerProfile.communityRole ?? '');
    const isMembershipAuthority = Boolean(membership && LEADER_ROLES.includes(membership.role));

    if (!isCreator && !isProfileAuthority && !isMembershipAuthority) {
      throw new ForbiddenException('Only the Community President or Vice President can create tournaments');
    }
  }

  /** Club tournaments are run by the club's President or General Secretary. */
  private async assertClubLeader(userId: string, clubId: string, action: string): Promise<void> {
    const profile = await this.profilesRepository.findOne({ where: { userId } });
    if (!profile || profile.clubId !== clubId || !CLUB_LEADER_ROLES.includes(profile.clubRole ?? '')) {
      throw new ForbiddenException(`Only the Club President or General Secretary can ${action}`);
    }
  }

  /**
   * Match officials review evidence alongside the host's leaders, who always
   * review and so aren't stored. Community tournaments: community officials
   * (Team Manager, Head of Discipline or Scout). Club tournaments: club staff
   * (Captain, Vice-Captain, Academy Captain or Manager).
   */
  private async resolveMatchOfficials(host: TournamentHost, userIds: string[] | undefined): Promise<string[]> {
    const unique = [...new Set(userIds ?? [])];
    if (!unique.length) return [];

    if (host.kind === 'club') {
      const [profiles, club] = await Promise.all([
        this.profilesRepository.find({
          where: { userId: In(unique), clubId: host.id },
          select: { userId: true, clubRole: true },
        }),
        this.clubsRepository.findOne({ where: { id: host.id }, select: { id: true, matchOfficialIds: true } }),
      ]);
      const roleByUser = new Map(profiles.map((p) => [p.userId, p.clubRole ?? '']));
      const nominees = new Set(club?.matchOfficialIds ?? []);
      const officials = unique.filter((id) => !CLUB_LEADER_ROLES.includes(roleByUser.get(id) ?? ''));
      // Eligible: club members who are staff, or whom the club nominated as match officials.
      const eligible = (id: string) =>
        roleByUser.has(id) && (CLUB_OFFICIAL_ROLES.includes(roleByUser.get(id)!) || nominees.has(id));
      if (officials.some((id) => !eligible(id))) {
        throw new BadRequestException(
          "Match officials must be club staff (Captain, Vice-Captain, Academy Captain or Manager) or one of the club's match-official nominees",
        );
      }
      return officials;
    }

    const rows: Array<{ userId: string; role: string }> = await this.communityMembersRepository.query(
      `SELECT ep."userId", m.role FROM community_members m
         JOIN efootball_profiles ep ON ep.id = m."profileId"
        WHERE m."communityId" = $1 AND ep."userId" = ANY($2)`,
      [host.id, unique],
    );
    const roleByUser = new Map(rows.map((r) => [r.userId, r.role]));
    const officials = unique.filter((id) => !LEADER_ROLES.includes(roleByUser.get(id) ?? ''));
    if (officials.some((id) => !MATCH_OFFICIAL_ROLES.includes(roleByUser.get(id) as CommunityRole))) {
      throw new BadRequestException(
        'Match officials must be community officials (Team Manager, Head of Discipline or Scout)',
      );
    }
    return officials;
  }

  private async notifyNewOfficials(tournament: Tournament, officialIds: string[], actorUserId: string): Promise<void> {
    const recipients = officialIds.filter((id) => id !== actorUserId);
    if (!recipients.length) return;
    await this.sendNotifications(recipients, {
      title: 'You are a match official',
      message: `You were appointed as a match official for "${tournament.name}". You'll review the evidence players upload after each match window closes.`,
      link: tournamentLink(tournament, '?tab=bracket'),
      code: 'tournament.officialAppointed',
      params: { tournament: tournament.name },
    });
  }

  /** Validated daily play hours (both or neither); null = system default 19:00–01:00. */
  private resolvePlayHours(
    start: number | null | undefined,
    end: number | null | undefined,
  ): { playHoursStart: number | null; playHoursEnd: number | null } {
    if (start == null && end == null) return { playHoursStart: null, playHoursEnd: null };
    if (start == null || end == null) {
      throw new BadRequestException('Set both the start and end of the daily play hours');
    }
    const error = playHoursError(normalizePlayHours(start, end));
    if (error) throw new BadRequestException(error);
    return { playHoursStart: start, playHoursEnd: end };
  }

  /**
   * Resolves preset + roster size for a new tournament. PvP is always 1v1.
   * CvC uses one of the fixed presets (16v16, 12v12, 8v8, 4v4 — 8v8 when
   * none is given) or a custom roster whose starter count is a multiple of 4,
   * so every fixture splits evenly into 1v1 games.
   */
  private resolveRoster(dto: CreateTournamentDto): {
    preset: TournamentPreset;
    startersCount: number;
    subsCount: number;
  } {
    if (dto.type === TournamentType.PVP) {
      return { preset: TournamentPreset.CUSTOM, startersCount: 1, subsCount: 0 };
    }

    const rawPreset = String(dto.preset || TournamentPreset.EIGHT_V_EIGHT)
      .toLowerCase()
      .replace(/^preset_/, '');

    if (rawPreset === TournamentPreset.CUSTOM) {
      const startersCount = dto.startersCount ?? 0;
      if (startersCount < 4 || startersCount > 16 || startersCount % 4 !== 0) {
        throw new BadRequestException('Custom rosters need 4, 8, 12 or 16 starters');
      }
      return {
        preset: TournamentPreset.CUSTOM,
        startersCount,
        subsCount: dto.subsCount ?? 0,
      };
    }

    const roster = TOURNAMENT_PRESET_ROSTERS[rawPreset as TournamentPreset];
    if (!roster) {
      throw new BadRequestException(
        `Unsupported roster preset "${dto.preset}". Use 16v16, 12v12, 8v8, 4v4 or custom`,
      );
    }
    return { preset: rawPreset as TournamentPreset, ...roster };
  }

  /**
   * Card data for tournament lists: tournament columns (no bracket), the host community's
   * display fields and a participant count. Participants/brackets are only loaded by findOne.
   */
  async findAll(query: TournamentQueryDto, userId: string | null = null) {
    const qb = this.tournamentsRepository
      .createQueryBuilder('t')
      .select(
        [
          'id', 'name', 'description', 'type', 'status', 'preset', 'startersCount', 'subsCount',
          'maxParticipants', 'entryFeeBdt', 'prizePoolBdt', 'registrationDeadline',
          'teamSubmissionDeadline', 'startAt', 'endAt', 'communityId', 'hostClubId', 'creatorId', 'createdAt',
          'updatedAt',
        ].map((column) => `t.${column}`),
      )
      .leftJoin('t.community', 'community')
      .addSelect(
        ['id', 'name', 'color', 'initials', 'dpUrl', 'creatorId'].map((column) => `community.${column}`),
      )
      .leftJoin('t.hostClub', 'hostClub')
      .addSelect(['id', 'name', 'color', 'initials', 'dpUrl'].map((column) => `hostClub.${column}`));

    const scope = query.scope ?? (query.joined === 'true' ? 'joined' : undefined);
    if (scope) {
      if (!userId) return [];
      const conditions = [
        scope !== 'hosted' ? joinedSql(':userId') : null,
        scope !== 'joined' ? hostedSql(':userId', ':leaderRoles', ':clubLeaderRoles') : null,
      ].filter(Boolean);
      qb.andWhere(`(${conditions.join(' OR ')})`, {
        userId,
        leaderRoles: LEADER_ROLES,
        clubLeaderRoles: CLUB_LEADER_ROLES,
      });
    }

    if (query.type) {
      qb.andWhere('t.type = :type', { type: query.type });
    }

    if (query.communityId) {
      qb.andWhere('t.communityId = :communityId', {
        communityId: query.communityId,
      });
    }

    if (query.clubId) {
      qb.andWhere(
        `EXISTS (SELECT 1 FROM tournament_participants cp WHERE cp."tournamentId" = t.id AND cp."clubId" = :clubId)`,
        { clubId: query.clubId },
      );
    }

    if (query.hostClubId) {
      qb.andWhere('t.hostClubId = :hostClubId', { hostClubId: query.hostClubId });
    }

    if (query.search) {
      qb.andWhere(
        '(LOWER(t.name) LIKE :search OR LOWER(community.name) LIKE :search OR LOWER(hostClub.name) LIKE :search)',
        { search: `%${query.search.toLowerCase().trim()}%` },
      );
    }

    if (query.hasPrize === 'true') {
      qb.andWhere('t.prizePoolBdt > 0');
    } else if (query.hasPrize === 'false') {
      qb.andWhere('t.prizePoolBdt = 0');
    }

    if (query.isFree === 'true') {
      qb.andWhere('t.entryFeeBdt = 0');
    } else if (query.isFree === 'false') {
      qb.andWhere('t.entryFeeBdt > 0');
    }

    const sortBy = query.sortBy || 'startAt';
    const sortOrder = query.sortOrder === 'DESC' ? 'DESC' : 'ASC';

    if (sortBy === 'prizePoolBdt') {
      qb.orderBy('t.prizePoolBdt', sortOrder);
    } else if (sortBy === 'createdAt') {
      qb.orderBy('t.createdAt', sortOrder);
    } else {
      qb.orderBy('t.startAt', sortOrder);
    }

    const tournaments = await qb.getMany();
    if (!tournaments.length) return [];

    const counts: Array<{ tournamentId: string; count: number }> = await this.participantsRepository
      .createQueryBuilder('p')
      .select('p.tournamentId', 'tournamentId')
      .addSelect('COUNT(*)::int', 'count')
      .where('p.tournamentId IN (:...ids)', { ids: tournaments.map((t) => t.id) })
      .groupBy('p.tournamentId')
      .getRawMany();
    const countById = new Map(counts.map((c) => [c.tournamentId, c.count]));
    const ids = tournaments.map((t) => t.id);

    // Champion of each finished tournament: the winner of its last knockout match.
    const completedIds = tournaments.filter((t) => t.status === TournamentStatus.COMPLETED).map((t) => t.id);
    const champions: Array<{ tournamentId: string; name: string; dpUrl: string | null }> = completedIds.length
      ? await this.participantsRepository.query(
          `SELECT DISTINCT ON (m."tournamentId") m."tournamentId", COALESCE(c.name, u.name) AS name,
                  COALESCE(c."dpUrl", u."dpUrl") AS "dpUrl"
             FROM tournament_matches m
             JOIN tournament_participants p ON p.id = m."winnerParticipantId"
             LEFT JOIN clubs c ON c.id = p."clubId"
             LEFT JOIN users u ON u.id = p."userId"
            WHERE m."tournamentId" = ANY($1) AND m.stage = 'knockout'
            ORDER BY m."tournamentId", m.round DESC`,
          [completedIds],
        )
      : [];
    const championById = new Map(champions.map((c) => [c.tournamentId, { name: c.name, dpUrl: c.dpUrl }]));

    // How the viewer relates to each tournament: they host it, and / or they (or their club) entered it.
    let joinedIds = new Set<string>();
    let hostedIds = new Set<string>();
    if (userId) {
      const rows: Array<{ id: string; joined: boolean; hosted: boolean }> = await this.tournamentsRepository.query(
        `SELECT t.id,
                ${joinedSql('$2')} AS joined,
                ${hostedSql('$2', '$3', '$4')} AS hosted
           FROM tournaments t LEFT JOIN communities community ON community.id = t."communityId"
          WHERE t.id = ANY($1)`,
        [ids, userId, LEADER_ROLES, CLUB_LEADER_ROLES],
      );
      joinedIds = new Set(rows.filter((r) => r.joined).map((r) => r.id));
      hostedIds = new Set(rows.filter((r) => r.hosted).map((r) => r.id));
    }

    return tournaments.map((t) => ({
      ...t,
      participantCount: countById.get(t.id) ?? 0,
      champion: championById.get(t.id) ?? null,
      joinedByMe: joinedIds.has(t.id),
      hostedByMe: hostedIds.has(t.id),
    }));
  }

  async findOne(id: string): Promise<Tournament> {
    const tournament = await this.tournamentsRepository.findOne({
      where: { id },
      relations: {
        community: true,
        hostClub: true,
        creator: true,
        participants: {
          club: {
            teams: true,
          },
          user: true,
        },
      },
    });

    if (!tournament) {
      throw new NotFoundException(`Tournament ${id} not found`);
    }

    return tournament;
  }

  async update(
    userId: string,
    tournamentId: string,
    dto: UpdateTournamentDto,
  ): Promise<Tournament> {
    const tournament = await this.findOne(tournamentId);
    await this.assertCanManage(userId, tournament, 'edit tournaments');
    if (this.isLocked(tournament)) {
      throw new BadRequestException('Live or finished tournaments can no longer be edited');
    }

    const changes: string[] = [];

    if (dto.name !== undefined && dto.name.trim() !== tournament.name) {
      tournament.name = dto.name.trim();
      changes.push('name');
    }

    if (dto.description !== undefined && (dto.description || null) !== tournament.description) {
      tournament.description = dto.description || null;
      changes.push('description');
    }

    if (dto.maxParticipants !== undefined && dto.maxParticipants !== tournament.maxParticipants) {
      const enrolled = tournament.participants?.length ?? 0;
      if (dto.maxParticipants < enrolled) {
        throw new BadRequestException(
          `Capacity can't be lower than the ${enrolled} participants already enrolled`,
        );
      }
      tournament.maxParticipants = dto.maxParticipants;
      changes.push('capacity');
    }

    if (dto.startAt !== undefined) {
      const startAt = new Date(dto.startAt);
      if (startAt.getTime() !== new Date(tournament.startAt).getTime()) {
        if (ENFORCE_START_LEAD && startAt.getTime() <= Date.now() + LINEUP_CUTOFF_MS) {
          throw new BadRequestException(
            'Start time must be at least 2 hours in the future to allow lineup submissions',
          );
        }
        const deadline = new Date(startAt.getTime() - LINEUP_CUTOFF_MS);
        tournament.startAt = startAt;
        tournament.teamSubmissionDeadline = deadline;
        tournament.registrationDeadline = deadline;
        changes.push('start time');
      }
    }

    if (dto.endAt !== undefined) {
      const endAt = dto.endAt ? new Date(dto.endAt) : null;
      const current = tournament.endAt ? new Date(tournament.endAt).getTime() : null;
      if ((endAt?.getTime() ?? null) !== current) {
        tournament.endAt = endAt;
        changes.push('end time');
      }
    }
    if (tournament.endAt && new Date(tournament.endAt) <= new Date(tournament.startAt)) {
      throw new BadRequestException('End time must be after the start time');
    }

    if (tournament.hostClubId) this.assertFriendly(dto);

    if (dto.entryFeeBdt !== undefined && dto.entryFeeBdt !== tournament.entryFeeBdt) {
      tournament.entryFeeBdt = dto.entryFeeBdt;
      changes.push('entry fee');
    }

    if (dto.prizePoolBdt !== undefined && dto.prizePoolBdt !== tournament.prizePoolBdt) {
      tournament.prizePoolBdt = dto.prizePoolBdt;
      changes.push('prize pool');
    }

    if (dto.playHoursStart !== undefined || dto.playHoursEnd !== undefined) {
      const next = this.resolvePlayHours(
        dto.playHoursStart ?? tournament.playHoursStart,
        dto.playHoursEnd ?? tournament.playHoursEnd,
      );
      if (next.playHoursStart !== tournament.playHoursStart || next.playHoursEnd !== tournament.playHoursEnd) {
        if (tournament.format) {
          throw new BadRequestException("Play hours can't change after fixtures are generated");
        }
        Object.assign(tournament, next);
        changes.push('play hours');
      }
    }

    let newOfficials: string[] = [];
    if (dto.matchOfficialIds !== undefined) {
      const next = await this.resolveMatchOfficials(hostOf(tournament), dto.matchOfficialIds);
      const current = tournament.matchOfficialIds ?? [];
      if (next.length !== current.length || next.some((id) => !current.includes(id))) {
        newOfficials = next.filter((id) => !current.includes(id));
        tournament.matchOfficialIds = next;
        changes.push('match officials');
      }
    }

    if (!changes.length) return tournament;

    // Save only the tournament's own columns, not the loaded relations.
    const {
      participants: _participants,
      community: _community,
      hostClub: _hostClub,
      creator: _creator,
      ...columns
    } = tournament;
    await this.tournamentsRepository.save(columns);

    await this.notifyNewOfficials(tournament, newOfficials, userId);
    await this.notifyParticipants(tournament, userId, {
      title: 'Tournament updated',
      message: `"${tournament.name}" was updated by the organizer. Changed: ${changes.join(', ')}.`,
      link: tournamentLink(tournament),
      code: 'tournament.updated',
      // English field names; the app translates each one.
      params: { tournament: tournament.name, changes: changes.join(',') },
    });

    return this.findOne(tournamentId);
  }

  async remove(userId: string, tournamentId: string): Promise<{ id: string }> {
    const tournament = await this.findOne(tournamentId);
    await this.assertCanManage(userId, tournament, 'delete tournaments');
    if (this.isLocked(tournament)) {
      throw new BadRequestException('Live or finished tournaments can no longer be deleted');
    }

    // Resolve recipients before it is hidden.
    const recipients = await this.participantRecipients(tournament, userId);
    await this.recycleBin.moveToBin('tournament', tournament.id, userId, 'Deleted by the organizer');

    await this.sendNotifications(recipients, {
      title: 'Tournament cancelled',
      message: `"${tournament.name}" has been deleted by the organizer and will not take place.`,
      link: hostTournamentsLink(tournament),
      code: 'tournament.cancelled',
      params: { tournament: tournament.name },
    });

    return { id: tournament.id };
  }

  /**
   * Once fixtures are out, or the tournament has started (or ended), organizers
   * can no longer edit or delete it.
   */
  isLocked(tournament: Tournament, now = Date.now()): boolean {
    return (
      Boolean(tournament.format) ||
      new Date(tournament.startAt).getTime() <= now ||
      tournament.status === TournamentStatus.ONGOING ||
      tournament.status === TournamentStatus.COMPLETED ||
      tournament.status === TournamentStatus.CANCELLED
    );
  }

  /**
   * Organizers: the tournament creator, plus for a community tournament the
   * community creator and its President / Vice President, or for a club
   * tournament the club's President / General Secretary.
   */
  async assertCanManage(
    userId: string,
    tournament: Tournament,
    action: string,
  ): Promise<void> {
    if (tournament.creatorId === userId) return;
    if (tournament.hostClubId) {
      await this.assertClubLeader(userId, tournament.hostClubId, action);
      return;
    }
    if (tournament.community?.creatorId === userId) {
      return;
    }

    const callerProfile = await this.profilesRepository.findOne({ where: { userId } });
    const membership = callerProfile
      ? await this.communityMembersRepository.findOne({
          where: { communityId: tournament.communityId!, profileId: callerProfile.id },
        })
      : null;

    const isLeader =
      membership?.role === CommunityRole.PRESIDENT ||
      membership?.role === CommunityRole.VICE_PRESIDENT;
    if (!isLeader) {
      throw new ForbiddenException(
        `Only the Community President, Vice President, or creator can ${action}`,
      );
    }
  }

  /**
   * Who hears about changes to a tournament: enrolled players (PvP), and for
   * clubs (CvC) the club President plus whoever registered the club.
   * The acting organizer is left out.
   */
  private async participantRecipients(
    tournament: Tournament,
    actorUserId: string,
  ): Promise<string[]> {
    const participants = tournament.participants ?? [];
    const userIds = participants.flatMap((p) => [p.userId, p.registeredByUserId]);

    const clubIds = participants.map((p) => p.clubId).filter((id): id is string => Boolean(id));
    if (clubIds.length) {
      const presidents = await this.profilesRepository.find({
        where: { clubId: In(clubIds), clubRole: ClubRole.PRESIDENT },
        select: { id: true, userId: true },
      });
      userIds.push(...presidents.map((p) => p.userId));
    }

    const pickedProfileIds = participants.flatMap((p) => [
      ...(p.lineup?.starters ?? []),
      ...(p.lineup?.substitutes ?? []),
    ]).map((player) => player.profileId);
    if (pickedProfileIds.length) {
      const picked = await this.profilesRepository.find({
        where: { id: In(pickedProfileIds) },
        select: { id: true, userId: true },
      });
      userIds.push(...picked.map((p) => p.userId));
    }

    return Array.from(
      new Set(userIds.filter((id): id is string => Boolean(id) && id !== actorUserId)),
    );
  }

  async notifyParticipants(
    tournament: Tournament,
    actorUserId: string,
    notification: TournamentNotification,
  ): Promise<void> {
    const recipients = await this.participantRecipients(tournament, actorUserId);
    await this.sendNotifications(recipients, notification);
  }

  /** Notification failures are logged, never surfaced: the edit/delete already succeeded. */
  async sendNotifications(userIds: string[], notification: TournamentNotification): Promise<void> {
    const results = await Promise.allSettled(
      userIds.map((id) =>
        this.notificationsService.createNotification(id, {
          ...notification,
          type: 'tournament_update',
        }),
      ),
    );
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed) {
      this.logger.warn(`${failed} tournament notification(s) failed to send`);
    }
  }

  async join(
    userId: string,
    tournamentId: string,
    dto: JoinTournamentDto,
  ): Promise<TournamentParticipant> {
    const tournament = await this.findOne(tournamentId);

    if (tournament.status !== TournamentStatus.REGISTRATION_OPEN) {
      throw new BadRequestException(
        'Tournament registration is not currently open',
      );
    }

    const now = new Date();
    if (
      tournament.registrationDeadline &&
      now > new Date(tournament.registrationDeadline)
    ) {
      throw new BadRequestException(
        'Registration deadline has passed for this tournament',
      );
    }

    const participantCount = tournament.participants?.length ?? 0;
    if (participantCount >= tournament.maxParticipants) {
      throw new BadRequestException(
        'Tournament is already at maximum capacity',
      );
    }

    const callerProfile = await this.profilesRepository.findOne({
      where: { userId },
    });

    if (!callerProfile) {
      throw new BadRequestException('User profile not found');
    }

    // Club tournaments: PvP for the hosting club's members; its President / GS run it, so they can't play.
    if (tournament.hostClubId) {
      if (callerProfile.clubId !== tournament.hostClubId) {
        throw new ForbiddenException('Only members of the hosting club can join this tournament');
      }
      if (CLUB_LEADER_ROLES.includes(callerProfile.clubRole ?? '')) {
        throw new ForbiddenException(
          'The club President and General Secretary cannot join tournaments hosted by their club',
        );
      }
      return this.registerPlayer(tournament, userId, callerProfile);
    }

    const membership = await this.communityMembersRepository.findOne({
      where: {
        communityId: tournament.communityId!,
        profileId: callerProfile.id,
      },
    });

    const isCommunityCreator = tournament.community?.creatorId === userId;
    const isProfileLeader =
      callerProfile.communityId === tournament.communityId &&
      (callerProfile.communityRole === CommunityRole.PRESIDENT ||
        callerProfile.communityRole === CommunityRole.VICE_PRESIDENT);
    const isMembershipLeader =
      membership?.role === CommunityRole.PRESIDENT ||
      membership?.role === CommunityRole.VICE_PRESIDENT;

    if (isCommunityCreator || isProfileLeader || isMembershipLeader) {
      throw new ForbiddenException(
        'Community Presidents and Vice Presidents cannot join tournaments hosted by their community',
      );
    }

    if (tournament.type === TournamentType.PVP) {
      // Check that the player is a member of this tournament's community
      const isCommunityMember =
        callerProfile.communityId === tournament.communityId ||
        tournament.community?.creatorId === userId;

      if (!isCommunityMember && !membership) {
        throw new ForbiddenException(
          'You must be an active member of this community to join this PvP tournament',
        );
      }

      return this.registerPlayer(tournament, userId, callerProfile);
    }

    // CvC Tournament registration
    if (!dto.clubId) {
      throw new BadRequestException(
        'clubId is required to register for a CvC tournament',
      );
    }
    if (!dto.lineup) {
      throw new BadRequestException(
        'Clubs must submit their team lineup when registering for a CvC tournament',
      );
    }

    const club = await this.clubsRepository.findOne({
      where: { id: dto.clubId },
      relations: { members: true },
    });

    if (!club) {
      throw new NotFoundException(`Club ${dto.clubId} not found`);
    }

    // 1. Club must be a member of the tournament's hosting community
    const isCommunityMember = club.communityIds?.includes(
      tournament.communityId!,
    );

    if (!isCommunityMember) {
      throw new BadRequestException(
        'Club must be an approved member of this community to join the tournament',
      );
    }

    // 2. Only President or General Secretary of the club can register
    const memberRecord = club.members?.find((m) => m.id === callerProfile.id);
    const hasClubAuthority =
      memberRecord &&
      (memberRecord.clubRole === ClubRole.PRESIDENT ||
        memberRecord.clubRole === ClubRole.GENERAL_SECRETARY);

    if (!hasClubAuthority) {
      throw new ForbiddenException(
        'Only the Club President or General Secretary can register the club for a tournament',
      );
    }

    // Check if club is already registered
    const existingClub = await this.participantsRepository.findOne({
      where: { tournamentId, clubId: dto.clubId },
    });

    if (existingClub) {
      throw new BadRequestException(
        'This club is already registered for this tournament',
      );
    }

    this.assertValidLineup(tournament, club.members ?? [], dto.lineup);
    await this.assertPlayersAvailable(tournament, dto.lineup);

    const participant = this.participantsRepository.create({
      tournamentId,
      participantType: ParticipantType.CLUB,
      clubId: dto.clubId,
      registeredByUserId: userId,
      status: ParticipantStatus.LINEUP_SUBMITTED,
      lineup: this.toLineup(dto.lineup),
      submittedAt: new Date(),
      submittedByUserId: userId,
    });

    const saved = await this.participantsRepository.save(participant);
    await this.notifyLineupChanges(tournament, club.name, club.members ?? [], null, saved.lineup, userId);
    return saved;
  }

  /** Registers a player for a PvP tournament (once, and only if not busy in another active one). */
  private async registerPlayer(
    tournament: Tournament,
    userId: string,
    callerProfile: EfootballProfile,
  ): Promise<TournamentParticipant> {
    const existing = await this.participantsRepository.findOne({
      where: { tournamentId: tournament.id, userId },
    });
    if (existing) {
      throw new BadRequestException('You are already registered for this tournament');
    }

    const [commitment] = await this.findPlayerCommitments([callerProfile.id], tournament.id);
    if (commitment) {
      throw new BadRequestException(
        `You are already registered in "${commitment.tournamentName}". A player can take part in only one active tournament at a time.`,
      );
    }

    const participant = this.participantsRepository.create({
      tournamentId: tournament.id,
      participantType: ParticipantType.PLAYER,
      userId,
      registeredByUserId: userId,
      status: ParticipantStatus.REGISTERED,
    });
    return this.participantsRepository.save(participant);
  }

  /**
   * A CvC lineup must match the tournament preset exactly (starters and
   * substitutes), list each player once, and only use members of the club.
   */
  private assertValidLineup(
    tournament: Tournament,
    clubMembers: EfootballProfile[],
    lineup: SubmitLineupDto,
  ): void {
    if (lineup.starters.length !== tournament.startersCount) {
      throw new BadRequestException(
        `Lineup must have exactly ${tournament.startersCount} starters (received ${lineup.starters.length})`,
      );
    }
    if (lineup.substitutes.length !== tournament.subsCount) {
      throw new BadRequestException(
        `Lineup must have exactly ${tournament.subsCount} substitutes (received ${lineup.substitutes.length})`,
      );
    }

    const profileIds = [...lineup.starters, ...lineup.substitutes].map((p) => p.profileId);
    if (new Set(profileIds).size !== profileIds.length) {
      throw new BadRequestException('A player can only appear once in the lineup');
    }

    const memberIds = new Set(clubMembers.map((m) => m.id));
    if (profileIds.some((id) => !memberIds.has(id))) {
      throw new BadRequestException('Every player in the lineup must be a member of the club');
    }
  }

  /**
   * A player can take part in only one active (not completed / cancelled)
   * tournament at a time: in a club's team (starter or sub) or registered
   * individually for a PvP tournament.
   */
  private async assertPlayersAvailable(tournament: Tournament, lineup: SubmitLineupDto): Promise<void> {
    const players = [...lineup.starters, ...lineup.substitutes];
    const commitments = await this.findPlayerCommitments(players.map((p) => p.profileId), tournament.id);
    if (!commitments.length) return;
    const nameOf = (profileId: string) => players.find((p) => p.profileId === profileId)?.name || 'A player';
    const list = commitments.map((c) => `${nameOf(c.profileId)} ("${c.tournamentName}")`).join(', ');
    throw new BadRequestException(
      `Already registered in another tournament: ${list}. A player can take part in only one active tournament at a time.`,
    );
  }

  /** Which of these players are already in another active tournament, and which one. */
  async findPlayerCommitments(
    profileIds: string[],
    excludeTournamentId: string,
  ): Promise<PlayerCommitment[]> {
    if (!profileIds.length) return [];
    return this.participantsRepository.query(
      `SELECT DISTINCT ON (x."profileId") x."profileId", t.id AS "tournamentId", t.name AS "tournamentName"
         FROM (
           SELECT p."tournamentId", e->>'profileId' AS "profileId"
             FROM tournament_participants p,
                  jsonb_array_elements(
                    COALESCE(p.lineup->'starters', '[]'::jsonb) || COALESCE(p.lineup->'substitutes', '[]'::jsonb)
                  ) e
            WHERE p.lineup IS NOT NULL
           UNION ALL
           SELECT p."tournamentId", ep.id::text
             FROM tournament_participants p
             JOIN efootball_profiles ep ON ep."userId" = p."userId"
            WHERE p."participantType" = 'player'
         ) x
         JOIN tournaments t ON t.id = x."tournamentId"
        WHERE t.status NOT IN ('completed', 'cancelled')
          AND t.id <> $1
          AND x."profileId" = ANY($2)
        ORDER BY x."profileId", t."startAt"`,
      [excludeTournamentId, profileIds],
    );
  }

  /** Club members already taking part in another active tournament (for the team picker). */
  async getClubCommitments(tournamentId: string, clubId: string): Promise<PlayerCommitment[]> {
    const members = await this.profilesRepository.find({ where: { clubId }, select: { id: true } });
    return this.findPlayerCommitments(members.map((m) => m.id), tournamentId);
  }

  private toLineup(dto: SubmitLineupDto) {
    return {
      teamId: dto.teamId ?? null,
      teamName: dto.teamName ?? null,
      starters: dto.starters,
      substitutes: dto.substitutes,
    };
  }

  async submitLineup(
    userId: string,
    tournamentId: string,
    participantId: string,
    dto: SubmitLineupDto,
  ): Promise<TournamentParticipant> {
    const tournament = await this.findOne(tournamentId);

    const participant = await this.participantsRepository.findOne({
      where: { id: participantId, tournamentId },
      relations: { club: { members: true } },
    });

    if (!participant) {
      throw new NotFoundException('Tournament participant record not found');
    }

    if (
      tournament.status === TournamentStatus.COMPLETED ||
      tournament.status === TournamentStatus.CANCELLED
    ) {
      throw new BadRequestException('This tournament is finished; its teams can no longer be changed');
    }

    // Enforce 2-hour pre-match cutoff deadline
    const now = new Date();
    if (now > new Date(tournament.teamSubmissionDeadline)) {
      throw new BadRequestException(
        'Team lineup submission deadline has passed (must be submitted at least 2 hours before tournament start)',
      );
    }

    if (tournament.type === TournamentType.CVC) {
      // Must be President, General Secretary, or Manager
      const callerProfile = await this.profilesRepository.findOne({
        where: { userId },
      });

      if (!callerProfile) {
        throw new ForbiddenException('eFootball profile not found');
      }

      const club = participant.club;
      const memberRecord = club?.members?.find(
        (m) => m.id === callerProfile.id,
      );
      const canSubmit =
        memberRecord &&
        (memberRecord.clubRole === ClubRole.PRESIDENT ||
          memberRecord.clubRole === ClubRole.GENERAL_SECRETARY ||
          memberRecord.clubRole === ClubRole.MANAGER);

      if (!canSubmit) {
        throw new ForbiddenException(
          'Only the Club President, General Secretary, or Manager can submit the team lineup',
        );
      }

      this.assertValidLineup(tournament, club?.members ?? [], dto);
      await this.assertPlayersAvailable(tournament, dto);
    }

    const previousLineup = participant.lineup;
    participant.lineup = this.toLineup(dto);
    participant.status = ParticipantStatus.LINEUP_SUBMITTED;
    participant.submittedAt = new Date();
    participant.submittedByUserId = userId;

    const saved = await this.participantsRepository.save(participant);
    if (tournament.type === TournamentType.CVC && participant.club) {
      await this.notifyLineupChanges(
        tournament,
        participant.club.name,
        participant.club.members ?? [],
        previousLineup,
        saved.lineup,
        userId,
      );
    }
    return saved;
  }

  /**
   * Notifies players about their place in a club's tournament team: picked
   * (new to the lineup), removed, or moved between starting lineup and bench.
   */
  private async notifyLineupChanges(
    tournament: Tournament,
    clubName: string,
    clubMembers: EfootballProfile[],
    before: TournamentLineup | null,
    after: TournamentLineup | null,
    actorUserId: string,
  ): Promise<void> {
    const roleIn = (lineup: TournamentLineup | null) => {
      const roles = new Map<string, 'starter' | 'substitute'>();
      lineup?.starters.forEach((p) => roles.set(p.profileId, 'starter'));
      lineup?.substitutes.forEach((p) => roles.set(p.profileId, 'substitute'));
      return roles;
    };
    const beforeRoles = roleIn(before);
    const afterRoles = roleIn(after);
    const userIdByProfile = new Map(clubMembers.map((m) => [m.id, m.userId]));
    const pageLink = tournamentLink(tournament);
    // Picked/moved players land on the lineup with their own row highlighted.
    const lineupLink = tournamentLink(tournament, '?tab=lineup&highlight=me');
    const describe = (role: 'starter' | 'substitute') =>
      role === 'starter' ? 'the starting lineup' : 'the bench';

    const messages = new Map<string, TournamentNotification>();
    const params = { club: clubName, tournament: tournament.name };
    for (const [profileId, role] of afterRoles) {
      const previous = beforeRoles.get(profileId);
      if (!previous) {
        messages.set(profileId, {
          title: 'Picked for a tournament',
          message: `${clubName} picked you for "${tournament.name}" — you're in ${describe(role)}.`,
          link: lineupLink,
          code: role === 'starter' ? 'tournament.pickedStarter' : 'tournament.pickedSub',
          params,
        });
      } else if (previous !== role) {
        messages.set(profileId, {
          title: 'Tournament role changed',
          message: `${clubName} moved you to ${describe(role)} for "${tournament.name}".`,
          link: lineupLink,
          code: role === 'starter' ? 'tournament.movedToStarter' : 'tournament.movedToSub',
          params,
        });
      }
    }
    for (const profileId of beforeRoles.keys()) {
      if (!afterRoles.has(profileId)) {
        messages.set(profileId, {
          title: 'Removed from tournament team',
          message: `${clubName} removed you from its team for "${tournament.name}".`,
          link: pageLink,
          code: 'tournament.removedFromTeam',
          params,
        });
      }
    }

    await Promise.all(
      [...messages].map(([profileId, content]) => {
        const recipient = userIdByProfile.get(profileId);
        return recipient && recipient !== actorUserId
          ? this.sendNotifications([recipient], content)
          : Promise.resolve();
      }),
    );
  }

}
