import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { StoreItemCategory } from '../admin/entities/store-item.entity.js';
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
}

export class EquipDto {
  @IsIn(CATEGORIES)
  category!: StoreItemCategory;

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
    return this.store.purchase(user.id, dto.sku, dto.equip ?? true);
  }

  /** Wear an item I own, or take a category off. */
  @UseGuards(JwtAuthGuard)
  @Post('equip')
  equip(@CurrentUser() user: User, @Body() dto: EquipDto) {
    return this.store.equip(user.id, dto.category, dto.sku);
  }
}
