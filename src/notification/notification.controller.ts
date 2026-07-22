import { Body, Controller, Get, Put } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator';
import { NotificationPreferencesDto } from './dto/notification-preferences.dto';

/** NotificationPreferencesController — `/api/notification-preferences`. */
@Controller('notification-preferences')
export class NotificationController {
  constructor(private readonly service: NotificationService) {}

  @Get()
  get(@CurrentUser() user: AuthUser) {
    return this.service.getForUser(user.id);
  }

  @Put()
  update(@Body() dto: NotificationPreferencesDto, @CurrentUser() user: AuthUser) {
    return this.service.update(user.id, dto);
  }
}
