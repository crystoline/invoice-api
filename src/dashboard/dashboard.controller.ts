import { Controller, Get, Param, Query } from '@nestjs/common';
import { DashboardService } from './dashboard.service';

/** DashboardController — `/api/dashboard`. */
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('business/:businessId/stats')
  stats(@Param('businessId') businessId: string, @Query('currency') currency?: string) {
    return this.dashboard.getStats(BigInt(businessId), currency);
  }

  @Get('business/:businessId/cashflow')
  cashflow(
    @Param('businessId') businessId: string,
    @Query('range') range?: string,
    @Query('currency') currency?: string,
  ) {
    return this.dashboard.getCashflow(BigInt(businessId), range ?? '7m', currency);
  }

  @Get('business/:businessId/activity')
  activity(@Param('businessId') businessId: string) {
    return this.dashboard.getActivity(BigInt(businessId));
  }
}
