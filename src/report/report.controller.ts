import { Controller, Get, Query } from '@nestjs/common';
import { ReportService } from './report.service';
import { ReportQueryDto } from './dto/report-query.dto';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator';

/**
 * ReportController — `/api/reports`. All routes are authenticated (global JWT
 * guard) and owner-scoped: reports are keyed by `businessId` and only the
 * owning user (or an admin) may read a business's figures. Every endpoint
 * accepts `?businessId=&from=&to=&format=csv`.
 */
@Controller('reports')
export class ReportController {
  constructor(private readonly reports: ReportService) {}

  @Get('revenue')
  revenue(@Query() query: ReportQueryDto, @CurrentUser() user: AuthUser) {
    return this.reports.revenue(query, user);
  }

  @Get('expenses')
  expenses(@Query() query: ReportQueryDto, @CurrentUser() user: AuthUser) {
    return this.reports.expenses(query, user);
  }

  @Get('aging')
  aging(@Query() query: ReportQueryDto, @CurrentUser() user: AuthUser) {
    return this.reports.aging(query, user);
  }

  @Get('tax-summary')
  taxSummary(@Query() query: ReportQueryDto, @CurrentUser() user: AuthUser) {
    return this.reports.taxSummary(query, user);
  }
}
