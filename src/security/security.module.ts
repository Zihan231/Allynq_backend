import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoginEvent } from '../activity/entities/login-event.entity.js';
import { SecurityBan } from './security-ban.entity.js';
import { SecurityService } from './security.service.js';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([SecurityBan, LoginEvent])],
  providers: [SecurityService],
  exports: [SecurityService],
})
export class SecurityModule {}
