import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import type { Request } from 'express';
import { RequireSystemRole, SystemRoleGuard } from '../admin/system-role.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { User } from '../users/entities/user.entity.js';
import { SystemRole } from '../users/enums/user-attributes.enum.js';
import { CREATOR_CATEGORIES, DESIGN_FILE_FIELDS, designUploadOptions, type CreatorCategory, type DesignFiles } from './creators-upload.js';
import { CreatorsService, RARITIES, type Rarity } from './creators.service.js';

/** Multipart booleans arrive as "true" / "false". */
const toBool = ({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value);

class DesignDto {
  @IsOptional() @IsIn(CREATOR_CATEGORIES) category?: CreatorCategory;
  @IsOptional() @IsString() @MaxLength(60) name?: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100_000) priceTk?: number;
  @IsOptional() @IsIn(RARITIES) rarity?: Rarity;
  @IsOptional() @Matches(/^#[0-9a-fA-F]{6}$/) primaryColor?: string;
  @IsOptional() @Matches(/^#[0-9a-fA-F]{6}$/) secondaryColor?: string;
  @IsOptional() @Transform(toBool) @IsBoolean() active?: boolean;
  @IsOptional() @Transform(toBool) @IsBoolean() resubmit?: boolean;
}

class ReviewDesignDto {
  @IsBoolean() approve!: boolean;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100_000) priceTk?: number;
  @IsOptional() @IsIn(RARITIES) rarity?: Rarity;
}

class AdminDesignsQueryDto extends PaginationQueryDto {
  @IsOptional() @IsIn(['pending', 'approved', 'rejected']) status?: 'pending' | 'approved' | 'rejected';
}

/** Creators: submit and manage designs for the store. */
@Controller('creators')
export class CreatorsController {
  constructor(private readonly creators: CreatorsService) {}

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: User) {
    return this.creators.me(user);
  }

  /** Multipart: the design's fields plus its files (image / frame / banner / stickers, by type). */
  @UseGuards(JwtAuthGuard)
  @Post('designs')
  @UseInterceptors(FileFieldsInterceptor(DESIGN_FILE_FIELDS, designUploadOptions))
  create(@CurrentUser() user: User, @Body() dto: DesignDto, @UploadedFiles() files?: DesignFiles) {
    return this.creators.create(user, dto, files ?? {});
  }

  @UseGuards(JwtAuthGuard)
  @Patch('designs/:id')
  @UseInterceptors(FileFieldsInterceptor(DESIGN_FILE_FIELDS, designUploadOptions))
  update(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DesignDto, @UploadedFiles() files?: DesignFiles) {
    return this.creators.update(user, id, dto, files ?? {});
  }

  @UseGuards(JwtAuthGuard)
  @Delete('designs/:id')
  remove(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.creators.remove(user, id);
  }

  @Get(':id')
  creator(@Param('id', ParseUUIDPipe) id: string) {
    return this.creators.publicCreator(id);
  }
}

/** Staff: the design review queue (moderators and up; price / rarity changes need an admin). */
@Controller('admin/creators')
@UseGuards(JwtAuthGuard, SystemRoleGuard)
@RequireSystemRole(SystemRole.MODERATOR)
export class AdminCreatorsController {
  constructor(private readonly creators: CreatorsService) {}

  @Get('designs')
  designs(@Query() query: AdminDesignsQueryDto) {
    return this.creators.adminList(query.status ?? 'pending', query.page, query.limit);
  }

  @Post('designs/:id/review')
  review(@CurrentUser() actor: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewDesignDto, @Req() req: Request) {
    return this.creators.review(actor, id, dto, req.ip ?? null);
  }
}
