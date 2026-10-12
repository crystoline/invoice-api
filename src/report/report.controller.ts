import { Controller, Get, Query } from '@nestjs/common';
import { ReportService } from './report.service';
import { ReportQueryDto } from './dto/report-query.dto';
import { BusinessPermission } from '../common/authz/authz.decorators';
import { Permission } from '../common/authz/permissions';

/**
 * ReportController — `/api/reports`. All routes are authenticated (global JWT
 * guard) and owner-scoped: reports are keyed by `businessId` and only the
 * owning user (or an admin) may read a business's figures. Every endpoint
 * accepts `?businessId=&from=&to=&format=csv`.
 */
@BusinessPermission(Permission.VIEW, { query: 'businessId' })
@Controller('reports')
export class ReportController {
  constructor(private readonly reports: ReportService) {}

  @Get('revenue')
  revenue(@Query() query: ReportQueryDto) {
    return this.reports.revenue(query);
  }

  @Get('expenses')
  expenses(@Query() query: ReportQueryDto) {
    return this.reports.expenses(query);
  }

  @Get('aging')
  aging(@Query() query: ReportQueryDto) {
    return this.reports.aging(query);
  }

  @Get('tax-summary')
  taxSummary(@Query() query: ReportQueryDto) {
    return this.reports.taxSummary(query);
  }
}
