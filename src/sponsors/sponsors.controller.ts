import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateNested } from 'class-validator';
import type { Request } from 'express';
import { RequireSystemRole, SystemRoleGuard } from '../admin/system-role.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard.js';
import { coachingUploadOptions, MAX_POST_FILES } from '../coaching/coaching-upload.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { User } from '../users/entities/user.entity.js';
import { SystemRole } from '../users/enums/user-attributes.enum.js';
import { SPONSOR_TIERS, type SponsorTargetType, type SponsorTier } from './entities/sponsor.entities.js';
import { BRAND_FILE_FIELDS, brandUploadOptions, type BrandFiles } from './sponsors-upload.js';
import { SponsorsService } from './sponsors.service.js';

const TARGETS = ['tournament', 'community'] as const;

class SponsorProfileDto {
  @IsOptional() @IsString() @MaxLength(80) brandName?: string;
  @IsOptional() @IsString() @MaxLength(140) tagline?: string;
  @IsOptional() @IsString() @MaxLength(2000) about?: string;
  @IsOptional() @IsString() @MaxLength(500) website?: string;
  @IsOptional() @IsString() @MaxLength(500) facebookUrl?: string;
  @IsOptional() @IsString() @MaxLength(60) industry?: string;
}

class SponsorPostDto {
  @IsOptional() @IsString() @MaxLength(5000) body?: string;
  /** JSON array or one link per line. */
  @IsOptional() @IsString() @MaxLength(3000) links?: string;
}

class SponsorsQueryDto extends PaginationQueryDto {
  @IsOptional() @IsString() @MaxLength(80) search?: string;
  @IsOptional() @IsIn(['true', 'false']) verified?: string;
}

class CreateSponsorshipDto {
  @IsIn(TARGETS) targetType!: SponsorTargetType;
  @IsUUID() targetId!: string;
  @IsOptional() @IsUUID() sponsorUserId?: string;
  @IsIn(SPONSOR_TIERS) tier!: SponsorTier;
  @Type(() => Number) @IsInt() @Min(0) amountTk!: number;
  @IsOptional() @Type(() => Number) @IsInt() days?: number;
  @IsOptional() @IsString() @MaxLength(1000) message?: string;
}

class RespondSponsorshipDto {
  @IsBoolean() accept!: boolean;
}

class CounterSponsorshipDto {
  @Type(() => Number) @IsInt() @Min(0) amountTk!: number;
  @IsOptional() @IsIn(SPONSOR_TIERS) tier?: SponsorTier;
  @IsOptional() @Type(() => Number) @IsInt() days?: number;
  @IsOptional() @IsString() @MaxLength(1000) message?: string;
}

class SponsorCallDto {
  @IsIn(TARGETS) targetType!: SponsorTargetType;
  @IsUUID() targetId!: string;
  @IsArray() @IsIn(SPONSOR_TIERS, { each: true }) tiers!: SponsorTier[];
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) askTk?: number;
}

class ImpressionDto {
  @IsUUID() sponsorshipId!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) views?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) clicks?: number;
}

class ImpressionsDto {
  @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => ImpressionDto) items!: ImpressionDto[];
}

class VerifySponsorDto {
  @IsBoolean() verified!: boolean;
}

/** Sponsors: profile, posts, directory and public pages. */
@Controller('sponsors')
export class SponsorsController {
  constructor(private readonly sponsors: SponsorsService) {}

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: User) {
    return this.sponsors.me(user);
  }

  /** Multipart: brand fields, plus an optional `logo` and `banner` image. */
  @UseGuards(JwtAuthGuard)
  @Put('me')
  @UseInterceptors(FileFieldsInterceptor(BRAND_FILE_FIELDS, brandUploadOptions))
  updateProfile(@CurrentUser() user: User, @Body() dto: SponsorProfileDto, @UploadedFiles() files?: BrandFiles) {
    return this.sponsors.upsertProfile(user, dto, files ?? {});
  }

  @UseGuards(JwtAuthGuard)
  @Post('me/posts')
  @UseInterceptors(FilesInterceptor('media', MAX_POST_FILES, coachingUploadOptions))
  createPost(@CurrentUser() user: User, @Body() dto: SponsorPostDto, @UploadedFiles() files?: Express.Multer.File[]) {
    return this.sponsors.createPost(user, dto, files ?? []);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('me/posts/:id')
  deletePost(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.sponsors.deletePost(user, id);
  }

  @Get()
  list(@Query() query: SponsorsQueryDto) {
    return this.sponsors.list(query);
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Get(':userId')
  sponsor(@Param('userId', ParseUUIDPipe) userId: string, @CurrentUser() viewer?: User | null) {
    return this.sponsors.publicSponsor(userId, viewer?.id ?? null);
  }
}

/** Sponsorship deals, a target's sponsors, open calls and stats. */
@Controller('sponsorships')
export class SponsorshipsController {
  constructor(private readonly sponsors: SponsorsService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@CurrentUser() user: User, @Body() dto: CreateSponsorshipDto) {
    return this.sponsors.create(user, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/respond')
  respond(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RespondSponsorshipDto) {
    return this.sponsors.respond(user, id, dto.accept);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/counter')
  counter(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CounterSponsorshipDto) {
    return this.sponsors.counter(user, id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/cancel')
  cancel(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.sponsors.cancel(user, id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/end')
  end(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.sponsors.end(user, id);
  }

  /** Active sponsors of a tournament or community; its leaders also get pending deals. */
  @UseGuards(OptionalJwtAuthGuard)
  @Get('target/:type/:id')
  forTarget(@Param('type') type: string, @Param('id', ParseUUIDPipe) id: string, @CurrentUser() viewer?: User | null) {
    return this.sponsors.forTarget(type === 'community' ? 'community' : 'tournament', id, viewer?.id ?? null);
  }

  @Get('calls')
  calls() {
    return this.sponsors.calls();
  }

  @UseGuards(JwtAuthGuard)
  @Post('calls')
  openCall(@CurrentUser() user: User, @Body() dto: SponsorCallDto) {
    return this.sponsors.openCall(user, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('calls/:id')
  closeCall(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.sponsors.closeCall(user, id);
  }

  /** Logo / banner views and clicks, batched by the app. */
  @Post('impressions')
  impressions(@Body() dto: ImpressionsDto) {
    return this.sponsors.recordImpressions(dto.items);
  }
}

/** Staff: the sponsor list and the verified badge. */
@Controller('admin/sponsors')
@UseGuards(JwtAuthGuard, SystemRoleGuard)
@RequireSystemRole(SystemRole.MODERATOR)
export class AdminSponsorsController {
  constructor(private readonly sponsors: SponsorsService) {}

  @Get()
  list(@Query() query: SponsorsQueryDto) {
    return this.sponsors.adminList(query);
  }

  @RequireSystemRole(SystemRole.ADMIN)
  @Post(':userId/verify')
  verify(@CurrentUser() actor: User, @Param('userId', ParseUUIDPipe) userId: string, @Body() dto: VerifySponsorDto, @Req() req: Request) {
    return this.sponsors.verify(actor, userId, dto.verified, req.ip ?? null);
  }
}
