import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard.js';
import { User } from '../users/entities/user.entity.js';
import { FEED_TABS, FeedService, type FeedTab } from './feed.service.js';

class FeedQueryDto {
  @IsOptional() @IsIn(FEED_TABS) tab?: FeedTab;
  @IsOptional() @IsString() @MaxLength(200) cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(20) limit?: number;
}

class CommentsQueryDto {
  @IsOptional() @IsISO8601() before?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
}

class CommentDto {
  @IsString() @MinLength(1) @MaxLength(1000) body!: string;
}

class SeenDto {
  @IsArray() @ArrayMaxSize(50) @IsUUID('all', { each: true }) postIds!: string[];
}

/** The coaching feed and its interactions: likes, saves, comments, follows, seen marks. */
@Controller('feed')
export class FeedController {
  constructor(private readonly feed: FeedService) {}

  /** Signed out: the general ranking ("for_you" only). */
  @UseGuards(OptionalJwtAuthGuard)
  @Get()
  list(@Query() query: FeedQueryDto, @CurrentUser() viewer?: User) {
    return this.feed.feed(viewer?.id ?? null, query.tab ?? 'for_you', query.cursor, query.limit);
  }

  @UseGuards(JwtAuthGuard)
  @Post('posts/:id/like')
  like(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.feed.toggle('like', user, id, true);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('posts/:id/like')
  unlike(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.feed.toggle('like', user, id, false);
  }

  @UseGuards(JwtAuthGuard)
  @Post('posts/:id/save')
  save(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.feed.toggle('save', user, id, true);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('posts/:id/save')
  unsave(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.feed.toggle('save', user, id, false);
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Get('posts/:id/comments')
  comments(@Param('id', ParseUUIDPipe) id: string, @Query() query: CommentsQueryDto, @CurrentUser() viewer?: User) {
    return this.feed.comments(id, viewer?.id ?? null, query.before, query.limit);
  }

  @UseGuards(JwtAuthGuard)
  @Post('posts/:id/comments')
  comment(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CommentDto) {
    return this.feed.addComment(user, id, dto.body);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('comments/:id')
  deleteComment(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.feed.deleteComment(user, id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('seen')
  seen(@CurrentUser() user: User, @Body() dto: SeenDto) {
    return this.feed.markSeen(user, dto.postIds);
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Get('coaches/:id/follow')
  followStats(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() viewer?: User) {
    return this.feed.followStats(id, viewer?.id ?? null);
  }

  @UseGuards(JwtAuthGuard)
  @Post('coaches/:id/follow')
  follow(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.feed.follow(user, id, true);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('coaches/:id/follow')
  unfollow(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.feed.follow(user, id, false);
  }
}
