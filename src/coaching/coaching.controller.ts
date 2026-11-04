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
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { RequireSystemRole, SystemRoleGuard } from '../admin/system-role.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { User } from '../users/entities/user.entity.js';
import { SystemRole } from '../users/enums/user-attributes.enum.js';
import { coachingUploadOptions, MAX_POST_FILES } from './coaching-upload.js';
import { CoachingService } from './coaching.service.js';
import {
  AdminCoachPostsQueryDto,
  CoachesQueryDto,
  CounterCoachingDealDto,
  CreateCoachingDealDto,
  CreateCoachPostDto,
  RespondCoachingDealDto,
  ReviewCoachPostDto,
  UpdateCoachProfileDto,
} from './dto/coaching.dto.js';

const ctx = (req: Request) => ({ ip: req.ip ?? null });

@Controller('coaching')
export class CoachingController {
  constructor(private readonly coaching: CoachingService) {}

  // ------------------------------------------------------------- directory

  @Get('coaches')
  coaches(@Query() query: CoachesQueryDto) {
    return this.coaching.listCoaches(query);
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Get('coaches/:userId')
  coach(@Param('userId', ParseUUIDPipe) userId: string, @CurrentUser() viewer?: User) {
    return this.coaching.coachDetail(userId, viewer?.id ?? null);
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Get('clubs/:clubId')
  club(@Param('clubId', ParseUUIDPipe) clubId: string, @CurrentUser() viewer?: User) {
    return this.coaching.clubCoaching(clubId, viewer?.id ?? null);
  }

  // ------------------------------------------------------------------ coach

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: User) {
    return this.coaching.me(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Put('me/profile')
  updateProfile(@CurrentUser() user: User, @Body() dto: UpdateCoachProfileDto) {
    return this.coaching.upsertProfile(user, dto);
  }

  /** Multipart: body, links (one per line) + up to 4 images / videos as `media`. Staff approve it before it's public. */
  @UseGuards(JwtAuthGuard)
  @Post('me/posts')
  @UseInterceptors(FilesInterceptor('media', MAX_POST_FILES, coachingUploadOptions))
  createPost(@CurrentUser() user: User, @Body() dto: CreateCoachPostDto, @UploadedFiles() files?: Express.Multer.File[]) {
    return this.coaching.createPost(user, dto, files ?? []);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('me/posts/:id')
  deletePost(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.coaching.deletePost(user, id);
  }

  // ------------------------------------------------------------------ deals

  @UseGuards(JwtAuthGuard)
  @Post('deals')
  createDeal(@CurrentUser() user: User, @Body() dto: CreateCoachingDealDto) {
    return this.coaching.create(user, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('deals/:id')
  deal(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.coaching.getDeal(user, id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('deals/:id/respond')
  respond(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RespondCoachingDealDto) {
    return this.coaching.respond(user, id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('deals/:id/counter')
  counter(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CounterCoachingDealDto) {
    return this.coaching.counter(user, id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('deals/:id/cancel')
  cancel(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.coaching.cancel(user, id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('deals/:id/end')
  end(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.coaching.end(user, id);
  }
}

/** Staff: the post review queue (moderators and up) and the deals ledger (admins). */
@Controller('admin/coaching')
@UseGuards(JwtAuthGuard, SystemRoleGuard)
@RequireSystemRole(SystemRole.MODERATOR)
export class AdminCoachingController {
  constructor(private readonly coaching: CoachingService) {}

  @Get('posts')
  posts(@Query() query: AdminCoachPostsQueryDto) {
    return this.coaching.adminPosts(query);
  }

  @Post('posts/:id/review')
  review(@CurrentUser() actor: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewCoachPostDto, @Req() req: Request) {
    return this.coaching.reviewPost(actor, id, dto, ctx(req));
  }

  @RequireSystemRole(SystemRole.ADMIN)
  @Get('deals')
  deals(@Query() query: PaginationQueryDto) {
    return this.coaching.adminDeals(query);
  }
}
