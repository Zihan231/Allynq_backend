import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
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
import { User } from '../users/entities/user.entity.js';
import { SystemRole } from '../users/enums/user-attributes.enum.js';
import {
  AdminReportsQueryDto,
  AssignReportDto,
  CreateReportDto,
  MyReportsQueryDto,
  ReportMessageDto,
  ResolveReportDto,
  StaffNoteDto,
} from './dto/report.dto.js';
import { MAX_REPORT_IMAGES, reportFileUrl, reportUploadOptions } from './report-upload.js';
import { ReportsService } from './reports.service.js';

/** Players (and club / community leaders) report problems and follow them up. */
@Controller('reports')
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** Multipart: the report fields plus up to 3 proof images in "images". */
  @Post()
  @UseInterceptors(FilesInterceptor('images', MAX_REPORT_IMAGES, reportUploadOptions))
  create(@CurrentUser() user: User, @Body() dto: CreateReportDto, @UploadedFiles() files: Express.Multer.File[] = []) {
    return this.reports.create(user, dto, files.map(reportFileUrl));
  }

  @Get('mine')
  mine(@CurrentUser() user: User, @Query() query: MyReportsQueryDto) {
    return this.reports.mine(user, query);
  }

  @Get(':id')
  detail(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.reports.reporterDetail(user, id);
  }

  @Post(':id/messages')
  reply(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReportMessageDto) {
    return this.reports.reply(user, id, dto.body);
  }

  @Post(':id/withdraw')
  withdraw(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.reports.withdraw(user, id);
  }
}

const ctx = (req: Request) => ({ ip: req.ip ?? null });

/** The staff report centre. Moderators and up; actions on the target keep their own role checks. */
@Controller('admin/reports')
@UseGuards(JwtAuthGuard, SystemRoleGuard)
@RequireSystemRole(SystemRole.MODERATOR)
export class AdminReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  list(@CurrentUser() actor: User, @Query() query: AdminReportsQueryDto) {
    return this.reports.list(actor, query);
  }

  @Get('counts')
  counts(@CurrentUser() actor: User) {
    return this.reports.counts(actor);
  }

  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.reports.staffDetail(id);
  }

  @Post(':id/assign')
  assign(@CurrentUser() actor: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignReportDto, @Req() req: Request) {
    return this.reports.assign(actor, id, dto, ctx(req));
  }

  @Post(':id/notes')
  note(@CurrentUser() actor: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StaffNoteDto) {
    return this.reports.staffNote(actor, id, dto.body, Boolean(dto.internal));
  }

  @Post(':id/resolve')
  resolve(@CurrentUser() actor: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ResolveReportDto, @Req() req: Request) {
    return this.reports.resolve(actor, id, dto, ctx(req));
  }
}
