import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateIf } from 'class-validator';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { PlayerItemCategory } from '../admin/entities/store-item.entity.js';
import { User } from '../users/entities/user.entity.js';
import { StoreService } from './store.service.js';

const CATEGORIES = ['badge', 'title', 'frame', 'theme'] as const;

export class PurchaseDto {
  @IsString()
  @MaxLength(64)
  sku!: string;

  /** Equip it right away (default true). */
  @IsOptional()
  @IsBoolean()
  equip?: boolean;

  /** A club theme: the club it's for (paid from the club wallet by its President / GS). */
  @IsOptional()
  @IsUUID()
  clubId?: string;

  /** A tournament banner: the tournament to put it on straight away. */
  @IsOptional()
  @IsUUID()
  tournamentId?: string;
}

/** Which look of a design to show: a version number, or null to follow the latest. */
export class DesignVersionDto {
  @IsString()
  @MaxLength(64)
  sku!: string;

  @ValidateIf((dto: DesignVersionDto) => dto.version !== null)
  @IsInt()
  @Min(1)
  version!: number | null;

  /** A club theme: the club whose look changes (its President / GS). */
  @IsOptional()
  @IsUUID()
  clubId?: string;
}

/** A club theme or tournament banner to show, or null for none. */
export class SetSkuDto {
  @ValidateIf((dto: SetSkuDto) => dto.sku !== null)
  @IsString()
  @MaxLength(64)
  sku!: string | null;
}

export class EquipDto {
  @IsIn(CATEGORIES)
  category!: PlayerItemCategory;

  /** The owned item to wear, or null to take this category off. */
  @ValidateIf((dto: EquipDto) => dto.sku !== null)
  @IsString()
  @MaxLength(64)
  sku!: string | null;
}

/** The cosmetics store for signed-in users. (`GET /store/items` lists every item, for staff tools.) */
@Controller('store')
export class StoreController {
  constructor(private readonly store: StoreService) {}

  /** Items on sale. */
  @Get('catalog')
  catalog() {
    return this.store.catalog();
  }

  /** My wallet balance, owned items and what I'm wearing. */
  @UseGuards(JwtAuthGuard)
  @Get('me')
  mine(@CurrentUser() user: User) {
    return this.store.mine(user.id);
  }

  /** Buy an item from my wallet (free items are just added). */
  @UseGuards(JwtAuthGuard)
  @Post('purchase')
  purchase(@CurrentUser() user: User, @Body() dto: PurchaseDto) {
    if (dto.clubId) return this.store.purchaseForClub(user.id, dto.clubId, dto.sku, dto.equip ?? true);
    return this.store.purchase(user.id, dto.sku, dto.equip ?? true, dto.tournamentId);
  }

  /** A club's themes and wallet balance (its President / General Secretary). */
  @UseGuards(JwtAuthGuard)
  @Get('clubs/:clubId')
  club(@CurrentUser() user: User, @Param('clubId', ParseUUIDPipe) clubId: string) {
    return this.store.club(user.id, clubId);
  }

  /** Keep an earlier look of a design I (or my club) own, or follow the latest. */
  @UseGuards(JwtAuthGuard)
  @Post('version')
  setVersion(@CurrentUser() user: User, @Body() dto: DesignVersionDto) {
    return this.store.setDesignVersion(user.id, dto.sku, dto.version, dto.clubId);
  }

  /** Put one of the club's themes on its page, or take it off. */
  @UseGuards(JwtAuthGuard)
  @Post('clubs/:clubId/theme')
  setClubTheme(@CurrentUser() user: User, @Param('clubId', ParseUUIDPipe) clubId: string, @Body() dto: SetSkuDto) {
    return this.store.setClubTheme(user.id, clubId, dto.sku);
  }

  /** Put a banner I own on a tournament I manage, or take it off. */
  @UseGuards(JwtAuthGuard)
  @Post('tournaments/:tournamentId/banner')
  setBanner(@CurrentUser() user: User, @Param('tournamentId', ParseUUIDPipe) tournamentId: string, @Body() dto: SetSkuDto) {
    return this.store.setTournamentBanner(user.id, tournamentId, dto.sku);
  }

  /** Wear an item I own, or take a category off. */
  @UseGuards(JwtAuthGuard)
  @Post('equip')
  equip(@CurrentUser() user: User, @Body() dto: EquipDto) {
    return this.store.equip(user.id, dto.category, dto.sku);
  }
}
