import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Club } from '../clubs/entities/club.entity.js';
import { ClubRole, CommunityRole } from '../users/enums/user-attributes.enum.js';
import { Community } from '../communities/entities/community.entity.js';
import { CommunityMember } from '../communities/entities/community-member.entity.js';
import { EfootballProfile } from '../users/entities/efootball-profile.entity.js';
import { User } from '../users/entities/user.entity.js';
import { CreateTournamentDto } from './dto/create-tournament.dto.js';
import { JoinTournamentDto } from './dto/join-tournament.dto.js';
import { SubmitLineupDto } from './dto/submit-lineup.dto.js';
import { TournamentQueryDto } from './dto/tournament-query.dto.js';
import {
  BracketMatch,
  Tournament,
} from './entities/tournament.entity.js';
import { TournamentParticipant } from './entities/tournament-participant.entity.js';
import {
  ParticipantStatus,
  ParticipantType,
  TournamentPreset,
  TournamentStatus,
  TournamentType,
} from './enums/tournament.enum.js';

@Injectable()
export class TournamentsService {
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

    const isAuthority =
      membership &&
      (membership.role === CommunityRole.PRESIDENT ||
        membership.role === CommunityRole.VICE_PRESIDENT);

    if (!isAuthority) {
      throw new ForbiddenException(
        'Only the Community President or Vice President can create tournaments',
      );
    }

    const startAt = new Date(dto.startAt);
    if (isNaN(startAt.getTime())) {
      throw new BadRequestException('Invalid startAt datetime');
    }

    // Automatically calculate lineup submission deadline = 2 hours before startAt
    const teamSubmissionDeadline = new Date(startAt.getTime() - 2 * 60 * 60 * 1000);

    // Preset configurations
    let startersCount = dto.startersCount ?? 11;
    let subsCount = dto.subsCount ?? 5;
    const preset = dto.preset ?? TournamentPreset.ELEVEN_V_ELEVEN;

    if (preset === TournamentPreset.ELEVEN_V_ELEVEN) {
      startersCount = 11;
      subsCount = 5;
    } else if (preset === TournamentPreset.EIGHT_V_EIGHT) {
      startersCount = 8;
      subsCount = 4;
    }

    const tournament = this.tournamentsRepository.create({
      name: dto.name,
      description: dto.description ?? null,
      type: dto.type,
      status: TournamentStatus.REGISTRATION_OPEN,
      preset,
      startersCount,
      subsCount,
      maxParticipants: dto.maxParticipants ?? 16,
      entryFeeBdt: dto.entryFeeBdt ?? 0,
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

  async findAll(query: TournamentQueryDto) {
    const qb = this.tournamentsRepository
      .createQueryBuilder('t')
      .leftJoinAndSelect('t.community', 'community')
      .leftJoinAndSelect('t.creator', 'creator')
      .leftJoinAndSelect('t.participants', 'participants')
      .leftJoinAndSelect('participants.club', 'club')
      .leftJoinAndSelect('participants.user', 'user');

    if (query.type) {
      qb.andWhere('t.type = :type', { type: query.type });
    }

    if (query.communityId) {
      qb.andWhere('t.communityId = :communityId', { communityId: query.communityId });
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

    return qb.getMany();
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

  async join(userId: string, tournamentId: string, dto: JoinTournamentDto): Promise<TournamentParticipant> {
    const tournament = await this.findOne(tournamentId);

    if (tournament.status !== TournamentStatus.REGISTRATION_OPEN) {
      throw new BadRequestException('Tournament registration is not currently open');
    }

    const now = new Date();
    if (tournament.registrationDeadline && now > new Date(tournament.registrationDeadline)) {
      throw new BadRequestException('Registration deadline has passed for this tournament');
    }

    const participantCount = tournament.participants?.length ?? 0;
    if (participantCount >= tournament.maxParticipants) {
      throw new BadRequestException('Tournament is already at maximum capacity');
    }

    const callerProfile = await this.profilesRepository.findOne({
      where: { userId },
    });

    if (!callerProfile) {
      throw new BadRequestException('User profile not found');
    }

    if (tournament.type === TournamentType.PVP) {
      // Check that the player is a member of this tournament's community
      const isCommunityMember =
        callerProfile.communityId === tournament.communityId ||
        tournament.community?.presidentId === userId ||
        tournament.community?.vicePresidentId === userId;

      const membership = await this.communityMembersRepository.findOne({
        where: { communityId: tournament.communityId, profileId: callerProfile.id },
      });

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
        throw new BadRequestException('You are already registered for this tournament');
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
      throw new BadRequestException('clubId is required to register for a CvC tournament');
    }

    const club = await this.clubsRepository.findOne({
      where: { id: dto.clubId },
      relations: { members: true },
    });

    if (!club) {
      throw new NotFoundException(`Club ${dto.clubId} not found`);
    }

    // 1. Club must be a member of the tournament's hosting community
    const isCommunityMember =
      club.communityIds?.includes(tournament.communityId);

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
      throw new BadRequestException('This club is already registered for this tournament');
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
      const memberRecord = club?.members?.find((m) => m.id === callerProfile.id);
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

  async generateBracket(userId: string, tournamentId: string): Promise<Tournament> {
    const tournament = await this.findOne(tournamentId);

    // Authority: Community President/VP or Tournament creator
    const callerProfile = await this.profilesRepository.findOne({ where: { userId } });
    if (!callerProfile) {
      throw new ForbiddenException('Profile not found');
    }

    const membership = await this.communityMembersRepository.findOne({
      where: { communityId: tournament.communityId, profileId: callerProfile.id },
    });

    const isAuthority =
      tournament.creatorId === userId ||
      (membership &&
        (membership.role === CommunityRole.PRESIDENT ||
          membership.role === CommunityRole.VICE_PRESIDENT));

    if (!isAuthority) {
      throw new ForbiddenException(
        'Only the Community President, Vice President, or creator can generate brackets',
      );
    }

    const participants = tournament.participants ?? [];
    if (participants.length < 2) {
      throw new BadRequestException('At least 2 participants are required to generate a bracket');
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
