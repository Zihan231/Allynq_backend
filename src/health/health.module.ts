import { Controller, Get, Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { SettingsService } from '../settings/settings.service.js';
import { JobMonitorService } from './job-monitor.service.js';
import { PlatformInterceptor } from './platform.interceptor.js';

/** What every visitor may know about the platform's state: maintenance and which features are on. */
@Controller('settings')
export class PublicSettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get('public')
  async publicSettings() {
    const [maintenance, features] = await Promise.all([this.settings.maintenance(), this.settings.features()]);
    return { maintenance, features };
  }
}

@Global()
@Module({
  controllers: [PublicSettingsController],
  providers: [JobMonitorService, { provide: APP_INTERCEPTOR, useClass: PlatformInterceptor }],
  exports: [JobMonitorService],
})
export class HealthModule {}
