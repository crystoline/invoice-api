import { Body, Controller, Post } from '@nestjs/common';
import { PlanService } from './plan.service';
import { SubRequestDto } from './dto/plan.dto';
import { Authenticated } from '../common/authz/authz.decorators';
import { isPlatformAdmin } from '../common/authz/permissions';
import {
  CurrentUser,
  type AuthUser,
} from '../common/decorators/current-user.decorator';

/** PlanController — `/api/plans`. */
@Controller('plans')
export class PlanController {
  constructor(private readonly plans: PlanService) {}

  // Legacy: the body names the user to subscribe. Only platform admins may
  // subscribe someone else; everyone else always subscribes themselves.
  @Authenticated()
  @Post('subscribe')
  subscribe(@Body() dto: SubRequestDto, @CurrentUser() user: AuthUser) {
    if (!isPlatformAdmin(user) || dto.UserId == null) {
      dto.UserId = Number(user.id);
    }
    return this.plans.subscribe(dto);
  }
}
