import { Body, Controller, Post } from '@nestjs/common';
import { PlanService } from './plan.service';
import { SubRequestDto } from './dto/plan.dto';

/** PlanController — `/api/plans`. */
@Controller('plans')
export class PlanController {
  constructor(private readonly plans: PlanService) {}

  @Post('subscribe')
  subscribe(@Body() dto: SubRequestDto) {
    return this.plans.subscribe(dto);
  }
}
