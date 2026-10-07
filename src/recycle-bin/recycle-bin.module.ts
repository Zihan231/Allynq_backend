import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RecycleBinItem } from './recycle-bin-item.entity.js';
import { RecycleBinService } from './recycle-bin.service.js';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([RecycleBinItem])],
  providers: [RecycleBinService],
  exports: [RecycleBinService],
})
export class RecycleBinModule {}
