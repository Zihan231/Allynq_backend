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
import { NotificationsService } from '../notifications/notifications.service.js';
import { EfootballProfile } from '../users/entities/efootball-profile.entity.js';
import { User } from '../users/entities/user.entity.js';
import { CreateTournamentDto } from './dto/create-tournament.dto.js';
import { JoinTournamentDto } from './dto/join-tournament.dto.js';
import { SubmitLineupDto } from './dto/submit-lineup.dto.js';
import { TournamentQueryDto } from './dto/tournament-query.dto.js';
import { UpdateTournamentDto } from './dto/update-tournament.dto.js';
import { BracketMatch, Tournament } from './entities/tournament.entity.js';
import { TournamentParticipant } from './entities/tournament-participant.entity.js';
import {
  ParticipantStatus,
  ParticipantType,
  TOURNAMENT_PRESET_ROSTERS,
  TournamentPreset,
  TournamentStatus,
  TournamentType,
} from './enums/tournament.enum.js';

const LINEUP_CUTOFF_MS = 2 * 60 * 60 * 1000;

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
  ) {}

  async create(userId: string, dto: CreateTournamentDto): Promise<Tournament> {
    const community = await this.communitiesRepository.findOne({
      where: { id: dto.communityId },
    });
    if (!community) {
      throw new NotFoundException(`Community ${dto.communityId} not found`);
    }

    // Check that caller is President or Vice President of this community
    const callerProfile = await this.profilesRepository.findOne({
      where: { userId },
    });

    if (!callerProfile) {
      throw new ForbiddenException('User eFootball profile not found');
    }

    const membership = await this.communityMembersRepository.findOne({
      where: { communityId: dto.communityId, profileId: callerProfile.id },
    });

    const isCreator = community.creatorId === userId;
    const isProfileAuthority =
      callerProfile.communityId === dto.communityId &&
      (callerProfile.communityRole === CommunityRole.PRESIDENT ||
        callerProfile.communityRole === CommunityRole.VICE_PRESIDENT);
    const isMembershipAuthority =
      membership &&
      (membership.role === CommunityRole.PRESIDENT ||
        membership.role === CommunityRole.VICE_PRESIDENT);

    if (!isCreator && !isProfileAuthority && !isMembershipAuthority) {
      throw new ForbiddenException(
        'Only the Community President or Vice President can create tournaments',
      );
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

    const entryFeeBdt = dto.isPaid === false ? 0 : (dto.entryFeeBdt ?? 0);

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
      prizePoolBdt: dto.prizePoolBdt ?? 0,
      registrationDeadline: dto.registrationDeadline
        ? new Date(dto.registrationDeadline)
        : teamSubmissionDeadline,
      teamSubmissionDeadline,
      startAt,
      endAt: dto.endAt ? new Date(dto.endAt) : null,
      communityId: dto.communityId,
      creatorId: userId,
    });

    return this.tournamentsRepository.save(tournament);
  }

  /**
   * Resolves preset + roster size for a new tournament. PvP is always 1v1.
   * CvC uses one of the fixed presets (16v16, 12v12, 8v8, 4v4 — 8v8 when
   * none is given) or a custom roster whose starter count must be even.
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
      if (startersCount < 2 || startersCount > 16 || startersCount % 2 !== 0) {
        throw new BadRequestException(
          'Custom rosters need an even number of starters between 2 and 16',
        );
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
          'teamSubmissionDeadline', 'startAt', 'endAt', 'communityId', 'creatorId', 'createdAt', 'updatedAt',
        ].map((column) => `t.${column}`),
      )
      .leftJoin('t.community', 'community')
      .addSelect(
        ['id', 'name', 'color', 'initials', 'dpUrl', 'creatorId'].map((column) => `community.${column}`),
      );

    if (query.joined === 'true') {
      if (!userId) return [];
      qb.andWhere(
        `EXISTS (
          SELECT 1 FROM tournament_participants tp
          WHERE tp."tournamentId" = t.id
            AND (tp."userId" = :userId
              OR tp."clubId" = (SELECT p."clubId" FROM efootball_profiles p WHERE p."userId" = :userId))
        )`,
        { userId },
      );
    }

    if (query.type) {
      qb.andWhere('t.type = :type', { type: query.type });
    }

    if (query.communityId) {
      qb.andWhere('t.communityId = :communityId', {
        communityId: query.communityId,
      });
    }

    if (query.search) {
      qb.andWhere(
        '(LOWER(t.name) LIKE :search OR LOWER(community.name) LIKE :search)',
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

    return tournaments.map((t) => ({ ...t, participantCount: countById.get(t.id) ?? 0 }));
  }

  async findOne(id: string): Promise<Tournament> {
    const tournament = await this.tournamentsRepository.findOne({
      where: { id },
      relations: {
        community: true,
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

    if (
      tournament.status === TournamentStatus.COMPLETED ||
      tournament.status === TournamentStatus.CANCELLED
    ) {
      throw new BadRequestException('Finished tournaments can no longer be edited');
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
        if (startAt.getTime() <= Date.now() + LINEUP_CUTOFF_MS) {
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

    if (dto.entryFeeBdt !== undefined && dto.entryFeeBdt !== tournament.entryFeeBdt) {
      tournament.entryFeeBdt = dto.entryFeeBdt;
      changes.push('entry fee');
    }

    if (dto.prizePoolBdt !== undefined && dto.prizePoolBdt !== tournament.prizePoolBdt) {
      tournament.prizePoolBdt = dto.prizePoolBdt;
      changes.push('prize pool');
    }

    if (!changes.length) return tournament;

    // Save only the tournament's own columns, not the loaded relations.
    const { participants: _participants, community: _community, creator: _creator, ...columns } =
      tournament;
    await this.tournamentsRepository.save(columns);

    await this.notifyParticipants(tournament, userId, {
      title: 'Tournament updated',
      message: `"${tournament.name}" was updated by the organizer. Changed: ${changes.join(', ')}.`,
      link: `/dashboard/efootball/community/${tournament.communityId}/tournaments/${tournament.id}`,
    });

    return this.findOne(tournamentId);
  }

  async remove(userId: string, tournamentId: string): Promise<{ id: string }> {
    const tournament = await this.findOne(tournamentId);
    await this.assertCanManage(userId, tournament, 'delete tournaments');

    // Resolve recipients before the participants are cascade-deleted.
    const recipients = await this.participantRecipients(tournament, userId);
    await this.tournamentsRepository.delete({ id: tournament.id });

    await this.sendNotifications(recipients, {
      title: 'Tournament cancelled',
      message: `"${tournament.name}" has been deleted by the organizer and will not take place.`,
      link: `/dashboard/efootball/community/${tournament.communityId}?tab=tournaments`,
    });

    return { id: tournament.id };
  }

  /**
   * Organizers: the tournament creator, the community creator, or the hosting
   * community's President / Vice President.
   */
  private async assertCanManage(
    userId: string,
    tournament: Tournament,
    action: string,
  ): Promise<void> {
    if (tournament.creatorId === userId || tournament.community?.creatorId === userId) {
      return;
    }

    const callerProfile = await this.profilesRepository.findOne({ where: { userId } });
    const membership = callerProfile
      ? await this.communityMembersRepository.findOne({
          where: { communityId: tournament.communityId, profileId: callerProfile.id },
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

    return Array.from(
      new Set(userIds.filter((id): id is string => Boolean(id) && id !== actorUserId)),
    );
  }

  private async notifyParticipants(
    tournament: Tournament,
    actorUserId: string,
    notification: { title: string; message: string; link: string },
  ): Promise<void> {
    const recipients = await this.participantRecipients(tournament, actorUserId);
    await this.sendNotifications(recipients, notification);
  }

  /** Notification failures are logged, never surfaced: the edit/delete already succeeded. */
  private async sendNotifications(
    userIds: string[],
    notification: { title: string; message: string; link: string },
  ): Promise<void> {
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

    const membership = await this.communityMembersRepository.findOne({
      where: {
        communityId: tournament.communityId,
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

      // Check if player is already registered
      const existing = await this.participantsRepository.findOne({
        where: { tournamentId, userId },
      });

      if (existing) {
        throw new BadRequestException(
          'You are already registered for this tournament',
        );
      }

      const participant = this.participantsRepository.create({
        tournamentId,
        participantType: ParticipantType.PLAYER,
        userId,
        registeredByUserId: userId,
        status: ParticipantStatus.REGISTERED,
      });

      return this.participantsRepository.save(participant);
    }

    // CvC Tournament registration
    if (!dto.clubId) {
      throw new BadRequestException(
        'clubId is required to register for a CvC tournament',
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
      tournament.communityId,
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

    const participant = this.participantsRepository.create({
      tournamentId,
      participantType: ParticipantType.CLUB,
      clubId: dto.clubId,
      registeredByUserId: userId,
      status: ParticipantStatus.REGISTERED,
    });

    return this.participantsRepository.save(participant);
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

      // Check required counts
      if (dto.starters.length !== tournament.startersCount) {
        throw new BadRequestException(
          `Lineup must have exactly ${tournament.startersCount} starters (received ${dto.starters.length})`,
        );
      }

      if (dto.substitutes.length > tournament.subsCount) {
        throw new BadRequestException(
          `Lineup cannot exceed ${tournament.subsCount} substitutes (received ${dto.substitutes.length})`,
        );
      }
    }

    participant.lineup = {
      teamId: dto.teamId ?? null,
      teamName: dto.teamName ?? null,
      starters: dto.starters,
      substitutes: dto.substitutes,
    };
    participant.status = ParticipantStatus.LINEUP_SUBMITTED;
    participant.submittedAt = new Date();
    participant.submittedByUserId = userId;

    return this.participantsRepository.save(participant);
  }

  async generateBracket(
    userId: string,
    tournamentId: string,
  ): Promise<Tournament> {
    const tournament = await this.findOne(tournamentId);
    await this.assertCanManage(userId, tournament, 'generate brackets');

    const participants = tournament.participants ?? [];
    if (participants.length < 2) {
      throw new BadRequestException(
        'At least 2 participants are required to generate a bracket',
      );
    }

    // Build single-elimination tournament bracket
    const matches: BracketMatch[] = [];
    const count = participants.length;

    // Determine round name based on participant count
    let roundName = 'Match';
    if (count <= 2) roundName = 'Final';
    else if (count <= 4) roundName = 'Semi-final';
    else if (count <= 8) roundName = 'Quarter-final';
    else roundName = 'Round of 16';

    let matchNumber = 1;
    for (let i = 0; i < participants.length; i += 2) {
      const pA = participants[i];
      const pB = participants[i + 1] ?? null;

      matches.push({
        id: `match-${matchNumber}-${Date.now()}`,
        round: roundName,
        matchNumber,
        participantA: {
          id: pA.id,
          name: pA.club?.name ?? pA.user?.name ?? 'Player A',
          dpUrl: pA.club?.dpUrl ?? pA.user?.dpUrl ?? null,
          score: null,
        },
        participantB: pB
          ? {
              id: pB.id,
              name: pB.club?.name ?? pB.user?.name ?? 'Player B',
              dpUrl: pB.club?.dpUrl ?? pB.user?.dpUrl ?? null,
              score: null,
            }
          : null,
        winnerId: pB ? null : pA.id, // Automatic Bye if odd number
        status: pB ? 'pending' : 'completed',
      });
      matchNumber++;
    }

    tournament.bracket = matches;
    tournament.status = TournamentStatus.ONGOING;

    return this.tournamentsRepository.save(tournament);
  }
}
