import { Module } from '@nestjs/common';
import { StatsController } from './stats.controller.js';
import { StatsService } from './stats.service.js';

@Module({
  controllers: [StatsController],
  exports: [StatsService],
  providers: [StatsService],
})
export class StatsModule {}
