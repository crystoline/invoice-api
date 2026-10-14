import { Body, Controller, Post } from '@nestjs/common';
import { PlanService } from './plan.service';
import { SubRequestDto } from './dto/plan.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';

/** PlanController — `/api/plans`. */
@Controller('plans')
export class PlanController {
  constructor(private readonly plans: PlanService) {}

  // Legacy one-off charge at a single price that ignores the user's billing
  // jurisdiction. Subscriptions go through /api/subscription/checkout; this is
  // kept for platform staff only.
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Post('subscribe')
  subscribe(@Body() dto: SubRequestDto) {
    return this.plans.subscribe(dto);
  }
}
